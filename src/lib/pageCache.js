// 그려 둔 페이지 밑그림 보관 (탭을 옮겼다 돌아오거나, 멀리 스크롤했다 돌아올 때 pdf.js 로 다시 그리지 않게).
// PageCanvas 가 화면에서 빠지거나 없어질 때 맡기고, 같은 도면·페이지·배율로 다시 그릴 때 꺼내 씀.
// 메모리를 너무 쓰지 않게 전체 픽셀 수에 한도를 두고 오래된 것부터 버림.
const MAX_PIXELS = 24_000_000 // 약 96MB (픽셀당 4바이트)

const entries = new Map() // key → { doc, canvas, px } (Map 순서 = 오래된 순)
let total = 0
const docIds = new WeakMap() // PDFDocumentProxy → 번호 (같은 파일을 닫았다 다시 열면 다른 번호)
let nextDocId = 1
const keyOf = (doc, page, scale) => {
  if (!docIds.has(doc)) docIds.set(doc, nextDocId++)
  return `${docIds.get(doc)}|${page}|${scale.toFixed(6)}`
}

function drop(key) {
  const e = entries.get(key)
  if (!e) return
  entries.delete(key)
  total -= e.px
  e.canvas.width = e.canvas.height = 0
}

// 화면 캔버스 내용을 복사해 맡김
export function stashPage(doc, page, scale, source) {
  for (const [k, e] of entries) if (e.doc.loadingTask?.destroyed) drop(k) // 닫은 도면 것은 버림
  const px = source.width * source.height
  if (!px || px > MAX_PIXELS / 2 || doc.loadingTask?.destroyed) return
  const key = keyOf(doc, page, scale)
  drop(key)
  const copy = document.createElement('canvas')
  copy.width = source.width
  copy.height = source.height
  copy.getContext('2d').drawImage(source, 0, 0)
  entries.set(key, { doc, canvas: copy, px })
  total += px
  for (const k of entries.keys()) {
    if (total <= MAX_PIXELS) break
    if (k !== key) drop(k)
  }
}

// 맡겨 둔 밑그림을 꺼냄 (꺼내면 보관함에서 빠짐). 없으면 null
export function takePage(doc, page, scale) {
  const key = keyOf(doc, page, scale)
  const e = entries.get(key)
  if (!e) return null
  entries.delete(key)
  total -= e.px
  return e.canvas
}
