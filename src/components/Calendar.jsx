// 홈 왼쪽 위 작은 달력 + 크게 보기 Calendar 창.
// 오늘은 파랗게, 주말(기본 금요일)은 빨갛게. 주말 요일은 Calendar 창에서 바꿈 (lib/calendar.js, 이 브라우저에 저장).
// 일정: 등록·수정·삭제 (lib/calEvents.js, 로그인했으면 서버에 저장).
// Equipment 작업 완료 날짜(inst.done)는 그날 칸에 "Tag. No - 작업" 으로 표시, 칸에 다 안 들어가면 +N.
// 마우스 휠(트랙패드 위아래)로 이전 달·다음 달.
// 기본 공휴일(lib/holidays.js): 사우디는 휴무(빨간 숫자), 한국은 이름만.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  addMonths,
  dayKey,
  hijriLabel,
  loadWeekend,
  monthGrid,
  monthLabel,
  sameDay,
  saveWeekend,
  startOfMonth,
  weekdayOrder,
} from '../lib/calendar'
import { EMPTY_CAL, EVENT_COLORS, equipByDay, eventOn, newEventId, weekLanes } from '../lib/calEvents'
import { displayName } from '../lib/library'
import { holidaysOn, isPublicOff, loadPublicShow, savePublicShow } from '../lib/holidays'

// 오늘 날짜: 자정이 지나거나 창으로 돌아오면 새로 고침
function useToday() {
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => setToday((t) => (sameDay(t, new Date()) ? t : new Date()))
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    const timer = setTimeout(() => setToday(new Date()), next - now)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [today])
  return today
}

// 마우스 휠로 달 넘기기. 페이지가 같이 스크롤되지 않게 막고(passive: false),
// 트랙패드의 잔 움직임·관성은 모아서 한 번에 한 달씩만 넘김
function useWheelMonth(ref, onStep) {
  const stepRef = useRef(onStep)
  useLayoutEffect(() => {
    stepRef.current = onStep
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let acc = 0
    let last = 0
    const onWheel = (e) => {
      if (e.ctrlKey) return // 핀치 확대는 그대로
      let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!d) return
      e.preventDefault()
      if (e.deltaMode === 1) d *= 40
      const now = performance.now()
      if (now - last < 350) {
        last = now // 넘긴 직후 관성은 버림
        acc = 0
        return
      }
      acc += d
      if (Math.abs(acc) >= 40) {
        stepRef.current(acc > 0 ? 1 : -1)
        acc = 0
        last = now
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}

// 큰 달 칸 한 칸에 보일 줄 수 (화면 너비에 따라)
function useCellLines() {
  const get = () => (window.matchMedia?.('(min-width: 1024px)').matches ? 3 : window.matchMedia?.('(min-width: 640px)').matches ? 2 : 1)
  const [n, setN] = useState(get)
  useEffect(() => {
    const on = () => setN(get())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return n
}

function Chevron({ dir, className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

const navBtn = 'flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800'

export default function HomeCalendar({ store, list = [], library, onOpenEquip }) {
  const today = useToday()
  const [weekend, setWeekend] = useState(loadWeekend)
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [big, setBig] = useState(null) // null 닫힘, Date = 처음 고를 날
  const [cal, setCal] = useState(EMPTY_CAL)
  const [saveError, setSaveError] = useState(false)
  const gridRef = useRef(null)
  useWheelMonth(gridRef, (n) => setMonth((m) => addMonths(m, n)))

  useEffect(() => {
    let alive = true
    store
      ?.getCalendar?.()
      .then((c) => alive && setCal(c))
      .catch((e) => console.warn('일정을 불러오지 못함', e))
    return () => {
      alive = false
    }
  }, [store])

  const saveCal = (patch) => {
    const next = { ...cal, ...patch, at: Date.now() }
    setCal(next)
    setSaveError(false)
    store
      ?.saveCalendar?.(next)
      .catch((e) => {
        console.warn('일정 저장 실패', e)
        setSaveError(true)
      })
  }

  const saveEvents = (events) => saveCal({ events })
  const holidays = useMemo(() => new Set(cal.holidays ?? []), [cal.holidays])
  const toggleHoliday = (key) => saveCal({ holidays: holidays.has(key) ? [...holidays].filter((k) => k !== key) : [...holidays, key].sort() })
  const equip = useMemo(() => equipByDay(list), [list])
  const [pubShow, setPubShow] = useState(loadPublicShow)
  const changePubShow = (v) => {
    setPubShow(v)
    savePublicShow(v)
  }
  const changeWeekend = (days) => {
    setWeekend(days)
    saveWeekend(days)
  }

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-ink-500">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        달력
        {saveError && <span className="ml-auto font-normal text-danger-500">일정 저장 못 함 (이 브라우저에는 남아 있어요)</span>}
      </div>
      <div className="rounded-xl bg-surface p-3 shadow-sm">
        <div className="mb-1 flex items-center gap-1">
          <button onClick={() => setMonth((m) => addMonths(m, -1))} className={navBtn} title="이전 달" aria-label="이전 달">
            <Chevron dir="left" />
          </button>
          <button
            onClick={() => setMonth(startOfMonth(today))}
            title="이번 달로"
            className="min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-sm font-semibold text-ink-800 tabular-nums hover:bg-ink-100"
          >
            {monthLabel(month)}
          </button>
          <button onClick={() => setMonth((m) => addMonths(m, 1))} className={navBtn} title="다음 달" aria-label="다음 달">
            <Chevron dir="right" />
          </button>
          <button onClick={() => setBig(today)} className={navBtn} title="크게 보기" aria-label="달력 크게 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
            </svg>
          </button>
        </div>
        <div ref={gridRef} title="마우스 휠로 이전·다음 달">
          <MonthGrid month={month} today={today} weekend={weekend} holidays={holidays} pubShow={pubShow} events={cal.events} equip={equip} onPick={(d) => setBig(d)} />
        </div>
      </div>
      {big && (
        <CalendarDialog
          initial={big}
          today={today}
          weekend={weekend}
          onWeekend={changeWeekend}
          pubShow={pubShow}
          onPubShow={changePubShow}
          events={cal.events}
          onSaveEvents={saveEvents}
          holidays={holidays}
          onToggleHoliday={toggleHoliday}
          equip={equip}
          library={library}
          onOpenEquip={(item) => {
            setBig(null)
            onOpenEquip?.(item.doc, item.row)
          }}
          onClose={(m) => {
            setBig(null)
            if (m) setMonth(m)
          }}
        />
      )}
    </section>
  )
}

const dayTone = (isToday, off, inMonth) =>
  isToday ? 'bg-brand-600 font-semibold text-white' : off ? (inMonth ? 'text-danger-600' : 'text-danger-300') : inMonth ? 'text-ink-700' : 'text-ink-300'

// 주마다 일정 줄 배치 (여러 날 일정이 같은 줄에 이어진 막대로 보이게)
function useSlotMap(cells, events) {
  return useMemo(() => {
    const map = new Map()
    for (let w = 0; w < cells.length; w += 7) {
      const keys = cells.slice(w, w + 7).map((c) => c.key)
      weekLanes(keys, events).forEach((col, i) => map.set(keys[i], col))
    }
    return map
  }, [events, cells])
}

// 작은 달력 글씨: 9px 은 윈도우(맑은 고딕)에서 획이 뭉개져 10px 로, 자간을 조금 좁혀 한 칸에 더 들어가게
const MINI_TEXT = 'text-[10px] leading-[14px] font-medium tracking-[-0.03em]'
const MINI_LINES = 2 // 작은 달력 한 칸 줄 수 (넘치면 마지막 줄이 +N)

// 여러 날 막대의 제목: 첫 칸에서 이번 주 끝 칸까지 막대 전체 너비를 씀 (칸 하나에 갇혀 '정기...' 로 잘리지 않게)
// gap = 막대 칸 사이 간격(px), inset = 첫·끝 칸 바깥 여백(px)
function SpanTitle({ run, gap = 0, inset = 0, className = '', children }) {
  if (run <= 1) return children
  return (
    <span
      className={`pointer-events-none absolute inset-y-0 left-0 z-[1] truncate ${className}`}
      style={{ width: `calc(${run * 100}% + ${(run - 1) * gap - inset}px)` }}
    >
      {children}
    </span>
  )
}

// 작은 달력: 칸마다 일정·Equipment 를 작게 그대로 보여 주고, 넘치면 +N. 누르면 그날로 큰 창
function MonthGrid({ month, today, weekend, holidays, pubShow, events, equip, onPick }) {
  const order = weekdayOrder()
  const cells = useMemo(() => monthGrid(month), [month])
  const slotMap = useSlotMap(cells, events)
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs tabular-nums">
        {order.map((d) => (
          <div key={d} className={`py-1 font-medium ${weekend.includes(d) ? 'text-danger-500' : 'text-ink-400'}`}>
            {WEEKDAYS[d]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map(({ date, key, inMonth }) => {
          const isToday = sameDay(date, today)
          const holiday = holidays.has(key)
          const pub = holidaysOn(date, pubShow)
          const off = holiday || isPublicOff(pub) || weekend.includes(date.getDay())
          const slots = slotMap.get(key) ?? []
          const eq = equip.get(key) ?? []
          const rows = [...slots.map((x) => (x ? { type: 'ev', s: x } : { type: 'gap' })), ...eq.map((q) => ({ type: 'eq', q }))]
          const fit = rows.length <= MINI_LINES ? rows.length : MINI_LINES - 1
          const rest = rows.slice(fit).filter((r) => r.type !== 'gap').length
          const tip = [
            isToday && '오늘',
            ...pub.map((h) => h.name),
            holiday && '휴무',
            ...slots.filter(Boolean).map((x) => `${timeOf(x.e)}${x.e.title}`),
            ...eq.map((q) => `${q.tag} - ${q.label}`),
          ]
            .filter(Boolean)
            .join('\n')
          return (
            <button
              key={key}
              onClick={() => onPick(date)}
              title={tip || undefined}
              className={`group flex h-[3.25rem] min-w-0 flex-col items-stretch gap-px rounded-md pt-0.5 transition-colors hover:bg-ink-100 ${inMonth ? '' : 'opacity-60'}`}
            >
              <span className={`mx-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-0.5 text-xs tabular-nums ${dayTone(isToday, off, inMonth)}`}>
                {date.getDate()}
              </span>
              {rows.slice(0, fit).map((r, i) => {
                if (r.type === 'gap') return <span key={`g${i}`} className="h-3.5 shrink-0" aria-hidden="true" />
                if (r.type === 'eq')
                  return (
                    <span key={r.q.key} className={`${MINI_TEXT} mx-px overflow-hidden rounded-sm px-0.5 text-left whitespace-nowrap`} style={{ color: r.q.color, backgroundColor: `${r.q.color}1f` }}>
                      {r.q.tag}
                    </span>
                  )
                const { e, contLeft, contRight, showTitle, run } = r.s
                const title = showTitle ? e.title || '·' : '\u00a0'
                // 하루 일정 하나뿐이면 두 줄까지 접어서 보여 줌
                const wrap = run <= 1 && rows.length === 1 && rest === 0
                return (
                  <span
                    key={e.id}
                    className={`${MINI_TEXT} relative shrink-0 px-0.5 text-left text-white ${
                      wrap ? 'line-clamp-2 break-all' : run > 1 ? 'h-3.5' : 'h-3.5 overflow-hidden whitespace-nowrap'
                    } ${contLeft ? 'rounded-l-none' : 'ml-px rounded-l-sm'} ${contRight ? 'rounded-r-none' : 'mr-px rounded-r-sm'}`}
                    style={{ backgroundColor: e.color }}
                  >
                    <SpanTitle run={run} inset={2} className="px-0.5">
                      {title}
                    </SpanTitle>
                  </span>
                )
              })}
              {rest > 0 && <span className={`${MINI_TEXT} text-ink-500`}>+{rest}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// 크게 보기 Calendar 창
function CalendarDialog({ initial, today, weekend, onWeekend, pubShow, onPubShow, holidays, onToggleHoliday, events, onSaveEvents, equip, library, onOpenEquip, onClose }) {
  const [month, setMonth] = useState(() => startOfMonth(initial))
  const [selected, setSelected] = useState(initial)
  const [settings, setSettings] = useState(false)
  const [editing, setEditing] = useState(null) // 고치는 일정 (새 일정은 id 없음)
  const gridRef = useRef(null)
  const lines = useCellLines()
  const order = weekdayOrder()
  const cells = useMemo(() => monthGrid(month), [month])
  const slotMap = useSlotMap(cells, events)
  useWheelMonth(gridRef, (n) => setMonth((m) => addMonths(m, n)))

  const closeRef = useRef(null)
  useLayoutEffect(() => {
    closeRef.current = () => (editing ? setEditing(null) : onClose(month))
  })
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current()
      else if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setMonth((m) => addMonths(m, -1))
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') setMonth((m) => addMonths(m, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goToday = () => {
    setMonth(startOfMonth(today))
    setSelected(today)
  }
  const toggleDay = (d) => onWeekend(weekend.includes(d) ? weekend.filter((x) => x !== d) : [...weekend, d].sort())
  const startNew = (date) => setEditing({ date: dayKey(date), title: '', color: EVENT_COLORS[0] })

  const saveEvent = (ev) => {
    if (ev.id) onSaveEvents(events.map((e) => (e.id === ev.id ? ev : e)))
    else onSaveEvents([...events, { ...ev, id: newEventId() }])
    setEditing(null)
  }
  const deleteEvent = (id) => {
    onSaveEvents(events.filter((e) => e.id !== id))
    setEditing(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onMouseDown={() => onClose(month)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Calendar"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface shadow-xl"
      >
        {/* 머리줄 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-3">
          <h3 className="mr-2 text-lg font-semibold tracking-tight text-ink-900">Calendar</h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth((m) => addMonths(m, -1))} className={navBtn} title="이전 달 (← 또는 휠 위로)" aria-label="이전 달">
              <Chevron dir="left" />
            </button>
            <span className="min-w-[7.5rem] text-center text-base font-semibold text-ink-800 tabular-nums">{monthLabel(month)}</span>
            <button onClick={() => setMonth((m) => addMonths(m, 1))} className={navBtn} title="다음 달 (→ 또는 휠 아래로)" aria-label="다음 달">
              <Chevron dir="right" />
            </button>
          </div>
          <button onClick={goToday} className="rounded-lg px-3 py-1 text-sm font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
            오늘
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => startNew(selected)}
              className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-press"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              일정
            </button>
            <button
              onClick={() => setSettings((v) => !v)}
              aria-expanded={settings}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
                settings ? 'bg-ink-100 text-ink-900' : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
              <span className="hidden sm:inline">휴무 설정</span>
            </button>
            <button onClick={() => onClose(month)} className={navBtn} title="닫기 (Esc)" aria-label="닫기">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {settings && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <span className="mr-1 text-sm text-ink-600">쉬는 요일</span>
            {order.map((d) => {
              const on = weekend.includes(d)
              return (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  aria-pressed={on}
                  title={WEEKDAYS_LONG[d]}
                  className={`h-8 w-8 rounded-full text-sm font-medium ring-1 transition-colors ${
                    on ? 'bg-danger-500 text-white ring-danger-500' : 'bg-surface text-ink-600 ring-ink-200 hover:ring-ink-400'
                  }`}
                >
                  {WEEKDAYS[d]}
                </button>
              )
            })}
            <span className="text-xs text-ink-400">고른 요일이 빨간색으로 표시돼요 (기본: 금요일)</span>
            <span className="mx-1 hidden h-5 w-px bg-ink-200 sm:block" aria-hidden="true" />
            <span className="mr-1 text-sm text-ink-600">공휴일</span>
            {[
              ['sa', '사우디', '사우디 공휴일 (휴무, 빨간 숫자)'],
              ['kr', '한국', '한국 공휴일 (이름만 표시)'],
            ].map(([id, label, tip]) => (
              <button
                key={id}
                onClick={() => onPubShow({ ...pubShow, [id]: !pubShow[id] })}
                aria-pressed={pubShow[id]}
                title={tip}
                className={`rounded-full px-3 py-1 text-sm font-medium ring-1 transition-colors ${
                  pubShow[id] ? (id === 'sa' ? 'bg-danger-50 text-danger-600 ring-danger-200' : 'bg-brand-50 text-brand-700 ring-brand-200') : 'bg-surface text-ink-500 ring-ink-200 hover:ring-ink-400'
                }`}
              >
                {pubShow[id] ? '✓ ' : ''}
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row">
          {/* 큰 달 칸 */}
          <div className="min-w-0 flex-1 p-3">
            <div className="grid grid-cols-7 text-center text-xs font-medium">
              {order.map((d) => (
                <div key={d} className={`pb-2 ${weekend.includes(d) ? 'text-danger-500' : 'text-ink-500'}`}>
                  {WEEKDAYS[d]}
                </div>
              ))}
            </div>
            <div ref={gridRef} className="grid grid-cols-7 overflow-hidden rounded-lg ring-1 ring-ink-200" style={{ gap: 1, background: 'var(--color-ink-200)' }}>
              {cells.map((cell) => {
                const pub = holidaysOn(cell.date, pubShow)
                return (
                <DayCell
                  key={cell.key}
                  {...cell}
                  pub={pub}
                  lines={lines}
                  slots={slotMap.get(cell.key) ?? []}
                  equip={equip.get(cell.key) ?? []}
                  isToday={sameDay(cell.date, today)}
                  isSelected={sameDay(cell.date, selected)}
                  off={holidays.has(cell.key) || isPublicOff(pub) || weekend.includes(cell.date.getDay())}
                  onSelect={() => {
                    setSelected(cell.date)
                    setEditing(null)
                    if (!cell.inMonth) setMonth(startOfMonth(cell.date))
                  }}
                  onAdd={() => {
                    setSelected(cell.date)
                    startNew(cell.date)
                  }}
                  onEdit={(ev) => {
                    setSelected(cell.date)
                    setEditing(ev)
                  }}
                />
                )
              })}
            </div>
            <p className="mt-2 hidden text-xs text-ink-400 sm:block">빈 곳을 두 번 누르면 일정 추가 · 마우스 휠로 이전·다음 달</p>
          </div>

          {/* 선택한 날: 일정·Equipment 목록, 일정 등록·수정 */}
          <aside className="shrink-0 border-t border-ink-200 p-4 md:w-72 md:overflow-y-auto md:border-t-0 md:border-l">
            {editing ? (
              <EventForm key={editing.id ?? 'new'} event={editing} onSave={saveEvent} onDelete={deleteEvent} onCancel={() => setEditing(null)} />
            ) : (
              <DayPanel
                day={selected}
                today={today}
                weekend={weekend}
                holiday={holidays.has(dayKey(selected))}
                pub={holidaysOn(selected, pubShow)}
                onToggleHoliday={() => onToggleHoliday(dayKey(selected))}
                events={events.filter((e) => eventOn(e, dayKey(selected)))}
                equip={equip.get(dayKey(selected)) ?? []}
                library={library}
                onAdd={() => startNew(selected)}
                onEdit={setEditing}
                onOpenEquip={onOpenEquip}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

const timeOf = (e) => (e.time ? `${e.time} ` : '')

function DayCell({ date, inMonth, isToday, isSelected, off, pub = [], slots, equip, lines, onSelect, onAdd, onEdit }) {
  // 일정 줄(빈 줄 포함, 주 안에서 같은 일정은 같은 줄) 다음에 Equipment. 다 들어가면 그대로, 넘치면 마지막 줄을 +N 자리로
  const rows = [...slots.map((s) => (s ? { type: 'ev', s } : { type: 'gap' })), ...equip.map((q) => ({ type: 'eq', q }))]
  const fit = rows.length <= lines ? rows.length : Math.max(lines - 1, 0)
  const rest = rows.slice(fit).filter((r) => r.type !== 'gap').length
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onAdd}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      aria-current={isToday ? 'date' : undefined}
      aria-pressed={isSelected}
      className={`relative flex h-20 min-w-0 cursor-pointer flex-col items-stretch gap-px py-1 text-left transition-colors select-none sm:h-24 lg:h-28 ${
        inMonth ? 'bg-surface' : 'bg-ink-50'
      } ${isSelected ? 'after:pointer-events-none after:absolute after:inset-0 after:z-10 after:ring-2 after:ring-brand-500 after:ring-inset' : 'hover:bg-brand-50/60'}`}
    >
      <div className="mx-1 mb-0.5 flex min-w-0 shrink-0 items-center gap-1">
        <span className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-sm tabular-nums ${dayTone(isToday, off, inMonth)}`}>
          {date.getDate()}
        </span>
        {pub.length > 0 && (
          <span className="min-w-0 truncate text-[10px] leading-4" title={pub.map((h) => `${h.cc === 'SA' ? '사우디' : '한국'} ${h.name}`).join(', ')}>
            {pub.map((h, i) => (
              <span key={h.cc + h.name} className={h.cc === 'SA' ? 'font-medium text-danger-600' : 'text-ink-500'}>
                {i > 0 && ' · '}
                {h.name}
              </span>
            ))}
          </span>
        )}
      </div>
      {rows.slice(0, fit).map((r, i) => {
        if (r.type === 'gap') return <span key={`g${i}`} className="h-4 shrink-0" aria-hidden="true" />
        if (r.type === 'eq')
          return (
            <span key={r.q.key} title={`${r.q.tag} - ${r.q.label}${r.q.desc ? ` (${r.q.desc})` : ''}`} className="mx-1 flex min-w-0 items-center gap-1 px-0.5 text-[11px] leading-4 text-ink-700">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.q.color }} />
              <span className="truncate">
                <span className="font-medium">{r.q.tag}</span>
                <span className="text-ink-500"> - {r.q.label}</span>
              </span>
            </span>
          )
        const { e, contLeft, contRight, showTitle, run } = r.s
        return (
          <button
            key={e.id}
            onClick={(ev) => {
              ev.stopPropagation()
              onEdit(e)
            }}
            onDoubleClick={(ev) => ev.stopPropagation()}
            title={`${timeOf(e)}${e.title}${e.end ? ` (${e.date.slice(5).replace('-', '/')}~${e.end.slice(5).replace('-', '/')})` : ''}`}
            className={`relative h-4 shrink-0 px-1 text-left text-[11px] leading-4 font-medium text-white ${run > 1 ? '' : 'truncate'} ${
              contLeft ? '-ml-px rounded-l-none' : 'ml-1 rounded-l'
            } ${contRight ? 'rounded-r-none' : 'mr-1 rounded-r'}`}
            style={{ backgroundColor: e.color }}
          >
            <SpanTitle run={run} gap={1} inset={8} className="px-1">
              {showTitle ? `${timeOf(e)}${e.title || '(제목 없음)'}` : '\u00a0'}
            </SpanTitle>
          </button>
        )
      })}
      {rest > 0 && <span className="mx-1 px-1 text-[11px] leading-4 font-medium text-ink-500">+{rest}</span>}
    </div>
  )
}

function DayPanel({ day, today, weekend, holiday, pub = [], onToggleHoliday, events, equip, library, onAdd, onEdit, onOpenEquip }) {
  const weekly = weekend.includes(day.getDay())
  const saOff = isPublicOff(pub)
  const off = holiday || weekly || saOff
  const hijri = hijriLabel(day)
  return (
    <>
      <div className="text-xs font-semibold tracking-wide text-ink-500">선택한 날</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${off ? 'text-danger-600' : 'text-ink-900'}`}>
        {day.getMonth() + 1}월 {day.getDate()}일 {WEEKDAYS_LONG[day.getDay()]}
      </div>
      <div className="text-sm text-ink-500 tabular-nums">
        {day.getFullYear()}년{sameDay(day, today) && <span className="ml-1.5 font-medium text-brand-600">오늘</span>}
        {off && <span className="ml-1.5 text-danger-500">휴무</span>}
      </div>
      {hijri && <div className="mt-1 text-xs text-ink-400">{hijri} (Hijri)</div>}
      {pub.length > 0 && (
        <ul className="mt-2 space-y-1">
          {pub.map((h) => (
            <li key={h.cc + h.name} className="flex items-center gap-1.5 text-sm">
              <span className={`rounded px-1.5 text-[11px] font-semibold ${h.cc === 'SA' ? 'bg-danger-50 text-danger-600' : 'bg-ink-100 text-ink-600'}`}>{h.cc === 'SA' ? '사우디' : '한국'}</span>
              <span className={h.cc === 'SA' ? 'font-medium text-danger-600' : 'text-ink-700'}>{h.name}</span>
            </li>
          ))}
        </ul>
      )}
      {saOff ? (
        <p className="mt-3 text-xs text-ink-400">사우디 공휴일이라 휴무예요{pub.some((h) => h.name.startsWith('Eid')) ? ' (이드 날짜는 달 관측 발표로 하루쯤 달라질 수 있어요)' : ''}</p>
      ) : weekly ? (
        <p className="mt-3 text-xs text-ink-400">주말 요일이라 늘 휴무예요 (위 휴무 설정에서 바꿔요)</p>
      ) : (
        <button
          onClick={onToggleHoliday}
          aria-pressed={holiday}
          className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition-colors ${
            holiday ? 'bg-danger-50 text-danger-600 ring-danger-200 hover:bg-danger-100' : 'text-ink-600 ring-ink-200 hover:bg-ink-50'
          }`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
            {holiday ? <path d="M9 14l6 4M15 14l-6 4" /> : <path d="M12 13v6M9 16h6" />}
          </svg>
          {holiday ? '휴무 해제' : '이 날 휴무 지정'}
        </button>
      )}

      <div className="mt-4 flex items-center">
        <h4 className="text-xs font-semibold tracking-wide text-ink-500">일정</h4>
        <button onClick={onAdd} className="ml-auto rounded-md px-2 py-0.5 text-sm font-medium text-brand-600 hover:bg-brand-50">
          + 추가
        </button>
      </div>
      {events.length ? (
        <ul className="mt-1 space-y-1">
          {events.map((e) => (
            <li key={e.id}>
              <button onClick={() => onEdit(e)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink-50" title="눌러서 고치기">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium break-words text-ink-800">{e.title || '(제목 없음)'}</span>
                  <span className="block text-xs text-ink-500 tabular-nums">
                    {e.time ?? '종일'}
                    {e.end && ` · ${e.date.slice(5).replace('-', '/')}~${e.end.slice(5).replace('-', '/')}`}
                  </span>
                  {e.memo && <span className="mt-0.5 block text-xs whitespace-pre-wrap text-ink-500">{e.memo}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 px-2 text-sm text-ink-400">일정이 없어요</p>
      )}

      {equip.length > 0 && (
        <>
          <h4 className="mt-4 text-xs font-semibold tracking-wide text-ink-500">Equipment ({equip.length})</h4>
          <ul className="mt-1 space-y-0.5">
            {equip.map((q) => (
              <li key={q.key}>
                <button onClick={() => onOpenEquip(q)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-brand-50/60" title="도면에서 이 Equipment 로 이동">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: q.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-800">
                      <span className="font-medium">{q.tag}</span> - {q.label}
                    </span>
                    {q.desc && <span className="block truncate text-xs text-ink-500">{q.desc}</span>}
                    <span className="block truncate text-xs text-ink-400">
                      {displayName(library, q.doc.id, q.doc.name)}
                      {q.row.page > 1 && ` · ${q.row.page}쪽`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

const inputCls = 'mt-1 w-full rounded-lg border border-ink-300 bg-surface px-2.5 py-1.5 text-sm text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100'

function EventForm({ event, onSave, onDelete, onCancel }) {
  const [title, setTitle] = useState(event.title ?? '')
  const [date, setDate] = useState(event.date)
  const [end, setEnd] = useState(event.end ?? '')
  const [time, setTime] = useState(event.time ?? '')
  const [memo, setMemo] = useState(event.memo ?? '')
  const [color, setColor] = useState(event.color ?? EVENT_COLORS[0])
  const editing = !!event.id

  const submit = (e) => {
    e.preventDefault()
    if (!title.trim() || !date) return
    const out = { id: event.id, date, title: title.trim(), color }
    if (end && end > date) out.end = end
    if (time) out.time = time
    if (memo.trim()) out.memo = memo.trim()
    onSave(out)
  }

  return (
    <form onSubmit={submit}>
      <div className="text-xs font-semibold tracking-wide text-ink-500">{editing ? '일정 고치기' : '새 일정'}</div>
      <label className="mt-2 block text-sm font-medium text-ink-600">
        제목
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="예: FT-101 Loop Check 입회" className={inputCls} />
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block text-sm font-medium text-ink-600">
          날짜
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </label>
        <label className="block text-sm font-medium text-ink-600">
          끝 날짜
          <input type="date" value={end} min={date} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </label>
      </div>
      <label className="mt-2 block text-sm font-medium text-ink-600">
        시간 <span className="font-normal text-ink-400">(비우면 종일)</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
      </label>
      <div className="mt-2 text-sm font-medium text-ink-600">색</div>
      <div className="mt-1 flex gap-2">
        {EVENT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`색 ${c}`}
            aria-pressed={color === c}
            className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition ${color === c ? 'ring-2 ring-ink-700' : 'hover:scale-110'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <label className="mt-2 block text-sm font-medium text-ink-600">
        메모
        <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} maxLength={4000} className={`${inputCls} resize-y`} />
      </label>
      <div className="mt-3 flex items-center gap-2">
        {editing && (
          <button type="button" onClick={() => window.confirm('이 일정을 지울까요?') && onDelete(event.id)} className="rounded-lg px-2 py-1.5 text-sm text-danger-500 hover:bg-danger-50">
            삭제
          </button>
        )}
        <button type="button" onClick={onCancel} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100">
          취소
        </button>
        <button type="submit" disabled={!title.trim()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-press disabled:opacity-40">
          저장
        </button>
      </div>
    </form>
  )
}
