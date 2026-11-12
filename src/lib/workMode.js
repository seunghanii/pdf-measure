// 도면 화면 작업 모드: 보기 · Equipment · 측정 · 마크업
// 모드를 고르면 왼쪽 도구 줄과 오른쪽 목록이 그 일에 맞게 바뀜. 단축키로 도구를 고르면 모드도 따라감.
// 마지막 모드는 이 브라우저에 기억 (pdf-measure:work-mode)

export const MODES = [
  { id: 'view', label: '보기', hint: '선택·이동·글자 복사' },
  { id: 'equip', label: 'Equipment', hint: 'Equipment·링크·메모 박스' },
  { id: 'measure', label: '측정', hint: '기준 길이·길이·면적·각도' },
  { id: 'markup', label: '마크업', hint: '형광펜·텍스트·펜·도형·화살표·사진' },
]

const MODE_IDS = MODES.map((m) => m.id)

// 어느 모드에서나 쓰는 도구
export const BASIC_TOOL_IDS = ['select', 'pan', 'textcopy']

const TOOL_MODE = {
  calibrate: 'measure',
  length: 'measure',
  area: 'measure',
  angle: 'measure',
  highlight: 'markup',
  text: 'markup',
  pen: 'markup',
  rect: 'markup',
  arrow: 'markup',
  memo: 'equip',
}

// 도구가 속한 모드 (기본 도구는 null: 지금 모드 그대로)
export function modeForTool(tool) {
  return TOOL_MODE[tool] ?? null
}

// 오른쪽 목록 탭 (보기 모드는 마지막에 본 탭 그대로)
export const PANELS = [
  { id: 'equip', label: 'Equipment' },
  { id: 'measure', label: '측정' },
  { id: 'markup', label: '마크업' },
]

const KEY = 'pdf-measure:work-mode'

export function loadMode() {
  try {
    const v = localStorage.getItem(KEY)
    return MODE_IDS.includes(v) ? v : 'view'
  } catch {
    return 'view'
  }
}

export function saveMode(mode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // 저장 못 해도 동작에는 문제 없음
  }
}
