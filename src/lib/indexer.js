// 검색용 글자 색인을 뒤에서 하나씩 만들어 저장하는 대기열.
// 도면을 열거나 올리면 색인이 없는 것만 차례로 만들고(스캔본은 OCR), 저장소(브라우저/서버)에 한 번만 저장합니다.
// 화면은 subscribe 로 진행 상황과 완료 소식을 받습니다.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { loadPdf } from './pdf'
import { buildIndex, isValidIndex } from './textIndex'

const scopeOf = (store) => (store.kind === 'cloud' ? `cloud:${store.user.id}` : 'local')
const keyOf = (store, id) => `${scopeOf(store)}|${id}`

const cache = new Map() // key → 색인 (이 창에서 한 번 읽은 것)
const queue = [] // { key, store, id, name, getPdf }
let running = null // { key, id, name, progress }
const listeners = new Set()
let snapshot = { running: null, waiting: 0 }

function emit() {
  snapshot = { running: running && { ...running }, waiting: queue.length }
  for (const fn of listeners) fn()
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// 진행 상황: { running: { id, name, progress: { page, pages, ocr, done } } | null, waiting }
export function useIndexerStatus() {
  return useSyncExternalStore(subscribe, () => snapshot)
}

const doneListeners = new Set() // (scope, id, index)
export function onIndexed(fn) {
  doneListeners.add(fn)
  return () => doneListeners.delete(fn)
}

export async function getIndex(store, id) {
  const key = keyOf(store, id)
  if (cache.has(key)) return cache.get(key)
  const index = await store.getTextIndex(id)
  if (isValidIndex(index)) cache.set(key, index)
  return isValidIndex(index) ? index : null
}

// 저장소에 있는 모든 색인 (홈 검색). 받은 것은 기억해 두고, 다음에는 아직 없는 것만 받음
export async function listIndexes(store) {
  const prefix = `${scopeOf(store)}|`
  const known = new Map()
  for (const [key, index] of cache) if (key.startsWith(prefix)) known.set(key.slice(prefix.length), index)
  const list = await store.listTextIndexes(new Set(known.keys()))
  const out = new Map()
  for (const { id, index } of list) {
    const ix = index === undefined ? known.get(id) : index // undefined: 이미 받아 둔 것
    if (!isValidIndex(ix)) continue
    cache.set(keyOf(store, id), ix)
    out.set(id, ix)
  }
  return out
}

export function forgetIndex(store, id) {
  cache.delete(keyOf(store, id))
}

// 색인이 없으면 대기열에 넣음. getPdf: 이미 열린 PDFDocumentProxy 를 주는 함수 (없으면 저장소에서 파일을 받아 엶)
export async function ensureIndexed(store, id, name, getPdf) {
  const key = keyOf(store, id)
  if (running?.key === key || queue.some((q) => q.key === key)) return
  try {
    if (await getIndex(store, id)) return
  } catch (e) {
    console.warn('색인 확인 실패', e)
    return
  }
  if (running?.key === key || queue.some((q) => q.key === key)) return
  queue.push({ key, store, id, name, getPdf })
  emit()
  pump()
}

// 개정판으로 바꾼 도면: 예전 색인을 지우고 새 PDF 로 다시 만듦 (만드는 중이던 예전 PDF 색인은 저장하지 않음)
export async function reindex(store, id, name, getPdf) {
  const key = keyOf(store, id)
  cache.delete(key)
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].key === key) queue.splice(i, 1)
  if (running?.key === key) running.stale = true
  try {
    await store.saveTextIndex(id, null)
  } catch (e) {
    console.warn('예전 색인 지우기 실패', e)
  }
  cache.delete(key)
  queue.push({ key, store, id, name, getPdf })
  emit()
  pump()
}

async function pump() {
  if (running) return
  const job = queue.shift()
  if (!job) return emit()
  const me = (running = { key: job.key, id: job.id, name: job.name, progress: null })
  emit()
  let own = null // 이 대기열이 직접 연 PDF (끝나면 닫음)
  try {
    let pdfDoc = job.getPdf?.()
    if (!pdfDoc) {
      const blob = await job.store.getFile(job.id)
      if (!blob) throw new Error('no file')
      own = pdfDoc = await loadPdf(await blob.arrayBuffer())
    }
    let last = 0
    const index = await buildIndex(pdfDoc, {
      onProgress: (p) => {
        running.progress = p
        const now = Date.now()
        if (now - last > 300) {
          last = now
          emit()
        }
      },
    })
    if (me.stale) return // 그사이 개정판으로 바뀜 (새 판 색인이 대기열에 있음)
    await job.store.saveTextIndex(job.id, index)
    cache.set(job.key, index)
    for (const fn of doneListeners) fn(scopeOf(job.store), job.id, index)
  } catch (e) {
    console.warn('검색 색인 만들기 실패', job.name, e)
  } finally {
    own?.loadingTask?.destroy()
    running = null
    emit()
    setTimeout(pump, 0)
  }
}

// 도면 하나의 색인 (만들어지면 자동으로 갱신)
export function useDocIndex(store, id) {
  const [index, setIndex] = useState(() => cache.get(keyOf(store, id)) ?? null)
  useEffect(() => {
    let alive = true
    getIndex(store, id)
      .then((ix) => alive && ix && setIndex(ix))
      .catch(() => {})
    const off = onIndexed((scope, docId, ix) => {
      if (scope === scopeOf(store) && docId === id) setIndex(ix)
    })
    return () => {
      alive = false
      off()
    }
  }, [store, id])
  return index
}

export { scopeOf }
