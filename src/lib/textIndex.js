// 도면 글자 색인: 페이지마다 글자 덩어리와 그 위치를 한 번만 뽑아 저장해 두고 검색에 씁니다.
// { v, pages: [{ items: [[글자, x, y, w, h], ...], ocr?: true }] }  (좌표는 배율 1 페이지 좌표, 뷰어와 같음)
// PDF 에 글자 정보가 있으면 그대로 쓰고, 글자가 그림으로 들어 있을 만한 페이지는 나머지 부분을 OCR 합니다.
import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { mergeLine } from './textMerge'

export const INDEX_VERSION = 1
const MIN_TEXT_CHARS = 6 // 글자가 이보다 적으면 스캔본이거나 글자를 선으로 바꾼 도면
const FEW_TEXT_ITEMS = 40 // 큰 도면에 글자 덩어리가 이보다 적으면 표제란만 글자이고 본체는 그림일 가능성이 큼
const BIG_PAGE_AREA = 842 * 595 * 1.5 // A3 보다 큰 페이지
const IMAGE_COVERAGE = 0.2 // 이미지(스캔 등)가 페이지의 이만큼 이상 덮으면

const r1 = (v) => Math.round(v * 10) / 10

// PDF 안에 들어 있는 글자 → { s, x, y, w, h, flat } (flat: 가로쓰기)
async function pdfTextItems(pdfPage) {
  const vp = pdfPage.getViewport({ scale: 1 })
  const tc = await pdfPage.getTextContent()
  const out = []
  for (const it of tc.items) {
    if (!it.str?.trim()) continue
    const m = Util.transform(vp.transform, it.transform)
    const fh = Math.hypot(m[2], m[3]) || 1
    const len = it.width || fh * it.str.length * 0.5
    const ang = Math.atan2(m[1], m[0])
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    // 글자 기준선 시작점(e, f)에서 진행 방향으로 len, 위쪽으로 fh 만큼 차지
    const pts = [
      [m[4], m[5]],
      [m[4] + dx * len, m[5] + dy * len],
      [m[4] + dy * fh, m[5] - dx * fh],
      [m[4] + dx * len + dy * fh, m[5] + dy * len - dx * fh],
    ]
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    out.push({ s: it.str, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, flat: Math.abs(ang) < 0.05 })
  }
  return out
}

// 페이지에서 이미지가 덮는 비율 (그리기 명령을 따라가며 이미지마다 크기 계산)
async function imageCoverage(pdfPage) {
  const { fnArray, argsArray } = await pdfPage.getOperatorList()
  const vp = pdfPage.getViewport({ scale: 1 })
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  let area = 0
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = Util.transform(ctm, argsArray[i])
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      if (argsArray[i]?.[0]) ctm = Util.transform(ctm, argsArray[i][0])
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject)
      area += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) // 이미지는 1x1 정사각형을 ctm 으로 늘려 그림
  }
  return Math.min(1, area / (vp.width * vp.height))
}

// 글자가 그림으로 들어 있을 만한 페이지인지
async function needsOcr(pdfPage, items, merged) {
  if (charCount(items) < MIN_TEXT_CHARS) return true
  const vp = pdfPage.getViewport({ scale: 1 })
  if (merged.length < FEW_TEXT_ITEMS && vp.width * vp.height > BIG_PAGE_AREA) return true
  return (await imageCoverage(pdfPage).catch(() => 0)) > IMAGE_COVERAGE
}

const pack = (list) =>
  list.map((i) => [i.s.trim().replace(/\s+/g, ' '), r1(i.x), r1(i.y), r1(i.w), r1(i.h)]).filter((i) => i[0])

const charCount = (items) => items.reduce((n, i) => n + i.s.replace(/\s/g, '').length, 0)

// 문서 전체 색인 만들기. onProgress({ page, pages, ocr, done(0~1) })
export async function buildIndex(pdfDoc, { onProgress, signal } = {}) {
  const pages = []
  let renderer = null // OCR 조각을 그려 줄 웹 워커 (OCR 할 페이지가 처음 나올 때 띄움)
  try {
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      onProgress?.({ page: n, pages: pdfDoc.numPages })
      const page = await pdfDoc.getPage(n)
      const items = await pdfTextItems(page)
      const merged = mergeLine(items)
      if (!(await needsOcr(page, items, merged))) {
        pages.push({ items: pack(merged) })
        continue
      }
      const { ocrPage, openRenderer } = await import('./ocr')
      renderer ??= await openRenderer(pdfDoc)
      const words = await ocrPage(renderer, page, {
        signal,
        mask: items, // PDF 에 이미 글자로 있는 곳은 지우고 읽음
        onProgress: (done) => onProgress?.({ page: n, pages: pdfDoc.numPages, ocr: true, done }),
      })
      const ocrItems = words.map(({ s, x, y, w, h }) => ({ s, x, y, w, h, flat: true }))
      pages.push({ items: pack(mergeLine([...items, ...ocrItems])), ocr: true })
    }
  } finally {
    renderer?.close()
  }
  return { v: INDEX_VERSION, pages }
}

export const isValidIndex = (index, numPages) =>
  index?.v === INDEX_VERSION && Array.isArray(index.pages) && (numPages == null || index.pages.length === numPages)

// 띄어쓰기·대소문자·기호 무시 ("P-101" 을 "p101" 로 찾아도, OCR 이 하이픈을 빠뜨려도 찾게)
const isWord = (ch) => /[\p{L}\p{N}]/u.test(ch)
const norm = (s) => [...s.toLowerCase()].filter(isWord).join('')

// → [{ page, text, rect: {x,y,w,h}, ocr }]  rect 는 찾은 글자 부분만 (가로쓰기면 비율로 잘라 냄)
export function searchIndex(index, query, limit = 200) {
  const q = norm(query)
  if (!q || !index) return []
  const hits = []
  index.pages.forEach((p, pi) => {
    for (const [s, x, y, w, h] of p.items) {
      const t = norm(s)
      const at = t.indexOf(q)
      if (at < 0) continue
      const rect =
        w >= h && t.length > 1 ? { x: x + (w * at) / t.length, y, w: (w * q.length) / t.length, h } : { x, y, w, h }
      hits.push({ page: pi + 1, text: s, rect, ocr: !!p.ocr })
      if (hits.length >= limit) return
    }
  })
  return hits
}

// 검색어 부분을 강조하려고 나눔 → [앞, 찾은 부분, 뒤] (띄어쓰기·기호 무시하고 찾은 것도 처리)
export function splitMatch(text, query) {
  const q = norm(query)
  if (!q) return [text, '', '']
  const map = [] // norm 글자 → 원래 글자 위치
  const low = text.toLowerCase()
  for (let i = 0; i < low.length; i++) if (isWord(low[i])) map.push(i)
  const at = map
    .map((i) => low[i])
    .join('')
    .indexOf(q)
  if (at < 0) return [text, '', '']
  const start = map[at]
  const end = map[at + q.length - 1] + 1
  return [text.slice(0, start), text.slice(start, end), text.slice(end)]
}
