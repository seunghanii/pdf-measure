// 도면 개정판으로 바꾸기: 도면(id·마크업·메모·계기 카드·연결)은 그대로 두고 PDF 파일만 새 판으로 바꿈.
// - 도면 state.rev = 지금 판 { key, label, name, size, at }, state.revisions = 예전 판 목록(새것부터) [{ key, label, name, size, at, file }]
//   key: 그 판을 보관한 이름(저장소 안에서만 씀), file: 예전 PDF 를 보관했는지
// - 폴더 정보(library)의 revOf { 파일 id: 도면 id } 와 revCur { 도면 id: 지금 판 파일 id } 로
//   나중에 컴퓨터에서 새 판(또는 예전 판) PDF 를 바로 열어도 같은 도면으로 열리게 함
// - 쪽 크기가 바뀌면(같은 비율로 커지거나 작아지면) 마크업 자리와 축척을 같이 맞춤
// storage.js 의 fileIdOf 와 같음 (library.js 가 이 파일을 불러서, 서로 부르지 않게 따로 둠)
const fileIdOf = (file) => `${file.name}|${file.size}`

// 쪽마다 크기 (pdf.js 화면 좌표 = 마크업 좌표, 회전 포함)
export async function pageSizes(pdfDoc) {
  const out = []
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const vp = (await pdfDoc.getPage(i)).getViewport({ scale: 1 })
    out.push({ w: vp.width, h: vp.height })
  }
  return out
}

const SAME = 0.005 // 0.5% 안의 차이는 같은 크기로 봄
const ASPECT = 0.02 // 가로세로 비율이 2% 안이면 같은 비율 (크기만 바뀐 것)

// 쪽마다 어떻게 바뀌는지: { page, k (배율), kind: 'same' | 'scale' | 'shape' }
export function comparePages(oldSizes, newSizes) {
  const n = Math.min(oldSizes.length, newSizes.length)
  const out = []
  for (let i = 0; i < n; i++) {
    const a = oldSizes[i]
    const b = newSizes[i]
    const kx = b.w / a.w
    const ky = b.h / a.h
    if (Math.abs(kx - 1) < SAME && Math.abs(ky - 1) < SAME) out.push({ page: i + 1, k: 1, kind: 'same' })
    else if (Math.abs(kx / ky - 1) < ASPECT) out.push({ page: i + 1, k: Math.sqrt(kx * ky), kind: 'scale' })
    else out.push({ page: i + 1, k: 1, kind: 'shape' })
  }
  return out
}

// 바꾸기 전에 보여 줄 요약
export function revisionReport(oldSizes, newSizes, items) {
  const pages = comparePages(oldSizes, newSizes)
  const gone = items.filter((m) => m.page > newSizes.length)
  const used = new Set(items.map((m) => m.page))
  return {
    oldPages: oldSizes.length,
    newPages: newSizes.length,
    scaled: pages.filter((p) => p.kind === 'scale' && used.has(p.page)),
    reshaped: pages.filter((p) => p.kind === 'shape' && used.has(p.page)),
    goneCount: gone.length,
    goneFrom: newSizes.length + 1,
  }
}

const num = (v) => typeof v === 'number' && Number.isFinite(v)

function scaleItem(m, k) {
  const out = { ...m, points: m.points?.map((p) => ({ ...p, x: p.x * k, y: p.y * k })) }
  for (const f of ['fontSize', 'boxWidth', 'strokeWidth', 'borderWidth']) if (num(m[f])) out[f] = m[f] * k
  return out
}

// 새 판에 맞춘 측정값. fit: 같은 비율로 커지거나 작아진 쪽은 마크업도 같이 맞춤 (false 면 자리 그대로)
export function adaptState({ measurements, trash, calibration }, oldSizes, newSizes, fit) {
  const ks = new Map()
  if (fit) for (const p of comparePages(oldSizes, newSizes)) if (p.kind === 'scale') ks.set(p.page, p.k)
  const fix = (m) => (ks.has(m.page) ? scaleItem(m, ks.get(m.page)) : m)
  let cal = calibration
  if (cal?.mode === 'line' && ks.has(cal.page)) {
    // 기준선도 같이 늘리면 "실제 길이 ÷ 선 길이" 가 새 크기에 맞게 바뀜
    const k = ks.get(cal.page)
    cal = { ...cal, points: cal.points.map((p) => ({ ...p, x: p.x * k, y: p.y * k })) }
  } else if (cal?.mode === 'ratio' && ks.has(1)) {
    // 1:N 축척은 종이 크기가 k 배가 되면 1:N/k
    cal = { ...cal, ratio: cal.ratio / ks.get(1) }
  }
  return {
    measurements: measurements.map(fix),
    trash: (trash ?? []).map((t) => ({ ...t, item: fix(t.item) })),
    calibration: cal,
  }
}

export const newRevKey = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// 다음 판 이름 제안: 마지막 이름이 숫자나 글자로 끝나면 하나 올림 (Rev.0 → Rev.1, Rev.A → Rev.B)
export function nextRevLabel(rev, revisions = []) {
  const last = rev?.label
  if (last) {
    const m = last.match(/^(.*?)(\d+)$/)
    if (m) return m[1] + (Number(m[2]) + 1)
    const c = last.match(/^(.*?)([A-Y])$/i)
    if (c) return c[1] + String.fromCharCode(c[2].charCodeAt(0) + 1)
  }
  return `Rev.${revisions.length + 1}`
}

// 홈·탭에 보일 판 이름
export const revLabel = (state) => state?.rev?.label ?? null

// ---------- 폴더 정보(library) 쪽 ----------

// file 을 열 때 어느 도면인지: { id, stale } (stale: 지금 판이 아닌 예전 판 PDF)
export function resolveFile(lib, file) {
  const key = fileIdOf(file)
  const id = lib?.revOf?.[key] ?? key
  const cur = lib?.revCur?.[id]
  return { id, stale: !!cur && cur !== key }
}

// 판을 바꾼 뒤: 새 파일 id 를 이 도면으로 이어 줌
export function linkRevision(lib, docId, fileKey) {
  const revOf = { ...(lib.revOf ?? {}) }
  if (fileKey !== docId) revOf[fileKey] = docId
  return { ...lib, revOf, revCur: { ...(lib.revCur ?? {}), [docId]: fileKey } }
}

// 도면을 완전히 지울 때 판 연결도 지움
export function forgetRevisions(lib, docId) {
  if (!lib.revCur?.[docId] && !Object.values(lib.revOf ?? {}).includes(docId)) return lib
  const revOf = {}
  for (const [k, v] of Object.entries(lib.revOf ?? {})) if (v !== docId) revOf[k] = v
  const revCur = { ...(lib.revCur ?? {}) }
  delete revCur[docId]
  return { ...lib, revOf, revCur }
}

export function normalizeRevMaps(lib) {
  const pick = (o) => {
    const out = {}
    for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) if (typeof v === 'string' && v) out[k] = v
    return out
  }
  return { revOf: pick(lib?.revOf), revCur: pick(lib?.revCur) }
}
