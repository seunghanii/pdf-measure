// 마크업(형광펜, 텍스트, 펜, 사각형, 화살표) 공통 정의
// 마크업은 측정과 같은 목록(measurements)에 저장되고, 좌표는 PDF 페이지 좌표(pt)입니다.

export const MARKUP_TYPES = ['highlight', 'text', 'pen', 'rect', 'arrow']

export const isMarkup = (type) => MARKUP_TYPES.includes(type)

// 드래그로 그리는 도구 (누른 채 끌었다 놓기)
export const DRAG_TOOLS = ['highlight', 'pen', 'rect', 'arrow']

export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#f472b6', '#60a5fa']
export const MARKUP_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#111827', '#ea580c']

// 텍스트 글자 크기 (pt)
export const TEXT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64]

export const DEFAULT_BOX_OPACITY = 0.9

export const FONT_FAMILY = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif'

// 마크업 선 굵기 (pt). 도면과 함께 확대/축소됩니다.
export const MARKUP_STROKE = 1.6

let measureCtx = null

// 텍스트 상자 크기 (pt 단위, fontSize 기준)
export function textBoxMetrics(text, fontSize) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  measureCtx.font = `${fontSize}px ${FONT_FAMILY}`
  const lines = String(text || ' ').split('\n')
  const width = Math.max(...lines.map((l) => measureCtx.measureText(l || ' ').width))
  const lineHeight = fontSize * 1.3
  const pad = fontSize * 0.4
  return { lines, lineHeight, pad, width: width + pad * 2, height: lines.length * lineHeight + pad * 2 }
}

// 두 점으로 만든 사각형 (x, y, w, h)
export function rectOf(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

// 드래그 선택 판정에 쓰는 점들 (텍스트는 상자 네 모서리)
export function itemCorners(m) {
  if (m.type !== 'text') return m.points
  const p = m.points[0]
  const box = textBoxMetrics(m.text, m.fontSize ?? 13)
  return [p, { x: p.x + box.width, y: p.y }, { x: p.x, y: p.y + box.height }, { x: p.x + box.width, y: p.y + box.height }]
}
