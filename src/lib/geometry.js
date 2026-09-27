// 모든 좌표는 PDF 페이지 좌표(배율 1 기준, 단위 pt = 1/72 inch)입니다.

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function polylineLength(points) {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += distance(points[i - 1], points[i])
  return sum
}

export function polygonPerimeter(points) {
  if (points.length < 2) return 0
  return polylineLength(points) + distance(points[points.length - 1], points[0])
}

// 신발끈 공식
export function polygonArea(points) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

export function polygonCentroid(points) {
  const area2 = points.reduce((acc, a, i) => {
    const b = points[(i + 1) % points.length]
    return acc + (a.x * b.y - b.x * a.y)
  }, 0)
  if (Math.abs(area2) < 1e-9) {
    const n = points.length || 1
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    }
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const f = a.x * b.y - b.x * a.y
    cx += (a.x + b.x) * f
    cy += (a.y + b.y) * f
  }
  return { x: cx / (3 * area2), y: cy / (3 * area2) }
}

// 꼭짓점(vertex)에서 a, b 방향 사이의 각도 (0~180도)
export function angleDeg(a, vertex, b) {
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y }
  const v2 = { x: b.x - vertex.x, y: b.y - vertex.y }
  const l1 = Math.hypot(v1.x, v1.y)
  const l2 = Math.hypot(v2.x, v2.y)
  if (l1 === 0 || l2 === 0) return 0
  const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}

// Shift 키: 직전 점 기준으로 45도 단위로 방향 고정
export function snapTo45(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len }
}

// SVG 호(arc) 경로: 각도 표시용
export function angleArcPath(a, vertex, b, radius) {
  const a1 = Math.atan2(a.y - vertex.y, a.x - vertex.x)
  const a2 = Math.atan2(b.y - vertex.y, b.x - vertex.x)
  let diff = a2 - a1
  while (diff <= -Math.PI) diff += 2 * Math.PI
  while (diff > Math.PI) diff -= 2 * Math.PI
  const start = { x: vertex.x + Math.cos(a1) * radius, y: vertex.y + Math.sin(a1) * radius }
  const end = { x: vertex.x + Math.cos(a1 + diff) * radius, y: vertex.y + Math.sin(a1 + diff) * radius }
  const sweep = diff > 0 ? 1 : 0
  return {
    d: `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep} ${end.x} ${end.y}`,
    mid: {
      x: vertex.x + Math.cos(a1 + diff / 2) * radius,
      y: vertex.y + Math.sin(a1 + diff / 2) * radius,
    },
    midAngle: a1 + diff / 2,
  }
}
