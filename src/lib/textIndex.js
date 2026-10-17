// 도면 글자 색인: 페이지마다 글자 덩어리와 그 위치를 한 번만 뽑아 저장해 두고 검색에 씁니다.
// { v, pages: [{ items: [[글자, x, y, w, h], ...], ocr?: true }] }  (좌표는 배율 1 페이지 좌표, 뷰어와 같음)
// PDF 에 글자 정보가 있으면 그대로 쓰고, 거의 없는 페이지(스캔본)만 OCR 합니다.
import { Util } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { mergeLine } from './textMerge'

export const INDEX_VERSION = 1
const MIN_TEXT_CHARS = 6 // 글자가 이보다 적은 페이지는 스캔 이미지로 보고 OCR

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

const pack = (list) => list.map((i) => [i.s.trim().replace(/\s+/g, ' '), r1(i.x), r1(i.y), r1(i.w), r1(i.h)]).filter((i) => i[0])

const charCount = (items) => items.reduce((n, i) => n + i.s.replace(/\s/g, '').length, 0)

// 문서 전체 색인 만들기. onProgress({ page, pages, ocr, done(0~1) })
export async function buildIndex(pdfDoc, { onProgress, signal } = {}) {
  const pages = []
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    onProgress?.({ page: n, pages: pdfDoc.numPages })
    const page = await pdfDoc.getPage(n)
    const items = await pdfTextItems(page)
    if (charCount(items) >= MIN_TEXT_CHARS) {
      pages.push({ items: pack(mergeLine(items)) })
      continue
    }
    const { ocrPage } = await import('./ocr')
    const words = await ocrPage(page, {
      signal,
      onProgress: (done) => onProgress?.({ page: n, pages: pdfDoc.numPages, ocr: true, done }),
    })
    const ocrItems = words.map(({ s, x, y, w, h }) => ({ s, x, y, w, h, flat: true }))
    pages.push({ items: pack(mergeLine([...items, ...ocrItems])), ocr: true })
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
      const rect = w >= h && t.length > 1 ? { x: x + (w * at) / t.length, y, w: (w * q.length) / t.length, h } : { x, y, w, h }
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
  const at = map.map((i) => low[i]).join('').indexOf(q)
  if (at < 0) return [text, '', '']
  const start = map[at]
  const end = map[at + q.length - 1] + 1
  return [text.slice(0, start), text.slice(start, end), text.slice(end)]
}
