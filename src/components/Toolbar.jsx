import { useRef } from 'react'
import { TOOLS, digitForTool } from '../lib/tools'
import { toggleSnap, useSnapEnabled } from '../lib/snapSetting'
import { DEFAULT_BOX_OPACITY, HIGHLIGHT_COLORS, MARKUP_COLORS, STROKE_TYPES, STROKE_WIDTHS, TEXT_SIZES } from '../lib/markup'

const MARKUP_TOOL_IDS = TOOLS.filter((t) => t.group === 'markup').map((t) => t.id)

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
  selectedHasStroke, // 선택한 것 중에 사각형·화살표·펜이 있으면 굵기도 보여 줌
  onSave,
  saving,
  syncStatus, // 서버 저장 상태: 'saved' | 'saving' | 'error' (로그인했을 때만)
  right, // 홈 화면 오른쪽 (계정)
}) {
  const inputRef = useRef(null)
  const numPages = pdfDoc?.numPages ?? 0

  return (
    <header className="relative z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 32 32" className="h-6 w-6">
          <rect x="2" y="10" width="28" height="12" rx="2" fill="#2563eb" />
          <path d="M7 10v5M12 10v7M17 10v5M22 10v7M27 10v5" stroke="#fff" strokeWidth="1.6" />
        </svg>
        <span className="hidden font-bold xl:inline">PDF 도면 측정기</span>
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
            <SnapButton />
          </div>
          <Divider />
          <div className="flex items-center gap-1" role="group" aria-label="마크업 도구">
            {TOOLS.filter((t) => t.group === 'markup').map((t) => (
              <ToolButton key={t.id} t={t} active={tool === t.id} onClick={() => setTool(t.id)} />
            ))}
          </div>
          <button
            className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={onUndo}
            disabled={!canUndo}
            title="되돌리기 (Ctrl+Z)"
          >
            ↶<span className="hidden min-[1600px]:inline"> 되돌리기</span>
          </button>

          <div className="ml-auto flex items-center gap-3">
            {syncStatus && <SyncBadge status={syncStatus} />}
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
      {right && <div className="ml-auto">{right}</div>}
      {/* 마크업 설정 바: 마크업 도구를 골랐거나, 선택 도구로 마크업을 골랐을 때 툴바 아래에 떠서 보임 (도면을 밀어내지 않음) */}
      {pdfDoc && (MARKUP_TOOL_IDS.includes(tool) || (tool === 'select' && selectedMarkupType)) && (
        <div className="absolute top-full left-1/2 z-20 mt-2 max-w-[calc(100%-1rem)] -translate-x-1/2">
          <MarkupStyle
            kind={selectedMarkupType && tool === 'select' ? selectedMarkupType : tool}
            title={tool === 'select' ? '선택한 마크업' : TOOLS.find((t) => t.id === tool)?.label}
            style={markupStyle}
            onChange={onChangeMarkupStyle}
            showStroke={selectedHasStroke}
          />
        </div>
      )}
    </header>
  )
}

function SyncBadge({ status }) {
  const look = {
    saved: ['text-slate-400', '서버에 저장됨', 'M7 18a4 4 0 01-.5-8 6 6 0 0111.5 1.5A3.5 3.5 0 0117.5 18zM9.5 13.5l2 2 3.5-3.5'],
    saving: ['text-blue-600', '저장 중…', 'M7 18a4 4 0 01-.5-8 6 6 0 0111.5 1.5A3.5 3.5 0 0117.5 18z'],
    error: ['text-red-600', '서버 저장 실패', 'M7 18a4 4 0 01-.5-8 6 6 0 0111.5 1.5A3.5 3.5 0 0117.5 18zM12 11v3M12 16.5v.01'],
  }[status]
  return (
    <span
      className={`flex items-center gap-1 text-xs whitespace-nowrap ${look[0]}`}
      title={status === 'error' ? '인터넷 연결을 확인하세요. 다음 변경 때 다시 저장을 시도해요.' : '측정값과 마크업은 자동으로 서버에 저장돼요'}
    >
      <Icon d={look[2]} />
      <span className="hidden min-[2000px]:inline">{look[1]}</span>
    </span>
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

// 자석 켜고 끄기: 켜져 있으면 도면 선의 끝점·교차점·선 위와 찍은 점에 붙음
function SnapButton() {
  const on = useSnapEnabled()
  return (
    <button
      onClick={toggleSnap}
      aria-pressed={on}
      title={on ? '자석 켜짐: 선 끝점·교차점·선 위에 붙어요. 누르면 꺼짐 (S)' : '자석 꺼짐: 누르면 선에 붙게 켜요 (S)'}
      className={[
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition',
        on ? 'bg-pink-50 text-pink-700 ring-1 ring-pink-300 hover:bg-pink-100' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
      ].join(' ')}
    >
      <Icon d={on ? 'M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4zM6 8h4M14 8h4' : 'M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4zM3 3l18 18'} />
      <span className="hidden min-[1600px]:inline">자석</span>
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
      {showLabel ? <span className="hidden min-[1600px]:inline">{t.label}</span> : <span className="hidden min-[1800px]:inline">{t.label}</span>}
    </button>
  )
}

// 텍스트 정렬 버튼: [값, 이름, 아이콘]
const ALIGN_BUTTONS = [
  ['left', '왼쪽', 'M4 6h16M4 10h10M4 14h16M4 18h10'],
  ['center', '가운데', 'M4 6h16M7 10h10M4 14h16M7 18h10'],
  ['right', '오른쪽', 'M4 6h16M10 10h10M4 14h16M10 18h10'],
]

// 마크업 색상, 선 굵기, 글자 크기, 텍스트 상자 배경 투명도
function MarkupStyle({ kind, title, style, onChange, showStroke }) {
  const isHighlight = kind === 'highlight'
  const colors = isHighlight ? HIGHLIGHT_COLORS : MARKUP_COLORS
  const current = isHighlight ? style.highlightColor : style.color
  // 예전에 저장된 크기처럼 목록에 없는 값도 그대로 보이게
  const sizes = TEXT_SIZES.includes(style.fontSize) ? TEXT_SIZES : [...TEXT_SIZES, style.fontSize].sort((a, b) => a - b)
  const widths = STROKE_WIDTHS.includes(style.strokeWidth) ? STROKE_WIDTHS : [...STROKE_WIDTHS, style.strokeWidth].sort((a, b) => a - b)
  const transparency = Math.round((1 - (style.boxOpacity ?? DEFAULT_BOX_OPACITY)) * 100)
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-md backdrop-blur">
      {title && <span className="mr-1.5 text-xs font-semibold whitespace-nowrap text-slate-700">{title}</span>}
      {colors.map((c) => (
        <button
          key={c}
          title="색상"
          onClick={() => onChange(isHighlight ? { highlightColor: c } : { color: c })}
          className={`h-5 w-5 rounded-full border border-black/10 ${current === c ? 'ring-2 ring-slate-700 ring-offset-1' : ''}`}
          style={{ background: c }}
        />
      ))}
      {(STROKE_TYPES.includes(kind) || showStroke) && (
        <label className="ml-2 flex items-center gap-1 text-xs text-slate-600" title="선 굵기 (pt). 화살촉은 굵기에 맞춰 커져요">
          굵기
          <select
            value={style.strokeWidth}
            onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs tabular-nums"
          >
            {widths.map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100) / 100}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 24 12" className="h-3 w-6" aria-hidden="true">
            <line x1="2" y1="6" x2="22" y2="6" stroke={style.color} strokeWidth={Math.min(10, Math.max(0.75, style.strokeWidth))} strokeLinecap="round" />
          </svg>
        </label>
      )}
      {kind === 'text' && (
        <>
          <label className="ml-2 flex items-center gap-1 text-xs text-slate-600" title="글자 크기 (pt)">
            크기
            <select
              value={style.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs tabular-nums"
            >
              {sizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-2 flex items-center rounded border border-slate-300 bg-white" role="group" aria-label="정렬">
            {ALIGN_BUTTONS.map(([value, label, d]) => (
              <button
                key={value}
                title={`${label} 정렬`}
                aria-pressed={(style.textAlign ?? 'left') === value}
                onClick={() => onChange({ textAlign: value })}
                className={`flex h-6 w-6 items-center justify-center first:rounded-l last:rounded-r ${
                  (style.textAlign ?? 'left') === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon d={d} />
              </button>
            ))}
          </div>
          <label className="ml-2 flex items-center gap-1 text-xs whitespace-nowrap text-slate-600" title="텍스트 상자 배경 투명도 (100% = 배경 없음)">
            배경 투명도
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={transparency}
              onChange={(e) => onChange({ boxOpacity: 1 - Number(e.target.value) / 100 }, { live: true })}
              className="w-20 accent-slate-700"
            />
            <span className="w-8 text-right tabular-nums">{transparency}%</span>
          </label>
        </>
      )}
    </div>
  )
}
