import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { distance, snapTo45 } from '../lib/geometry'
import { TYPE_INFO } from '../lib/measure'
import MeasurementShape from './MeasurementShape'
import { DRAG_TOOLS, textBoxMetrics, FONT_FAMILY } from '../lib/markup'

const MAX_CANVAS_PIXELS = 16_000_000 // 모바일 사파리 캔버스 한도 근처
const CLOSE_RADIUS_PX = 10 // 면적: 첫 점 / 길이: 마지막 점 근처 클릭 시 완료
const PAGE_GAP = 16
const PAD = 24

// 모든 페이지를 위아래로 이어 붙여 보여 주는 뷰어. 화면에 보이는 페이지만 캔버스에 그립니다.
export default function PdfViewer({
  pdfDoc,
  pageNum,
  onPageChange,
  jump,
  zoom,
  onZoom,
  fitKey,
  fittedKey,
  onFitted,
  tool,
  measurements,
  calibration,
  selectedId,
  onSelect,
  onComplete,
  onMovePoint,
  onSetPoints,
  onBeginEdit,
  onUpdateItem,
  markupStyle,
  mmPerPt,
  unit,
}) {
  const containerRef = useRef(null)
  const pageEls = useRef([])
  const [sizes, setSizes] = useState(null) // 페이지별 배율 1 기준 크기(pt)
  const [draft, setDraft] = useState(null) // { page, points }
  const [cursor, setCursor] = useState(null) // { page, p }
  const [shiftDown, setShiftDown] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [visible, setVisible] = useState(() => new Set())
  const dragRef = useRef(null) // 점 하나 { id, index } 또는 도형 전체 { id, whole, start, orig } 이동 중
  const [editing, setEditing] = useState(null) // 텍스트 입력 중 { page, point, id?, text, fontSize, color }
  const panRef = useRef(null) // { x, y, left, top } 화면 이동 중
  const zoomAnchorRef = useRef(null) // 확대/축소 후에도 같은 지점을 같은 자리에
  const viewAnchorRef = useRef(null) // 현재 화면 가운데에 있는 페이지 위치
  const [, forceRender] = useState(0)

  // ---------- 모든 페이지 크기 불러오기 ----------
  useEffect(() => {
    let cancelled = false
    const pages = Array.from({ length: pdfDoc.numPages }, (_, i) => pdfDoc.getPage(i + 1))
    Promise.all(pages).then((list) => {
      if (cancelled) return
      setSizes(
        list.map((page) => {
          const vp = page.getViewport({ scale: 1 })
          return { width: vp.width, height: vp.height }
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [pdfDoc])

  // 위치 계산 도우미: 화면 좌표 ↔ 페이지 좌표
  const anchorAt = useCallback(
    (clientX, clientY) => {
      const el = containerRef.current
      if (!el || !sizes) return null
      const rect = el.getBoundingClientRect()
      const cx = clientX ?? rect.left + rect.width / 2
      const cy = clientY ?? rect.top + rect.height / 2
      // 세로로 가장 가까운 페이지
      let best = 0
      let bestDist = Infinity
      pageEls.current.forEach((pe, i) => {
        if (!pe) return
        const r = pe.getBoundingClientRect()
        const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      })
      const pr = pageEls.current[best]?.getBoundingClientRect()
      if (!pr) return null
      return {
        page: best,
        pageX: (cx - pr.left) / zoom,
        pageY: (cy - pr.top) / zoom,
        offsetX: cx - rect.left,
        offsetY: cy - rect.top,
      }
    },
    [sizes, zoom],
  )

  const restoreAnchor = useCallback((anchor, z) => {
    const el = containerRef.current
    const pe = pageEls.current[anchor?.page]
    if (!el || !pe) return
    const rect = el.getBoundingClientRect()
    const pr = pe.getBoundingClientRect()
    el.scrollLeft += pr.left + anchor.pageX * z - (rect.left + anchor.offsetX)
    el.scrollTop += pr.top + anchor.pageY * z - (rect.top + anchor.offsetY)
  }, [])

  // ---------- 확대/축소: 마우스 위치(없으면 화면 가운데)를 고정 ----------
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current ?? viewAnchorRef.current
    zoomAnchorRef.current = null
    if (anchor) restoreAnchor(anchor, zoom)
    viewAnchorRef.current = anchorAt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const zoomAt = useCallback(
    (nextZoom, clientX, clientY) => {
      zoomAnchorRef.current = anchorAt(clientX, clientY)
      onZoom(nextZoom)
    },
    [anchorAt, onZoom],
  )

  // Ctrl(⌘) + 휠 / 트랙패드 핀치 = PDF 만 확대/축소.
  // 창 전체에서 가로채서 툴바·목록 위에서 휠을 굴려도 브라우저 화면 확대가 되지 않게 합니다.
  const wheelRef = useRef(null)
  useLayoutEffect(() => {
    wheelRef.current = { zoom, zoomAt }
  })
  useEffect(() => {
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const { zoom: z, zoomAt: at } = wheelRef.current
      const el = containerRef.current
      const inside = el && el.contains(e.target)
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025))
      at(Math.min(8, Math.max(0.1, z * factor)), inside ? e.clientX : undefined, inside ? e.clientY : undefined)
    }
    // 사파리 트랙패드 핀치
    const onGesture = (e) => e.preventDefault()
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('gesturestart', onGesture)
    window.addEventListener('gesturechange', onGesture)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('gesturestart', onGesture)
      window.removeEventListener('gesturechange', onGesture)
    }
  }, [])

  // ---------- 화면에 맞춤 (새 파일을 열거나 맞춤 버튼) ----------
  useEffect(() => {
    const el = containerRef.current
    if (!el || !sizes || fitKey === fittedKey) return
    const s = sizes[Math.max(0, pageNum - 1)] ?? sizes[0]
    const fit = Math.min((el.clientWidth - PAD * 2) / s.width, (el.clientHeight - PAD * 2) / s.height)
    viewAnchorRef.current = { page: pageNum - 1, pageX: s.width / 2, pageY: 0, offsetX: el.clientWidth / 2, offsetY: PAD }
    onZoom(Math.max(0.1, Math.min(8, fit)))
    onFitted(fitKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fittedKey, sizes])

  // ---------- 페이지 이동 요청(툴바, 측정 목록) ----------
  const lastJump = useRef(null)
  useEffect(() => {
    if (!sizes || !jump || lastJump.current === jump.nonce) return
    const el = containerRef.current
    const pe = pageEls.current[jump.page - 1]
    if (!el || !pe) return
    lastJump.current = jump.nonce
    el.scrollTop += pe.getBoundingClientRect().top - el.getBoundingClientRect().top - PAD
    viewAnchorRef.current = anchorAt()
  }, [jump, sizes, anchorAt])

  // ---------- 스크롤: 현재 페이지 번호 갱신 ----------
  const scrollRaf = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(scrollRaf.current)
    scrollRaf.current = requestAnimationFrame(() => {
      const a = anchorAt()
      if (!a) return
      viewAnchorRef.current = a
      if (a.page + 1 !== pageNum) onPageChange(a.page + 1)
    })
  }

  // ---------- 보이는 페이지만 그리기 ----------
  useEffect(() => {
    const root = containerRef.current
    if (!root || !sizes) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const en of entries) {
            const i = Number(en.target.dataset.page)
            if (en.isIntersecting) next.add(i)
            else next.delete(i)
          }
          return next
        })
      },
      { root, rootMargin: '400px 0px' },
    )
    pageEls.current.forEach((pe) => pe && io.observe(pe))
    return () => io.disconnect()
  }, [sizes])

  // 도구를 바꾸면 그리던 것은 취소
  useEffect(() => {
    setDraft(null)
  }, [tool, pdfDoc])

  // ---------- 텍스트 상자 입력 ----------
  const editingRef = useRef(null)
  useLayoutEffect(() => {
    editingRef.current = editing
  })
  const commitText = useCallback(() => {
    const ed = editingRef.current
    editingRef.current = null // blur 와 Enter 가 겹쳐도 한 번만 저장
    setEditing(null)
    if (!ed) return
    const text = ed.text.replace(/\s+$/, '')
    if (ed.id) {
      if (text && text !== ed.original) {
        onBeginEdit()
        onUpdateItem(ed.id, { text })
      }
    } else if (text) {
      onComplete('text', [ed.point], ed.page, { text, fontSize: ed.fontSize, color: ed.color })
    }
  }, [onBeginEdit, onComplete, onUpdateItem])

  const editExisting = (id) => {
    const item = measurements.find((m) => m.id === id)
    if (!item || item.type !== 'text') return
    onSelect(id)
    setEditing({
      page: item.page,
      point: item.points[0],
      id,
      text: item.text,
      original: item.text,
      fontSize: item.fontSize ?? markupStyle.fontSize,
      color: item.color,
    })
  }

  const drawing = tool === 'length' || tool === 'area' || tool === 'angle' || tool === 'calibrate'
  const multi = tool === 'length' || tool === 'area' // 원하는 만큼 점을 찍는 도구
  const draftPts = draft?.points ?? []

  const constrained = (p) => {
    if (!shiftDown || draftPts.length === 0) return p
    return snapTo45(draftPts[draftPts.length - 1], p)
  }

  const finish = useCallback(
    (d) => {
      onComplete(tool, d.points, d.page)
      setDraft(null)
    },
    [onComplete, tool],
  )

  const finishMulti = useCallback(() => {
    if (!draft) return
    if (tool === 'area' && draft.points.length >= 3) finish(draft)
    if (tool === 'length' && draft.points.length >= 2) finish(draft)
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
      if (e.key === 'Escape') setDraft(null)
      if (e.key === 'Enter') finishMulti()
      if (e.key === 'Backspace' && draft) {
        e.preventDefault()
        setDraft((d) => (d && d.points.length > 1 ? { ...d, points: d.points.slice(0, -1) } : null))
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
  }, [draft, finishMulti])

  // ---------- 마우스 ----------
  const panning = tool === 'pan' || spaceDown

  const toPage = (e, svg) => {
    const rect = svg.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
  }

  const onPointerDown = (e, page) => {
    if (e.button === 1 || (e.button === 0 && panning)) {
      e.preventDefault()
      const el = containerRef.current
      panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
      e.currentTarget.setPointerCapture(e.pointerId)
      forceRender((n) => n + 1)
      return
    }
    if (e.button !== 0) return

    // 선택 도구: 점 잡아서 옮기기 / 도형 통째로 옮기기 / 선택
    if (tool === 'select') {
      const handle = e.target.closest?.('[data-handle]')
      if (handle) {
        dragRef.current = { id: handle.dataset.id, index: Number(handle.dataset.index), moved: false }
        onSelect(handle.dataset.id)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      const shape = e.target.closest?.('[data-shape]')
      const id = shape?.dataset.shape ?? null
      onSelect(id)
      const item = id && measurements.find((m) => m.id === id)
      if (item) {
        dragRef.current = { id, whole: true, start: toPage(e, e.currentTarget), orig: item.points, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      return
    }

    // 형광펜·펜·사각형·화살표: 누른 채 끌어서 그리기
    if (DRAG_TOOLS.includes(tool)) {
      const p = toPage(e, e.currentTarget)
      setDraft({ page, points: tool === 'pen' ? [p] : [p, p], dragging: true })
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    // 텍스트: 클릭한 곳에 입력 상자 (기존 텍스트를 누르면 고치기)
    if (tool === 'text') {
      e.preventDefault()
      if (editing) return commitText()
      const existing = e.target.closest?.('[data-type="text"]')
      if (existing) return editExisting(existing.dataset.shape)
      setEditing({
        page,
        point: toPage(e, e.currentTarget),
        text: '',
        fontSize: markupStyle.fontSize,
        color: markupStyle.color,
      })
      return
    }

    if (!drawing) return
    if (draft && draft.page !== page) return // 그리던 도형은 한 페이지 안에서만
    const p = constrained(toPage(e, e.currentTarget))
    const pts = draftPts
    const near = (q) => distance(q, p) * zoom < CLOSE_RADIUS_PX

    if (tool === 'area' && pts.length >= 3 && near(pts[0])) return finish(draft)
    if (tool === 'length' && pts.length >= 2 && near(pts[pts.length - 1])) return finish(draft)
    // 더블클릭으로 생기는 중복 점 무시
    if (pts.length > 0 && distance(pts[pts.length - 1], p) * zoom < 3) return

    const next = { page, points: [...pts, p] }
    const need = multi ? null : TYPE_INFO[tool].need
    if (need && next.points.length >= need) finish(next)
    else setDraft(next)
  }

  const onPointerMove = (e, page) => {
    if (panRef.current) {
      const el = containerRef.current
      el.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x)
      el.scrollTop = panRef.current.top - (e.clientY - panRef.current.y)
      return
    }
    const p = toPage(e, e.currentTarget)
    const d = dragRef.current
    if (d) {
      if (d.whole) {
        const dx = p.x - d.start.x
        const dy = p.y - d.start.y
        if (!d.moved) {
          if (Math.hypot(dx, dy) * zoom < 3) return // 단순 클릭은 선택만
          d.moved = true
          onBeginEdit()
        }
        onSetPoints(d.id, d.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })))
      } else {
        if (!d.moved) {
          d.moved = true
          onBeginEdit()
        }
        onMovePoint(d.id, d.index, p)
      }
      return
    }
    if (draft?.dragging) {
      setDraft((dr) => {
        if (!dr) return dr
        if (tool === 'pen') {
          const last = dr.points[dr.points.length - 1]
          return distance(last, p) * zoom > 2 ? { ...dr, points: [...dr.points, p] } : dr
        }
        const q = shiftDown && tool === 'arrow' ? snapTo45(dr.points[0], p) : p
        return { ...dr, points: [dr.points[0], q] }
      })
      return
    }
    if (drawing) setCursor({ page, p: draft && draft.page === page ? constrained(p) : p })
  }

  const onPointerUp = () => {
    if (panRef.current) {
      panRef.current = null
      forceRender((n) => n + 1)
    }
    dragRef.current = null
    if (draft?.dragging) {
      const pts = draft.points
      const big = tool === 'pen' ? pts.length > 1 : distance(pts[0], pts[pts.length - 1]) * zoom > 4
      if (big) onComplete(tool, pts, draft.page)
      setDraft(null)
    }
  }

  if (!sizes) {
    return <div className="flex flex-1 items-center justify-center bg-slate-200 text-slate-500">페이지 불러오는 중…</div>
  }

  const cursorStyle = panRef.current
    ? 'grabbing'
    : panning
      ? 'grab'
      : tool === 'text'
        ? 'text'
        : drawing || DRAG_TOOLS.includes(tool)
          ? 'crosshair'
          : 'default'

  // 그리는 중인 도형 미리보기
  const renderPreview = (page) => {
    if (draft?.dragging && draft.page === page) {
      const color = tool === 'highlight' ? markupStyle.highlightColor : markupStyle.color
      return <MeasurementShape m={{ id: 'draft', type: tool, points: draft.points, color }} zoom={zoom} draft />
    }
    if (!drawing || !draft || draft.page !== page) return null
    const c = cursor && cursor.page === page ? cursor.p : null
    const pts = draft.points
    const closeArea = c && tool === 'area' && pts.length >= 3 && distance(pts[0], c) * zoom < CLOSE_RADIUS_PX
    const endLength = c && tool === 'length' && pts.length >= 2 && distance(pts[pts.length - 1], c) * zoom < CLOSE_RADIUS_PX
    const shown = c && !closeArea && !endLength ? [...pts, c] : pts
    return (
      <MeasurementShape
        m={{ id: 'draft', type: tool, points: shown }}
        zoom={zoom}
        mmPerPt={mmPerPt}
        unit={unit}
        draft
        closeHint={closeArea}
        endHint={endLength}
      />
    )
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-auto bg-slate-200"
        onScroll={onScroll}
        onPointerLeave={() => setCursor(null)}
      >
        <div className="flex min-w-full flex-col items-center" style={{ padding: PAD, gap: PAGE_GAP, width: 'max-content' }}>
          {sizes.map((size, i) => {
            const page = i + 1
            const w = size.width * zoom
            const h = size.height * zoom
            return (
              <div
                key={page}
                ref={(el) => (pageEls.current[i] = el)}
                data-page={i}
                className="relative shrink-0 bg-white shadow-lg"
                style={{ width: w, height: h }}
              >
                <PageCanvas pdfDoc={pdfDoc} page={page} size={size} zoom={zoom} visible={visible.has(i)} />
                {editing && editing.page === page && (
                  <TextEditor editing={editing} zoom={zoom} onChange={(text) => setEditing((ed) => ({ ...ed, text }))} onCommit={commitText} onCancel={() => setEditing(null)} />
                )}
                <svg
                  width={w}
                  height={h}
                  className="absolute inset-0 touch-none select-none"
                  style={{ cursor: cursorStyle }}
                  onPointerDown={(e) => onPointerDown(e, page)}
                  onPointerMove={(e) => onPointerMove(e, page)}
                  onPointerUp={onPointerUp}
                  onDoubleClick={(e) => {
                    if (tool === 'select') {
                      // 포인터 캡처 때문에 e.target 이 svg 일 수 있어 좌표로 다시 찾음
                      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-type="text"]')
                      if (t) editExisting(t.dataset.shape)
                    } else finishMulti()
                  }}
                  onContextMenu={(e) => {
                    if (drawing && draft) {
                      e.preventDefault()
                      setDraft((d) => (d && d.points.length > 1 ? { ...d, points: d.points.slice(0, -1) } : null))
                    }
                  }}
                >
                  {calibration && calibration.page === page && (
                    <MeasurementShape
                      m={{ id: 'calibration', type: 'calibrate', points: calibration.points, label: calibration.label }}
                      zoom={zoom}
                      selected={selectedId === 'calibration'}
                      showHandles={tool === 'select'}
                    />
                  )}
                  {measurements
                    .filter((m) => m.page === page && m.id !== editing?.id)
                    .map((m) => (
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
                  {renderPreview(page)}
                  {drawing && cursor && cursor.page === page && !(draft && draft.page === page) && (
                    <circle cx={cursor.p.x * zoom} cy={cursor.p.y * zoom} r={3} fill={TYPE_INFO[tool].color} />
                  )}
                </svg>
                {sizes.length > 1 && (
                  <div className="pointer-events-none absolute -bottom-px left-1/2 translate-y-full -translate-x-1/2 pt-0.5 text-[11px] text-slate-500">
                    {page} / {sizes.length}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {sizes.length > 1 && (
        <div className="pointer-events-none absolute top-3 right-4 rounded-full bg-slate-900/70 px-3 py-1 text-sm text-white shadow">
          {pageNum} / {sizes.length} 페이지
        </div>
      )}
      {drawing && <DrawHint tool={tool} count={draftPts.length} />}
    </div>
  )
}

// 페이지 한 장의 캔버스. 화면 근처에 있을 때만 그리고, 멀어지면 메모리를 비웁니다.
function PageCanvas({ pdfDoc, page, size, zoom, visible }) {
  const canvasRef = useRef(null)
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible) {
      canvas.width = 0
      canvas.height = 0
      return
    }
    let task = null
    let cancelled = false
    const timer = setTimeout(async () => {
      const pdfPage = await pdfDoc.getPage(page)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      let scale = zoom * dpr
      const pixels = size.width * size.height * scale * scale
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
      const viewport = pdfPage.getViewport({ scale })
      const off = document.createElement('canvas')
      off.width = Math.floor(viewport.width)
      off.height = Math.floor(viewport.height)
      setRendering(true)
      task = pdfPage.render({ canvas: off, canvasContext: off.getContext('2d'), viewport })
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
      cancelled = true
      clearTimeout(timer)
      if (task) task.cancel()
    }
  }, [pdfDoc, page, size, zoom, visible])

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: size.width * zoom, height: size.height * zoom }} />
      {visible && rendering && (
        <div className="pointer-events-none absolute top-2 right-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
          그리는 중…
        </div>
      )}
    </>
  )
}

function DrawHint({ tool, count }) {
  let text = ''
  if (tool === 'calibrate') text = count === 0 ? '도면에서 길이를 아는 선의 시작점을 클릭하세요' : '끝점을 클릭하세요 (Shift: 수평/수직 고정)'
  if (tool === 'length')
    text =
      count === 0
        ? '시작점을 클릭하세요'
        : count === 1
          ? '다음 점을 클릭하세요 (Shift: 수평/수직 고정)'
          : '계속 클릭해 이어 가거나, 마지막 점 다시 클릭 / 더블클릭 / Enter 로 완료'
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

// 도면 위 텍스트 상자 입력창. Enter 로 완료, Shift+Enter 로 줄바꿈, Esc 로 취소.
function TextEditor({ editing, zoom, onChange, onCommit, onCancel }) {
  const ref = useRef(null)
  const openedAt = useRef(0)
  useEffect(() => {
    openedAt.current = performance.now()
    const t = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const size = editing.fontSize
  const box = textBoxMetrics(editing.text || '텍스트 입력', size)
  return (
    <textarea
      ref={ref}
      value={editing.text}
      placeholder="텍스트 입력"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onCommit()
        }
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        if (performance.now() - openedAt.current > 150) onCommit()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
      className="absolute z-10 resize-none overflow-hidden rounded-sm border border-dashed bg-white/95 outline-none"
      style={{
        left: editing.point.x * zoom,
        top: editing.point.y * zoom,
        width: Math.max(box.width * zoom + 8, 80),
        height: box.height * zoom + 2,
        fontSize: size * zoom,
        lineHeight: 1.3,
        padding: `${box.pad * zoom}px`,
        color: editing.color,
        borderColor: editing.color,
        fontFamily: FONT_FAMILY,
      }}
    />
  )
}
