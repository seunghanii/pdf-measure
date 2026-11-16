// 도면 그리기를 화면과 떨어진 곳(웹 워커)에서 하기.
// pdf.js 가 화면 쪽에서 그리면 선·글자가 많은 도면은 스크롤·확대할 때 그리는 동안 화면이 잠깐씩 멈춤.
// 워커(ocrRender.worker.js, OCR 조각 그리기와 같은 파일)가 그려서 완성된 그림(ImageBitmap)만 넘겨주면 화면은 붙이기만 함.
// 워커가 준비되기 전(도면을 막 열었을 때)이나 못 쓰는 브라우저에서는 null 을 돌려주고, 부르는 쪽이 예전처럼 화면 쪽에서 그림.

const IDLE_CLOSE_MS = 60_000 // 이만큼 그릴 일이 없으면 워커를 닫아 메모리를 돌려줌 (다시 필요하면 새로 엶)
const supported = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'

const entries = new WeakMap() // PDFDocumentProxy → { worker, ready, failed, waiting, seq, timer }

function open(pdfDoc) {
  const worker = new Worker(new URL('./ocrRender.worker.js', import.meta.url), { type: 'module' })
  const entry = { worker, ready: false, failed: false, waiting: new Map(), seq: 0, timer: null }
  const fail = (e) => {
    console.warn('도면 그리기 워커를 쓸 수 없어 화면 쪽에서 그림', e)
    entry.failed = true
    entry.ready = false
    for (const w of entry.waiting.values()) w.reject(new Error('render worker failed'))
    entry.waiting.clear()
    worker.terminate()
  }
  worker.onmessage = ({ data }) => {
    const w = entry.waiting.get(data.id)
    entry.waiting.delete(data.id)
    if (data.error) w?.reject(new Error(data.error))
    else w?.resolve(data)
  }
  worker.onerror = (e) => fail(e?.message ?? e)
  ;(async () => {
    try {
      const data = await pdfDoc.getData() // 사본 (화면이 쓰는 문서는 그대로)
      await new Promise((resolve, reject) => {
        const id = ++entry.seq
        entry.waiting.set(id, { resolve, reject })
        worker.postMessage({ type: 'open', id, data, fonts: true }, [data.buffer])
      })
      if (!entry.failed) entry.ready = true
    } catch (e) {
      if (!entry.failed) fail(e)
    }
  })()
  return entry
}

function touch(pdfDoc, entry) {
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    if (entry.waiting.size) return touch(pdfDoc, entry)
    entry.worker.terminate()
    if (entries.get(pdfDoc) === entry) entries.delete(pdfDoc)
  }, IDLE_CLOSE_MS)
}

// 페이지의 한 부분을 그린 그림. { promise: Promise<ImageBitmap>, cancel() } 또는 null (워커를 지금 못 씀 → 화면 쪽에서 그릴 것)
// scale: 배율(화면 배율 × 화면 픽셀 비율), left·top·w·h: 그 배율에서의 픽셀 자리와 크기
export function renderInWorker(pdfDoc, { page, scale, left = 0, top = 0, w, h }) {
  if (!supported || pdfDoc.loadingTask?.destroyed) return null
  let entry = entries.get(pdfDoc)
  if (!entry) entries.set(pdfDoc, (entry = open(pdfDoc)))
  if (entry.failed) return null
  touch(pdfDoc, entry)
  if (!entry.ready) return null
  const id = ++entry.seq
  const promise = new Promise((resolve, reject) => {
    entry.waiting.set(id, { resolve: (d) => resolve(d.bitmap), reject })
    entry.worker.postMessage({ type: 'bitmap', id, page, scale, left, top, w, h })
  })
  return {
    promise,
    cancel: () => {
      if (!entry.waiting.has(id)) return
      entry.worker.postMessage({ type: 'cancel', target: id })
      // 늦게 도착한 그림은 바로 버림
      entry.waiting.set(id, { resolve: (d) => d.bitmap?.close?.(), reject: () => {} })
    },
  }
}
