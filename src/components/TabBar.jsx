// 열린 도면 탭. 맨 왼쪽 집 아이콘은 홈(최근 파일 목록)입니다.
export default function TabBar({ docs, activeId, onSelect, onClose, onHome }) {
  if (docs.length === 0) return null

  return (
    <nav className="flex items-end gap-1 overflow-x-auto border-b border-slate-200 bg-slate-200/70 px-2 pt-1.5" aria-label="열린 도면">
      <button
        onClick={onHome}
        title="홈 (최근 파일)"
        className={`mb-1 flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm ${
          activeId === null ? 'bg-white font-semibold text-blue-700 shadow-sm' : 'text-slate-600 hover:bg-white/70'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" />
        </svg>
        <span className="hidden sm:inline">홈</span>
      </button>

      {docs.map((d) => {
        const active = d.id === activeId
        return (
          <div
            key={d.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(d.id)}
            onAuxClick={(e) => e.button === 1 && onClose(d.id)}
            title={d.name}
            className={`group flex h-9 max-w-56 shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 pr-1.5 pl-3 text-sm ${
              active
                ? 'border-slate-200 bg-white font-medium text-slate-900'
                : 'border-transparent text-slate-600 hover:bg-white/60'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M6 2h9l5 5v15H6z" />
              <path d="M15 2v5h5" />
            </svg>
            <span className="truncate">{d.name.replace(/\.pdf$/i, '')}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(d.id)
              }}
              title="탭 닫기 (측정값은 저장되어 있어요)"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 ${
                active ? '' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )
      })}

      <button
        onClick={onHome}
        title="다른 도면 열기"
        className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg text-slate-500 hover:bg-white/70 hover:text-slate-800"
      >
        +
      </button>
    </nav>
  )
}
