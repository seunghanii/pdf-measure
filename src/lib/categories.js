// 측정 항목 분류 (벽, 창호 같은 물량 묶음). 도면 상태(state.categories)에 [{ id, name, color }] 로 저장하고,
// 측정 항목에는 분류 id(cat)와 그 분류 색(color)을 함께 둡니다. 색을 항목에도 넣어 두면 그리기·PDF 저장이
// 분류 목록을 몰라도 되고(끌기·확대 때 다시 그리는 범위가 그대로), 분류가 없는 항목은 예전처럼 종류 색으로 그려집니다.
import { polygonArea, polygonPerimeter, polylineLength } from './geometry'
import { isMarkup } from './markup'

// 파랑(선택)·주황(기준 길이)·분홍(자석)과 겹치지 않는 색
export const CATEGORY_COLORS = ['#0d9488', '#7c3aed', '#b45309', '#dc2626', '#0891b2', '#4d7c0f', '#475569', '#9d174d']

export const CATEGORY_PRESETS = ['벽', '창호', '문', '바닥', '천장', '기둥', '배관']

export const newCategoryId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

// 아직 안 쓴 색부터
export function nextCategoryColor(categories) {
  const used = new Set(categories.map((c) => c.color))
  return CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]
}

// 분류를 붙일 수 있는 항목: 길이·면적·각도
export const canCategorize = (m) => !isMarkup(m.type)

// 항목에 분류 붙이기/떼기 (cat 이 null 이면 떼고 종류 색으로 돌아감)
export function withCategory(m, cat) {
  const { cat: _c, color: _k, ...rest } = m
  return cat ? { ...rest, cat: cat.id, color: cat.color } : rest
}

// 분류별 합계 → Map(분류 id 또는 '' → { count, length, area, perimeter })  값은 페이지 좌표(pt) 단위
export function categoryTotals(measures, categories) {
  const known = new Set(categories.map((c) => c.id))
  const out = new Map()
  for (const m of measures) {
    const key = m.cat && known.has(m.cat) ? m.cat : ''
    let t = out.get(key)
    if (!t) out.set(key, (t = { count: 0, length: 0, area: 0, perimeter: 0, lengthCount: 0, areaCount: 0 }))
    t.count++
    if (m.type === 'length') {
      t.length += polylineLength(m.points)
      t.lengthCount++
    } else if (m.type === 'area') {
      t.area += polygonArea(m.points)
      t.perimeter += polygonPerimeter(m.points)
      t.areaCount++
    }
  }
  return out
}

// 기본 이름("길이 3")인지: 기본 이름 항목은 분류가 없으면 검색에 넣지 않음 (검색 결과가 넘치지 않게)
export const isDefaultName = (name) => /^(길이|면적|각도) \d+$/.test(name ?? '')
