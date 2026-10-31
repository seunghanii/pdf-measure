import { useSyncExternalStore } from 'react'

// 메모장 자리: 'right'(오른쪽 위, 기본) 또는 'bottom'(아래에 길게).
// 모든 메모·모든 탭이 같은 설정을 쓰고, 이 브라우저에 기억해 둡니다.
const KEY = 'pdf-measure:memo-dock'
const listeners = new Set()

let dock = (() => {
  try {
    return localStorage.getItem(KEY) === 'bottom' ? 'bottom' : 'right'
  } catch {
    return 'right'
  }
})()

export function setMemoDock(next) {
  dock = next === 'bottom' ? 'bottom' : 'right'
  try {
    localStorage.setItem(KEY, dock)
  } catch {
    // 저장 못 해도 이번 창에서는 동작
  }
  listeners.forEach((fn) => fn())
}

export function useMemoDock() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => dock,
  )
}
