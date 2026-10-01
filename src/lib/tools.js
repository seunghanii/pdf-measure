// 도구 목록. 숫자 키(1~9, 0)와 글자 키로 바꿀 수 있습니다.
// Ctrl+숫자는 크롬·엣지가 브라우저 탭 전환에 먼저 쓰기 때문에 숫자 키만 눌러도 되게 했습니다.
export const TOOLS = [
  { id: 'select', label: '선택', key: 'V', group: 'basic', icon: 'M5 3l14 8-6 2-3 6z' },
  {
    id: 'pan',
    label: '이동',
    key: 'H',
    group: 'basic',
    icon: 'M8 13V5a1.5 1.5 0 013 0v6m0-1V4a1.5 1.5 0 013 0v6m0-1V5.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L4 13.5a1.5 1.5 0 012.5-1.6L8 14',
  },
  { id: 'calibrate', label: '기준 길이', key: 'C', group: 'measure', icon: 'M3 17L17 3M3 17l3 0M3 17l0-3M17 3l-3 0M17 3l0 3', accent: 'orange' },
  { id: 'length', label: '길이', key: 'L', group: 'measure', icon: 'M3 12h18M3 8v8M21 8v8' },
  { id: 'area', label: '면적', key: 'A', group: 'measure', icon: 'M4 6l8-3 8 5-2 11H6z' },
  { id: 'angle', label: '각도', key: 'G', group: 'measure', icon: 'M4 20h16M4 20L16 5M10 20a6 6 0 00-2-4.5' },
  { id: 'highlight', label: '형광펜', key: 'M', group: 'markup', icon: 'M9 11l-5 5v4h4l5-5M9 11l6-6 4 4-6 6M9 11l4 4M3 21h8' },
  { id: 'text', label: '텍스트', key: 'T', group: 'markup', icon: 'M4 6V4h16v2M12 4v16M9 20h6' },
  { id: 'pen', label: '펜', key: 'P', group: 'markup', icon: 'M3 17c3-1 4-6 7-6s2 6 5 6 4-4 6-5' },
  { id: 'rect', label: '사각형', key: 'R', group: 'markup', icon: 'M4 6h16v12H4z' },
  { id: 'arrow', label: '화살표', key: 'W', group: 'markup', icon: 'M5 19L19 5M19 5h-8M19 5v8' },
]

export const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

// 숫자 → 도구 (1=선택 … 9=펜, 0=사각형). 화살표는 W.
export function toolForDigit(d) {
  const i = DIGIT_KEYS.indexOf(d)
  return i >= 0 ? TOOLS[i]?.id : undefined
}

export function digitForTool(id) {
  const i = TOOLS.findIndex((t) => t.id === id)
  return i >= 0 && i < DIGIT_KEYS.length ? DIGIT_KEYS[i] : null
}
