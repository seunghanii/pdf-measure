// 도면 위 계기 박스 이름표를 한꺼번에 숨기기 (이 브라우저에 기억, 모든 도면 공통)
// html 에 inst-labels-off 클래스를 달아 CSS 로 숨김 → 그리기 코드가 다시 그려지지 않아도 됨
import { useEffect, useState } from 'react'

const KEY = 'pdf-measure:inst-labels-off'
const CLASS = 'inst-labels-off'

function load() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function apply(off) {
  document.documentElement.classList.toggle(CLASS, off)
}

export function useInstLabelsOff() {
  const [off, setOff] = useState(load)
  useEffect(() => {
    apply(off)
    try {
      if (off) localStorage.setItem(KEY, '1')
      else localStorage.removeItem(KEY)
    } catch {
      // 저장 못 해도 이번엔 적용
    }
  }, [off])
  return [off, setOff]
}

// 처음 불러올 때 바로 적용 (오른쪽 목록이 그려지기 전에도 맞게)
if (typeof document !== 'undefined') apply(load())
