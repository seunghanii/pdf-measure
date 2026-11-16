// 도면 첫 쪽 작은 그림 (홈 '이어서 보기' 카드). 도면을 열 때 한가할 때 한 번 그려 이 브라우저에 보관하고,
// 홈은 PDF 를 읽지 않고 이 그림만 씀. 다른 기기에서 처음 보는 도면은 그림 없이 이름만 보임.
// 브라우저의 큰 저장소(IndexedDB, storage.js thumbCache*)에 최근 MAX 개만 둠.
// (예전에는 localStorage 한 칸에 모두 넣어 앱을 켤 때마다 통째로 읽었고, 5MB 한도를 Inst list 사본 등과 나눠 썼음)
import { thumbCacheAll, thumbCacheWrite } from './storage'

const OLD_KEY = 'pdf-measure:thumbs' // 예전 localStorage 칸 (처음 한 번 옮기고 지움)
const MAX = 40
const WIDTH = 280 // 그림 폭(px). 카드에서 2배 화면에도 흐리지 않을 만큼

const cache = new Map() // 도면 id → { d: data URL, t: 저장 시각 }
const listeners = new Set()
let loading = null

function load() {
  if (!loading)
    loading = (async () => {
      try {
        for (const r of await thumbCacheAll()) cache.set(r.id, { d: r.d, t: r.t })
        const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null')
        if (old) {
          const moved = Object.entries(old)
            .filter(([id, v]) => v?.d && !cache.has(id))
            .map(([id, v]) => ({ id, d: v.d, t: v.t || 0 }))
          for (const m of moved) cache.set(m.id, { d: m.d, t: m.t })
          if (moved.length) await thumbCacheWrite(moved)
          localStorage.removeItem(OLD_KEY)
        }
      } catch (e) {
        console.warn('첫 쪽 그림 읽기 실패', e) // 그림 없이 이름만 보임
      }
      listeners.forEach((f) => f())
    })()
  return loading
}

export function getThumb(id) {
  load()
  return cache.get(id)?.d ?? null
}

export function subscribeThumbs(f) {
  listeners.add(f)
  return () => listeners.delete(f)
}

// 열린 PDF 의 첫 쪽을 그려 보관 (같은 날 이미 그렸으면 건너뜀)
export async function makeThumb(id, pdfDoc) {
  await load()
  const old = cache.get(id)
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
  const entry = { d: canvas.toDataURL('image/jpeg', 0.6), t: Date.now() }
  canvas.width = canvas.height = 0
  cache.set(id, entry)
  const drop = [...cache.entries()]
    .sort((a, b) => b[1].t - a[1].t)
    .slice(MAX)
    .map(([k]) => k)
  for (const k of drop) cache.delete(k)
  listeners.forEach((f) => f())
  await thumbCacheWrite([{ id, ...entry }], drop)
}
