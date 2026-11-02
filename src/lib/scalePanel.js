// 오른쪽 목록 축척 칸: 기준 길이가 없을 때 접어 둔 상태 (이 브라우저에 기억)
const KEY = 'pdf-measure:scale-uncal-hidden'

export function loadUncalHidden() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function saveUncalHidden(v) {
  try {
    if (v) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // 저장 못 해도 이번엔 접힘
  }
}
