import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_ZOOM = 8

// 사진 크게 보기. 휠·+/− 버튼으로 확대(마우스 위치 기준), 끌어서 이동, 더블클릭으로 확대/맞춤,
// ←/→ 로 다른 사진, Esc 로 닫기.
// urls: 사진 주소 목록 (아직 못 불러온 것은 null)
export default function PhotoViewer({ urls, index, onIndex, onClose }) {
  const boxRef = useRef(null)
  // { s: 맞춤 대비 배율, x, y: 왼쪽 위 위치(px), fit: 화면 맞춤 배율, w, h: 사진 원래 크기 }
  const [view, setView] = useState(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  const url = urls[index]

  // 화면에 맞춘 기본 크기로
  const fitView = useCallback((w, h) => {
    const el = boxRef.current
    if (!el || !w) return
    const pad = 48
    const fit = Math.min(1, (el.clientWidth - pad * 2) / w, (el.clientHeight - pad * 2) / h)
    setView({ s: 1, x: (el.clientWidth - w * fit) / 2, y: (el.clientHeight - h * fit) / 2, fit, w, h })
  }, [])
  const reset = useCallback(() => view && fitView(view.w, view.h), [view, fitView])

  // (cx, cy) 를 고정한 채 배율 바꾸기 (맞춤보다 작게는 안 됨)
  const zoomTo = useCallback((next, cx, cy) => {
    const el = boxRef.current
    if (!el) return
    setView((v) => {
      if (!v) return v
      const s = Math.min(MAX_ZOOM / v.fit, Math.max(1, next(v.s)))
      if (s === 1) return { ...v, s, x: (el.clientWidth - v.w * v.fit) / 2, y: (el.clientHeight - v.h * v.fit) / 2 }
      const px = cx ?? el.clientWidth / 2
      const py = cy ?? el.clientHeight / 2
      return { ...v, s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s }
    })
  }, [])

  // 휠은 이 화면 안에서만 (뒤의 도면이 확대되지 않게)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002))
      zoomTo((s) => s * k, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  // 키보드: 다른 단축키보다 먼저 받음
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && index < urls.length - 1) onIndex(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      else if (e.key === '+' || e.key === '=') zoomTo((s) => s * 1.5)
      else if (e.key === '-') zoomTo((s) => s / 1.5)
      else if (e.key === '0') reset()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, urls.length, onClose, onIndex, zoomTo, reset])

  useEffect(() => {
    const onResize = () => reset()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [reset])

  const zoomed = view && view.s > 1.001
  const btn = 'flex h-9 min-w-9 items-center justify-center rounded-full bg-white/10 px-2 text-white hover:bg-white/25 disabled:opacity-30'

  return (
    <div
      ref={boxRef}
      className="fixed inset-0 z-50 touch-none overflow-hidden bg-black/90 select-none"
      style={{ cursor: dragging ? 'grabbing' : zoomed ? 'grab' : 'zoom-in' }}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.target.closest('button')) return
        drag.current = { x: e.clientX, y: e.clientY, vx: view?.x ?? 0, vy: view?.y ?? 0, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (!d.moved && Math.hypot(dx, dy) < 3) return
        if (!d.moved) setDragging(true)
        d.moved = true
        if (zoomed) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        setDragging(false)
        if (!d || d.moved) return
        // 사진 밖 빈 곳을 누르면 닫기
        if (!e.target.closest('img')) onClose()
      }}
      onDoubleClick={(e) => {
        if (e.target.closest('button')) return
        const r = e.currentTarget.getBoundingClientRect()
        if (zoomed) reset()
        else zoomTo(() => 2.5, e.clientX - r.left, e.clientY - r.top)
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => fitView(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          className="absolute top-0 left-0 max-w-none origin-top-left"
          style={
            view
              ? { width: view.w * view.fit, height: view.h * view.fit, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }
              : { opacity: 0 }
          }
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">사진 불러오는 중…</div>
      )}

      <div className="absolute top-3 right-3 flex items-center gap-2">
        <span className="mr-1 text-sm text-white/70 tabular-nums">{view ? `${Math.round(view.fit * view.s * 100)}%` : ''}</span>
        <button className={btn} title="축소 (−)" onClick={() => zoomTo((s) => s / 1.5)}>
          −
        </button>
        <button className={btn} title="확대 (+)" onClick={() => zoomTo((s) => s * 1.5)}>
          +
        </button>
        <button className={`${btn} text-sm`} title="화면에 맞춤 (0)" onClick={reset}>
          맞춤
        </button>
        <button className={btn} title="닫기 (Esc)" onClick={onClose}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {urls.length > 1 && (
        <>
          <button className={`${btn} absolute top-1/2 left-3 -translate-y-1/2 text-xl`} disabled={index === 0} onClick={() => onIndex(index - 1)} title="이전 사진 (←)">
            ‹
          </button>
          <button
            className={`${btn} absolute top-1/2 right-3 -translate-y-1/2 text-xl`}
            disabled={index === urls.length - 1}
            onClick={() => onIndex(index + 1)}
            title="다음 사진 (→)"
          >
            ›
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm text-white/80 tabular-nums">
            {index + 1} / {urls.length}
          </div>
        </>
      )}
      {!zoomed && <div className="pointer-events-none absolute bottom-4 left-4 text-xs text-white/50">휠이나 더블클릭으로 확대, 끌어서 이동</div>}
    </div>
  )
}
