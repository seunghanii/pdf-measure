// 도면 화면 왼쪽 아래에 늘 떠 있는 메모장 단추. 누르면 홈 메모장(같은 글, 같은 저장)이 그 위에 떠서 바로 고칠 수 있음.
// 도면을 스크롤해도 단추는 제자리 (스크롤 칸 바깥, 도면 칸 위에 얹음). 크기는 오른쪽 위 모서리를 끌어 조절하고 이 브라우저에 기억.
import { lazy, Suspense, useRef, useState } from 'react'

const HomeNotepad = lazy(() => import('./HomeNotepad'))

const SIZE_KEY = 'pdf-measure:notepad-float-size'
const MIN_W = 260
const MIN_H = 220

function loadSize() {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY))
    return v && v.w > 0 && v.h > 0 ? { w: v.w, h: v.h } : null
  } catch {
    return null
  }
}

function saveSize(size) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size))
  } catch {
    // 저장 못 해도 이번 창에서는 그대로
  }
}

export function NotepadIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6M8 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2M9 11l2 2 4-4M9 17h6" />
    </svg>
  )
}

export default function NotepadFloat({ store, open, setOpen, hideButton = false }) {
  const [size, setSize] = useState(loadSize)
  const panelRef = useRef(null)

  // 왼쪽 아래가 붙어 있으니 오른쪽 위 모서리를 끌면 너비·높이가 함께 바뀜
  const startResize = (e) => {
    e.preventDefault()
    const panel = panelRef.current
    const box = panel?.parentElement?.getBoundingClientRect()
    if (!panel || !box) return
    const r = panel.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    let next = { w: r.width, h: r.height }
    const move = (ev) => {
      const w = Math.min(box.right - r.left - 12, Math.max(MIN_W, r.width + ev.clientX - sx))
      const h = Math.min(r.bottom - box.top - 12, Math.max(MIN_H, r.height - (ev.clientY - sy)))
      next = { w: Math.round(w), h: Math.round(h) }
      setSize(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      saveSize(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          style={size ? { width: size.w, height: size.h } : undefined}
          className={`absolute bottom-[4.25rem] left-4 z-30 flex max-h-[calc(100%-5.25rem)] max-w-[calc(100%-2rem)] flex-col rounded-xl shadow-2xl ${size ? '' : 'h-[26rem] w-[22rem]'}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            }
          }}
          // 메모장 위에 끌어 놓은 파일이 도면 사진으로 들어가지 않게
          onDragOver={(e) => e.stopPropagation()}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <Suspense fallback={<div className="flex-1 rounded-xl bg-surface p-4 text-sm text-ink-400 ring-1 ring-ink-200">불러오는 중…</div>}>
            <HomeNotepad store={store} className="flex-1" onClose={() => setOpen(false)} />
          </Suspense>
          <div onPointerDown={startResize} className="absolute -top-1 -right-1 h-4 w-4 cursor-nesw-resize touch-none" title="끌어서 크기 조절" />
        </div>
      )}
      {!hideButton && (
        <button
          onClick={() => setOpen(!open)}
          className={`absolute bottom-4 left-4 z-30 flex h-11 w-11 items-center justify-center rounded-full shadow-lg ring-1 transition-colors ${
            open ? 'bg-brand-600 text-white ring-brand-700 hover:bg-brand-700' : 'bg-surface text-brand-600 ring-ink-200 hover:bg-ink-50'
          }`}
          title={open ? '메모장 닫기' : '메모장 열기 (홈 메모장)'}
          aria-label={open ? '메모장 닫기' : '메모장 열기'}
          aria-pressed={open}
        >
          <NotepadIcon />
        </button>
      )}
    </>
  )
}
