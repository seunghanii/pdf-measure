// 도면별 수정 기록: 계기 카드·메모·마크업·측정을 넣고 고치고 지운 일을 도면 state.activity 에 남깁니다.
// 홈 화면 '최근 수정' 은 도면 요약(summary.activity)을 모아 시간 순으로 보여 주고, 누르면 그 자리로 이동합니다.
// 서버 저장이면 요약도 서버에 있어 다른 기기에서 고친 것도 함께 보임 (DB 모양은 그대로, state 안 JSON 만 늘어남).
//
// 기록 하나: { t: 시각(ms), a: 'add'|'edit'|'del', id: 항목 id(여러 개를 한 번에 바꾼 묶음은 null),
//            w: 종류 이름('계기 카드', '메모', '텍스트' …), n: 항목 이름, p: 쪽, r: [x, y, w, h](배율 1 페이지 좌표), c: 색, cnt: 묶음 개수 }
import { isMarkup, kindName, textMetricsOf } from './markup'
import { TYPE_INFO } from './measure'
import { isInst } from './instrument'
import { isLinkOnly } from './memo'

export const ACTIVITY_MAX = 40 // 도면 하나에 남기는 기록 수
export const SUMMARY_ACTIVITY = 15 // 홈 요약에 넣는 기록 수
const MERGE_MS = 30 * 60 * 1000 // 같은 항목을 30분 안에 또 고치면 기록 하나로 합침
const BULK = 6 // 한 번에 이만큼 넘게 바뀌면 "항목 N개" 한 줄로

const r1 = (v) => Math.round(v * 10) / 10

export function normalizeActivity(list) {
  return Array.isArray(list) ? list.filter((e) => e && typeof e.t === 'number' && e.a).slice(0, ACTIVITY_MAX) : []
}

// 종류 이름: 계기 카드 / 메모 / 도면 연결 / 텍스트 / 원 / 길이 …
function whatOf(m) {
  if (isInst(m)) return 'Equipment'
  if (m.type === 'memo') return isLinkOnly(m) ? '도면 연결' : '메모'
  return TYPE_INFO[m.type] ? kindName(m, TYPE_INFO) : '항목'
}

function nameOf(m) {
  if (isInst(m)) {
    const tag = String(m.inst.tag ?? '').trim()
    const desc = String(m.inst.desc ?? '').trim()
    return [tag, desc].filter(Boolean).join(' · ') || m.name || ''
  }
  if (m.type === 'text') return String(m.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || m.name || ''
  return String(m.name ?? '').trim()
}

function rectOfItem(m) {
  const pts = m.points ?? []
  if (!pts.length) return null
  if (m.type === 'text') {
    const box = textMetricsOf(m)
    return [r1(pts[0].x), r1(pts[0].y), r1(box.width), r1(box.height)]
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return [r1(x0), r1(y0), r1(x1 - x0), r1(y1 - y0)]
}

function eventOf(a, m, t) {
  const e = { t, a, id: m.id, w: whatOf(m), n: nameOf(m), p: m.page ?? 1, r: rectOfItem(m) }
  const c = m.color ?? (isMarkup(m.type) ? null : TYPE_INFO[m.type]?.color)
  if (c) e.c = c
  return e
}

// 숨기기·보이기만 바꾼 것은 기록하지 않음 (화면에서 가린 것뿐)
function sameIgnoringHidden(a, b) {
  if (a.hidden === b.hidden) return JSON.stringify(a) === JSON.stringify(b)
  return JSON.stringify({ ...a, hidden: 0 }) === JSON.stringify({ ...b, hidden: 0 })
}

// 지난번 항목들(prev)과 지금 항목들(next)을 비교해 기록을 더한 새 목록. 바뀐 게 없으면 activity 그대로 돌려줌
export function trackActivity(prev, next, activity, now = Date.now()) {
  if (prev === next) return activity
  const before = new Map((prev ?? []).map((m) => [m.id, m]))
  const changes = []
  const seen = new Set()
  for (const m of next ?? []) {
    seen.add(m.id)
    const old = before.get(m.id)
    if (!old) changes.push(['add', m])
    else if (old !== m && !sameIgnoringHidden(old, m)) changes.push(['edit', m])
  }
  for (const [id, m] of before) if (!seen.has(id)) changes.push(['del', m])
  if (!changes.length) return activity

  let list = [...activity]
  const byAction = { add: [], edit: [], del: [] }
  for (const [a, m] of changes) byAction[a].push(m)
  for (const a of ['del', 'edit', 'add']) {
    const items = byAction[a]
    if (!items.length) continue
    if (items.length > BULK) {
      // 한꺼번에 바꾼 것(전체 삭제, 개정판 맞춤 등)은 한 줄로. 종류가 모두 같으면 그 이름, 아니면 '항목'
      const kinds = new Set(items.map(whatOf))
      const pages = new Set(items.map((m) => m.page ?? 1))
      const first = items[0]
      list.unshift({
        t: now,
        a,
        id: null,
        w: kinds.size === 1 ? whatOf(first) : '항목',
        n: '',
        cnt: items.length,
        p: pages.size === 1 ? (first.page ?? 1) : Math.min(...pages),
        r: null,
      })
      continue
    }
    for (const m of items) {
      const i = list.findIndex((e) => e.id === m.id)
      const recent = i >= 0 && now - list[i].t < MERGE_MS ? list[i] : null
      if (recent) list.splice(i, 1)
      if (a === 'del' && recent?.a === 'add') continue // 넣자마자 지운 것(되돌리기 등)은 기록에서 뺌
      // 방금 넣은 것을 고친 것은 '추가' 그대로 (이름·자리만 새로)
      list.unshift(eventOf(recent?.a === 'add' && a === 'edit' ? 'add' : a, m, now))
    }
  }
  return list.slice(0, ACTIVITY_MAX)
}

export const ACTION_LABEL = { add: '추가', edit: '수정', del: '삭제' }

// 도면 연결 박스가 가리키는 항목: 자리 { x, y, w, h } 와 한 줄 이름 ("Equipment · FT-1001")
export function itemRect(m) {
  const r = rectOfItem(m)
  return r ? { x: r[0], y: r[1], w: Math.max(r[2], 1), h: Math.max(r[3], 1) } : null
}
export function itemLabel(m) {
  const what = whatOf(m)
  const name = nameOf(m)
  // "사각형 · 사각형 1" 처럼 겹치면 이름만
  if (!name || name === what) return what
  return name.startsWith(what) ? name : `${what} · ${name}`
}
