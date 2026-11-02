// 화면 모드: 밝게 / 어둡게 / 시스템 따라가기. 고른 값은 이 브라우저에 저장.
// 첫 화면이 번쩍이지 않게 index.html 의 작은 스크립트가 같은 키로 먼저 <html class="dark"> 를 붙여 둡니다.
// 색은 src/index.css 의 html.dark 토큰이 바꿉니다. 도면(PDF) 색은 그대로.

const KEY = 'pdf-measure:theme'
export const THEMES = [
  { id: 'light', label: '밝게' },
  { id: 'dark', label: '어둡게' },
  { id: 'system', label: '시스템 설정 따라가기' },
]

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function loadTheme() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'system' ? v : 'light' // 처음엔 예전처럼 밝게
  } catch {
    return 'light'
  }
}

export function isDark(theme) {
  return theme === 'dark' || (theme === 'system' && !!media?.matches)
}

export function applyTheme(theme) {
  const dark = isDark(theme)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191c24' : '#ffffff')
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 사생활 보호 창 등: 저장만 못 하고 화면은 바뀜
  }
  applyTheme(theme)
}

// 시스템 따라가기일 때 맥 설정(밝게/어둡게)이 바뀌면 바로 따라감
export function watchSystemTheme() {
  if (!media) return () => {}
  const on = () => applyTheme('system')
  media.addEventListener('change', on)
  return () => media.removeEventListener('change', on)
}
