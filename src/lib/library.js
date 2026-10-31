// 홈 화면의 폴더 정보: 폴더 목록과 "어떤 도면이 어느 폴더에 있는지".
// 도면의 측정값(state)과 따로 보관해서, 폴더를 바꿔도 측정값은 건드리지 않습니다.
// { folders: [{ id, name, color, parent? }], assign: { [도면 id]: 폴더 id }, aliases: { [도면 id]: 별명 }, kinds: [사용자가 더한 계기 종류] }
// 별명은 홈·탭에 짧게 보일 이름. 원래 파일 이름(name)은 그대로 두고 따로 둡니다.
// parent: 하위 폴더일 때 상위 폴더 id (없으면 맨 위). 예전 폴더는 parent 가 없어 그대로 맨 위에 보입니다.
// trash: 휴지통에 넣은 도면 { [도면 id]: { at, name } } (lib/trash.js)
import { normalizeDocTrash } from './trash'

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

export const EMPTY_LIBRARY = { folders: [], assign: {}, aliases: {}, kinds: [], trash: {} }

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
  const raw = Array.isArray(lib?.folders) ? lib.folders.filter((f) => f && f.id && typeof f.name === 'string') : []
  const ids = new Set(raw.map((f) => f.id))
  // 없는 상위 폴더나 돌고 도는 연결(A 안에 B, B 안에 A)은 맨 위로
  const byId = new Map(raw.map((f) => [f.id, f]))
  const loops = (f) => {
    const seen = new Set([f.id])
    for (let p = f.parent; p; p = byId.get(p)?.parent) {
      if (seen.has(p) || !ids.has(p)) return true
      seen.add(p)
    }
    return false
  }
  const folders = raw.map((f) => {
    if (!f.parent) return f.parent === undefined ? f : stripParent(f)
    return loops(f) ? stripParent(f) : f
  })
  const assign = {}
  for (const [doc, folder] of Object.entries(lib?.assign ?? {})) if (ids.has(folder)) assign[doc] = folder
  const aliases = {}
  for (const [doc, alias] of Object.entries(lib?.aliases ?? {})) if (typeof alias === 'string' && alias.trim()) aliases[doc] = alias.trim()
  const kinds = Array.isArray(lib?.kinds) ? [...new Set(lib.kinds.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim().toUpperCase()))] : []
  return { folders, assign, aliases, kinds, trash: normalizeDocTrash(lib?.trash) }
}

function stripParent(f) {
  const { parent: _parent, ...rest } = f
  return rest
}

// 폴더 나무 다루기
export const parentOf = (lib, id) => lib.folders.find((f) => f.id === id)?.parent ?? null
export const childFolders = (lib, parentId) => lib.folders.filter((f) => (f.parent ?? null) === (parentId ?? null))

// 맨 위부터 id 폴더까지 (빵부스러기)
export function folderPath(lib, id) {
  const path = []
  const seen = new Set()
  for (let f = lib.folders.find((x) => x.id === id); f && !seen.has(f.id); f = lib.folders.find((x) => x.id === f.parent)) {
    seen.add(f.id)
    path.unshift(f)
  }
  return path
}

// id 폴더와 그 아래 모든 하위 폴더 id
export function folderSubtree(lib, id) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of lib.folders) {
      if (f.parent && out.has(f.parent) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

// 고르기 목록용: 나무 순서로 펼친 [{ folder, depth }]
export function folderTree(lib) {
  const out = []
  const walk = (parentId, depth) => {
    for (const f of childFolders(lib, parentId)) {
      out.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

// "상위 › 하위" 이름
export const folderLabel = (lib, id) => folderPath(lib, id).map((f) => f.name).join(' › ')

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
  if (!lib.assign[docId] && !lib.aliases?.[docId] && !lib.trash?.[docId]) return lib
  const trash = { ...(lib.trash ?? {}) }
  delete trash[docId]
  return { ...setAlias(moveDoc(lib, docId, null), docId, ''), trash }
}

export const newFolderId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// parent: 이 폴더 안에 만들 때 상위 폴더 id
export function addFolder(lib, name, color, parent = null) {
  const folder = { id: newFolderId(), name, color }
  if (parent && lib.folders.some((f) => f.id === parent)) folder.parent = parent
  return { ...lib, folders: [...lib.folders, folder] }
}

// changes.parent 로 다른 폴더 안으로 옮기기 (null = 맨 위). 자기 자신이나 자기 하위 폴더 안으로는 못 옮김
export function editFolder(lib, id, changes) {
  const { parent, ...rest } = changes
  return {
    ...lib,
    folders: lib.folders.map((f) => {
      if (f.id !== id) return f
      const next = { ...f, ...rest }
      if (parent === undefined) return next
      if (parent && (folderSubtree(lib, id).has(parent) || !lib.folders.some((x) => x.id === parent))) return next
      return parent ? { ...next, parent } : stripParent(next)
    }),
  }
}

// 폴더를 지워도 안의 도면과 하위 폴더는 지우지 않고 한 단계 위(지운 폴더의 상위)로 꺼냄
export function deleteFolder(lib, id) {
  const up = parentOf(lib, id)
  const assign = {}
  for (const [doc, f] of Object.entries(lib.assign)) {
    if (f !== id) assign[doc] = f
    else if (up) assign[doc] = up
  }
  const folders = lib.folders
    .filter((f) => f.id !== id)
    .map((f) => (f.parent === id ? (up ? { ...f, parent: up } : stripParent(f)) : f))
  return { ...lib, folders, assign }
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
    // 상위 폴더부터 차례로 맞추기 (같은 id, 아니면 같은 자리의 같은 이름)
    let parent = null
    let dest = null
    for (const step of folderPath(source, f.id)) {
      dest =
        folders.find((x) => x.id === step.id) ??
        folders.find((x) => x.name === step.name && (x.parent ?? null) === parent)
      if (!dest) {
        dest = stripParent({ ...step })
        if (parent) dest.parent = parent
        folders.push(dest)
      }
      parent = dest.id
    }
    assign[id] = dest.id
  }
  const kinds = [...new Set([...(target.kinds ?? []), ...(source.kinds ?? [])])]
  const trash = { ...(target.trash ?? {}) }
  for (const id of docIds) if (source.trash?.[id] && !trash[id]) trash[id] = source.trash[id]
  return { folders, assign, aliases, kinds, trash }
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

// 같은 상위 폴더 안의 순서 바꾸기: order 는 그 형제 폴더 id 들의 새 순서.
// 전체 folders 배열에서 형제들이 있던 자리에 새 순서대로 다시 채움.
export function reorderSiblings(lib, order) {
  const set = new Set(order)
  const queue = order.map((id) => lib.folders.find((f) => f.id === id)).filter(Boolean)
  if (queue.length !== set.size) return lib
  const folders = lib.folders.map((f) => (set.has(f.id) ? queue.shift() : f))
  return { ...lib, folders }
}
