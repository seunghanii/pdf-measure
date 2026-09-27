// 축척은 "PDF 1pt 가 실제 몇 mm 인지"(mmPerPt) 하나로 저장합니다.
export const UNITS = {
  mm: { label: 'mm', toMm: 1, digits: 1, areaDigits: 0 },
  cm: { label: 'cm', toMm: 10, digits: 2, areaDigits: 1 },
  m: { label: 'm', toMm: 1000, digits: 3, areaDigits: 2 },
}

export const PT_TO_PAPER_MM = 25.4 / 72

function fmt(value, digits) {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatLength(pt, mmPerPt, unit) {
  if (!mmPerPt) return '기준 길이 필요'
  const u = UNITS[unit]
  return `${fmt((pt * mmPerPt) / u.toMm, u.digits)} ${u.label}`
}

// 길이를 mm 로 볼 때도 면적은 m² 가 읽기 쉬워서 m² 로 표시
const AREA_UNIT = { mm: 'm', cm: 'cm', m: 'm' }

export function formatArea(pt2, mmPerPt, unit) {
  if (!mmPerPt) return '기준 길이 필요'
  const u = UNITS[AREA_UNIT[unit]]
  return `${fmt((pt2 * mmPerPt * mmPerPt) / (u.toMm * u.toMm), u.areaDigits)} ${u.label}²`
}

export function formatAngle(deg) {
  return `${fmt(deg, 1)}°`
}

// 숫자 입력 문자열 파싱 ("5,000" 같은 콤마 허용)
export function parseNumber(text) {
  const n = Number(String(text).replace(/,/g, '').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}
