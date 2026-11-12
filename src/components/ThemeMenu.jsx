import { useEffect, useRef, useState } from 'react'
import { THEMES, isDark, loadTheme, saveTheme, watchSystemTheme } from '../lib/theme'

// 홈 툴바 오른쪽: 화면 모드(밝게/어둡게/시스템) 고르기
export default function ThemeMenu() {
  const [theme, setTheme] = useState(loadTheme)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => (theme === 'system' ? watchSystemTheme() : undefined), [theme])
  // 찾기·명령 창에서 바꾼 테마도 단추에 반영
  useEffect(() => {
    const on = (e) => setTheme(e.detail)
    window.addEventListener('jcp:theme', on)
    return () => window.removeEventListener('jcp:theme', on)
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const pick = (id) => {
    setTheme(id)
    saveTheme(id)
    setOpen(false)
  }
  const label = THEMES.find((t) => t.id === theme)?.label

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={`화면 모드: ${label}`}
        aria-label={`화면 모드: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-ink-200 bg-surface text-ink-600 shadow-xs transition-colors hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900"
      >
        {isDark(theme) ? <MoonIcon /> : <SunIcon />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-ink-200">
          <div className="px-3 pt-1.5 pb-1 text-xs font-medium text-ink-500">화면 모드</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={theme === t.id}
              onClick={() => pick(t.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-50 ${theme === t.id ? 'font-semibold text-brand-700' : 'text-ink-700'}`}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {t.id === 'light' ? <SunIcon /> : t.id === 'dark' ? <MoonIcon /> : <AutoIcon />}
              </span>
              <span className="flex-1">{t.label}</span>
              {theme === t.id && <span aria-hidden>✓</span>}
            </button>
          ))}
          <div className="border-t border-ink-100 px-3 pt-1.5 pb-1 text-[11px] leading-snug text-ink-400">도면 종이는 늘 흰색 그대로예요</div>
        </div>
      )}
    </div>
  )
}

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

function SunIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg {...svg}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function AutoIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}
