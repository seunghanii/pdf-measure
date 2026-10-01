import { angleDeg, polygonArea, polygonPerimeter, polylineLength } from './geometry'
import { formatAngle, formatArea, formatLength } from './units'

export const TYPE_INFO = {
  length: { name: '길이', color: '#2563eb', need: null }, // 여러 점을 이어서 총 길이
  area: { name: '면적', color: '#16a34a', need: null },
  angle: { name: '각도', color: '#9333ea', need: 3 },
  calibrate: { name: '기준 길이', color: '#ea580c', need: 2 },
  highlight: { name: '형광펜', color: '#facc15', need: null },
  text: { name: '텍스트', color: '#dc2626', need: 1 },
  pen: { name: '펜', color: '#dc2626', need: null },
  rect: { name: '사각형', color: '#dc2626', need: null },
  arrow: { name: '화살표', color: '#dc2626', need: null },
}

// 측정 하나의 표시 문자열(주 값, 보조 값)
export function describe(m, mmPerPt, unit) {
  if (m.type === 'length') {
    const segments = m.points.length - 1
    return {
      main: formatLength(polylineLength(m.points), mmPerPt, unit),
      sub: segments > 1 ? `${segments}구간 합계` : null,
    }
  }
  if (m.type === 'area') {
    return {
      main: formatArea(polygonArea(m.points), mmPerPt, unit),
      sub: mmPerPt ? `둘레 ${formatLength(polygonPerimeter(m.points), mmPerPt, unit)}` : null,
    }
  }
  if (m.type === 'angle') {
    if (m.points.length < 3) return { main: '' }
    return { main: formatAngle(angleDeg(m.points[0], m.points[1], m.points[2])) }
  }
  if (m.type === 'text') return { main: m.text }
  return { main: '' }
}
