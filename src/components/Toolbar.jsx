import { useRef } from 'react'
import { TOOLS, digitForTool } from '../lib/tools'
import { HIGHLIGHT_COLORS, MARKUP_COLORS, TEXT_SIZES } from '../lib/markup'

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
  markupStyle,
  onChangeMarkupStyle,
  selectedMarkupType,
  onSave,
  saving,
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
            {TOOLS.filter((t) => t.group !== 'markup').map((t) => (
              <ToolButton key={t.id} t={t} active={tool === t.id} needCal={!calibrated && t.id === 'calibrate'} onClick={() => setTool(t.id)} showLabel />
            ))}
          </div>
          <Divider />
          <div className="flex items-center gap-1" role="group" aria-label="마크업 도구">
            {TOOLS.filter((t) => t.group === 'markup').map((t) => (
              <ToolButton key={t.id} t={t} active={tool === t.id} onClick={() => setTool(t.id)} />
            ))}
          </div>
          {(['highlight', 'text', 'pen', 'rect', 'arrow'].includes(tool) || selectedMarkupType) && (
            <MarkupStyle
              kind={selectedMarkupType && tool === 'select' ? selectedMarkupType : tool}
              style={markupStyle}
              onChange={onChangeMarkupStyle}
            />
          )}

          <button
            className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={onUndo}
            disabled={!canUndo}
            title="되돌리기 (Ctrl+Z)"
          >
            ↶<span className="hidden sm:inline"> 되돌리기</span>
          </button>

          <div className="ml-auto flex items-center gap-3">
            <button
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={onSave}
              disabled={saving}
              title="마크업과 측정을 그려 넣은 PDF로 저장 (Ctrl+S)"
            >
              <Icon d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              <span className="hidden sm:inline">{saving ? '저장 중…' : 'PDF 저장'}</span>
            </button>
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

function ToolButton({ t, active, needCal, onClick, showLabel }) {
  const digit = digitForTool(t.id)
  return (
    <button
      title={`${t.label} (${digit ? `${digit} 또는 ` : ''}${t.key})`}
      onClick={onClick}
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
      {showLabel ? <span className="hidden sm:inline">{t.label}</span> : <span className="hidden 2xl:inline">{t.label}</span>}
    </button>
  )
}

// 마크업 색상, 글자 크기
function MarkupStyle({ kind, style, onChange }) {
  const isHighlight = kind === 'highlight'
  const colors = isHighlight ? HIGHLIGHT_COLORS : MARKUP_COLORS
  const current = isHighlight ? style.highlightColor : style.color
  return (
    <div className="flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-1">
      {colors.map((c) => (
        <button
          key={c}
          title="색상"
          onClick={() => onChange(isHighlight ? { highlightColor: c } : { color: c })}
          className={`h-5 w-5 rounded-full border border-black/10 ${current === c ? 'ring-2 ring-slate-700 ring-offset-1' : ''}`}
          style={{ background: c }}
        />
      ))}
      {kind === 'text' && (
        <select
          value={style.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          className="ml-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
          title="글자 크기"
        >
          {TEXT_SIZES.map((s) => (
            <option key={s.id} value={s.pt}>
              {s.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
