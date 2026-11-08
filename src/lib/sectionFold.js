// 오른쪽 목록 칸(측정 목록·마크업·Equipment) 접힘 상태 (모든 도면 공통, 이 브라우저에 기억)
const KEY = 'pdf-measure:sidebar-folded'

export function loadFolded() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function saveFolded(list) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    // 저장 못 해도 이번엔 접힘
  }
}
