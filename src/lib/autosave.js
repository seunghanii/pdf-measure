// 측정값이 바뀌면 잠시 뒤 자동 저장 (로그인했으면 서버, 아니면 이 브라우저).
// 서버 저장은 한 번에 하나씩, 밀린 것은 가장 최근 상태만 보냄. 저장 상태('saved' | 'saving' | 'error')를 돌려줌.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// counters: 종류별 번호를 담은 ref
// revs: 개정판 정보 { rev, revisions } (lib/revision.js, 바꾼 적 없으면 비어 있음)
// controlRef: 개정판으로 바꿀 때 자동 저장을 멈추는 stop() 을 넣어 줌 (멈춘 뒤에는 보내던 저장이 끝나기를 기다림)
export function useAutosave({ store, docId, measurements, categories, calibration, unit, markupStyle, counters, pageNum, trash, revs, controlRef }) {
  const cloud = store.kind === 'cloud'
  const [syncStatus, setSyncStatus] = useState('saved')
  const queue = useRef({ busy: false, next: null })
  // 마지막으로 보낸 내용 (바뀐 게 없으면 다시 보내지 않음. 메모를 열고 닫기만 해도 항목이 새로 만들어지는 경우 등)
  const lastSent = useRef(null)
  const stopped = useRef(false)
  const persist = useCallback(
    (state) => {
      if (stopped.current) return
      const json = JSON.stringify(state)
      if (json === lastSent.current) return
      lastSent.current = json
      const q = queue.current
      q.next = state
      if (q.busy) return
      q.busy = true
      ;(async () => {
        while (q.next) {
          const st = q.next
          q.next = null
          setSyncStatus('saving')
          try {
            await store.saveState(docId, st)
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
    [docId, store],
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
    }
  })
  useEffect(() => {
    // 처음 열었을 때는 불러온 그대로라 저장할 필요 없음
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const state = { measurements, categories, calibration, unit, markupStyle, counters: counters.current, trash, ...revs }
    latest.current = state
    const t = setTimeout(() => {
      latest.current = null
      savedPage.current = pageRef.current
      persist({ ...state, pageNum: pageRef.current })
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
      const base = latest.current ?? stateRef.current
      savedPage.current = pageRef.current
      persist({ ...base, pageNum: pageRef.current })
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

  return syncStatus
}
