// 달력 일정 (등록·수정·삭제) 과 Equipment 작업 완료 날짜 모으기.
// 저장 모양: { events: [{ id, date 'YYYY-MM-DD', end?, time?, title, memo?, color }], at: 마지막으로 고친 시각(ms) }
// 로그인했으면 documents 특별한 줄 __calendar__ (스키마 변경 없음), 아니면 이 브라우저.
// 이 브라우저에도 늘 사본을 둠 (서버에 못 올린 일정을 지키고 다음에 다시 올림) — 홈 메모장(lib/homeNote.js)과 같은 방식.
import { dayKey } from './calendar'
import { INST_STATUSES, statusOf } from './instrument'

const KEY = 'pdf-measure:cal-events'

export const EVENT_COLORS = ['#2a4fe0', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#64748b']
export const EMPTY_CAL = { events: [], at: 0 }

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
  return { events: c.events.map(cleanEvent).filter(Boolean), at: Number(c.at) || 0 }
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
        const item = { key: `${doc.id}|${row.id}|${step}`, tag: row.tag || '(Tag 없음)', desc: row.desc ?? '', label: s.label, color: s.color, step, doc, row }
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
