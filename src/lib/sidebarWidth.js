import { useSyncExternalStore } from 'react'

// 오른쪽 목록 넓이(px). 모든 도면이 같은 넓이를 쓰고, 이 브라우저에 기억해 둡니다.
const KEY = 'pdf-measure:sidebar-w'
export const SIDEBAR_DEFAULT_W = 320 // 예전 w-80
export const SIDEBAR_MIN_W = 240
const SIDEBAR_MAX_W = 900
const listeners = new Set()

// 화면이 좁을 때는 도면 칸이 너무 좁아지지 않게 화면의 60% 까지만
export function clampSidebarWidth(w) {
  const max = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, Math.round((window.innerWidth || 1600) * 0.6)))
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_W, Number(w) || SIDEBAR_DEFAULT_W)))
}

let width = (() => {
  try {
    const v = Number(localStorage.getItem(KEY))
    return v > 0 ? v : SIDEBAR_DEFAULT_W
  } catch {
    return SIDEBAR_DEFAULT_W
  }
})()

// save=false: 끄는 동안 화면만 바꿈 (손을 뗄 때 한 번 저장)
export function setSidebarWidth(w, save = true) {
  width = Math.round(Number(w) || SIDEBAR_DEFAULT_W)
  if (save) {
    try {
      if (width === SIDEBAR_DEFAULT_W) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, String(width))
    } catch {
      // 저장 못 해도 이번 창에서는 동작
    }
  }
  listeners.forEach((fn) => fn())
}

export function useSidebarWidth() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => width,
  )
}
