// 마크업(형광펜, 텍스트, 펜, 사각형, 화살표, 사진, 메모 범위) 공통 정의
// 마크업은 측정과 같은 목록(measurements)에 저장되고, 좌표는 PDF 페이지 좌표(pt)입니다.

export const MARKUP_TYPES = ['highlight', 'text', 'pen', 'rect', 'arrow', 'image', 'memo']

export const isMarkup = (type) => MARKUP_TYPES.includes(type)

// 드래그로 그리는 도구 (누른 채 끌었다 놓기)
export const DRAG_TOOLS = ['highlight', 'pen', 'rect', 'arrow', 'memo']

export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#f472b6', '#60a5fa']
export const MARKUP_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#111827', '#ea580c']

// 텍스트 글자 크기 (pt)
export const TEXT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64]

export const DEFAULT_BOX_OPACITY = 0.9

export const FONT_FAMILY = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif'

// 마크업 선 굵기 (pt). 도면과 함께 확대/축소됩니다.
export const MARKUP_STROKE = 1.6

// 굵기를 고를 수 있는 마크업 (화살촉 크기는 굵기에 비례)
export const STROKE_TYPES = ['rect', 'arrow', 'pen']
export const STROKE_WIDTHS = [0.5, 1, 1.6, 2, 3, 4, 6, 8, 12]

// 항목의 선 굵기 (pt). 굵기 기능 전에 저장된 항목은 예전 굵기 그대로
export const strokeOf = (m) => m.strokeWidth ?? (m.type === 'pen' ? MARKUP_STROKE * 1.2 : MARKUP_STROKE)

// 도형 도구의 모양. 'rect' 항목에 shape 가 없으면 사각형 (예전 데이터 그대로)
export const SHAPES = [
  ['rect', '사각형', 'M4 6h16v12H4z'],
  ['ellipse', '원', 'M12 19c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7z'],
]
export const shapeOf = (m) => (m.type === 'rect' && m.shape === 'ellipse' ? 'ellipse' : 'rect')
// 목록·엑셀에 보이는 종류 이름 (원은 '원', 나머지는 TYPE_INFO 이름)
export const kindName = (m, typeInfo) => (m.type === 'rect' && m.shape === 'ellipse' ? '원' : typeInfo[m.type].name)

// 사각형·형광펜 크기 조절 손잡이 (모서리 4개 + 변 가운데 4개)
export const RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// 손잡이 위치 (r: rectOf 결과)
export function resizeHandlePos(r, dir) {
  const x = dir.includes('w') ? r.x : dir.includes('e') ? r.x + r.w : r.x + r.w / 2
  const y = dir.includes('n') ? r.y : dir.includes('s') ? r.y + r.h : r.y + r.h / 2
  return { x, y }
}

// 사진: 테두리 색과 굵기 (pt)
export const IMAGE_BORDER_COLORS = ['#111827', '#ffffff', '#dc2626', '#2563eb', '#16a34a', '#ea580c']
export const IMAGE_BORDER_WIDTHS = [0.5, 1, 2, 3, 4, 6, 8]

export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 }
export const cropOf = (m) => m.crop ?? FULL_CROP
export const isCropped = (m) => {
  const c = cropOf(m)
  return c.x > 1e-4 || c.y > 1e-4 || c.w < 1 - 1e-4 || c.h < 1 - 1e-4
}

// 잘라 낸 사진의 원본 전체가 놓일 자리 (r: 보이는 부분 사각형, c: 자르기 영역 0~1)
export function fullImageRect(r, c) {
  const w = r.w / c.w
  const h = r.h / c.h
  return { x: r.x - c.x * w, y: r.y - c.y * h, w, h }
}

// 모서리 손잡이: 가로세로 비율을 유지하며 크기 조절 (반대쪽 모서리는 그대로)
export function resizeKeepAspect(r, dir, p) {
  if (dir.length !== 2) return resizeRect(r, dir, p)
  const ax = dir.includes('w') ? r.x + r.w : r.x
  const ay = dir.includes('n') ? r.y + r.h : r.y
  const k = Math.max(Math.abs(p.x - ax) / (r.w || 1), Math.abs(p.y - ay) / (r.h || 1), 0.02)
  const w = r.w * k
  const h = r.h * k
  const x = dir.includes('w') ? ax - w : ax
  const y = dir.includes('n') ? ay - h : ay
  return [
    { x, y },
    { x: x + w, y: y + h },
  ]
}

// 자르기 손잡이를 p 로 끌었을 때 새 보이는 영역과 자르기 값. 원본 사진 밖으로는 못 나감
export function cropResize(r, full, dir, p) {
  const min = Math.min(4, full.w, full.h)
  const q = { x: Math.min(full.x + full.w, Math.max(full.x, p.x)), y: Math.min(full.y + full.h, Math.max(full.y, p.y)) }
  let left = r.x
  let top = r.y
  let right = r.x + r.w
  let bottom = r.y + r.h
  if (dir.includes('w')) left = Math.min(q.x, right - min)
  if (dir.includes('e')) right = Math.max(q.x, left + min)
  if (dir.includes('n')) top = Math.min(q.y, bottom - min)
  if (dir.includes('s')) bottom = Math.max(q.y, top + min)
  return {
    points: [
      { x: left, y: top },
      { x: right, y: bottom },
    ],
    crop: { x: (left - full.x) / full.w, y: (top - full.y) / full.h, w: (right - left) / full.w, h: (bottom - top) / full.h },
  }
}

// 손잡이를 p 로 끌었을 때 새 두 점 (반대쪽 변은 그대로, 넘어가면 뒤집힘)
export function resizeRect(r, dir, p) {
  let left = r.x
  let top = r.y
  let right = r.x + r.w
  let bottom = r.y + r.h
  if (dir.includes('w')) left = p.x
  if (dir.includes('e')) right = p.x
  if (dir.includes('n')) top = p.y
  if (dir.includes('s')) bottom = p.y
  return [
    { x: left, y: top },
    { x: right, y: bottom },
  ]
}

let measureCtx = null

export const TEXT_ALIGNS = ['left', 'center', 'right']

// 너비를 줄인 텍스트 상자의 최소 너비 (pt)
export const minTextBoxWidth = (fontSize) => fontSize * 2.3

// 한 줄을 maxWidth 안에 들어가게 나눔. 띄어쓰기에서 먼저 끊고, 긴 낱말은 글자 단위로 끊음
function wrapLine(line, maxWidth) {
  const out = []
  let cur = ''
  for (const ch of line) {
    if (!cur || measureCtx.measureText(cur + ch).width <= maxWidth) {
      cur += ch
      continue
    }
    const sp = cur.lastIndexOf(' ')
    if (ch === ' ') {
      out.push(cur)
      cur = ''
    } else if (sp > 0) {
      out.push(cur.slice(0, sp))
      cur = cur.slice(sp + 1) + ch
    } else {
      out.push(cur)
      cur = ch
    }
  }
  out.push(cur)
  return out
}

// 텍스트 상자 크기 (pt 단위, fontSize 기준).
// boxWidth(상자 너비 pt)가 있으면 그 안에서 자동 줄바꿈, 없으면 가장 긴 줄에 맞춤 (예전 텍스트)
export function textBoxMetrics(text, fontSize, boxWidth) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  measureCtx.font = `${fontSize}px ${FONT_FAMILY}`
  const lineHeight = fontSize * 1.3
  const pad = fontSize * 0.4
  let lines = String(text || ' ').split('\n')
  let width
  if (boxWidth) {
    width = Math.max(boxWidth, minTextBoxWidth(fontSize))
    lines = lines.flatMap((l) => wrapLine(l, width - pad * 2))
  } else {
    width = Math.max(...lines.map((l) => measureCtx.measureText(l || ' ').width)) + pad * 2
  }
  return { lines, lineHeight, pad, width, height: lines.length * lineHeight + pad * 2 }
}

export const textMetricsOf = (m) => textBoxMetrics(m.text, m.fontSize ?? 13, m.boxWidth)

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
  const box = textMetricsOf(m)
  return [p, { x: p.x + box.width, y: p.y }, { x: p.x, y: p.y + box.height }, { x: p.x + box.width, y: p.y + box.height }]
}
