// 홈 왼쪽 위 달력: 날짜 계산과 주말 설정.
// 주말 요일은 이 브라우저에 저장 (기본: 금요일, 사우디 휴무일).
// 나중에 일정(등록·수정)을 붙일 때는 날짜를 dayKey(date) 'YYYY-MM-DD' 로 묶어 저장하면
// 작은 달력과 큰 Calendar 창이 같은 키로 표시할 수 있습니다.

const WEEKEND_KEY = 'pdf-measure:cal-weekend'
export const DEFAULT_WEEKEND = [5] // 0 = 일요일 … 5 = 금요일, 6 = 토요일
export const WEEK_START = 0 // 사우디 근무 주는 일요일에 시작
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
export const WEEKDAYS_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

export function loadWeekend() {
  try {
    const v = JSON.parse(localStorage.getItem(WEEKEND_KEY))
    if (Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return [...new Set(v)].sort()
  } catch {
    // 무시
  }
  return DEFAULT_WEEKEND
}

export function saveWeekend(days) {
  try {
    localStorage.setItem(WEEKEND_KEY, JSON.stringify(days))
  } catch {
    // 사생활 보호 창 등: 저장만 못 함
  }
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function addMonths(month, n) {
  return new Date(month.getFullYear(), month.getMonth() + n, 1)
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// 요일 머리줄 순서 (주 시작 요일부터)
export function weekdayOrder() {
  return Array.from({ length: 7 }, (_, i) => (WEEK_START + i) % 7)
}

// 한 달 칸: 앞뒤 달 날짜로 채워 6주(42칸) 고정. 달이 바뀌어도 높이가 그대로라 화면이 흔들리지 않음
export function monthGrid(month) {
  const first = startOfMonth(month)
  const lead = (first.getDay() - WEEK_START + 7) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - lead + i)
    return { date, key: dayKey(date), inMonth: date.getMonth() === first.getMonth() }
  })
}

export function monthLabel(month) {
  return `${month.getFullYear()}년 ${month.getMonth() + 1}월`
}

// 이슬람력(움 알쿠라, 사우디 공식 달력) 날짜. 브라우저가 지원하지 않으면 빈 글
export function hijriLabel(d) {
  try {
    return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  } catch {
    return ''
  }
}
