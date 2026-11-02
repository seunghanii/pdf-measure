/* JCP 도면 관리 서비스 워커 (앱으로 설치 + 앱 파일 보관)
 *
 * 빌드할 때 vite.config.js 의 pwaServiceWorker() 가 이 파일을 dist/sw.js 로 내보내며
 * __VERSION__ 과 __PRECACHE__ 를 이번 빌드 값으로 바꿉니다. (개발 서버에서는 등록하지 않음)
 *
 * - 앱 파일(assets/ 의 JS·CSS·워커)은 이름에 내용 해시가 붙어 있어 한 번 받으면 바뀌지 않음 → 보관함에서 바로 꺼냄
 * - 새로 배포하면 sw.js 내용이 바뀌어 새 워커가 깔리고, 바뀐 파일만 새로 받음(안 바뀐 파일은 예전 보관함에서 복사)
 * - 화면(index.html)은 늘 서버에 먼저 물어봄 → 새 배포가 바로 보임. 인터넷이 끊겼을 때만 보관해 둔 화면을 씀
 * - 바로 전 판 보관함 하나는 남겨 둠: 열어 둔 창이 예전 판 조각을 늦게 불러도 깨지지 않게
 * - 다른 주소(Supabase 로그인·DB·PDF 저장소)와 GET 이 아닌 요청은 건드리지 않음
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const PREFIX = 'jcp-app-'
const CACHE = PREFIX + VERSION
const OCR_CACHE = 'jcp-ocr'
const INDEX = new URL('./', self.location).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(
        PRECACHE.map(async (path) => {
          const url = new URL(path, self.location).href
          // 화면은 늘 새로 받음. 해시가 붙은 파일은 예전 보관함에 있으면 그대로 복사
          const old = url === INDEX ? null : await caches.match(url)
          const res = old || (await fetch(url, { cache: 'no-cache' }))
          if (!res.ok) throw new Error(`${url} ${res.status}`)
          await cache.put(url, res)
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 보관함 이름은 만든 순서대로 나옴. 이번 판과 바로 전 판만 남김
      const mine = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE)
      await Promise.all(mine.slice(0, -1).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req))
    return
  }
  const path = url.pathname
  if (path.includes('/assets/')) {
    event.respondWith(cacheFirst(req))
    return
  }
  // OCR 엔진 파일(수 MB)은 처음 OCR 할 때 받아 보관. 글자 데이터(.traineddata)는 tesseract 가 따로 보관하므로 제외
  if (path.includes('/ocr/') && !path.endsWith('.traineddata.gz')) {
    event.respondWith(staleWhileRevalidate(req, OCR_CACHE))
    return
  }
  // 아이콘·설명 파일 등은 보관함에 있으면 꺼내고 없으면 서버로
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)))
})

async function networkFirstPage(req) {
  try {
    const res = await fetch(req)
    if (res.ok && new URL(req.url).pathname.endsWith('/')) {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(INDEX, copy))
    }
    return res
  } catch (err) {
    const hit = await caches.match(INDEX)
    if (hit) return hit
    throw err
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    const copy = res.clone()
    caches.open(CACHE).then((c) => c.put(req, copy))
  }
  return res
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => null)
  return hit || (await fresh) || fetch(req)
}
