// OCR 할 도면 조각을 화면과 떨어진 곳(웹 워커)에서 그립니다.
// 조각 그리기는 무거워서 화면 쪽에서 하면 그동안 스크롤이 멈추기 때문입니다.
// 메시지: open { data } → tile { page, scale, left, top, w, h, mask } → { blob } 또는 { blank: true }
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

async function renderTile({ page, scale, left, top, w, h, mask }) {
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
  if (isBlank(ctx, w, h)) return { blank: true }
  return { blob: await canvas.convertToBlob({ type: 'image/png' }) }
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
