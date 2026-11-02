// 박스 연결의 반대 방향: "여기로 연결한 박스" (양방향 연결)
// 연결은 연결 박스가 있는 도면에만 저장하고(links 의 item), 반대 방향은 저장하지 않고 그때그때 찾음:
//  - 같은 도면 안: 지금 항목들에서 바로
//  - 다른 도면: 각 도면 요약(summary.boxLinks)에서. 저장할 때마다 요약이 새로 써지므로 연결을 빼면 반대쪽도 사라짐
import { itemLabel, itemRect } from './activity'
import { memoLinks } from './instrument'

const r1 = (n) => Math.round(n * 10) / 10

// 요약에 넣을 이 도면의 박스 연결들: [[가는 도면 id, 가는 항목 id, 연결 박스 id, 연결 박스 이름, 쪽, [x, y, w, h]]]
export function boxLinkRows(measurements) {
  const out = []
  for (const m of measurements ?? []) {
    if (m.type !== 'memo') continue
    for (const l of memoLinks(m)) {
      if (!l?.item || l.photo || !l.id) continue
      const r = itemRect(m)
      out.push([l.id, l.item, m.id, itemLabel(m), m.page ?? 1, r ? [r1(r.x), r1(r.y), r1(r.w), r1(r.h)] : null])
    }
  }
  return out
}

// 이 도면(docId) 항목별 "여기로 연결한 박스" Map(항목 id → [{ id, name, page, item, itemName, rect, here }])
// items: 이 도면 항목들, rows: 다른 도면들 [{ id, name, summary }] (휴지통 도면은 빼고 넘김)
export function backlinksFor(docId, docName, items, rows) {
  const map = new Map()
  const add = (to, link) => {
    const list = map.get(to)
    if (list) list.push(link)
    else map.set(to, [link])
  }
  for (const [to, toItem, from, label, page, rect] of boxLinkRows(items))
    if (to === docId) add(toItem, { id: docId, name: docName, item: from, itemName: label, page, rect: rect && { x: rect[0], y: rect[1], w: rect[2], h: rect[3] }, here: true })
  for (const row of rows ?? []) {
    if (row.id === docId) continue
    for (const [to, toItem, from, label, page, rect] of row.summary?.boxLinks ?? [])
      if (to === docId) add(toItem, { id: row.id, name: row.name, item: from, itemName: label, page, rect: rect && { x: rect[0], y: rect[1], w: rect[2], h: rect[3] } })
  }
  return map
}
