// 로그인하지 않았을 때 쓰는 브라우저 저장소 (서버로 전송되지 않음).
// - IndexedDB: PDF 파일 자체(용량이 커서 localStorage 에는 못 넣음)와 도면별 측정값
// - localStorage: 마지막으로 열려 있던 탭 목록 (로그인 여부와 상관없이 기기마다 따로)
// 로그인하면 cloudStore.js 가 같은 모양의 함수로 서버(Supabase)에 저장하고,
// 여기의 'cache' 저장소는 서버에서 받은 PDF 를 다시 받지 않도록 임시 보관하는 데만 씁니다.

import { EMPTY_LIBRARY, normalizeLibrary } from './library'
import { noteItems } from './notes'

const DB_NAME = 'pdf-measure'
const DB_VERSION = 4
const MAX_RECENT = 20
const SESSION_KEY = 'pdf-measure:session'
const LIBRARY_KEY = 'pdf-measure:library'

let dbPromise = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('text')) db.createObjectStore('text', { keyPath: 'id' }) // 검색용 글자 색인
        // 도면에 넣은 사진 { id, docId, blob }
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' }).createIndex('docId', 'docId')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function run(storeNames, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode)
        const stores = [].concat(storeNames).map((n) => tx.objectStore(n))
        let result
        Promise.resolve(fn(...stores))
          .then((r) => (result = r))
          .catch((e) => {
            tx.abort()
            reject(e)
          })
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

const req2promise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

// 같은 이름·크기의 파일은 같은 도면으로 봅니다.
export function fileIdOf(file) {
  return `${file.name}|${file.size}`
}

// 파일을 저장하고 "최근 연 시각"을 갱신. 기존에 저장된 측정값이 있으면 돌려줍니다.
export async function rememberFile(id, file) {
  const now = Date.now()
  const doc = await run(['files', 'docs'], 'readwrite', async (files, docs) => {
    const existing = await req2promise(docs.get(id))
    files.put({ id, blob: file })
    const next = { id, name: file.name, size: file.size, state: null, ...existing, lastOpened: now }
    docs.put(next)
    return next
  })
  await pruneRecent()
  return doc
}

export async function touchFile(id) {
  return run('docs', 'readwrite', async (docs) => {
    const existing = await req2promise(docs.get(id))
    if (!existing) return null
    const next = { ...existing, lastOpened: Date.now() }
    docs.put(next)
    return next
  })
}

export function getFile(id) {
  return run('files', 'readonly', (files) => req2promise(files.get(id))).then((r) => r?.blob ?? null)
}

export function getDoc(id) {
  return run('docs', 'readonly', (docs) => req2promise(docs.get(id)))
}

export function saveState(id, state) {
  return run('docs', 'readwrite', async (docs) => {
    const existing = await req2promise(docs.get(id))
    if (existing) docs.put({ ...existing, state })
  })
}

export async function listRecent() {
  const all = await run('docs', 'readonly', (docs) => req2promise(docs.getAll()))
  return all.map((d) => ({ ...d, summary: summarize(d.state) })).sort((a, b) => b.lastOpened - a.lastOpened)
}

// 홈 목록에 보여 줄 요약: 측정·마크업 개수와 축척, 홈 검색용 직접 넣은 글(notes)
export function summarize(state) {
  return {
    count: state?.measurements?.length ?? 0,
    calibration: state?.calibration ?? null,
    notes: noteItems(state?.measurements, state?.categories),
  }
}

// 화면에 보이는 이름만 바꿈 (id 는 그대로라 측정값이 이어짐)
export function renameFile(id, name) {
  return run('docs', 'readwrite', async (docs) => {
    const existing = await req2promise(docs.get(id))
    if (existing) docs.put({ ...existing, name })
  })
}

export function removeFile(id) {
  return run(['files', 'docs', 'text', 'images'], 'readwrite', async (files, docs, text, images) => {
    files.delete(id)
    docs.delete(id)
    text.delete(id)
    const keys = await req2promise(images.index('docId').getAllKeys(id))
    keys.forEach((k) => images.delete(k))
  })
}

// 도면에 넣은 사진 (images.js)
export function saveImage(docId, imageId, blob) {
  return run('images', 'readwrite', (images) => {
    images.put({ id: imageId, docId, blob })
  })
}

export function getImage(docId, imageId) {
  return run('images', 'readonly', (images) => req2promise(images.get(imageId))).then((r) => r?.blob ?? null)
}

export function listImageIds(docId) {
  return run('images', 'readonly', (images) => req2promise(images.index('docId').getAllKeys(docId)))
}

export function removeImages(docId, ids) {
  return run('images', 'readwrite', (images) => ids.forEach((k) => images.delete(k)))
}

// 서버로 옮길 때 쓰는 도면의 사진 전부 [{ id, blob }]
export function listImages(docId) {
  return run('images', 'readonly', (images) => req2promise(images.index('docId').getAll(docId))).then((rows) =>
    rows.map((r) => ({ id: r.id, blob: r.blob })),
  )
}

// 검색용 글자 색인 (textIndex.js)
export function getTextIndex(id) {
  return run('text', 'readonly', (t) => req2promise(t.get(id))).then((r) => r?.index ?? null)
}

export function saveTextIndex(id, index) {
  return run('text', 'readwrite', (t) => {
    t.put({ id, index })
  })
}

export async function listTextIndexes() {
  const all = await run('text', 'readonly', (t) => req2promise(t.getAll()))
  return all.map((r) => ({ id: r.id, index: r.index }))
}

// 오래된 도면은 목록에서 정리하되, 폴더에 넣어 둔 도면은 남김
async function pruneRecent() {
  const { assign } = getLibrary()
  const loose = (await listRecent()).filter((d) => !assign[d.id])
  for (const d of loose.slice(MAX_RECENT)) await removeFile(d.id)
}

export function getLibrary() {
  try {
    return normalizeLibrary(JSON.parse(localStorage.getItem(LIBRARY_KEY)))
  } catch {
    return EMPTY_LIBRARY
  }
}

export function saveLibrary(lib) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib))
  } catch {
    // 무시
  }
}

// 서버에서 받은 PDF 임시 보관 (key: 저장 경로)
export function cacheGet(key) {
  return run('cache', 'readonly', (c) => req2promise(c.get(key))).then((r) => r?.blob ?? null)
}

export function cachePut(key, blob) {
  return run('cache', 'readwrite', (c) => {
    c.put({ key, blob, at: Date.now() })
  })
}

export function cacheDelete(key) {
  return run('cache', 'readwrite', (c) => {
    c.delete(key)
  })
}

// keep 에 없는 임시 보관 파일 지우기
export async function cachePrune(keep) {
  const keys = await run('cache', 'readonly', (c) => req2promise(c.getAllKeys()))
  const drop = keys.filter((k) => !keep.has(k))
  if (drop.length) await run('cache', 'readwrite', (c) => drop.forEach((k) => c.delete(k)))
}

// 로그인하지 않았을 때 쓰는 저장소. cloudStore.js 의 createCloudStore 와 같은 모양.
export const localStore = {
  kind: 'local',
  saveDelay: 200,
  rememberFile,
  touchFile,
  getFile,
  saveState,
  listRecent: () => listRecent(),
  removeFile,
  renameFile,
  getTextIndex,
  saveTextIndex,
  listTextIndexes,
  saveImage,
  getImage,
  listImageIds,
  removeImages,
  listImages,
  getLibrary: async () => getLibrary(),
  saveLibrary: async (lib) => saveLibrary(lib),
}

// scope: 로그인한 사용자 id (없으면 이 브라우저 전용)
const sessionKey = (scope) => (scope ? `${SESSION_KEY}:${scope}` : SESSION_KEY)

export function loadSession(scope) {
  try {
    const s = JSON.parse(localStorage.getItem(sessionKey(scope)))
    if (s && Array.isArray(s.open)) return s
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 모드 등)
  }
  return { open: [], active: null }
}

export function saveSession(scope, session) {
  try {
    localStorage.setItem(sessionKey(scope), JSON.stringify(session))
  } catch {
    // 무시
  }
}
