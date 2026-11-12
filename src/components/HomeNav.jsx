// 홈 안 화면 고르기: 홈(현황판) · Equipment · 도면 폴더 · 달력
const VIEWS = [
  { id: 'home', label: '홈', icon: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' },
  { id: 'equip', label: 'Equipment', icon: 'M5 10a7 7 0 1014 0 7 7 0 10-14 0zM12 10l3.5-3M12 17v4M9 21h6' },
  { id: 'docs', label: '도면 폴더', icon: 'M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z' },
  { id: 'calendar', label: '달력', icon: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4' },
]

export default function HomeNav({ view, onView }) {
  return (
    <nav className="flex items-center gap-0.5 rounded-xl bg-ink-100 p-0.5" aria-label="홈 화면">
      {VIEWS.map((v) => {
        const on = view === v.id
        return (
          <button
            key={v.id}
            onClick={() => onView(v.id)}
            aria-current={on ? 'page' : undefined}
            title={v.label}
            className={[
              'flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors pointer-coarse:py-2.5 max-sm:px-2.5',
              on ? 'bg-surface text-ink-900 shadow-xs' : 'text-ink-600 hover:bg-surface/70 hover:text-ink-900',
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={v.icon} />
            </svg>
            <span className="max-md:hidden">{v.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
