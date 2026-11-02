// 도면 글자 색인: 페이지마다 글자 덩어리와 그 위치를 한 번만 뽑아 저장해 두고 검색에 씁니다.
// { v, pages: [{ items: [[글자, x, y, w, h], ...], ocr?: true }] }  (좌표는 배율 1 페이지 좌표, 뷰어와 같음)
// PDF 에 글자 정보가 있으면 그대로 쓰고, 글자가 그림으로 들어 있을 만한 페이지는 나머지 부분을 OCR 합니다.
import { mergeLine } from './textMerge'
import { getPdfjs } from './pdf'

let OPS = null // pdf.js 는 색인을 만들 때 불러옴 (검색만 할 때는 필요 없음)
let Util = null

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
  ;({ OPS, Util } = await getPdfjs())
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

// 검색어를 띄어쓰기로 나눈 조각들 (Everything 처럼 "flo pu" → flocculant pump)
// 조각마다 띄어쓰기·기호는 무시, 순서는 상관없이 모든 조각이 들어 있으면 찾음
export function queryTokens(query) {
  const out = []
  for (const part of (query ?? '').split(/\s+/)) {
    const t = norm(part)
    if (t && !out.includes(t)) out.push(t)
  }
  // 긴 조각부터 (짧은 조각이 긴 조각 안에 들어가면 같은 자리를 두 번 잡지 않게)
  return out.sort((a, b) => b.length - a.length)
}

// 글 → { t: norm 글자, map: norm 글자 → 원래 글자 위치, starts: 낱말 첫 글자인 norm 위치 }
// 낱말 첫 글자: 앞이 기호·띄어쓰기, 글자↔숫자 바뀜(FT101 의 1), 소문자→대문자(camelCase)
function prepare(text) {
  const map = []
  const starts = new Set()
  let t = ''
  let prev = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!isWord(ch)) {
      prev = ''
      continue
    }
    const low = ch.toLowerCase()
    const digit = /\p{N}/u.test(ch)
    if (
      !prev ||
      digit !== /\p{N}/u.test(prev) ||
      (ch !== low && prev === prev.toLowerCase() && prev !== prev.toUpperCase())
    )
      starts.add(t.length)
    // toLowerCase 가 글자 수를 바꾸는 드문 경우(İ 등)도 위치가 맞게 한 글자씩
    for (const c of low) {
      map.push(i)
      t += c
    }
    prev = ch
  }
  return { t, map, starts }
}

// 조각 하나의 자리: 낱말 첫머리에서 시작하는 곳을 먼저, 없으면 처음 나오는 곳
function findToken(t, starts, tok) {
  let first = -1
  for (let at = t.indexOf(tok); at >= 0; at = t.indexOf(tok, at + 1)) {
    if (starts.has(at)) return { at, head: true }
    if (first < 0) first = at
  }
  return first < 0 ? null : { at: first, head: false }
}

// 글에서 모든 조각 찾기 → null 또는 { t, map, spans: [[norm 시작, norm 끝]], head: 모든 조각이 낱말 첫머리 }
// 빠르게: norm 글자에 조각이 다 있는지 먼저 보고, 있을 때만 자세히
function matchText(text, tokens, quick) {
  const q = quick ?? norm(text)
  for (const tok of tokens) if (!q.includes(tok)) return null
  const { t, map, starts } = prepare(text)
  const spans = []
  let head = true
  for (const tok of tokens) {
    const f = findToken(t, starts, tok)
    if (!f) return null
    spans.push([f.at, f.at + tok.length])
    head &&= f.head
  }
  return { t, map, spans, head }
}

// 낱말 첫머리에서 맞은 결과를 앞으로 (같은 무리 안에서는 원래 순서 그대로)
const byHead = (hits) => [...hits.filter((h) => h.head), ...hits.filter((h) => !h.head)]

// → [{ page, text, rect: {x,y,w,h}, ocr }]  rect 는 찾은 글자 부분만 (가로쓰기면 비율로 잘라 냄)
export function searchIndex(index, query, limit = 200) {
  const tokens = queryTokens(query)
  if (!tokens.length || !index) return []
  const hits = []
  let heads = 0
  for (let pi = 0; pi < index.pages.length && heads < limit; pi++) {
    const p = index.pages[pi]
    for (const [s, x, y, w, h] of p.items) {
      const m = matchText(s, tokens)
      if (!m) continue
      const n = m.t.length
      const a = Math.min(...m.spans.map((sp) => sp[0]))
      const b = Math.max(...m.spans.map((sp) => sp[1]))
      const rect = w >= h && n > 1 ? { x: x + (w * a) / n, y, w: (w * (b - a)) / n, h } : { x, y, w, h }
      hits.push({ page: pi + 1, text: s, rect, ocr: !!p.ocr, head: m.head })
      if ((m.head && ++heads >= limit) || hits.length >= limit * 4) break
    }
    if (hits.length >= limit * 4) break
  }
  return byHead(hits).slice(0, limit)
}

// 직접 넣은 글(notes.js noteItems) 에서 찾기 → [{ page, text, rect, note: 'text'|'memo'|'measure', itemId, hidden }]  rect 는 상자 전체
export function searchNotes(notes, query, limit = 200) {
  const tokens = queryTokens(query)
  if (!tokens.length || !notes) return []
  const hits = []
  for (const [s, x, y, w, h, page, kind, itemId, hidden] of notes) {
    const m = matchText(s, tokens)
    if (!m) continue
    hits.push({ page, text: s, rect: { x, y, w, h }, note: kind, itemId, hidden: !!hidden, head: m.head })
  }
  return byHead(hits).slice(0, limit)
}

// 글에 찾는 말이 들어 있는지 (띄어쓰기·기호·대소문자 무시, 조각은 순서 상관없이, 검색 색인과 같은 규칙)
export function textHas(text, query) {
  const tokens = queryTokens(query)
  if (!tokens.length) return false
  const t = norm(text ?? '')
  return tokens.every((tok) => t.includes(tok))
}

// 검색어 부분을 강조하려고 나눔 → [[글, 찾은 부분인지], ...] (조각 여러 개, 띄어쓰기·기호 무시하고 찾은 것도 처리)
export function splitMatch(text, query) {
  const tokens = queryTokens(query)
  const m = tokens.length ? matchText(text ?? '', tokens) : null
  if (!m) return [[text, false]]
  // 원래 글자 위치로 바꾸고 겹치는 곳은 합침
  const ranges = m.spans
    .map(([a, b]) => [m.map[a], m.map[b - 1] + 1])
    .sort((p, q) => p[0] - q[0])
    .reduce((acc, r) => {
      const last = acc[acc.length - 1]
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else acc.push(r)
      return acc
    }, [])
  const out = []
  let pos = 0
  for (const [a, b] of ranges) {
    if (a > pos) out.push([text.slice(pos, a), false])
    out.push([text.slice(a, b), true])
    pos = b
  }
  if (pos < text.length) out.push([text.slice(pos), false])
  return out
}
