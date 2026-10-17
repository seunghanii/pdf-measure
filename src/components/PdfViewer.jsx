import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { distance, snapTo45 } from '../lib/geometry'
import { TYPE_INFO } from '../lib/measure'
import MeasurementShape from './MeasurementShape'
import { DRAG_TOOLS, textBoxMetrics, textMetricsOf, minTextBoxWidth, FONT_FAMILY, itemCorners, rectOf, resizeRect, isMarkup } from '../lib/markup'
import { SNAP_KINDS, findRaySnap, findSnap, loadSnapIndex } from '../lib/snap'
import { useSnapEnabled } from '../lib/snapSetting'

const MAX_CANVAS_PIXELS = 16_000_000 // 모바일 사파리 캔버스 한도 근처
const CLOSE_RADIUS_PX = 10 // 면적: 첫 점 / 길이: 마지막 점 근처 클릭 시 완료
const SNAP_RADIUS_PX = 12 // 자석: 화면에서 이 거리 안이면 붙음
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
  selectedIds,
  onSelect, // (ids 배열)
  onComplete,
  onMovePoint,
  onSetPoints,
  onBeginEdit,
  onUpdateItem,
  onEditCalibration, // 기준선 더블클릭: 길이 숫자 고치기
  markupStyle,
  mmPerPt,
  unit,
}) {
  const containerRef = useRef(null)
  const pageEls = useRef([])
  const [sizes, setSizes] = useState(null) // 페이지별 배율 1 기준 크기(pt)
  const [draft, setDraft] = useState(null) // { page, points }
  const [cursor, setCursor] = useState(null) // { page, p, snap? }
  const [shiftDown, setShiftDown] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [visible, setVisible] = useState(() => new Set())
  const dragRef = useRef(null) // 점 하나 { id, index } 또는 도형 전체 { id, whole, start, orig } 이동 중
  const [editing, setEditing] = useState(null) // 텍스트 입력 중 { page, point, id?, text, fontSize, color }
  const [marquee, setMarquee] = useState(null) // 드래그 선택 상자 { page, a, b, additive }
  const panRef = useRef(null) // { x, y, left, top } 화면 이동 중
  const zoomAnchorRef = useRef(null) // 확대/축소 후에도 같은 지점을 같은 자리에
  const viewAnchorRef = useRef(null) // 현재 화면 가운데에 있는 페이지 위치
  const [, forceRender] = useState(0)
  const snapOn = useSnapEnabled()
  const snapIndexes = useRef(new Map()) // 페이지 번호 → 도면 선 색인 (자석용, 필요할 때 한 번 읽음)

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

  useEffect(() => {
    snapIndexes.current = new Map()
  }, [pdfDoc])

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
      onComplete('text', [ed.point], ed.page, { text, fontSize: ed.fontSize, color: ed.color, align: ed.align })
    }
  }, [onBeginEdit, onComplete, onUpdateItem])

  const editExisting = (id) => {
    const item = measurements.find((m) => m.id === id)
    if (!item || item.type !== 'text') return
    onSelect([id])
    setEditing({
      page: item.page,
      point: item.points[0],
      id,
      text: item.text,
      original: item.text,
      fontSize: item.fontSize ?? markupStyle.fontSize,
      color: item.color,
      align: item.align,
      boxWidth: item.boxWidth,
    })
  }

  const drawing = tool === 'length' || tool === 'area' || tool === 'angle' || tool === 'calibrate'
  const multi = tool === 'length' || tool === 'area' // 원하는 만큼 점을 찍는 도구
  const draftPts = draft?.points ?? []

  const constrained = (p) => {
    if (!shiftDown || draftPts.length === 0) return p
    return snapTo45(draftPts[draftPts.length - 1], p)
  }

  // ---------- 자석 ----------
  const snapIndexFor = (page) => {
    const map = snapIndexes.current
    if (!map.has(page)) {
      map.set(page, null) // 읽는 중
      loadSnapIndex(pdfDoc, page).then((index) => {
        if (snapIndexes.current !== map) return // 그사이 다른 파일
        map.set(page, index)
        forceRender((n) => n + 1)
      })
    }
    return map.get(page)
  }

  // 붙을 수 있는 측정 점: 측정·기준선·그리는 중인 점 (exclude: 지금 끌고 있는 점 { id, index })
  const snapTargets = (page, exclude) => {
    const pts = []
    const add = (id, points) =>
      points.forEach((q, i) => {
        if (!(exclude && exclude.id === id && exclude.index === i)) pts.push(q)
      })
    for (const m of measurements) if (m.page === page && !isMarkup(m.type)) add(m.id, m.points)
    if (calibration && calibration.page === page) add('calibration', calibration.points)
    if (draft && draft.page === page && !draft.dragging) add('draft', draft.points)
    return pts
  }

  // 커서 위치 → 실제로 찍힐 점. Shift 를 누르면 방향을 고정한 채 그 방향의 선에 붙음
  const resolvePoint = (raw, page, { exclude } = {}) => {
    const locked = shiftDown && draft && draft.page === page && draftPts.length > 0
    const p = locked ? constrained(raw) : raw
    if (!snapOn) return { p, snap: null }
    const opts = { index: snapIndexFor(page), points: snapTargets(page, exclude) }
    const r = SNAP_RADIUS_PX / zoom
    const s = locked ? findRaySnap(draftPts[draftPts.length - 1], p, r, opts) : findSnap(p, r, opts)
    return s ? { p: { x: s.x, y: s.y }, snap: s } : { p, snap: null }
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
      if (handle?.dataset.resize) {
        // 사각형·형광펜 크기 조절: 잡은 순간의 사각형 기준으로 계산
        const item = measurements.find((m) => m.id === handle.dataset.id)
        if (item?.type === 'text') {
          // 텍스트 상자 너비 조절: 반대쪽 변은 그대로
          const left = item.points[0].x
          const right = left + textMetricsOf(item).width
          dragRef.current = { id: item.id, resize: handle.dataset.resize, text: { left, right, y: item.points[0].y, min: minTextBoxWidth(item.fontSize ?? 13) }, moved: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        } else if (item) {
          dragRef.current = { id: item.id, resize: handle.dataset.resize, rect: rectOf(item.points[0], item.points[1] ?? item.points[0]), moved: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        return
      }
      if (handle) {
        dragRef.current = { id: handle.dataset.id, index: Number(handle.dataset.index), moved: false }
        onSelect([handle.dataset.id])
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      const shape = e.target.closest?.('[data-shape]')
      const id = shape?.dataset.shape ?? null
      const start = toPage(e, e.currentTarget)
      if (id) {
        // Shift/Ctrl+클릭: 선택에 더하거나 빼기
        if (additive) {
          onSelect(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
          return
        }
        // 이미 선택된 것을 잡으면 선택된 것 전부를 함께 옮김
        const group = selectedIds.includes(id) ? selectedIds : [id]
        if (!selectedIds.includes(id)) onSelect([id])
        const orig = {}
        for (const m of measurements) if (group.includes(m.id)) orig[m.id] = m.points
        if (Object.keys(orig).length) {
          dragRef.current = { whole: true, start, orig, moved: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        return
      }
      // 빈 곳을 끌면 상자 안의 항목을 한꺼번에 선택
      setMarquee({ page, a: start, b: start, additive })
      e.currentTarget.setPointerCapture(e.pointerId)
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
        align: markupStyle.textAlign,
      })
      return
    }

    if (!drawing) return
    if (draft && draft.page !== page) return // 그리던 도형은 한 페이지 안에서만
    const { p } = resolvePoint(toPage(e, e.currentTarget), page)
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
        const next = {}
        for (const [id, pts] of Object.entries(d.orig)) next[id] = pts.map((q) => ({ x: q.x + dx, y: q.y + dy }))
        onSetPoints(next)
      } else if (d.resize) {
        if (!d.moved) {
          d.moved = true
          onBeginEdit()
        }
        if (d.text) {
          const t = d.text
          const left = d.resize === 'w' ? Math.min(p.x, t.right - t.min) : t.left
          const right = d.resize === 'e' ? Math.max(p.x, t.left + t.min) : t.right
          onUpdateItem(d.id, { points: [{ x: left, y: t.y }], boxWidth: right - left })
        } else onSetPoints({ [d.id]: resizeRect(d.rect, d.resize, p) })
      } else {
        if (!d.moved) {
          d.moved = true
          onBeginEdit()
        }
        const r = resolvePoint(p, page, { exclude: { id: d.id, index: d.index } })
        onMovePoint(d.id, d.index, r.p)
        setCursor(r.snap ? { page, p: r.p, snap: r.snap } : null)
      }
      return
    }
    if (marquee) {
      setMarquee((mq) => (mq ? { ...mq, b: p } : mq))
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
    if (drawing) {
      const r = resolvePoint(p, page)
      setCursor({ page, p: r.p, snap: r.snap })
    }
  }

  const onPointerUp = () => {
    if (panRef.current) {
      panRef.current = null
      forceRender((n) => n + 1)
    }
    if (dragRef.current && !drawing) setCursor(null) // 점 끌기 때 보이던 자석 표시 지우기
    dragRef.current = null
    if (marquee) {
      const r = rectOf(marquee.a, marquee.b)
      let ids = []
      if (r.w * zoom > 3 || r.h * zoom > 3) {
        const inside = (q) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h
        // 점(텍스트는 상자 모서리) 하나라도 상자 안에 들어오면 선택
        ids = measurements.filter((m) => m.page === marquee.page && itemCorners(m).some(inside)).map((m) => m.id)
      }
      onSelect(marquee.additive ? [...new Set([...selectedIds, ...ids])] : ids)
      setMarquee(null)
    }
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
      return <MeasurementShape m={{ id: 'draft', type: tool, points: draft.points, color, strokeWidth: markupStyle.strokeWidth }} zoom={zoom} draft />
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
                <PageCanvas pdfDoc={pdfDoc} page={page} size={size} zoom={zoom} visible={visible.has(i)} scrollRoot={containerRef} />
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
                      const hit = document.elementFromPoint(e.clientX, e.clientY)
                      const t = hit?.closest('[data-type="text"]')
                      if (t) editExisting(t.dataset.shape)
                      else if (hit?.closest('[data-shape="calibration"]')) onEditCalibration()
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
                      selected={selectedIds.includes('calibration')}
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
                        selected={selectedIds.includes(m.id)}
                        showHandles={tool === 'select'}
                      />
                    ))}
                  {renderPreview(page)}
                  {marquee && marquee.page === page && (() => {
                    const r = rectOf(marquee.a, marquee.b)
                    return (
                      <rect
                        x={r.x * zoom}
                        y={r.y * zoom}
                        width={r.w * zoom}
                        height={r.h * zoom}
                        fill="#3b82f6"
                        fillOpacity={0.08}
                        stroke="#2563eb"
                        strokeDasharray="5 3"
                        pointerEvents="none"
                      />
                    )
                  })()}
                  {drawing && cursor && cursor.page === page && !(draft && draft.page === page) && (
                    <circle cx={cursor.p.x * zoom} cy={cursor.p.y * zoom} r={3} fill={TYPE_INFO[tool].color} />
                  )}
                  {cursor?.snap && cursor.page === page && <SnapMarker snap={cursor.snap} zoom={zoom} />}
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
// 크게 확대하면 페이지 전체를 선명하게 그릴 캔버스가 너무 커지므로, 전체는 낮은 해상도로 깔고
// 화면에 보이는 부분만 원래 해상도로 한 번 더 그려 위에 덮습니다(상세 캔버스).
function PageCanvas({ pdfDoc, page, size, zoom, visible, scrollRoot }) {
  const canvasRef = useRef(null)
  const detailRef = useRef(null)
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const detail = detailRef.current
    detail.style.display = 'none' // 이전 배율의 상세 그림은 위치가 맞지 않음
    if (!visible) {
      canvas.width = 0
      canvas.height = 0
      detail.width = 0
      detail.height = 0
      return
    }
    let task = null
    let detailTask = null
    let detailTimer = null
    let detailArea = null // 지금 상세 캔버스가 덮고 있는 영역(CSS px)
    let cancelled = false
    const dpr = window.devicePixelRatio || 1
    const fullScale = zoom * dpr
    const fullPixels = size.width * size.height * fullScale * fullScale
    const capped = fullPixels > MAX_CANVAS_PIXELS
    const pdfPagePromise = pdfDoc.getPage(page)

    const timer = setTimeout(async () => {
      const pdfPage = await pdfPagePromise
      if (cancelled) return
      const scale = capped ? fullScale * Math.sqrt(MAX_CANVAS_PIXELS / fullPixels) : fullScale
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
          // 캔버스 픽셀과 화면 픽셀을 1:1 로 맞춰서 브라우저가 다시 늘리며 흐려지지 않게
          if (!capped) {
            canvas.style.width = `${off.width / dpr}px`
            canvas.style.height = `${off.height / dpr}px`
          }
          setRendering(false)
          if (capped) scheduleDetail(0)
        })
        .catch(() => {})
    }, 120)

    // 화면에 보이는 부분(+ 여유)을 원래 해상도로 그립니다.
    const renderDetail = async () => {
      const root = scrollRoot.current
      const pageEl = canvas.parentElement
      if (!root || !pageEl || cancelled) return
      const rr = root.getBoundingClientRect()
      const pr = pageEl.getBoundingClientRect()
      const w = size.width * zoom
      const h = size.height * zoom
      // 보이는 영역을 페이지 좌표(CSS px)로
      const vx0 = Math.max(0, rr.left - pr.left)
      const vy0 = Math.max(0, rr.top - pr.top)
      const vx1 = Math.min(w, rr.right - pr.left)
      const vy1 = Math.min(h, rr.bottom - pr.top)
      if (vx1 <= vx0 || vy1 <= vy0) return
      // 이미 덮고 있으면 다시 그릴 필요 없음
      const a = detailArea
      if (a && vx0 >= a.x0 && vy0 >= a.y0 && vx1 <= a.x1 && vy1 <= a.y1) return
      // 스크롤해도 바로 다시 그리지 않도록 사방으로 여유를 두되, 캔버스 한도는 넘지 않게
      let mx = (vx1 - vx0) * 0.5
      let my = (vy1 - vy0) * 0.5
      const area = (vx1 - vx0 + 2 * mx) * (vy1 - vy0 + 2 * my) * dpr * dpr
      if (area > MAX_CANVAS_PIXELS) {
        const k = Math.sqrt(MAX_CANVAS_PIXELS / area)
        const cw = (vx1 - vx0 + 2 * mx) * k
        const ch = (vy1 - vy0 + 2 * my) * k
        mx = Math.max(0, (cw - (vx1 - vx0)) / 2)
        my = Math.max(0, (ch - (vy1 - vy0)) / 2)
      }
      const x0 = Math.floor(Math.max(0, vx0 - mx) * dpr) / dpr
      const y0 = Math.floor(Math.max(0, vy0 - my) * dpr) / dpr
      const x1 = Math.min(w, vx1 + mx)
      const y1 = Math.min(h, vy1 + my)
      const pw = Math.ceil((x1 - x0) * dpr)
      const ph = Math.ceil((y1 - y0) * dpr)
      if (pw * ph > MAX_CANVAS_PIXELS * 1.05) return // 화면 자체가 너무 큰 경우

      const pdfPage = await pdfPagePromise
      if (cancelled) return
      if (detailTask) detailTask.cancel()
      const viewport = pdfPage.getViewport({ scale: fullScale })
      const off = document.createElement('canvas')
      off.width = pw
      off.height = ph
      detailTask = pdfPage.render({
        canvas: off,
        canvasContext: off.getContext('2d'),
        viewport,
        transform: [1, 0, 0, 1, -x0 * dpr, -y0 * dpr],
      })
      const myTask = detailTask
      myTask.promise
        .then(() => {
          if (cancelled) return
          detail.width = pw
          detail.height = ph
          detail.getContext('2d').drawImage(off, 0, 0)
          detail.style.left = `${x0}px`
          detail.style.top = `${y0}px`
          detail.style.width = `${pw / dpr}px`
          detail.style.height = `${ph / dpr}px`
          detail.style.display = 'block'
          detailArea = { x0, y0, x1: x0 + pw / dpr, y1: y0 + ph / dpr }
        })
        .catch(() => {})
    }
    const scheduleDetail = (delay = 150) => {
      clearTimeout(detailTimer)
      detailTimer = setTimeout(renderDetail, delay)
    }
    const root = scrollRoot.current
    const onScroll = () => scheduleDetail()
    if (capped && root) {
      root.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll)
    }

    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(detailTimer)
      if (task) task.cancel()
      if (detailTask) detailTask.cancel()
      if (capped && root) {
        root.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onScroll)
      }
    }
  }, [pdfDoc, page, size, zoom, visible, scrollRoot])

  return (
    <>
      <canvas ref={canvasRef} className="absolute top-0 left-0" style={{ width: size.width * zoom, height: size.height * zoom }} />
      <canvas ref={detailRef} className="pointer-events-none absolute" style={{ display: 'none' }} />
      {visible && rendering && (
        <div className="pointer-events-none absolute top-2 right-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
          그리는 중…
        </div>
      )}
    </>
  )
}

// 자석이 붙은 곳 표시: 끝점·측정점 □, 교차점 ×, 선 위 ◇
function SnapMarker({ snap, zoom }) {
  const x = snap.x * zoom
  const y = snap.y * zoom
  const s = 6
  const color = '#db2777'
  const common = { fill: 'none', stroke: color, strokeWidth: 2 }
  return (
    <g pointerEvents="none">
      {snap.kind === 'cross' ? (
        <path d={`M${x - s} ${y - s}L${x + s} ${y + s}M${x + s} ${y - s}L${x - s} ${y + s}`} {...common} />
      ) : snap.kind === 'line' ? (
        <path d={`M${x} ${y - s - 1}L${x + s + 1} ${y}L${x} ${y + s + 1}L${x - s - 1} ${y}Z`} {...common} />
      ) : (
        <rect x={x - s} y={y - s} width={s * 2} height={s * 2} {...common} />
      )}
      <text
        x={x + s + 4}
        y={y - s - 3}
        fontSize={11}
        fontWeight={600}
        fill={color}
        stroke="#fff"
        strokeWidth={3}
        paintOrder="stroke"
        style={{ fontFamily: FONT_FAMILY }}
      >
        {SNAP_KINDS[snap.kind].label}
      </text>
    </g>
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
  const box = textBoxMetrics(editing.text || '텍스트 입력', size, editing.boxWidth)
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
        // 너비를 정한 상자는 그 너비 그대로 (글자가 넘치면 줄바꿈), 아니면 글자에 맞춰 늘어남
        width: editing.boxWidth ? box.width * zoom : Math.max(box.width * zoom + 8, 80),
        textAlign: editing.align ?? 'left',
        whiteSpace: editing.boxWidth ? 'pre-wrap' : 'pre',
        wordBreak: 'keep-all', // 화면 표시와 같게 낱말 단위로 줄바꿈
        overflowWrap: 'anywhere',
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
