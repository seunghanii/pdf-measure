// 페이지 편집 (왼쪽 위 페이지 탐색 창): 빈 페이지 넣기·페이지 지우기·순서 바꾸기.
// PDF 를 새로 만들어 같은 도면(id 그대로)의 파일만 바꾸고, 측정·마크업·박스·기준선·글자 색인의 쪽 번호를 새 순서에 맞춤.
// order: 새 PDF 의 쪽 목록. 원래 쪽은 { src: 원래 쪽 번호(1부터) }, 새 빈 쪽은 { blank: { w, h } } (pt, pdf.js 화면 크기)
import { PT_TO_PAPER_MM } from './units'

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// 처음 순서 (지금 PDF 그대로)
export const initialOrder = (numPages) => Array.from({ length: numPages }, (_, i) => ({ src: i + 1 }))

// 원래 쪽 번호 → 새 쪽 번호 (지운 쪽은 없음)
export function pageMap(order) {
  const map = new Map()
  order.forEach((e, i) => e.src && map.set(e.src, i + 1))
  return map
}

// 지운 쪽에 있던 항목을 옮겨 둘 쪽: 그 앞에 남은 가장 가까운 쪽 (없으면 1쪽)
function nearest(map, page, numPages) {
  for (let p = page - 1; p >= 1; p--) if (map.has(p)) return map.get(p)
  for (let p = page + 1; p <= numPages; p++) if (map.has(p)) return map.get(p)
  return 1
}

// 새 순서에 맞춘 상태. 지운 쪽의 항목은 휴지통으로 (7일 동안 되살리기 가능, 되살리면 가까운 쪽에 나타남)
// 지운 쪽에 기준선이 있으면 같은 축척(1:N)으로 바꿔 둠
// editKey: 이 편집 이름 (휴지통에 넣은 항목에 붙여, 되돌릴 때 원래 쪽으로 꺼냄)
export function remapState({ measurements, trash, calibration, pageNum }, order, numPages, { now = Date.now(), editKey = null } = {}) {
  const map = pageMap(order)
  const keep = []
  const gone = []
  for (const m of measurements) {
    const p = m.page ?? 1
    if (map.has(p)) keep.push(map.get(p) === p ? m : { ...m, page: map.get(p) })
    else if (p > numPages) keep.push(m) // 이미 없는 쪽 (예전 개정판에서 남은 것) 은 그대로
    else gone.push({ item: { ...m, page: nearest(map, p, numPages) }, at: now, ...(editKey && { pageEdit: editKey, fromPage: p }) })
  }
  const fixTrash = (t) => {
    const p = t.item.page ?? 1
    if (map.has(p)) return map.get(p) === p ? t : { ...t, item: { ...t.item, page: map.get(p) } }
    return p > numPages ? t : { ...t, item: { ...t.item, page: nearest(map, p, numPages) } }
  }
  let cal = calibration
  if (cal?.mode === 'line') {
    if (map.has(cal.page)) cal = { ...cal, page: map.get(cal.page) }
    else if (cal.page <= numPages) {
      const d = distance(cal.points[0], cal.points[1])
      cal = d > 0 ? { mode: 'ratio', ratio: cal.realMm / d / PT_TO_PAPER_MM } : null
    }
  }
  return {
    measurements: keep,
    trash: [...gone, ...(trash ?? []).map(fixTrash)],
    calibration: cal,
    pageNum: map.get(pageNum) ?? nearest(map, pageNum, numPages),
    goneCount: gone.length,
  }
}

// 되돌리기용 거꾸로 순서: 편집 전 쪽 p 가 편집 뒤 몇 쪽이었는지 ({ src: 새 쪽 } | { gone: true })
export function invertOrder(order, oldNumPages) {
  const map = pageMap(order)
  return Array.from({ length: oldNumPages }, (_, i) => (map.has(i + 1) ? { src: map.get(i + 1) } : { gone: true }))
}

// 되돌리기: 지금 상태를 편집 전 쪽 순서로 되돌리고, 그 편집이 휴지통에 넣은 항목은 원래 쪽으로 꺼냄
// (편집 뒤에 그린 것도 남김. 새로 넣었던 빈 쪽에 그린 항목은 휴지통으로)
export function undoState(state, entry) {
  const inv = invertOrder(entry.order, entry.oldNumPages)
  const out = remapState(state, inv, entry.order.length)
  const have = new Set(out.measurements.map((m) => m.id))
  const back = []
  const trash = []
  for (const t of out.trash) {
    if (t.pageEdit === entry.key && !have.has(t.item.id)) back.push({ ...t.item, page: t.fromPage })
    else trash.push(t)
  }
  // 지운 쪽의 기준선을 1:N 으로 바꿨는데 그 뒤로 축척을 안 건드렸으면 원래 기준선으로
  const calSame = JSON.stringify(state.calibration ?? null) === JSON.stringify(entry.calAfter ?? null)
  return { ...out, measurements: [...out.measurements, ...back], trash, calibration: calSame ? (entry.calBefore ?? null) : out.calibration }
}

// 글자 색인도 새 순서로 (OCR 을 다시 하지 않게). 빈 쪽은 글자 없음
export function remapIndex(index, order, numPages) {
  if (!index?.pages || index.pages.length !== numPages) return null
  return { ...index, pages: order.map((e) => (e.src ? index.pages[e.src - 1] : { items: [] })) }
}

// 새 PDF 만들기 → File (이름은 그대로)
export async function buildPdf(pdfDoc, order, name) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(await pdfDoc.getData(), { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const srcIdx = order.filter((e) => e.src).map((e) => e.src - 1)
  const copied = await out.copyPages(src, srcIdx)
  let k = 0
  for (const e of order) {
    if (e.src) out.addPage(copied[k++])
    else out.addPage([e.blank.w, e.blank.h])
  }
  try {
    const title = src.getTitle()
    if (title) out.setTitle(title)
  } catch {
    /* 제목 없음 */
  }
  const bytes = await out.save()
  return new File([bytes], name, { type: 'application/pdf' })
}

// 페이지 편집 되돌리기 (이 창에서만 기억, 도면마다 최근 5번까지)
// { file: 편집 전 PDF, pdf: 편집 뒤 PDF(지금 탭이 이 PDF 일 때만 되돌릴 수 있음), order, oldNumPages, index, label, ... }
const UNDO_MAX = 5
const undoByDoc = new Map()
export function rememberPageEdit(docId, entry) {
  undoByDoc.set(docId, [...(undoByDoc.get(docId) ?? []).slice(1 - UNDO_MAX), entry])
}
export const pageEditUndo = (docId) => undoByDoc.get(docId)?.at(-1) ?? null
// 되돌린 뒤: 맨 위 것을 빼고, 그 아래 것은 되돌려서 연 새 PDF 를 기준으로
export function popPageEdit(docId, restoredPdf) {
  const list = (undoByDoc.get(docId) ?? []).slice(0, -1)
  if (list.length) list[list.length - 1] = { ...list.at(-1), pdf: restoredPdf }
  undoByDoc.set(docId, list)
}

// 편집 뒤 탭이 새로 그려질 때 이어 쓸 화면 상태 (도구 등)
const carry = new Map()
export const setPageEditCarry = (docId, v) => carry.set(docId, v)
export function takePageEditCarry(docId) {
  const v = carry.get(docId)
  carry.delete(docId)
  return v ?? null
}

// 페이지 탐색 창 열림 (모든 도면 공통)
const NAV_KEY = 'pdf-measure:page-nav'
export function loadPageNavOpen() {
  try {
    return localStorage.getItem(NAV_KEY) === '1'
  } catch {
    return false
  }
}
export function savePageNavOpen(open) {
  try {
    localStorage.setItem(NAV_KEY, open ? '1' : '0')
  } catch {
    /* 저장 안 돼도 괜찮음 */
  }
}
