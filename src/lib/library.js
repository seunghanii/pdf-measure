// 홈 화면의 폴더 정보: 폴더 목록과 "어떤 도면이 어느 폴더에 있는지".
// 도면의 측정값(state)과 따로 보관해서, 폴더를 바꿔도 측정값은 건드리지 않습니다.
// { folders: [{ id, name, color }], assign: { [도면 id]: 폴더 id }, aliases: { [도면 id]: 별명 }, kinds: [사용자가 더한 계기 종류] }
// 별명은 홈·탭에 짧게 보일 이름. 원래 파일 이름(name)은 그대로 두고 따로 둡니다.

export const FOLDER_COLORS = [
  { id: 'blue', label: '파랑', hex: '#3b82f6' },
  { id: 'green', label: '초록', hex: '#22c55e' },
  { id: 'yellow', label: '노랑', hex: '#eab308' },
  { id: 'orange', label: '주황', hex: '#f97316' },
  { id: 'red', label: '빨강', hex: '#ef4444' },
  { id: 'pink', label: '분홍', hex: '#ec4899' },
  { id: 'purple', label: '보라', hex: '#8b5cf6' },
  { id: 'gray', label: '회색', hex: '#64748b' },
]

export const colorHex = (id) => (FOLDER_COLORS.find((c) => c.id === id) ?? FOLDER_COLORS[0]).hex

export const EMPTY_LIBRARY = { folders: [], assign: {}, aliases: {}, kinds: [] }

// 홈 화면에서 눌러 연 폴더 (이 브라우저에만 기억)
const OPEN_FOLDER_KEY = 'pdf-measure:open-folder'

export function loadOpenFolder() {
  try {
    return localStorage.getItem(OPEN_FOLDER_KEY)
  } catch {
    return null
  }
}

export function saveOpenFolder(id) {
  try {
    if (id) localStorage.setItem(OPEN_FOLDER_KEY, id)
    else localStorage.removeItem(OPEN_FOLDER_KEY)
  } catch {
    // 무시
  }
}

export function normalizeLibrary(lib) {
  const folders = Array.isArray(lib?.folders) ? lib.folders.filter((f) => f && f.id && typeof f.name === 'string') : []
  const ids = new Set(folders.map((f) => f.id))
  const assign = {}
  for (const [doc, folder] of Object.entries(lib?.assign ?? {})) if (ids.has(folder)) assign[doc] = folder
  const aliases = {}
  for (const [doc, alias] of Object.entries(lib?.aliases ?? {})) if (typeof alias === 'string' && alias.trim()) aliases[doc] = alias.trim()
  const kinds = Array.isArray(lib?.kinds) ? [...new Set(lib.kinds.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim().toUpperCase()))] : []
  return { folders, assign, aliases, kinds }
}

// 홈·탭에 보일 이름: 별명이 있으면 별명, 없으면 파일 이름에서 .pdf 를 뺀 것
export const fileBase = (name) => (name ?? '').replace(/\.pdf$/i, '')
export const displayName = (lib, id, name) => lib?.aliases?.[id] || fileBase(name)

// 별명 붙이기. 빈 글이면 별명을 지워 파일 이름이 다시 보임
export function setAlias(lib, docId, alias) {
  const aliases = { ...(lib.aliases ?? {}) }
  const next = alias?.trim()
  if (next) aliases[docId] = next
  else delete aliases[docId]
  return { ...lib, aliases }
}

// 도면을 지울 때 폴더 배정과 별명도 함께 정리
export function forgetDoc(lib, docId) {
  if (!lib.assign[docId] && !lib.aliases?.[docId]) return lib
  return setAlias(moveDoc(lib, docId, null), docId, '')
}

export const newFolderId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function addFolder(lib, name, color) {
  return { ...lib, folders: [...lib.folders, { id: newFolderId(), name, color }] }
}

export function editFolder(lib, id, changes) {
  return { ...lib, folders: lib.folders.map((f) => (f.id === id ? { ...f, ...changes } : f)) }
}

// 폴더를 지워도 안의 도면은 지우지 않고 폴더 밖으로 꺼냄
export function deleteFolder(lib, id) {
  const assign = Object.fromEntries(Object.entries(lib.assign).filter(([, f]) => f !== id))
  return { ...lib, folders: lib.folders.filter((f) => f.id !== id), assign }
}

// folderId 가 null 이면 폴더 밖으로
export function moveDoc(lib, docId, folderId) {
  const assign = { ...lib.assign }
  if (folderId) assign[docId] = folderId
  else delete assign[docId]
  return { ...lib, assign }
}

// 로그인 전 브라우저의 폴더 정보를 서버 쪽에 합치기 (docIds: 서버로 옮긴 도면)
export function mergeLibrary(target, source, docIds) {
  const folders = [...target.folders]
  const assign = { ...target.assign }
  const aliases = { ...(target.aliases ?? {}) }
  for (const id of docIds) {
    if (source.aliases?.[id] && !aliases[id]) aliases[id] = source.aliases[id]
    const f = source.folders.find((x) => x.id === source.assign[id])
    if (!f || assign[id]) continue
    let dest = folders.find((x) => x.id === f.id) ?? folders.find((x) => x.name === f.name)
    if (!dest) folders.push((dest = { ...f }))
    assign[id] = dest.id
  }
  const kinds = [...new Set([...(target.kinds ?? []), ...(source.kinds ?? [])])]
  return { folders, assign, aliases, kinds }
}

// 폴더 순서 바꾸기: id 폴더를 index 자리로 옮김 (홈 화면 칸 순서 = folders 배열 순서)
export function moveFolder(lib, id, index) {
  const from = lib.folders.findIndex((f) => f.id === id)
  if (from < 0) return lib
  const to = Math.max(0, Math.min(lib.folders.length - 1, index))
  if (from === to) return lib
  const folders = [...lib.folders]
  const [f] = folders.splice(from, 1)
  folders.splice(to, 0, f)
  return { ...lib, folders }
}
