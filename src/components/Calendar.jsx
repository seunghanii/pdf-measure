// 홈 왼쪽 위 작은 달력 + 크게 보기 Calendar 창.
// 오늘은 파랗게, 주말(기본 금요일)은 빨갛게. 주말 요일은 Calendar 창에서 바꿈 (lib/calendar.js, 이 브라우저에 저장).
// 일정 기능은 아직 없음: 나중에 events = { 'YYYY-MM-DD': [...] } 를 DayCell 에 넘겨 표시하고,
// 창 오른쪽 '선택한 날' 칸에 목록·등록 단추를 넣으면 됩니다.
import { useEffect, useState } from 'react'
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  addMonths,
  hijriLabel,
  loadWeekend,
  monthGrid,
  monthLabel,
  sameDay,
  saveWeekend,
  startOfMonth,
  weekdayOrder,
} from '../lib/calendar'

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

function Chevron({ dir, className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

const navBtn = 'flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800'

export default function HomeCalendar() {
  const today = useToday()
  const [weekend, setWeekend] = useState(loadWeekend)
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [big, setBig] = useState(false)

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
          <button onClick={() => setBig(true)} className={navBtn} title="크게 보기" aria-label="달력 크게 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
            </svg>
          </button>
        </div>
        <MonthGrid month={month} today={today} weekend={weekend} />
      </div>
      {big && (
        <CalendarDialog
          initialMonth={month}
          today={today}
          weekend={weekend}
          onWeekend={changeWeekend}
          onClose={(m) => {
            setBig(false)
            if (m) setMonth(m)
          }}
        />
      )}
    </section>
  )
}

// 작은 달력 칸
function MonthGrid({ month, today, weekend }) {
  const order = weekdayOrder()
  return (
    <div className="grid grid-cols-7 text-center text-xs tabular-nums">
      {order.map((d) => (
        <div key={d} className={`py-1 font-medium ${weekend.includes(d) ? 'text-danger-500' : 'text-ink-400'}`}>
          {WEEKDAYS[d]}
        </div>
      ))}
      {monthGrid(month).map(({ date, key, inMonth }) => {
        const isToday = sameDay(date, today)
        const off = weekend.includes(date.getDay())
        return (
          <div key={key} className="flex items-center justify-center py-0.5">
            <span
              title={isToday ? '오늘' : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full ${
                isToday
                  ? 'bg-brand-600 font-semibold text-white'
                  : off
                    ? inMonth
                      ? 'text-danger-600'
                      : 'text-danger-300'
                    : inMonth
                      ? 'text-ink-700'
                      : 'text-ink-300'
              }`}
            >
              {date.getDate()}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// 크게 보기 Calendar 창
function CalendarDialog({ initialMonth, today, weekend, onWeekend, onClose }) {
  const [month, setMonth] = useState(initialMonth)
  const [selected, setSelected] = useState(() => (sameDay(startOfMonth(today), initialMonth) ? today : initialMonth))
  const [settings, setSettings] = useState(false)
  const order = weekdayOrder()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose(month)
      else if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setMonth((m) => addMonths(m, -1))
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') setMonth((m) => addMonths(m, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [month, onClose])

  const goToday = () => {
    setMonth(startOfMonth(today))
    setSelected(today)
  }
  const toggleDay = (d) => onWeekend(weekend.includes(d) ? weekend.filter((x) => x !== d) : [...weekend, d].sort())
  const hijri = hijriLabel(selected)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onMouseDown={() => onClose(month)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Calendar"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-xl"
      >
        {/* 머리줄 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-3">
          <h3 className="mr-2 text-lg font-semibold tracking-tight text-ink-900">Calendar</h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth((m) => addMonths(m, -1))} className={navBtn} title="이전 달 (←)" aria-label="이전 달">
              <Chevron dir="left" />
            </button>
            <span className="min-w-[7.5rem] text-center text-base font-semibold text-ink-800 tabular-nums">{monthLabel(month)}</span>
            <button onClick={() => setMonth((m) => addMonths(m, 1))} className={navBtn} title="다음 달 (→)" aria-label="다음 달">
              <Chevron dir="right" />
            </button>
          </div>
          <button onClick={goToday} className="rounded-lg px-3 py-1 text-sm font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
            오늘
          </button>
          <div className="ml-auto flex items-center gap-1">
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
              주말 설정
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
            <div className="grid grid-cols-7 overflow-hidden rounded-lg ring-1 ring-ink-200" style={{ gap: 1, background: 'var(--color-ink-200)' }}>
              {monthGrid(month).map((cell) => (
                <DayCell
                  key={cell.key}
                  {...cell}
                  isToday={sameDay(cell.date, today)}
                  isSelected={sameDay(cell.date, selected)}
                  off={weekend.includes(cell.date.getDay())}
                  onSelect={() => {
                    setSelected(cell.date)
                    if (!cell.inMonth) setMonth(startOfMonth(cell.date))
                  }}
                />
              ))}
            </div>
          </div>

          {/* 선택한 날: 나중에 일정 목록·등록 자리 */}
          <aside className="shrink-0 border-t border-ink-200 p-4 md:w-64 md:border-t-0 md:border-l">
            <div className="text-xs font-semibold tracking-wide text-ink-500">선택한 날</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${weekend.includes(selected.getDay()) ? 'text-danger-600' : 'text-ink-900'}`}>
              {selected.getMonth() + 1}월 {selected.getDate()}일 {WEEKDAYS_LONG[selected.getDay()]}
            </div>
            <div className="text-sm text-ink-500 tabular-nums">
              {selected.getFullYear()}년{sameDay(selected, today) && <span className="ml-1.5 font-medium text-brand-600">오늘</span>}
              {weekend.includes(selected.getDay()) && <span className="ml-1.5 text-danger-500">휴무</span>}
            </div>
            {hijri && <div className="mt-1 text-xs text-ink-400">{hijri} (Hijri)</div>}
            <div className="mt-4 rounded-lg border border-dashed border-ink-300 px-3 py-4 text-center text-sm text-ink-400">일정 기능은 곧 추가돼요</div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function DayCell({ date, inMonth, isToday, isSelected, off, onSelect }) {
  return (
    <button
      onClick={onSelect}
      aria-current={isToday ? 'date' : undefined}
      aria-pressed={isSelected}
      className={`flex h-16 flex-col items-stretch p-1.5 text-left transition-colors sm:h-20 lg:h-24 ${
        inMonth ? 'bg-surface' : 'bg-ink-50'
      } ${isSelected ? 'ring-2 ring-brand-500 ring-inset' : 'hover:bg-brand-50/60'}`}
    >
      <span
        className={`flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1 text-sm tabular-nums ${
          isToday
            ? 'bg-brand-600 font-semibold text-white'
            : off
              ? inMonth
                ? 'font-medium text-danger-600'
                : 'text-danger-300'
              : inMonth
                ? 'text-ink-800'
                : 'text-ink-300'
        }`}
      >
        {date.getDate()}
      </span>
      {/* 일정 표시 자리 */}
    </button>
  )
}
