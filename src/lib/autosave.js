// 측정값이 바뀌면 잠시 뒤 자동 저장 (로그인했으면 서버, 아니면 이 브라우저).
// 서버 저장은 한 번에 하나씩, 밀린 것은 가장 최근 상태만 보냄. 저장 상태('saved' | 'saving' | 'error')를 돌려줌.
//
// 여러 기기(맥·회사 PC)나 여러 창에서 같은 도면을 열어 둔 경우:
// - 서버 저장은 "이 창이 마지막으로 본 저장 시각"일 때만 됨 (lib/cloudStore.js saveState expect).
//   그사이 다른 곳에서 저장했으면 서버 것을 받아 항목별로 합친 뒤(lib/stateMerge.js) 다시 저장하고, 합친 것을 화면에도 반영(onRemote).
// - 창으로 돌아오거나 탭을 다시 볼 때 서버가 바뀌었으면 받아서 반영.
// - 다른 곳에서 PDF 자체를 바꿨으면(페이지 편집·개정판, PDF 크기로 알아봄) 합칠 수 없으므로 onReload (탭을 새로 불러옴)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { normalizeActivity, trackActivity } from './activity'
import { mergeState } from './stateMerge'

// 서버 시각 글자는 모양이 달라도(…Z / …+00:00) 같은 시각이면 같음
const sameStamp = (a, b) => a === b || (a != null && b != null && Date.parse(a) === Date.parse(b))
// 저장할 때 보내는 모양 그대로 (화면에 반영한 상태를 곧바로 다시 저장하지 않도록 비교용)
const shape = (s) => ({
  measurements: s.measurements,
  categories: s.categories,
  calibration: s.calibration,
  unit: s.unit,
  markupStyle: s.markupStyle,
  counters: s.counters,
  trash: s.trash,
  rev: s.rev ?? null,
  revisions: s.revisions ?? [],
  pageNum: s.pageNum,
  pageLog: s.pageLog,
  activity: s.activity,
})

// counters: 종류별 번호를 담은 ref
// revs: 개정판 정보 { rev, revisions } (lib/revision.js, 바꾼 적 없으면 비어 있음)
// controlRef: 개정판으로 바꿀 때 자동 저장을 멈추는 stop() 을 넣어 줌 (멈춘 뒤에는 보내던 저장이 끝나기를 기다림)
// saved: 불러온 상태 (합칠 때 기준), stamp·size: 불러온 서버 저장 시각·PDF 크기
// active: 지금 보이는 탭인지, onRemote(state): 다른 곳에서 고친 것을 합친 상태를 화면에 반영, onReload(): 탭을 새로 불러옴
export function useAutosave({ store, docId, measurements, categories, calibration, unit, markupStyle, counters, pageNum, trash, revs, controlRef, saved, stamp, size, active, onRemote, onReload }) {
  const cloud = store.kind === 'cloud'
  const [syncStatus, setSyncStatus] = useState('saved')
  const queue = useRef({ busy: false, next: null })
  // 마지막으로 보낸 내용 (바뀐 게 없으면 다시 보내지 않음. 메모를 열고 닫기만 해도 항목이 새로 만들어지는 경우 등)
  const lastSent = useRef(null)
  const stopped = useRef(false)
  // 수정 기록: 지난번 저장(처음엔 불러온) 항목과 비교 기준
  const activityRef = useRef(null)
  const baseItems = useRef(measurements)
  if (activityRef.current === null) activityRef.current = normalizeActivity(saved?.activity)
  // 서버와 마지막으로 맞춘 상태·저장 시각 (cloud 일 때만 씀. stamp 가 undefined 면 예전처럼 그냥 덮어씀)
  const baseRef = useRef(saved ?? null)
  const stampRef = useRef(cloud ? stamp : undefined)
  const sizeRef = useRef(size)
  // 다른 곳 것을 화면에 반영한 횟수. 그 전에 만든 상태가 늦게 저장되려 하면 반영한 것과 다시 합침
  const epochRef = useRef(0)
  const rebaseRef = useRef(null) // { epoch, from: 합치기 전 이 창 상태, to: 합친 상태 }
  const handlers = useRef({ onRemote, onReload })
  useLayoutEffect(() => {
    handlers.current = { onRemote, onReload }
  })

  // 다른 곳 상태와 합친 것을 화면에 반영
  const applyRemote = useCallback((from, merged) => {
    epochRef.current += 1
    rebaseRef.current = { epoch: epochRef.current, from, to: merged }
    activityRef.current = normalizeActivity(merged.activity)
    baseItems.current = merged.measurements ?? []
    handlers.current.onRemote?.(merged)
  }, [])

  // 서버가 다른 곳에서 바뀌었을 때: PDF 가 바뀌었으면 새로 불러오고, 아니면 mine 과 합침. 합친 상태(또는 null)
  const syncFromServer = useCallback(
    async (mine) => {
      const server = await store.getState(docId)
      if (!server) return null
      if (sizeRef.current && server.size && server.size !== sizeRef.current) {
        stopped.current = true // 이 탭은 예전 PDF 기준이라 더 저장하지 않음
        handlers.current.onReload?.()
        return null
      }
      const merged = mergeState(baseRef.current, mine, server.state)
      return { merged, stamp: server.updatedAt }
    },
    [store, docId],
  )

  const persist = useCallback(
    (raw, epoch = epochRef.current) => {
      if (stopped.current) return
      // 다른 곳 것을 반영하기 전에 만든 상태면, 반영한 상태에 이 창에서 고친 것만 얹음
      const rb = rebaseRef.current
      if (rb && epoch < rb.epoch) raw = { ...mergeState(rb.from, raw, rb.to), pageNum: raw.pageNum }
      activityRef.current = trackActivity(baseItems.current, raw.measurements, activityRef.current)
      baseItems.current = raw.measurements
      const state = { ...raw, activity: activityRef.current }
      const json = JSON.stringify(state)
      if (json === lastSent.current) return
      lastSent.current = json
      const q = queue.current
      q.next = state
      if (q.busy) return
      q.busy = true
      ;(async () => {
        while (q.next) {
          let st = q.next
          q.next = null
          setSyncStatus('saving')
          try {
            for (let attempt = 0; ; attempt++) {
              try {
                const at = await store.saveState(docId, st, cloud && stampRef.current !== undefined ? { expect: stampRef.current } : undefined)
                if (cloud && at) stampRef.current = at
                baseRef.current = st
                break
              } catch (e) {
                if (e?.code !== 'conflict' || attempt >= 3) throw e
                // 다른 기기(창)가 그사이 저장함: 받아서 합치고 다시 저장
                const got = await syncFromServer(st)
                if (!got) {
                  q.next = null
                  break
                }
                stampRef.current = got.stamp
                baseRef.current = got.merged // 서버 것과 합친 상태가 새 기준 (저장되면 그대로)
                const from = st
                st = got.merged
                lastSent.current = JSON.stringify(shape(st))
                // 밀려 있던 다음 저장도 합친 상태 위로
                if (q.next) q.next = { ...mergeState(from, q.next, st), pageNum: q.next.pageNum }
                applyRemote(from, st)
              }
            }
            if (stopped.current) break
            setSyncStatus(q.next ? 'saving' : 'saved')
          } catch (e) {
            lastSent.current = null // 실패하면 같은 내용이라도 다음에 다시 보냄
            console.warn('저장 실패', e)
            setSyncStatus('error')
          }
        }
        q.busy = false
      })()
    },
    [docId, store, cloud, syncFromServer, applyRemote],
  )

  const latest = useRef(null)
  const firstRun = useRef(true)
  // 보던 페이지는 스크롤할 때마다 저장하지 않고, 다른 변경을 저장할 때나 탭·창을 닫을 때 함께 저장
  const pageRef = useRef(pageNum)
  const savedPage = useRef(pageNum)
  const stateRef = useRef(null)
  useLayoutEffect(() => {
    pageRef.current = pageNum
    stateRef.current = { measurements, categories, calibration, unit, markupStyle, counters: counters.current, trash, ...revs }
  })
  useLayoutEffect(() => {
    if (!controlRef) return
    controlRef.current = {
      // 멈추고, 보내는 중인 저장이 끝날 때까지 기다림
      stop: async () => {
        stopped.current = true
        latest.current = null
        while (queue.current.busy) await new Promise((r) => setTimeout(r, 50))
      },
      resume: () => {
        stopped.current = false
      },
      // 개정판 저장에 지금까지의 수정 기록도 함께 넣도록
      activity: () => activityRef.current,
    }
  })
  useEffect(() => {
    // 처음 열었을 때는 불러온 그대로라 저장할 필요 없음
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const state = { measurements, categories, calibration, unit, markupStyle, counters: counters.current, trash, ...revs }
    const epoch = epochRef.current
    latest.current = { state, epoch }
    const t = setTimeout(() => {
      latest.current = null
      savedPage.current = pageRef.current
      persist({ ...state, pageNum: pageRef.current }, epoch)
    }, store.saveDelay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements, categories, calibration, unit, markupStyle, counters, trash, revs, persist, store.saveDelay])

  // 탭을 닫거나 창을 닫을 때 아직 저장 안 된 변경(페이지 이동 포함)이 있으면 바로 저장
  useEffect(() => {
    const flush = () => {
      if (stopped.current) return false
      const pageMoved = pageRef.current !== savedPage.current
      if (!latest.current && !pageMoved) return false
      const base = latest.current?.state ?? stateRef.current
      const epoch = latest.current?.epoch ?? epochRef.current
      savedPage.current = pageRef.current
      persist({ ...base, pageNum: pageRef.current }, epoch)
      latest.current = null
      return true
    }
    const onBeforeUnload = (e) => {
      const changed = !!latest.current || queue.current.busy // 페이지만 옮긴 것은 묻지 않음
      flush()
      if (changed && cloud) e.preventDefault() // 서버 저장이 끝나기 전에 닫으면 물어봄
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
  }, [cloud, persist])

  // 창으로 돌아오거나 이 탭을 다시 볼 때: 다른 기기(창)에서 이 도면을 고쳤으면 받아서 반영
  // (저장할 게 남아 있으면 그 저장이 알아서 합치므로 건너뜀)
  useEffect(() => {
    if (!cloud || !active || stampRef.current === undefined || !store.peekState) return
    let last = 0
    let busy = false
    const check = async () => {
      if (document.visibilityState === 'hidden' || busy || Date.now() - last < 3000) return
      if (stopped.current || queue.current.busy || latest.current) return
      last = Date.now()
      busy = true
      try {
        const peek = await store.peekState(docId)
        if (!peek || sameStamp(peek.updatedAt, stampRef.current)) return
        if (stopped.current || queue.current.busy || latest.current) return
        const mine = { ...stateRef.current, pageNum: pageRef.current, activity: activityRef.current }
        const got = await syncFromServer(mine)
        if (!got || stopped.current || queue.current.busy || latest.current) return
        stampRef.current = got.stamp
        baseRef.current = got.merged
        lastSent.current = JSON.stringify(shape(got.merged))
        applyRemote(mine, got.merged)
      } catch (e) {
        console.warn('다른 기기 변경 확인 실패', e)
      } finally {
        busy = false
      }
    }
    check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [cloud, active, store, docId, syncFromServer, applyRemote])

  return syncStatus
}
