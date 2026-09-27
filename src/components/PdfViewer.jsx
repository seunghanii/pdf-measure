import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { distance, snapTo45 } from '../lib/geometry'
import { TYPE_INFO } from '../lib/measure'
import MeasurementShape from './MeasurementShape'

const MAX_CANVAS_PIXELS = 16_000_000 // 모바일 사파리 캔버스 한도 근처
const CLOSE_RADIUS_PX = 10 // 면적: 첫 점 근처 클릭 시 닫기

export default function PdfViewer({
  pdfDoc,
  pageNum,
  zoom,
  onZoom,
  fitKey,
  tool,
  measurements,
  calibration,
  selectedId,
  onSelect,
  onComplete,
  onMovePoint,
  mmPerPt,
  unit,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const svgRef = useRef(null)
  const [pageSize, setPageSize] = useState(null) // 배율 1 기준 pt
  const [rendering, setRendering] = useState(false)
  const [draft, setDraft] = useState([])
  const [cursor, setCursor] = useState(null)
  const [shiftDown, setShiftDown] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const dragRef = useRef(null) // { id, index } 점 이동 중
  const panRef = useRef(null) // { x, y, left, top } 화면 이동 중
  const zoomAnchorRef = useRef(null)
  const [, forceRender] = useState(0)

  // ---------- 페이지 로드 ----------
  const pageRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    pdfDoc.getPage(pageNum).then((page) => {
      if (cancelled) return
      pageRef.current = page
      const vp = page.getViewport({ scale: 1 })
      setPageSize({ width: vp.width, height: vp.height })
    })
    return () => {
      cancelled = true
    }
  }, [pdfDoc, pageNum])

  // "화면에 맞춤": 새 파일을 열거나 맞춤 버튼을 누를 때
  const pageWidth = pageSize?.width
  const pageHeight = pageSize?.height
  useEffect(() => {
    const el = containerRef.current
    if (!el || !pageWidth) return
    const fit = Math.min((el.clientWidth - 48) / pageWidth, (el.clientHeight - 48) / pageHeight)
    onZoom(Math.max(0.1, Math.min(8, fit)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, pageWidth, pageHeight])

  // 페이지/도구가 바뀌면 그리던 것은 취소
  useEffect(() => {
    setDraft([])
  }, [pageNum, tool, pdfDoc])

  // ---------- 캔버스 렌더링 (확대 중에는 잠깐 기다렸다가 선명하게 다시 그림) ----------
  useEffect(() => {
    const page = pageRef.current
    if (!page || !pageSize) return
    let task = null
    const timer = setTimeout(() => {
      const canvas = canvasRef.current
      const dpr = window.devicePixelRatio || 1
      let scale = zoom * dpr
      const pixels = pageSize.width * pageSize.height * scale * scale
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
      const viewport = page.getViewport({ scale })
      const off = document.createElement('canvas')
      off.width = Math.floor(viewport.width)
      off.height = Math.floor(viewport.height)
      setRendering(true)
      task = page.render({ canvas: off, canvasContext: off.getContext('2d'), viewport })
      task.promise
        .then(() => {
          // 다 그린 뒤 한 번에 교체해서 깜빡임 방지
          canvas.width = off.width
          canvas.height = off.height
          canvas.getContext('2d').drawImage(off, 0, 0)
          setRendering(false)
        })
        .catch(() => {})
    }, 120)
    return () => {
      clearTimeout(timer)
      if (task) task.cancel()
    }
  }, [pageSize, zoom])

  // ---------- 확대/축소 시 마우스 위치 고정 ----------
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    const el = containerRef.current
    if (!anchor || !el) return
    el.scrollLeft = anchor.pageX * zoom - anchor.offsetX
    el.scrollTop = anchor.pageY * zoom - anchor.offsetY
    zoomAnchorRef.current = null
  }, [zoom])

  const zoomAt = useCallback(
    (nextZoom, clientX, clientY) => {
      const el = containerRef.current
      const svg = svgRef.current
      if (!el || !svg) return onZoom(nextZoom)
      const rect = el.getBoundingClientRect()
      const svgRect = svg.getBoundingClientRect()
      const cx = clientX ?? rect.left + rect.width / 2
      const cy = clientY ?? rect.top + rect.height / 2
      zoomAnchorRef.current = {
        pageX: (cx - svgRect.left) / zoom,
        pageY: (cy - svgRect.top) / zoom,
        offsetX: cx - rect.left - (svgRect.left - rect.left + el.scrollLeft),
        offsetY: cy - rect.top - (svgRect.top - rect.top + el.scrollTop),
      }
      onZoom(nextZoom)
    },
    [onZoom, zoom],
  )

  // Ctrl(⌘) + 휠 = 확대/축소 (브라우저 확대 대신)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0025)
      zoomAt(Math.min(8, Math.max(0.1, zoom * factor)), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, zoomAt])

  // ---------- 좌표 변환 ----------
  const toPage = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
  }

  const drawing = tool === 'length' || tool === 'area' || tool === 'angle' || tool === 'calibrate'

  const constrained = (p) => {
    if (!shiftDown || draft.length === 0) return p
    return snapTo45(draft[draft.length - 1], p)
  }

  const finish = useCallback(
    (points) => {
      onComplete(tool, points)
      setDraft([])
    },
    [onComplete, tool],
  )

  const finishArea = useCallback(() => {
    if (tool === 'area' && draft.length >= 3) finish(draft)
  }, [draft, finish, tool])

  // ---------- 키보드 ----------
  useEffect(() => {
    const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
    const down = (e) => {
      if (e.key === 'Shift') setShiftDown(true)
      if (isTyping(e)) return
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceDown(true)
      }
      if (e.key === 'Escape') setDraft([])
      if (e.key === 'Enter') finishArea()
      if (e.key === 'Backspace' && draft.length > 0) {
        e.preventDefault()
        setDraft((d) => d.slice(0, -1))
      }
    }
    const up = (e) => {
      if (e.key === 'Shift') setShiftDown(false)
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [draft.length, finishArea])

  // ---------- 마우스 ----------
  const panning = tool === 'pan' || spaceDown

  const onPointerDown = (e) => {
    if (e.button === 1 || (e.button === 0 && panning)) {
      e.preventDefault()
      const el = containerRef.current
      panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
      e.currentTarget.setPointerCapture(e.pointerId)
      forceRender((n) => n + 1)
      return
    }
    if (e.button !== 0) return

    // 선택 도구: 점 잡아서 옮기기 / 도형 선택
    const handle = e.target.closest?.('[data-handle]')
    if (tool === 'select') {
      if (handle) {
        dragRef.current = { id: handle.dataset.id, index: Number(handle.dataset.index) }
        onSelect(handle.dataset.id)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      const shape = e.target.closest?.('[data-shape]')
      onSelect(shape ? shape.dataset.shape : null)
      return
    }

    if (!drawing) return
    const p = constrained(toPage(e))

    if (tool === 'area' && draft.length >= 3) {
      const first = draft[0]
      if (distance(first, p) * zoom < CLOSE_RADIUS_PX) return finish(draft)
    }
    // 더블클릭으로 생기는 중복 점 무시
    if (draft.length > 0 && distance(draft[draft.length - 1], p) * zoom < 3) return

    const next = [...draft, p]
    const need = TYPE_INFO[tool].need
    if (need && next.length >= need) finish(next)
    else setDraft(next)
  }

  const onPointerMove = (e) => {
    if (panRef.current) {
      const el = containerRef.current
      el.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x)
      el.scrollTop = panRef.current.top - (e.clientY - panRef.current.y)
      return
    }
    const p = toPage(e)
    if (dragRef.current) {
      onMovePoint(dragRef.current.id, dragRef.current.index, p)
      return
    }
    if (drawing) setCursor(constrained(p))
  }

  const onPointerUp = () => {
    if (panRef.current) {
      panRef.current = null
      forceRender((n) => n + 1)
    }
    dragRef.current = null
  }

  if (!pageSize) {
    return <div className="flex flex-1 items-center justify-center bg-slate-200 text-slate-500">페이지 불러오는 중…</div>
  }

  const w = pageSize.width * zoom
  const h = pageSize.height * zoom
  const cursorStyle = panRef.current ? 'grabbing' : panning ? 'grab' : drawing ? 'crosshair' : 'default'

  // 그리는 중인 도형 미리보기
  let preview = null
  if (drawing && draft.length > 0 && cursor) {
    const pts = [...draft, cursor]
    const closeHint = tool === 'area' && draft.length >= 3 && distance(draft[0], cursor) * zoom < CLOSE_RADIUS_PX
    preview = (
      <MeasurementShape
        m={{ id: 'draft', type: tool, points: closeHint ? draft : pts }}
        zoom={zoom}
        mmPerPt={mmPerPt}
        unit={unit}
        draft
        closeHint={closeHint}
      />
    )
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-auto bg-slate-200"
      onPointerLeave={() => setCursor(null)}
    >
      <div className="inline-block min-w-full p-6 text-center">
        <div className="relative inline-block bg-white text-left shadow-lg" style={{ width: w, height: h }}>
          <canvas ref={canvasRef} className="absolute inset-0" style={{ width: w, height: h }} />
          <svg
            ref={svgRef}
            width={w}
            height={h}
            className="absolute inset-0 touch-none select-none"
            style={{ cursor: cursorStyle }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={finishArea}
            onContextMenu={(e) => {
              if (drawing && draft.length) {
                e.preventDefault()
                setDraft((d) => d.slice(0, -1))
              }
            }}
          >
            {calibration && calibration.page === pageNum && (
              <MeasurementShape
                m={{ id: 'calibration', type: 'calibrate', points: calibration.points, label: calibration.label }}
                zoom={zoom}
                selected={selectedId === 'calibration'}
                showHandles={tool === 'select'}
              />
            )}
            {measurements.map((m) => (
              <MeasurementShape
                key={m.id}
                m={m}
                zoom={zoom}
                mmPerPt={mmPerPt}
                unit={unit}
                selected={selectedId === m.id}
                showHandles={tool === 'select'}
              />
            ))}
            {preview}
            {drawing && cursor && !preview && (
              <circle cx={cursor.x * zoom} cy={cursor.y * zoom} r={3} fill={TYPE_INFO[tool].color} />
            )}
          </svg>
          {rendering && (
            <div className="pointer-events-none absolute top-2 right-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
              그리는 중…
            </div>
          )}
        </div>
      </div>
    </div>
      {drawing && <DrawHint tool={tool} count={draft.length} />}
    </div>
  )
}

function DrawHint({ tool, count }) {
  let text = ''
  if (tool === 'calibrate') text = count === 0 ? '도면에서 길이를 아는 선의 시작점을 클릭하세요' : '끝점을 클릭하세요 (Shift: 수평/수직 고정)'
  if (tool === 'length') text = count === 0 ? '시작점을 클릭하세요' : '끝점을 클릭하세요 (Shift: 수평/수직 고정)'
  if (tool === 'angle')
    text = count === 0 ? '첫 번째 선 끝점을 클릭하세요' : count === 1 ? '꼭짓점(각의 중심)을 클릭하세요' : '두 번째 선 끝점을 클릭하세요'
  if (tool === 'area')
    text =
      count < 3
        ? '꼭짓점을 차례로 클릭하세요'
        : '계속 클릭하거나, 첫 점 클릭 / 더블클릭 / Enter 로 완료 (Backspace: 한 점 취소)'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="rounded-full bg-slate-900/80 px-4 py-1.5 text-center text-sm text-white shadow">
        {text} <span className="text-slate-400">· Esc 취소</span>
      </div>
    </div>
  )
}
