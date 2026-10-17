import { useSyncExternalStore } from 'react'

// 자석 켜짐/꺼짐. 모든 탭이 같은 설정을 쓰고, 이 브라우저에 기억해 둡니다 (기본: 켜짐).
const KEY = 'pdf-measure:snap'
const listeners = new Set()

let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
})()

export function setSnapEnabled(on) {
  enabled = on
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // 저장 못 해도 이번 창에서는 동작
  }
  listeners.forEach((fn) => fn())
}

export function toggleSnap() {
  setSnapEnabled(!enabled)
}

export function useSnapEnabled() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => enabled,
  )
}
