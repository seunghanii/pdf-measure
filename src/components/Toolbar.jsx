import { useRef } from 'react'

const TOOLS = [
  { id: 'select', label: '선택', key: 'V', icon: 'M5 3l14 8-6 2-3 6z' },
  { id: 'pan', label: '이동', key: 'H', icon: 'M8 13V5a1.5 1.5 0 013 0v6m0-1V4a1.5 1.5 0 013 0v6m0-1V5.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L4 13.5a1.5 1.5 0 012.5-1.6L8 14' },
  { id: 'calibrate', label: '기준 길이', key: 'C', icon: 'M3 17L17 3M3 17l3 0M3 17l0-3M17 3l-3 0M17 3l0 3', accent: 'orange' },
  { id: 'length', label: '길이', key: 'L', icon: 'M3 12h18M3 8v8M21 8v8' },
  { id: 'area', label: '면적', key: 'A', icon: 'M4 6l8-3 8 5-2 11H6z' },
  { id: 'angle', label: '각도', key: 'G', icon: 'M4 20h16M4 20L16 5M10 20a6 6 0 00-2-4.5' },
]

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export default function Toolbar({
  onOpenFile,
  pdfDoc,
  pageNum,
  setPageNum,
  zoom,
  setZoom,
  onFit,
  tool,
  setTool,
  calibrated,
  canUndo,
  onUndo,
}) {
  const inputRef = useRef(null)
  const numPages = pdfDoc?.numPages ?? 0

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 32 32" className="h-6 w-6">
          <rect x="2" y="10" width="28" height="12" rx="2" fill="#2563eb" />
          <path d="M7 10v5M12 10v7M17 10v5M22 10v7M27 10v5" stroke="#fff" strokeWidth="1.6" />
        </svg>
        <span className="hidden font-bold sm:inline">PDF 도면 측정기</span>
      </div>

      <button
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        onClick={() => inputRef.current?.click()}
      >
        PDF 열기
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          onOpenFile([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />

      {pdfDoc && (
        <>
          <Divider />
          <div className="flex items-center gap-1" role="group" aria-label="측정 도구">
            {TOOLS.map((t) => {
              const active = tool === t.id
              const needCal = !calibrated && t.id === 'calibrate'
              return (
                <button
                  key={t.id}
                  title={`${t.label} (${t.key})`}
                  onClick={() => setTool(t.id)}
                  className={[
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition',
                    active
                      ? t.accent === 'orange'
                        ? 'bg-orange-500 text-white'
                        : 'bg-slate-800 text-white'
                      : needCal
                        ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-300 hover:bg-orange-100'
                        : 'text-slate-700 hover:bg-slate-100',
                  ].join(' ')}
                >
                  <Icon d={t.icon} />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              )
            })}
          </div>

          <button
            className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={onUndo}
            disabled={!canUndo}
            title="되돌리기 (Ctrl+Z)"
          >
            ↶<span className="hidden sm:inline"> 되돌리기</span>
          </button>

          <div className="ml-auto flex items-center gap-3">
            {numPages > 1 && (
              <div className="flex items-center gap-1 text-sm">
                <SmallButton onClick={() => setPageNum(Math.max(1, pageNum - 1))} disabled={pageNum <= 1}>
                  ‹
                </SmallButton>
                <input
                  className="w-10 rounded border border-slate-300 px-1 py-0.5 text-center"
                  value={pageNum}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (n >= 1 && n <= numPages) setPageNum(n)
                  }}
                />
                <span className="text-slate-500">/ {numPages}</span>
                <SmallButton onClick={() => setPageNum(Math.min(numPages, pageNum + 1))} disabled={pageNum >= numPages}>
                  ›
                </SmallButton>
              </div>
            )}
            <div className="flex items-center gap-1 text-sm">
              <SmallButton onClick={() => setZoom(Math.max(0.1, zoom / 1.25))} title="축소 (-)">
                −
              </SmallButton>
              <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
              <SmallButton onClick={() => setZoom(Math.min(8, zoom * 1.25))} title="확대 (+)">
                +
              </SmallButton>
              <button className="ml-1 rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={onFit}>
                맞춤
              </button>
            </div>
          </div>
        </>
      )}
    </header>
  )
}

function Divider() {
  return <div className="hidden h-6 w-px bg-slate-200 md:block" />
}

function SmallButton({ children, ...props }) {
  return (
    <button
      className="flex h-7 w-7 items-center justify-center rounded-md text-base text-slate-700 hover:bg-slate-100 disabled:opacity-30"
      {...props}
    >
      {children}
    </button>
  )
}
