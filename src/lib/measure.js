import { angleDeg, distance, polygonArea, polygonPerimeter } from './geometry'
import { formatAngle, formatArea, formatLength } from './units'

export const TYPE_INFO = {
  length: { name: '길이', color: '#2563eb', need: 2 },
  area: { name: '면적', color: '#16a34a', need: null },
  angle: { name: '각도', color: '#9333ea', need: 3 },
  calibrate: { name: '기준 길이', color: '#ea580c', need: 2 },
}

// 측정 하나의 표시 문자열(주 값, 보조 값)
export function describe(m, mmPerPt, unit) {
  if (m.type === 'length') {
    return { main: formatLength(distance(m.points[0], m.points[1]), mmPerPt, unit) }
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
  return { main: '' }
}
