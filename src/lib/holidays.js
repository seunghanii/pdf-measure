// 기본 공휴일: 사우디(휴무, 빨간 숫자) + 한국(이름만 표시, 휴무 아님).
// 외부 API 없이 브라우저 달력으로 계산 (인터넷·키 필요 없음, 해마다 자동):
// - 사우디: 이슬람력은 사우디 공식 달력인 움 알쿠라(Intl 'islamic-umalqura'). 실제 이드 날짜는 달 관측 발표로 하루쯤 달라질 수 있음.
// - 한국: 음력 명절은 Intl 'chinese' 달력(윤달 제외), 대체공휴일도 계산.
import { dayKey } from './calendar'

const SHOW_KEY = 'pdf-measure:cal-public' // { sa: bool, kr: bool }

export function loadPublicShow() {
  try {
    const v = JSON.parse(localStorage.getItem(SHOW_KEY))
    if (v && typeof v === 'object') return { sa: v.sa !== false, kr: v.kr !== false }
  } catch {
    // 무시
  }
  return { sa: true, kr: true }
}

export function savePublicShow(v) {
  try {
    localStorage.setItem(SHOW_KEY, JSON.stringify(v))
  } catch {
    // 무시
  }
}

function makeFmt(calendar) {
  try {
    const f = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
    return (y, m, d) => {
      const parts = f.formatToParts(new Date(Date.UTC(y, m, d)))
      const month = parts.find((p) => p.type === 'month')?.value ?? ''
      // 윤달은 "4bis" 처럼 나옴 → 명절 아님
      return { m: /^\d+$/.test(month) ? Number(month) : 0, d: Number(parts.find((p) => p.type === 'day')?.value) }
    }
  } catch {
    return null // 이 달력을 모르는 브라우저
  }
}

let hijri
let lunar
const cache = new Map()

// 그해 공휴일: Map<'YYYY-MM-DD', [{ cc: 'SA'|'KR', name }]>
export function yearHolidays(year) {
  if (cache.has(year)) return cache.get(year)
  if (hijri === undefined) hijri = makeFmt('islamic-umalqura')
  if (lunar === undefined) lunar = makeFmt('chinese')
  const map = new Map()
  const add = (key, cc, name) => {
    if (!map.has(key)) map.set(key, [])
    const list = map.get(key)
    if (!list.some((h) => h.cc === cc && h.name === name)) list.push({ cc, name })
  }
  const days = []
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d)

  // ---- 사우디 ----
  for (const d of days) {
    const key = dayKey(d)
    const md = `${d.getMonth() + 1}/${d.getDate()}`
    if (md === '2/22') add(key, 'SA', 'Founding Day')
    if (md === '9/23') add(key, 'SA', 'National Day')
    if (hijri) {
      const h = hijri(d.getFullYear(), d.getMonth(), d.getDate())
      if (h.m === 10 && h.d >= 1 && h.d <= 3) add(key, 'SA', 'Eid al-Fitr')
      if (h.m === 12 && h.d === 9) add(key, 'SA', 'Arafat Day')
      if (h.m === 12 && h.d >= 10 && h.d <= 12) add(key, 'SA', 'Eid al-Adha')
    }
  }

  // ---- 한국 ----
  const kr = new Map() // key → { name, sub: 'block'|'day'|null }
  const fixed = { '1/1': ['신정', null], '3/1': ['삼일절', 'day'], '5/5': ['어린이날', 'day'], '6/6': ['현충일', null], '8/15': ['광복절', 'day'], '10/3': ['개천절', 'day'], '10/9': ['한글날', 'day'], '12/25': ['성탄절', 'day'] }
  const blocks = [] // 설날·추석 3일 묶음
  days.forEach((d) => {
    const md = `${d.getMonth() + 1}/${d.getDate()}`
    if (fixed[md]) kr.set(dayKey(d), { name: fixed[md][0], sub: fixed[md][1] })
    if (!lunar) return
    const l = lunar(d.getFullYear(), d.getMonth(), d.getDate())
    if (l.m === 4 && l.d === 8) kr.set(dayKey(d), { name: '부처님오신날', sub: 'day' })
    if ((l.m === 1 && l.d === 1) || (l.m === 8 && l.d === 15)) {
      const name = l.m === 1 ? '설날' : '추석'
      const block = [-1, 0, 1].map((o) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + o))
      blocks.push(block)
      for (const b of block) if (b.getFullYear() === year) kr.set(dayKey(b), { name, sub: null })
    }
  })
  // 대체공휴일: 날짜 하나짜리는 토·일이면, 설·추석은 연휴가 일요일과 겹치면 → 그다음 평일(공휴일 아닌 날)
  const isOff = (d) => d.getDay() === 0 || d.getDay() === 6 || kr.has(dayKey(d))
  const nextFree = (d) => {
    let n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    while (isOff(n)) n = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1)
    return n
  }
  const subs = []
  for (const [key, h] of kr) {
    if (h.sub !== 'day') continue
    const d = new Date(`${key}T00:00:00`)
    const wd = d.getDay()
    if (wd === 0 || wd === 6) subs.push(d)
  }
  for (const block of blocks) if (block.some((b) => b.getDay() === 0)) subs.push(block[2])
  for (const d of subs) {
    const n = nextFree(d)
    if (n.getFullYear() === year) kr.set(dayKey(n), { name: '대체공휴일', sub: null })
  }
  for (const [key, h] of kr) add(key, 'KR', h.name)

  cache.set(year, map)
  return map
}

// 날짜 하나의 공휴일 (보이는 나라만)
export function holidaysOn(date, show) {
  const list = yearHolidays(date.getFullYear()).get(dayKey(date)) ?? []
  return list.filter((h) => (h.cc === 'SA' ? show.sa : show.kr))
}

// 사우디 공휴일만 휴무(빨간 숫자)
export const isPublicOff = (list) => list.some((h) => h.cc === 'SA')
