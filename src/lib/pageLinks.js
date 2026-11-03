// 페이지를 넣고 지우고 옮겨도 "쪽 번호"로 걸어 둔 연결이 맞는 쪽을 가리키게.
//
// - 같은 도면 안: 페이지 편집 때 바로 고침 (fixLinksAfterPageEdit)
// - 다른 도면에서 이 도면 쪽으로 건 연결: 이 도면 state.pageLog 에 편집마다 "옛 쪽 → 새 쪽" 표를 남기고(요약 summary.pl 로도),
//   연결에는 걸 때의 편집 횟수(pv)를 적어 둠. 연결이 있는 도면을 열면 그 뒤 편집만큼 쪽 번호를 옮김 (lib/backlinks.js refreshLinks)
// - 링크 박스의 기본 이름 "도면 번호 (3 OF 10)" 도 박스의 쪽이 바뀌면 새 번호로
import { linkBoxName } from './drawingNo'
import { linksPatch, memoLinks } from './instrument'

const LOG_MAX = 10 // 기억하는 편집 수 (더 오래된 연결은 쪽을 옮기지 못하고 그대로)

// pageLog: { v: 지금까지 편집 수, start: maps[0] 의 편집 번호, maps: [옛 쪽 i+1 → 새 쪽 (0 = 지움)][] }
export const pageLogV = (log) => log?.v ?? 0

// order(lib/pageEdit.js 새 쪽 목록) → 옛 쪽 번호별 새 쪽 번호 표
export function orderToMap(order, oldNumPages) {
  const map = new Array(oldNumPages).fill(0)
  order.forEach((e, i) => {
    if (e.src && e.src <= oldNumPages) map[e.src - 1] = i + 1
  })
  return map
}

export function pushPageLog(log, map) {
  const v = pageLogV(log)
  const maps = [...(log?.maps ?? []), map]
  const drop = Math.max(0, maps.length - LOG_MAX)
  return { v: v + 1, start: (log?.start ?? 0) + drop, maps: maps.slice(drop) }
}

// 옛 쪽 → 새 쪽 하나. 지운 쪽이면 그 앞(없으면 뒤) 남은 가장 가까운 쪽
function step(map, page) {
  if (page > map.length) return page // 그때 PDF 에 없던 쪽 (그대로)
  if (map[page - 1]) return map[page - 1]
  for (let p = page - 1; p >= 1; p--) if (map[p - 1]) return map[p - 1]
  for (let p = page + 1; p <= map.length; p++) if (map[p - 1]) return map[p - 1]
  return 1
}

// 편집 fromV 번째 이후의 편집을 거친 쪽 번호. 너무 오래돼 표가 없으면 null
export function mapPage(log, page, fromV = 0) {
  const v = pageLogV(log)
  if (fromV >= v) return page
  if (fromV < (log.start ?? 0)) return null
  let p = page || 1
  for (let i = fromV - log.start; i < log.maps.length; i++) p = step(log.maps[i], p)
  return p
}

// 페이지 편집 뒤 이 도면 항목 고치기
// before: 편집 전 항목들 (옛 쪽 번호), items: 편집 뒤 항목들 (remapState 결과), map: 옛 쪽 → 새 쪽
export function fixLinksAfterPageEdit(items, before, { docId, fileName, map, oldNumPages, newNumPages }) {
  const oldPage = new Map(before.map((m) => [m.id, m.page ?? 1]))
  const newPage = new Map(items.map((m) => [m.id, m.page ?? 1]))
  return items.map((m) => {
    if (m.type !== 'memo') return m
    let out = m
    // 기본 이름 그대로인 링크 박스는 새 쪽 번호로
    const was = oldPage.get(m.id)
    if (was != null && m.name === linkBoxName(fileName, was, oldNumPages)) {
      const name = linkBoxName(fileName, m.page ?? 1, newNumPages)
      if (name !== m.name) out = { ...out, name }
    }
    // 같은 도면으로 건 연결: 박스 연결은 그 박스의 새 쪽, 쪽만 건 연결은 표로
    const links = memoLinks(m)
    let touched = false
    const next = links.map((l) => {
      if (l?.photo || l?.id !== docId) return l
      const page = l.item ? (newPage.get(l.item) ?? step(map, l.page ?? 1)) : step(map, l.page ?? 1)
      if (page === (l.page ?? 1)) return l
      touched = true
      return { ...l, page }
    })
    if (touched) out = { ...out, ...linksPatch(next) }
    return out
  })
}

// 박스를 다른 쪽으로 옮겼을 때 기본 이름 그대로인 링크 박스 이름
export function renameMovedLinkBox(m, page, fileName, numPages) {
  if (m.type !== 'memo' || (m.page ?? 1) === page) return m.name
  return m.name === linkBoxName(fileName, m.page ?? 1, numPages) ? linkBoxName(fileName, page, numPages) : m.name
}
