// OCR 할 도면 조각을 화면과 떨어진 곳(웹 워커)에서 그립니다.
// 조각 그리기는 무거워서 화면 쪽에서 하면 그동안 스크롤이 멈추기 때문입니다.
// 메시지: open { data } → tile { page, scale, left, top, w, h, mask, clean? } → { blob } 또는 { blank: true }
// clean: 글자보다 큰 선(계기 동그라미 등)을 지우고 줌 (박스 안 태그 읽기)
// rotate: 90 이면 그림을 시계 방향으로, -90 이면 반시계 방향으로 돌려 줌 (세로로 쓴 글자 읽기)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// 워커에는 document 가 없어서 캔버스는 OffscreenCanvas 로, 특수 필터는 쓰지 않음
class OffscreenCanvasFactory {
  create(width, height) {
    const canvas = new OffscreenCanvas(width, height)
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) }
  }
  reset(cc, width, height) {
    cc.canvas.width = width
    cc.canvas.height = height
  }
  destroy(cc) {
    cc.canvas.width = cc.canvas.height = 0
    cc.canvas = null
    cc.context = null
  }
}

class NoFilterFactory {
  addFilter() {
    return 'none'
  }
  addHCMFilter() {
    return 'none'
  }
  addAlphaFilter() {
    return 'none'
  }
  addLuminosityFilter() {
    return 'none'
  }
  addKnockoutFilter() {
    return 'none'
  }
  addHighlightHCMFilter() {
    return 'none'
  }
  addSelectionHCMFilter() {
    return 'none'
  }
  addSelectionFilter() {
    return 'none'
  }
  createSelectionStyle() {
    return null
  }
  destroy() {}
}

let docPromise = null

// 거의 흰 조각인지 (듬성듬성 픽셀을 봄)
function isBlank(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h)
  const step = 4 * 7
  let dark = 0
  for (let i = 0; i < data.length; i += step) {
    if (data[i] + data[i + 1] + data[i + 2] < 600) dark++
    if (dark > 20) return false
  }
  return true
}

// 계기 풍선의 동그라미·가로줄처럼 글자보다 훨씬 큰 선 덩어리를 지움 (글자만 남겨야 OCR 이 잘 읽음)
// 검은 점끼리 이어진 덩어리를 찾고, 보통 글자 높이보다 많이 크거나 긴 덩어리는 하얗게
function eraseLineArt(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const n = w * h
  const dark = new Uint8Array(n)
  for (let i = 0; i < n; i++) dark[i] = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] < 480 ? 1 : 0
  const label = new Int32Array(n)
  const comps = [] // [x0, y0, x1, y1, count]
  const stack = new Int32Array(n)
  for (let start = 0; start < n; start++) {
    if (!dark[start] || label[start]) continue
    const id = comps.length + 1
    let sp = 0
    stack[sp++] = start
    label[start] = id
    let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0
    while (sp) {
      const i = stack[--sp]
      const x = i % w
      const y = (i - x) / w
      count++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (dark[j] && !label[j]) {
            label[j] = id
            stack[sp++] = j
          }
        }
      }
    }
    comps.push([x0, y0, x1, y1, count])
  }
  // 보통 글자 높이: 작은 점 부스러기와 큰 덩어리를 뺀 높이들의 가운데 값
  const hs = comps
    .filter((c) => c[4] > 3 && c[3] - c[1] + 1 < h * 0.5)
    .map((c) => c[3] - c[1] + 1)
    .sort((a, b) => a - b)
  if (!hs.length) return
  const med = hs[hs.length >> 1]
  const erase = new Uint8Array(comps.length + 1)
  let any = false
  comps.forEach((c, k) => {
    const cw = c[2] - c[0] + 1
    const ch = c[3] - c[1] + 1
    if (ch > med * 2.5 || cw > med * 6 || c[4] <= 3) {
      erase[k + 1] = 1
      any = true
    }
  })
  if (!any) return
  for (let i = 0; i < n; i++)
    if (erase[label[i]]) {
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255
    }
  ctx.putImageData(img, 0, 0)
}

// 그림을 90° 돌린 새 캔버스 (deg: 90 시계, -90 반시계)
function rotated(canvas, deg) {
  const { width: w, height: h } = canvas
  const out = new OffscreenCanvas(h, w)
  const ctx = out.getContext('2d')
  if (deg > 0) {
    ctx.translate(h, 0)
    ctx.rotate(Math.PI / 2)
  } else {
    ctx.translate(0, w)
    ctx.rotate(-Math.PI / 2)
  }
  ctx.drawImage(canvas, 0, 0)
  return out
}

async function renderTile({ page, scale, left, top, w, h, mask, clean, rotate }) {
  const doc = await docPromise
  const pdfPage = await doc.getPage(page)
  const viewport = pdfPage.getViewport({ scale })
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  await pdfPage.render({ canvasContext: ctx, canvas, viewport, transform: [1, 0, 0, 1, -left, -top] }).promise
  // PDF 에 이미 글자로 있는 곳은 하얗게 지움 (두 번 세지 않게)
  ctx.fillStyle = '#fff'
  for (const m of mask) ctx.fillRect(m.x * scale - left - 2, m.y * scale - top - 2, m.w * scale + 4, m.h * scale + 4)
  if (clean) eraseLineArt(ctx, w, h)
  if (isBlank(ctx, w, h)) return { blank: true }
  const out = rotate ? rotated(canvas, rotate) : canvas
  return { blob: await out.convertToBlob({ type: 'image/png' }) }
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'open') {
      docPromise = pdfjs.getDocument({
        data: msg.data,
        CanvasFactory: OffscreenCanvasFactory,
        FilterFactory: NoFilterFactory,
        disableFontFace: true, // 글꼴을 등록할 document 가 없으니 글자는 모양(선)으로 그림
        isOffscreenCanvasSupported: true,
      }).promise
      await docPromise
      self.postMessage({ id: msg.id, ok: true })
    } else if (msg.type === 'tile') {
      self.postMessage({ id: msg.id, ...(await renderTile(msg)) })
    }
  } catch (e) {
    self.postMessage({ id: msg.id, error: String(e?.message ?? e) })
  }
}
