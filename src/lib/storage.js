// 로그인하지 않았을 때 쓰는 브라우저 저장소 (서버로 전송되지 않음).
// - IndexedDB: PDF 파일 자체(용량이 커서 localStorage 에는 못 넣음)와 도면별 측정값
// - localStorage: 마지막으로 열려 있던 탭 목록 (로그인 여부와 상관없이 기기마다 따로)
// 로그인하면 cloudStore.js 가 같은 모양의 함수로 서버(Supabase)에 저장하고,
// 여기의 'cache' 저장소는 서버에서 받은 PDF 를 다시 받지 않도록 임시 보관하는 데만 씁니다.

const DB_NAME = 'pdf-measure'
const DB_VERSION = 2
const MAX_RECENT = 20
const SESSION_KEY = 'pdf-measure:session'

let dbPromise = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function run(storeNames, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode)
        const stores = [].concat(storeNames).map((n) => tx.objectStore(n))
        let result
        Promise.resolve(fn(...stores))
          .then((r) => (result = r))
          .catch((e) => {
            tx.abort()
            reject(e)
          })
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

const req2promise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

// 같은 이름·크기의 파일은 같은 도면으로 봅니다.
export function fileIdOf(file) {
  return `${file.name}|${file.size}`
}

// 파일을 저장하고 "최근 연 시각"을 갱신. 기존에 저장된 측정값이 있으면 돌려줍니다.
export async function rememberFile(id, file) {
  const now = Date.now()
  const doc = await run(['files', 'docs'], 'readwrite', async (files, docs) => {
    const existing = await req2promise(docs.get(id))
    files.put({ id, blob: file })
    const next = { id, name: file.name, size: file.size, state: null, ...existing, lastOpened: now }
    docs.put(next)
    return next
  })
  await pruneRecent()
  return doc
}

export async function touchFile(id) {
  return run('docs', 'readwrite', async (docs) => {
    const existing = await req2promise(docs.get(id))
    if (!existing) return null
    const next = { ...existing, lastOpened: Date.now() }
    docs.put(next)
    return next
  })
}

export function getFile(id) {
  return run('files', 'readonly', (files) => req2promise(files.get(id))).then((r) => r?.blob ?? null)
}

export function getDoc(id) {
  return run('docs', 'readonly', (docs) => req2promise(docs.get(id)))
}

export function saveState(id, state) {
  return run('docs', 'readwrite', async (docs) => {
    const existing = await req2promise(docs.get(id))
    if (existing) docs.put({ ...existing, state })
  })
}

export async function listRecent() {
  const all = await run('docs', 'readonly', (docs) => req2promise(docs.getAll()))
  return all.sort((a, b) => b.lastOpened - a.lastOpened)
}

export function removeFile(id) {
  return run(['files', 'docs'], 'readwrite', (files, docs) => {
    files.delete(id)
    docs.delete(id)
  })
}

async function pruneRecent() {
  const all = await listRecent()
  for (const d of all.slice(MAX_RECENT)) await removeFile(d.id)
}

// 서버에서 받은 PDF 임시 보관 (key: 저장 경로)
export function cacheGet(key) {
  return run('cache', 'readonly', (c) => req2promise(c.get(key))).then((r) => r?.blob ?? null)
}

export function cachePut(key, blob) {
  return run('cache', 'readwrite', (c) => {
    c.put({ key, blob, at: Date.now() })
  })
}

export function cacheDelete(key) {
  return run('cache', 'readwrite', (c) => {
    c.delete(key)
  })
}

// keep 에 없는 임시 보관 파일 지우기
export async function cachePrune(keep) {
  const keys = await run('cache', 'readonly', (c) => req2promise(c.getAllKeys()))
  const drop = keys.filter((k) => !keep.has(k))
  if (drop.length) await run('cache', 'readwrite', (c) => drop.forEach((k) => c.delete(k)))
}

// 로그인하지 않았을 때 쓰는 저장소. cloudStore.js 의 createCloudStore 와 같은 모양.
export const localStore = {
  kind: 'local',
  saveDelay: 200,
  rememberFile,
  touchFile,
  getFile,
  saveState,
  listRecent: () => listRecent(),
  removeFile,
}

// scope: 로그인한 사용자 id (없으면 이 브라우저 전용)
const sessionKey = (scope) => (scope ? `${SESSION_KEY}:${scope}` : SESSION_KEY)

export function loadSession(scope) {
  try {
    const s = JSON.parse(localStorage.getItem(sessionKey(scope)))
    if (s && Array.isArray(s.open)) return s
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 모드 등)
  }
  return { open: [], active: null }
}

export function saveSession(scope, session) {
  try {
    localStorage.setItem(sessionKey(scope), JSON.stringify(session))
  } catch {
    // 무시
  }
}
