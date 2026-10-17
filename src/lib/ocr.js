import { mergeLine } from './textMerge'

// 글자가 그림으로만 들어 있는(스캔하거나 글자를 선으로 바꾼) 도면 부분을 브라우저 안에서 OCR 합니다. 서버나 유료 서비스를 쓰지 않습니다.
// 도면은 크고 글자는 작아서, 페이지를 높은 해상도로 조각(타일)마다 따로 그려 읽습니다.
// 그래서 커다란 캔버스 하나를 만들지 않고, 빈 조각은 건너뜁니다.
// 조각 그리기는 웹 워커(ocrRender.worker.js), 글자 읽기는 tesseract 워커가 해서 화면(스크롤)을 막지 않습니다.
// 한계: 가로로 쓴 글자만 읽고, 세로·비스듬한 글자와 손글씨는 거의 못 읽습니다.

// 두 번 읽음: 작은 태그·치수(7~8pt)는 크게 키워야, 큰 실 이름·도면명은 작게 그려야 잘 읽힘
const PASSES_DPI = [450, 200]
const MAX_OCR_PIXELS = 160_000_000 // A0 처럼 아주 큰 페이지는 해상도를 낮춤
const TILE = 2000
const OVERLAP = 120 // 조각 경계에 걸친 글자를 놓치지 않도록 겹쳐 읽음
const MIN_CONFIDENCE = 20 // 낮게 잡고, 두 번 읽은 결과가 겹치면 더 확실한 쪽을 남김

const IDLE_CLOSE_MS = 60_000 // 1분 동안 읽을 게 없으면 OCR 엔진을 닫아 메모리 반환

let workerPromise = null
let idleTimer = null

function getWorker() {
  clearTimeout(idleTimer)
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js')
      const base = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href
      const worker = await createWorker(['kor', 'eng'], 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        workerBlobURL: false,
      })
      // 도면은 글자가 여기저기 흩어져 있어서 "흩어진 글자" 모드가 가장 잘 읽음
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' })
      return worker
    })()
    workerPromise.catch(() => {
      workerPromise = null
    })
  }
  return workerPromise
}

function releaseWorkerLater() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(async () => {
    const p = workerPromise
    workerPromise = null
    ;(await p?.catch(() => null))?.terminate()
  }, IDLE_CLOSE_MS)
}

// 조각을 그려 주는 웹 워커 (문서 하나당 하나). 화면 쪽은 메시지만 주고받음
export async function openRenderer(pdfDoc) {
  const worker = new Worker(new URL('./ocrRender.worker.js', import.meta.url), { type: 'module' })
  const waiting = new Map()
  let seq = 0
  worker.onmessage = ({ data }) => {
    const w = waiting.get(data.id)
    waiting.delete(data.id)
    if (data.error) w?.reject(new Error(data.error))
    else w?.resolve(data)
  }
  const call = (msg, transfer) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      waiting.set(id, { resolve, reject })
      worker.postMessage({ ...msg, id }, transfer)
    })
  try {
    const data = await pdfDoc.getData() // 사본 (뷰어가 쓰는 문서는 그대로)
    await call({ type: 'open', data }, [data.buffer])
  } catch (e) {
    worker.terminate()
    throw e
  }
  return {
    tile: (t) => call({ type: 'tile', ...t }),
    close: () => worker.terminate(),
  }
}

// 한 해상도의 조각 목록
function tilesFor(pdfPage, dpi) {
  const vp1 = pdfPage.getViewport({ scale: 1 })
  const scale = Math.min(dpi / 72, Math.sqrt(MAX_OCR_PIXELS / (vp1.width * vp1.height)))
  const viewport = pdfPage.getViewport({ scale })
  const W = Math.ceil(viewport.width)
  const H = Math.ceil(viewport.height)
  const step = TILE - OVERLAP
  const tiles = []
  for (let top = 0; top < H; top += step)
    for (let left = 0; left < W; left += step)
      tiles.push({ scale, W, H, left, top, w: Math.min(TILE, W - left), h: Math.min(TILE, H - top) })
  return tiles
}

// 읽은 결과에서 이 조각 몫의 낱말만 → [{ s, x, y, w, h, conf }] (배율 1 페이지 좌표)
function wordsOf(data, { scale, W, H, left, top, w, h }) {
  // 겹친 부분의 글자는 가운데가 이 조각 몫인 것만 남김 (두 번 세지 않게)
  const half = OVERLAP / 2
  const minX = left === 0 ? -Infinity : half
  const minY = top === 0 ? -Infinity : half
  const maxX = left + w < W ? w - half : Infinity
  const maxY = top + h < H ? h - half : Infinity
  const words = []
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines)
        for (const word of line.words) {
          const text = word.text.trim()
          if (!text || word.confidence < MIN_CONFIDENCE) continue
          if (text.length === 1 && word.confidence < 80) continue // 선·기호를 글자로 잘못 읽은 것
          const { x0, y0, x1, y1 } = word.bbox
          const cx = (x0 + x1) / 2
          const cy = (y0 + y1) / 2
          if (cx < minX || cy < minY || cx >= maxX || cy >= maxY) continue
          words.push({
            s: text,
            x: (left + x0) / scale,
            y: (top + y0) / scale,
            w: (x1 - x0) / scale,
            h: (y1 - y0) / scale,
            conf: word.confidence,
          })
        }
  return words
}

const overlapRatio = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h || 1)
}

// 페이지 하나 OCR → [{ s, x, y, w, h }] (배율 1 페이지 좌표). onProgress(0~1)
// renderer: openRenderer 결과, mask: 건너뛸 곳 [{ x, y, w, h }] (PDF 에 이미 글자로 들어 있는 곳)
export async function ocrPage(renderer, pdfPage, { onProgress, signal, mask = [] } = {}) {
  const worker = await getWorker()
  try {
    const passes = PASSES_DPI.map((dpi) => tilesFor(pdfPage, dpi))
    const total = passes.reduce((n, t) => n + t.length, 0)
    const maskBox = mask.map(({ x, y, w, h }) => ({ x, y, w, h }))
    const draw = (t) => renderer.tile({ page: pdfPage.pageNumber, mask: maskBox, ...t })
    let done = 0
    let kept = []
    for (const tiles of passes) {
      const words = []
      // 다음 조각은 워커가 미리 그려 두는 동안 지금 조각을 읽음
      let next = tiles.length ? draw(tiles[0]) : null
      for (let i = 0; i < tiles.length; i++) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
        const drawn = await next
        next = i + 1 < tiles.length ? draw(tiles[i + 1]) : null
        if (drawn.blob) {
          const { data } = await worker.recognize(drawn.blob, {}, { blocks: true, text: false })
          words.push(...wordsOf(data, tiles[i]))
        }
        onProgress?.(++done / total)
      }
      // 낱말을 줄 단위로 붙인 뒤, 앞서(더 높은 해상도로) 읽은 것과 겹치면 더 나은 쪽만 남김
      // (신뢰도가 높을수록, 글자가 많을수록 = 끊기지 않고 통째로 읽었을수록 좋음)
      const score = (k) => k.conf + 3 * Math.min(10, k.s.replace(/\s/g, '').length)
      for (const ph of mergeLine(words.map((w) => ({ ...w, flat: true })))) {
        const clash = kept.filter((k) => overlapRatio(k, ph) > 0.4)
        if (clash.some((k) => score(k) >= score(ph))) continue
        kept = kept.filter((k) => !clash.includes(k))
        kept.push(ph)
      }
    }
    return kept
  } finally {
    releaseWorkerLater()
  }
}
