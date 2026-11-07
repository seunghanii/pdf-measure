// 홈 왼쪽 아래 메모장 (할 일, 간단한 업무 기록). 도면과 상관없는 글 하나.
// 저장 모양: { text: 마크다운 글, at: 마지막으로 고친 시각(ms) }
// 이 브라우저에도 늘 사본을 둠: 로그인 안 했을 때는 이것이 저장소, 로그인했을 때는 서버에 못 올린 글을 지키는 사본.
const KEY = 'pdf-measure:home-note'

export const EMPTY_NOTE = { text: '', at: 0 }

export function normalizeNote(n) {
  return n && typeof n.text === 'string' ? { text: n.text, at: Number(n.at) || 0 } : EMPTY_NOTE
}

// scope: 로그인한 사용자 id (없으면 이 브라우저 전용 메모장)
const keyOf = (scope) => (scope ? `${KEY}:${scope}` : KEY)

export function loadLocalNote(scope) {
  try {
    return normalizeNote(JSON.parse(localStorage.getItem(keyOf(scope))))
  } catch {
    return EMPTY_NOTE
  }
}

export function saveLocalNote(note, scope) {
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(note))
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 모드 등)
  }
}

