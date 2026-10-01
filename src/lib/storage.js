// 브라우저 안에만 저장합니다 (서버로 전송되지 않음).
// - IndexedDB: PDF 파일 자체(용량이 커서 localStorage 에는 못 넣음)와 도면별 측정값
// - localStorage: 마지막으로 열려 있던 탭 목록

const DB_NAME = 'pdf-measure'
const DB_VERSION = 1
const MAX_RECENT = 20
const SESSION_KEY = 'pdf-measure:session'

let dbPromise = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
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
  return all.sort((a, b) => b.lastOpened - a.lastOpened)
}

export function removeFile(id) {
  return run(['files', 'docs'], 'readwrite', (files, docs) => {
    files.delete(id)
    docs.delete(id)
  })
}

async function pruneRecent() {
  const all = await listRecent()
  for (const d of all.slice(MAX_RECENT)) await removeFile(d.id)
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY))
    if (s && Array.isArray(s.open)) return s
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 모드 등)
  }
  return { open: [], active: null }
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // 무시
  }
}
