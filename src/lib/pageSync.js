// 페이지 편집(돌리기·지우기·넣기·순서)의 서버 저장을 뒤에서 처리.
// 화면은 새 PDF 를 바로 보여 주고, PDF 업로드·상태 저장은 도면마다 차례로 여기서 함.
// - 앞 작업이 도는 동안 더 새 편집이 쌓이면, 보관본(keepKey)이 없는 중간 작업은 건너뜀 (마지막 것만 올리면 됨)
// - 실패하면 잠시 뒤(인터넷이 돌아오면 바로) 다시 시도. 끝날 때까지 자동 저장은 기다리고, 창을 닫으려 하면 물어봄
// - 자동 저장(lib/autosave.js)은 settle() 로 끝나기를 기다린 뒤 마지막 작업의 저장 시각·상태를 기준으로 이어 감

const docs = new Map() // docId → { jobs: [], running: false, seq, done: { seq, stamp, state } | null, waiters: [], failed }
const listeners = new Set()
const RETRY_MS = [2000, 5000, 10000, 20000, 30000]

const entry = (id) => {
  let d = docs.get(id)
  if (!d) docs.set(id, (d = { jobs: [], running: false, seq: 0, done: null, waiters: [], failed: 0 }))
  return d
}
const emit = () => {
  for (const fn of listeners) fn()
}

export const isPageSyncPending = (id) => {
  const d = docs.get(id)
  return !!d && (d.running || d.jobs.length > 0)
}
export const anyPageSyncPending = () => [...docs.keys()].some(isPageSyncPending)
export const pageSyncFailed = (id) => docs.get(id)?.failed ?? 0

// 상태 바뀔 때 알림 (useSyncExternalStore 용)
export function subscribePageSync(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// 끝날 때까지 기다림. 마지막으로 끝난 작업 { seq, stamp, state } (없으면 null)
export function settlePageSync(id) {
  const d = docs.get(id)
  if (!d) return Promise.resolve(null)
  if (!d.running && !d.jobs.length) return Promise.resolve(d.done)
  return new Promise((r) => d.waiters.push(r))
}

// job: { run: async () => ({ stamp, state }), keep: 건너뛰면 안 되는 작업(보관본 만들기 등) }
export function enqueuePageSync(id, job) {
  const d = entry(id)
  d.jobs.push({ ...job, seq: ++d.seq })
  emit()
  pump(id)
}

let retryTimer = null
async function pump(id) {
  const d = entry(id)
  if (d.running) return
  // 더 새 작업이 있으면 중간 작업은 건너뜀
  while (d.jobs.length > 1 && !d.jobs[0].keep) d.jobs.shift()
  const job = d.jobs[0]
  if (!job) {
    const done = d.done
    d.waiters.splice(0).forEach((r) => r(done))
    emit()
    return
  }
  d.running = true
  emit()
  try {
    const res = await job.run()
    d.done = { seq: job.seq, stamp: res?.stamp, state: res?.state ?? null }
    d.jobs.shift()
    d.failed = 0
    d.running = false
    pump(id)
  } catch (e) {
    console.warn('페이지 편집 서버 저장 실패, 다시 시도', e)
    d.running = false
    d.failed += 1
    emit()
    if (e?.code === 'too_large') {
      // 다시 해도 안 됨: 이 작업은 버리고 알림
      d.jobs.shift()
      job.onGiveUp?.(e)
      pump(id)
      return
    }
    const wait = RETRY_MS[Math.min(d.failed - 1, RETRY_MS.length - 1)]
    clearTimeout(retryTimer)
    retryTimer = setTimeout(retryAll, wait)
  }
}
function retryAll() {
  for (const id of docs.keys()) if (!docs.get(id).running && docs.get(id).jobs.length) pump(id)
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', retryAll)
  // 서버에 다 올리기 전에 창을 닫으면 물어봄
  window.addEventListener('beforeunload', (e) => {
    if (anyPageSyncPending()) e.preventDefault()
  })
}
