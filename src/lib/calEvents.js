// 달력 일정 (등록·수정·삭제) 과 Equipment 작업 완료 날짜 모으기.
// 저장 모양: { events: [{ id, date 'YYYY-MM-DD', end?, time?, title, memo?, color }], holidays: ['YYYY-MM-DD'], at: 마지막으로 고친 시각(ms) }
// holidays: 주말 요일 말고 따로 지정한 휴무일 (빨간 숫자)
// 로그인했으면 documents 특별한 줄 __calendar__ (스키마 변경 없음), 아니면 이 브라우저.
// 이 브라우저에도 늘 사본을 둠 (서버에 못 올린 일정을 지키고 다음에 다시 올림) — 홈 메모장(lib/homeNote.js)과 같은 방식.
import { dayKey } from './calendar'
import { INST_STATUSES, statusOf } from './instrument'

const KEY = 'pdf-measure:cal-events'

export const EVENT_COLORS = ['#2a4fe0', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#64748b']
export const EMPTY_CAL = { events: [], holidays: [], at: 0 }

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

function cleanEvent(e) {
  if (!e || typeof e.id !== 'string' || !isDay(e.date)) return null
  const out = { id: e.id, date: e.date, title: String(e.title ?? '').slice(0, 200), color: EVENT_COLORS.includes(e.color) ? e.color : EVENT_COLORS[0] }
  if (isDay(e.end) && e.end > e.date) out.end = e.end
  if (typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time)) out.time = e.time
  if (typeof e.memo === 'string' && e.memo.trim()) out.memo = e.memo.slice(0, 4000)
  return out
}

export function normalizeCal(c) {
  if (!c || !Array.isArray(c.events)) return EMPTY_CAL
  const holidays = Array.isArray(c.holidays) ? [...new Set(c.holidays.filter(isDay))].sort() : []
  return { events: c.events.map(cleanEvent).filter(Boolean), holidays, at: Number(c.at) || 0 }
}

export const newerCal = (a, b) => (normalizeCal(b).at > normalizeCal(a).at ? normalizeCal(b) : normalizeCal(a))

const keyOf = (scope) => (scope ? `${KEY}:${scope}` : KEY)

export function loadLocalCal(scope) {
  try {
    return normalizeCal(JSON.parse(localStorage.getItem(keyOf(scope))))
  } catch {
    return EMPTY_CAL
  }
}

export function saveLocalCal(cal, scope) {
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(cal))
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 모드 등)
  }
}

export const newEventId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// 일정이 그날에 걸리는지 (끝 날짜가 있으면 그 사이 모든 날)
export const eventOn = (e, key) => (e.end ? e.date <= key && key <= e.end : e.date === key)

// 시간 있는 일정은 시간 순, 그다음 종일 일정
const byTime = (a, b) => (a.time ?? '99') .localeCompare(b.time ?? '99') || a.title.localeCompare(b.title)

// 날짜 키 → 그날 일정 (보이는 날짜 칸들만)
export function eventsByDay(events, keys) {
  const map = new Map()
  for (const key of keys) {
    const list = events.filter((e) => eventOn(e, key)).sort(byTime)
    if (list.length) map.set(key, list)
  }
  return map
}

// 모든 도면 Equipment 의 작업 완료 날짜 → { 'YYYY-MM-DD': [{ key, tag, label, color, step, doc, row }] }
// list: 홈 도면 목록 (summary.inst 에 inst.done 이 들어 있음, SUMMARY_VERSION 6 이상)
const STEP_ORDER = Object.fromEntries(INST_STATUSES.map((s, i) => [s.id, i]))
export function equipByDay(list) {
  const map = new Map()
  for (const doc of list ?? []) {
    for (const row of doc.summary?.inst ?? []) {
      for (const [step, date] of Object.entries(row.done ?? {})) {
        if (!isDay(date)) continue
        const s = statusOf(step)
        const item = { key: `${doc.id}|${row.id}|${step}`, tag: row.tag || '(Tag. No 없음)', desc: row.desc ?? '', label: s.label, color: s.color, step, doc, row }
        if (!map.has(date)) map.set(date, [])
        map.get(date).push(item)
      }
    }
  }
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
  for (const items of map.values()) items.sort((a, b) => STEP_ORDER[a.step] - STEP_ORDER[b.step] || collator.compare(a.tag, b.tag))
  return map
}

export const todayKey = () => dayKey(new Date())

// 한 주(7칸) 일정 줄 배치: 여러 날 일정이 칸마다 같은 줄에 오게 해서 막대로 이어 보이게 함.
// 돌려주는 값: 7칸 각각의 줄 목록 [{ e, contLeft, contRight, showTitle } | null] (null = 빈 줄, 위아래 맞춤용)
export function weekLanes(keys, events) {
  const first = keys[0]
  const last = keys[keys.length - 1]
  const span = (e) => {
    let s = -1
    let t = -1
    keys.forEach((k, i) => {
      if (eventOn(e, k)) {
        if (s < 0) s = i
        t = i
      }
    })
    return [s, t]
  }
  const list = events
    .filter((e) => (e.end ?? e.date) >= first && e.date <= last)
    .map((e) => ({ e, r: span(e) }))
    .filter((x) => x.r[0] >= 0)
    .sort((a, b) => a.r[0] - b.r[0] || b.r[1] - b.r[0] - (a.r[1] - a.r[0]) || byTime(a.e, b.e))
  const lanes = []
  for (const { e, r } of list) {
    let lane = lanes.find((l) => l.slice(r[0], r[1] + 1).every((x) => !x))
    if (!lane) lanes.push((lane = Array(keys.length).fill(null)))
    for (let i = r[0]; i <= r[1]; i++) {
      const contLeft = e.date < keys[i]
      const showTitle = !contLeft || i === 0
      // run: 이 칸부터 이번 주 안에서 막대가 이어지는 칸 수 (제목을 막대 전체 너비로 보이게)
      lane[i] = { e, contLeft, contRight: (e.end ?? e.date) > keys[i], showTitle, run: showTitle ? r[1] - i + 1 : 0 }
    }
  }
  return keys.map((_, i) => {
    const col = lanes.map((l) => l[i])
    while (col.length && !col[col.length - 1]) col.pop()
    return col
  })
}
