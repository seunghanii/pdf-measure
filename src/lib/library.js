// 홈 화면의 폴더 정보: 폴더 목록과 "어떤 도면이 어느 폴더에 있는지".
// 도면의 측정값(state)과 따로 보관해서, 폴더를 바꿔도 측정값은 건드리지 않습니다.
// { folders: [{ id, name, color }], assign: { [도면 id]: 폴더 id } }

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

export const EMPTY_LIBRARY = { folders: [], assign: {} }

export function normalizeLibrary(lib) {
  const folders = Array.isArray(lib?.folders) ? lib.folders.filter((f) => f && f.id && typeof f.name === 'string') : []
  const ids = new Set(folders.map((f) => f.id))
  const assign = {}
  for (const [doc, folder] of Object.entries(lib?.assign ?? {})) if (ids.has(folder)) assign[doc] = folder
  return { folders, assign }
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
  return { folders: lib.folders.filter((f) => f.id !== id), assign }
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
  for (const id of docIds) {
    const f = source.folders.find((x) => x.id === source.assign[id])
    if (!f || assign[id]) continue
    let dest = folders.find((x) => x.id === f.id) ?? folders.find((x) => x.name === f.name)
    if (!dest) folders.push((dest = { ...f }))
    assign[id] = dest.id
  }
  return { folders, assign }
}
