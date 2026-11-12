// 도면 첫 쪽 작은 그림 (홈 '이어서 보기' 카드). 도면을 열 때 한가할 때 한 번 그려 이 브라우저에 보관하고,
// 홈은 PDF 를 읽지 않고 이 그림만 씀. 다른 기기에서 처음 보는 도면은 그림 없이 이름만 보임.
// localStorage pdf-measure:thumbs = { [도면 id]: { d: data URL, t: 저장 시각 } }, 최근 MAX 개만

const KEY = 'pdf-measure:thumbs'
const MAX = 40
const WIDTH = 280 // 그림 폭(px). 카드에서 2배 화면에도 흐리지 않을 만큼

let cache = null
const listeners = new Set()

function read() {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    cache = {}
  }
  return cache
}

function write(next) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 꽉 차면 오래된 것 절반을 버리고 한 번 더
    try {
      const keep = Object.entries(next)
        .sort((a, b) => b[1].t - a[1].t)
        .slice(0, MAX / 2)
      cache = Object.fromEntries(keep)
      localStorage.setItem(KEY, JSON.stringify(cache))
    } catch {
      // 저장 못 해도 홈은 이름만으로 보임
    }
  }
  listeners.forEach((f) => f())
}

export function getThumb(id) {
  return read()[id]?.d ?? null
}

export function subscribeThumbs(f) {
  listeners.add(f)
  return () => listeners.delete(f)
}

// 열린 PDF 의 첫 쪽을 그려 보관 (같은 날 이미 그렸으면 건너뜀)
export async function makeThumb(id, pdfDoc) {
  const old = read()[id]
  if (old && Date.now() - old.t < 12 * 3600 * 1000) return
  const page = await pdfDoc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: WIDTH / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  const d = canvas.toDataURL('image/jpeg', 0.6)
  const all = { ...read(), [id]: { d, t: Date.now() } }
  const keep = Object.entries(all)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, MAX)
  write(Object.fromEntries(keep))
}
