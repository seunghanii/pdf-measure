// 휴지통: 지운 항목·도면을 7일 동안 보관했다가 완전히 지웁니다.
// 서버 크론 없이, 도면이나 앱을 열 때 7일이 지난 것을 정리합니다.
//
// 항목 휴지통: 도면 state.trash = [{ item: 지운 항목 그대로, at: 지운 시각(ms) }]
//   (지운 항목의 사진·엑셀 파일은 휴지통에 있는 동안 지우지 않음)
// 도면 휴지통: 폴더 정보(library.trash) = { [도면 id]: { at, name } }
//   (휴지통에 있는 도면은 홈·검색·연결 목록에서 숨기고, 7일 뒤 PDF·사진까지 서버에서 지움)

export const TRASH_DAYS = 7
const DAY = 24 * 60 * 60 * 1000
export const TRASH_MS = TRASH_DAYS * DAY

export const isExpired = (at, now = Date.now()) => !(at > 0) || now - at >= TRASH_MS

// 남은 날 (올림). 0 이면 오늘 지워짐
export function daysLeft(at, now = Date.now()) {
  return Math.max(0, Math.ceil((at + TRASH_MS - now) / DAY))
}

export function leftLabel(at, now = Date.now()) {
  const d = daysLeft(at, now)
  return d <= 1 ? '하루 안에 완전 삭제' : `${d}일 뒤 완전 삭제`
}

// 도면 state 의 항목 휴지통 정리: 모양이 잘못됐거나 7일 지난 것은 뺌
export function liveItemTrash(list, now = Date.now()) {
  if (!Array.isArray(list)) return []
  return list.filter((t) => t && t.item && t.item.id && !isExpired(t.at, now))
}

// 항목을 휴지통에 넣기 (같은 id 가 있으면 새로 지운 것으로 바꿈). 최근 것이 앞에
export function pushItems(trash, items, now = Date.now()) {
  if (!items.length) return trash
  const ids = new Set(items.map((m) => m.id))
  return [...items.map((item) => ({ item, at: now })), ...trash.filter((t) => !ids.has(t.item.id))]
}

// ---- 도면 휴지통 (library.trash) ----

// 다른 화면(계기 목록, 도면 연결)에서 휴지통 도면을 빼고 보이도록 App 이 알려 주는 목록
let trashedDocs = {}
export function setTrashedDocs(map) {
  trashedDocs = map ?? {}
}
export const isDocTrashed = (id) => !!trashedDocs[id]
export const withoutTrashed = (list) => (list ?? []).filter((d) => !trashedDocs[d.id])

export function normalizeDocTrash(map) {
  const out = {}
  for (const [id, v] of Object.entries(map ?? {})) if (v && v.at > 0) out[id] = { at: v.at, name: String(v.name ?? '') }
  return out
}

export function trashDoc(lib, id, name, now = Date.now()) {
  return { ...lib, trash: { ...(lib.trash ?? {}), [id]: { at: now, name } } }
}

export function untrashDoc(lib, id) {
  if (!lib.trash?.[id]) return lib
  const trash = { ...lib.trash }
  delete trash[id]
  return { ...lib, trash }
}
