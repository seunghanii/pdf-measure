// 여러 기기(또는 여러 창)에서 같은 도면을 고쳤을 때 합치기.
// base: 이 창이 마지막으로 서버와 맞췄던 상태, mine: 이 창의 지금 상태, theirs: 서버에 있는 (다른 기기가 저장한) 상태
// 항목(측정·마크업·박스·Equipment)은 id 별로: 한쪽만 고쳤으면 고친 쪽, 둘 다 고쳤으면 이 창 것.
// 한쪽이 지우고 다른 쪽이 고쳤으면 고친 것을 남김 (지운 일보다 고친 일을 잃지 않게)
import { ACTIVITY_MAX } from './activity'

const same = (a, b) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// id 로 구분되는 목록 합치기. 순서는 이 창 순서 + 다른 쪽에만 새로 생긴 것 뒤에
function mergeList(base = [], mine = [], theirs = [], keyOf) {
  const B = new Map(base.map((x) => [keyOf(x), x]))
  const M = new Map(mine.map((x) => [keyOf(x), x]))
  const T = new Map(theirs.map((x) => [keyOf(x), x]))
  const pick = (id) => {
    const b = B.get(id)
    const m = M.get(id)
    const t = T.get(id)
    const mineChanged = !same(b, m)
    const theirsChanged = !same(b, t)
    if (mineChanged && theirsChanged) return m ?? t // 둘 다 바꿈: 이 창 것 (이 창이 지웠으면 다른 쪽 고친 것)
    if (mineChanged) return m
    return t
  }
  const out = []
  const seen = new Set()
  for (const x of mine) {
    const id = keyOf(x)
    seen.add(id)
    const v = pick(id)
    if (v) out.push(v)
  }
  for (const x of theirs) {
    const id = keyOf(x)
    if (seen.has(id)) continue
    seen.add(id)
    const v = pick(id)
    if (v) out.push(v)
  }
  return out
}

const pickValue = (base, mine, theirs) => (same(base, mine) ? theirs : mine)

function mergeCounters(a = {}, b = {}) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b ?? {})) if (typeof v === 'number') out[k] = Math.max(out[k] ?? 0, v)
  return out
}

// 수정 기록: 둘을 합쳐 시각 순으로 (같은 기록은 하나만)
function mergeActivity(a = [], b = []) {
  const seen = new Set()
  const out = []
  for (const e of [...(a ?? []), ...(b ?? [])]) {
    if (!e) continue
    const k = `${e.t}|${e.a}|${e.id}|${e.n}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out.sort((x, y) => y.t - x.t).slice(0, ACTIVITY_MAX)
}

export function mergeState(base, mine, theirs) {
  if (!theirs) return mine
  if (!mine) return theirs
  base = base ?? {}
  const measurements = mergeList(base.measurements, mine.measurements, theirs.measurements, (m) => m.id)
  const live = new Set(measurements.map((m) => m.id))
  // 휴지통: 도면에 살아 있는 항목은 빼고
  const trash = mergeList(base.trash, mine.trash, theirs.trash, (t) => t.item?.id).filter((t) => !live.has(t.item?.id))
  return {
    ...theirs,
    ...mine,
    measurements,
    trash,
    categories: mergeList(base.categories, mine.categories, theirs.categories, (c) => c.id),
    calibration: pickValue(base.calibration, mine.calibration, theirs.calibration) ?? null,
    unit: pickValue(base.unit, mine.unit, theirs.unit),
    markupStyle: pickValue(base.markupStyle, mine.markupStyle, theirs.markupStyle),
    counters: mergeCounters(mine.counters, theirs.counters),
    rev: pickValue(base.rev, mine.rev, theirs.rev) ?? null,
    revisions: mergeList(base.revisions, mine.revisions, theirs.revisions, (r) => r.key),
    activity: mergeActivity(mine.activity, theirs.activity),
    pageNum: mine.pageNum ?? theirs.pageNum,
  }
}
