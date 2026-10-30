import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { distance, snapTo45 } from '../lib/geometry'
import { TYPE_INFO } from '../lib/measure'
import MeasurementShape from './MeasurementShape'
import SelectionBox from './SelectionBox'
import PageCanvas from './PageCanvas'
import TextEditor from './TextEditor'
import { isTypingTarget } from '../lib/dom'
import { DRAG_TOOLS, textMetricsOf, minTextBoxWidth, FONT_FAMILY, itemCorners, rectOf, resizeRect, isMarkup, cropOf, cropResize, fullImageRect, resizeKeepAspect } from '../lib/markup'
import { isImageFile } from '../lib/images'
import { memoDrawOrder } from '../lib/memo'
import { SNAP_KINDS, findRaySnap, findSnap, loadSnapIndex } from '../lib/snap'
import { useSnapEnabled } from '../lib/snapSetting'
import { MAX_ZOOM, MIN_ZOOM } from '../lib/zoom'

const CLOSE_RADIUS_PX = 10 // 면적: 첫 점 / 길이: 마지막 점 근처 클릭 시 완료
const SNAP_RADIUS_PX = 12 // 자석: 화면에서 이 거리 안이면 붙음
const PAGE_GAP = 16
const TOUCH_DELAY = 100 // ms: 한 손가락 동작을 이만큼 미뤄서 두 손가락 핀치와 구분
const TOUCH_SLOP = 6 // px: 미뤄 둔 손가락이 이만큼 움직이면 바로 시작
const PAD = 24

// 미뤄 둔 손가락 누름/뗌을 나중에 다시 처리할 때 쓰는 이벤트 대신 객체
function replayEvent(e, svg) {
  return {
    replay: true,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    button: 0,
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    target: e.target,
    currentTarget: {
      getBoundingClientRect: () => svg.getBoundingClientRect(),
      setPointerCapture: (id) => {
        try {
          svg.setPointerCapture(id)
        } catch {
          // 이미 뗀 손가락
        }
      },
    },
    preventDefault() {},
  }
}

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
  croppingId, // 자르는 중인 사진
  onCropImage, // (id) 사진 더블클릭: 자르기 시작
  onDropImages, // (files, clientX, clientY) 사진 파일을 도면에 끌어다 놓음
  placeRef, // 사진 넣을 자리 계산 함수를 여기에 넣어 줌
  onOpenMemo, // (id, page, point, { force }) 메모 범위를 누름
  onDelete, // (ids) 선택 상자의 × 단추
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
  // 페이지별 항목 목록. 바뀌지 않은 페이지는 같은 배열을 그대로 써서 그 페이지 도형은 다시 그리지 않음
  const byPageRef = useRef(new Map())
  const byPage = useMemo(() => {
    const groups = new Map()
    for (const m of measurements) {
      let list = groups.get(m.page)
      if (!list) groups.set(m.page, (list = []))
      list.push(m)
    }
    const prev = byPageRef.current
    const next = new Map()
    for (const [page, list] of groups) {
      // 메모 범위는 다른 항목 아래에, 큰 범위부터 그려서 겹친 작은 범위도 누를 수 있게
      const ordered = [...list.filter((m) => m.type === 'memo').sort(memoDrawOrder), ...list.filter((m) => m.type !== 'memo')]
      const old = prev.get(page)
      next.set(page, old && old.length === ordered.length && old.every((m, i) => m === ordered[i]) ? old : ordered)
    }
    byPageRef.current = next
    return next
  }, [measurements])
  const snapOn = useSnapEnabled()
  const snapIndexes = useRef(new Map()) // 페이지 번호 → 도면 선 색인 (자석용, 필요할 때 한 번 읽음)
  const pointerRef = useRef(null) // 마지막 마우스 위치 { page, p } (붙여넣은 사진을 놓을 자리)

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

  // ---------- 사진 넣을 자리: 끌어다 놓은 곳 → 도면 위 마우스 위치 → 화면 가운데 ----------
  // { page, x, y (가운데, pt), maxW, maxH (화면에 보이는 크기, pt) }
  useLayoutEffect(() => {
    if (!placeRef) return
    placeRef.current = (clientX, clientY) => {
      const el = containerRef.current
      if (!el || !sizes) return null
      let page
      let x
      let y
      if (clientX != null) {
        const a = anchorAt(clientX, clientY)
        if (!a) return null
        ;({ page, pageX: x, pageY: y } = a)
      } else if (pointerRef.current) {
        page = pointerRef.current.page - 1
        ;({ x, y } = pointerRef.current.p)
      } else {
        const a = anchorAt()
        if (!a) return null
        ;({ page, pageX: x, pageY: y } = a)
      }
      const s = sizes[page]
      return {
        page: page + 1,
        x: Math.min(s.width, Math.max(0, x)),
        y: Math.min(s.height, Math.max(0, y)),
        maxW: Math.min(s.width, el.clientWidth / zoom),
        maxH: Math.min(s.height, el.clientHeight / zoom),
      }
    }
  })

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
  const touchesRef = useRef(new Map()) // 화면에 닿은 손가락 pointerId → { x, y }
  useLayoutEffect(() => {
    wheelRef.current = { zoom, zoomAt }
  })
  useEffect(() => {
    const clamp = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
    const inside = (e) => {
      const el = containerRef.current
      return el && el.contains(e.target) && e.clientX != null
    }
    let gesture = null // 사파리 트랙패드 핀치 중 { base }
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (gesture) return // 사파리는 핀치를 gesture 이벤트로 따로 줌
      const { zoom: z, zoomAt: at } = wheelRef.current
      // 트랙패드 핀치(크롬·엣지·파이어폭스)는 작은 값이 자주 옴 → 더 민감하게
      const pinch = e.deltaMode === 0 && Math.abs(e.deltaY) < 50
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : pinch ? 0.01 : 0.0025))
      const inn = inside(e)
      at(clamp(z * factor), inn ? e.clientX : undefined, inn ? e.clientY : undefined)
    }
    // 사파리(맥) 트랙패드 핀치. 아이패드 손가락 핀치는 아래 손가락 처리가 맡음
    const onGestureStart = (e) => {
      e.preventDefault()
      gesture = touchesRef.current.size ? null : { base: wheelRef.current.zoom }
    }
    const onGestureChange = (e) => {
      e.preventDefault()
      if (!gesture || touchesRef.current.size) return
      const { zoom: z, zoomAt: at } = wheelRef.current
      const next = clamp(gesture.base * e.scale)
      const inn = inside(e)
      if (Math.abs(next - z) > 1e-6) at(next, inn ? e.clientX : undefined, inn ? e.clientY : undefined)
    }
    const onGestureEnd = (e) => {
      e.preventDefault()
      gesture = null
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('gesturestart', onGestureStart)
    window.addEventListener('gesturechange', onGestureChange)
    window.addEventListener('gestureend', onGestureEnd)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('gesturestart', onGestureStart)
      window.removeEventListener('gesturechange', onGestureChange)
      window.removeEventListener('gestureend', onGestureEnd)
    }
  }, [])

  // ---------- 화면에 맞춤 (새 파일을 열거나 맞춤 버튼) ----------
  useEffect(() => {
    const el = containerRef.current
    if (!el || !sizes || fitKey === fittedKey) return
    const s = sizes[Math.max(0, pageNum - 1)] ?? sizes[0]
    const fit = Math.min((el.clientWidth - PAD * 2) / s.width, (el.clientHeight - PAD * 2) / s.height)
    viewAnchorRef.current = { page: pageNum - 1, pageX: s.width / 2, pageY: 0, offsetX: el.clientWidth / 2, offsetY: PAD }
    onZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)))
    onFitted(fitKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fittedKey, sizes])

  // ---------- 페이지 이동 요청(툴바, 측정 목록, 검색) ----------
  // 검색 결과(rect 가 있음)는 그 글자가 화면 가운데 읽을 만한 크기로 오게 확대하고 잠깐 표시
  const lastJump = useRef(null)
  const [flash, setFlash] = useState(null) // { page, rect }
  useEffect(() => {
    if (!sizes || !jump || lastJump.current === jump.nonce || fitKey !== fittedKey) return
    const el = containerRef.current
    const pe = pageEls.current[jump.page - 1]
    if (!el || !pe) return
    lastJump.current = jump.nonce
    if (jump.rect) {
      const r = jump.rect
      const readable = Math.min(8, 14 / Math.max(r.h, 0.5), (el.clientWidth * 0.7) / Math.max(r.w, 1))
      const z = Math.max(MIN_ZOOM, zoom > readable ? zoom : readable)
      const anchor = {
        page: jump.page - 1,
        pageX: r.x + r.w / 2,
        pageY: r.y + r.h / 2,
        offsetX: el.clientWidth / 2,
        offsetY: el.clientHeight / 2,
      }
      setFlash({ page: jump.page, rect: r, nonce: jump.nonce })
      if (Math.abs(z - zoom) > 1e-6) {
        zoomAnchorRef.current = anchor
        onZoom(z)
      } else {
        restoreAnchor(anchor, zoom)
        viewAnchorRef.current = anchorAt()
      }
      return
    }
    el.scrollTop += pe.getBoundingClientRect().top - el.getBoundingClientRect().top - PAD
    viewAnchorRef.current = anchorAt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, sizes, anchorAt, fitKey, fittedKey])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(t)
  }, [flash])

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
          // 바뀐 게 없으면 그대로 (다시 그리지 않게)
          return next.size === prev.size && [...next].every((i) => prev.has(i)) ? prev : next
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
    const down = (e) => {
      if (e.key === 'Shift') setShiftDown(true)
      if (isTypingTarget(e.target)) return
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
    // 손가락은 잠깐 미뤄 둠: 곧 두 번째 손가락이 닿으면 핀치라서 점을 찍거나 그리지 않음
    if (e.pointerType === 'touch' && !e.replay && !panning) {
      const svg = e.currentTarget
      clearPendingTouch()
      pendingTouchRef.current = {
        e: replayEvent(e, svg),
        page,
        timer: setTimeout(() => touchHandlersRef.current.flush(), TOUCH_DELAY),
      }
      return
    }
    if (e.button === 1 || (e.button === 0 && panning)) {
      e.preventDefault()
      const el = containerRef.current
      panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, button: e.button }
      e.currentTarget.setPointerCapture(e.pointerId)
      forceRender((n) => n + 1)
      return
    }
    if (e.button !== 0) return

    // 크기 조절 손잡이 (선택 도구, 또는 텍스트 도구에서 선택된 텍스트 상자)
    const resizeHandle = (tool === 'select' || tool === 'text') && e.target.closest?.('[data-resize]')
    if (resizeHandle) {
      e.preventDefault()
      if (editing) commitText()
      const item = measurements.find((m) => m.id === resizeHandle.dataset.id)
      const dir = resizeHandle.dataset.resize
      if (item?.type === 'image') {
        const r = rectOf(item.points[0], item.points[1] ?? item.points[0])
        // 자르기 손잡이: 원본 사진 자리는 그대로 두고 보이는 부분만 바꿈. 아니면 모서리는 비율 유지(Shift: 자유롭게)
        dragRef.current = 'crop' in resizeHandle.dataset ? { id: item.id, resize: dir, rect: r, crop: fullImageRect(r, cropOf(item)), moved: false } : { id: item.id, resize: dir, rect: r, aspect: true, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      } else if (item?.type === 'text') {
        // 텍스트 상자 너비 조절: 반대쪽 변은 그대로
        const left = item.points[0].x
        const right = left + textMetricsOf(item).width
        dragRef.current = { id: item.id, resize: dir, text: { left, right, y: item.points[0].y, min: minTextBoxWidth(item.fontSize ?? 13) }, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      } else if (item) {
        // 사각형·형광펜 크기 조절: 잡은 순간의 사각형 기준으로 계산
        dragRef.current = { id: item.id, resize: dir, rect: rectOf(item.points[0], item.points[1] ?? item.points[0]), moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      return
    }

    // 선택 도구: 점 잡아서 옮기기 / 도형 통째로 옮기기 / 선택
    if (tool === 'select') {
      const handle = e.target.closest?.('[data-handle]')
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
          dragRef.current = { whole: true, start, orig, moved: false, clickId: id, page }
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
    const pending = pendingTouchRef.current
    if (pending && pending.e.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - pending.e.clientX, e.clientY - pending.e.clientY) > TOUCH_SLOP) flushPendingTouch()
      return
    }
    if (panRef.current) {
      const el = containerRef.current
      el.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x)
      el.scrollTop = panRef.current.top - (e.clientY - panRef.current.y)
      return
    }
    const p = toPage(e, e.currentTarget)
    pointerRef.current = { page, p }
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
        } else if (d.crop) onUpdateItem(d.id, cropResize(d.rect, d.crop, d.resize, p))
        else if (d.aspect && !e.shiftKey) onSetPoints({ [d.id]: resizeKeepAspect(d.rect, d.resize, p) })
        else onSetPoints({ [d.id]: resizeRect(d.rect, d.resize, p) })
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

  // 그 자리의 메모 범위 (포인터 캡처 때문에 e.target 이 svg 일 수 있어 좌표로 찾음)
  const memoAtPointer = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-type="memo"]')?.dataset.shape

  const onPointerUp = (e, page) => {
    const pending = pendingTouchRef.current
    if (pending && pending.e.pointerId === e.pointerId) {
      // 짧게 톡 누름: 누름을 먼저 처리하고, 화면에 반영된 뒤 뗌을 처리
      flushPendingTouch()
      const up = replayEvent(e, e.currentTarget)
      setTimeout(() => touchHandlersRef.current.up(up, page))
      return
    }
    if (panRef.current) {
      // 이동 도구로 끌지 않고 누르기만 하면 메모 열기
      const pr = panRef.current
      if (pr.button === 0 && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 3) {
        const id = memoAtPointer(e)
        if (id) onOpenMemo(id, page, toPage(e, e.currentTarget))
      }
      panRef.current = null
      forceRender((n) => n + 1)
    }
    // 선택 도구로 메모 범위를 누르기만 하면(끌지 않으면) 메모 열기
    const dr = dragRef.current
    if (dr?.whole && !dr.moved && dr.clickId && measurements.find((m) => m.id === dr.clickId)?.type === 'memo') onOpenMemo(dr.clickId, dr.page, dr.start)
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
      else if (tool === 'memo') {
        // 메모 도구로 이미 있는 범위를 누르기만 하면 그 메모 열기
        const id = memoAtPointer(e)
        if (id) onOpenMemo(id, draft.page, pts[0])
      }
      setDraft(null)
    }
  }

  // ---------- 손가락(아이패드·터치 화면) ----------
  // 한 손가락: 지금 도구 그대로. 두 손가락: 벌리고 오므려 확대/축소 + 함께 끌어서 화면 이동.
  // 도면 바깥 빈 곳은 한 손가락으로 끌어도 화면 이동.
  const pendingTouchRef = useRef(null) // 미뤄 둔 한 손가락 누름 { e, page, timer }
  const pinchRef = useRef(null) // { dist, zoom, anchor, raf }
  const touchPanRef = useRef(null) // { id, x, y, left, top }
  const ignoredTouches = useRef(new Set()) // 핀치에 쓴 손가락: 뗄 때까지 도구 동작 안 함
  const touchHandlersRef = useRef(null)

  const clearPendingTouch = () => {
    if (pendingTouchRef.current) clearTimeout(pendingTouchRef.current.timer)
    pendingTouchRef.current = null
  }
  const flushPendingTouch = () => {
    const pending = pendingTouchRef.current
    if (!pending) return
    clearPendingTouch()
    onPointerDown(pending.e, pending.page)
  }
  useLayoutEffect(() => {
    touchHandlersRef.current = { flush: flushPendingTouch, up: onPointerUp }
  })
  useEffect(() => () => clearPendingTouch(), [])

  // 이 손가락이 핀치에 쓰였는지 (선택 상자 × 단추가 핀치 중 눌린 것으로 치지 않게)
  const isPinching = useCallback((id) => !!pinchRef.current || ignoredTouches.current.has(id), [])

  const startPinch = () => {
    // 첫 손가락이 시작한 일은 취소
    clearPendingTouch()
    panRef.current = null
    dragRef.current = null
    touchPanRef.current = null
    setMarquee(null)
    setDraft((d) => (d?.dragging ? null : d))
    setCursor(null)
    const [a, b] = [...touchesRef.current.values()]
    for (const id of touchesRef.current.keys()) ignoredTouches.current.add(id)
    const anchor = anchorAt((a.x + b.x) / 2, (a.y + b.y) / 2)
    pinchRef.current = anchor && { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom, anchor, raf: 0 }
  }

  // 화면을 한 프레임에 한 번만 갱신
  const updatePinch = () => {
    const pinch = pinchRef.current
    if (!pinch || pinch.raf) return
    pinch.raf = requestAnimationFrame(() => {
      pinch.raf = 0
      const el = containerRef.current
      if (pinchRef.current !== pinch || !el || touchesRef.current.size < 2) return
      const [a, b] = [...touchesRef.current.values()]
      const rect = el.getBoundingClientRect()
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist))
      // 처음 두 손가락 가운데 있던 도면 지점이 지금 두 손가락 가운데 오게
      const anchor = { ...pinch.anchor, offsetX: (a.x + b.x) / 2 - rect.left, offsetY: (a.y + b.y) / 2 - rect.top }
      if (Math.abs(next - wheelRef.current.zoom) > 1e-6) {
        zoomAnchorRef.current = anchor
        onZoom(next)
      } else restoreAnchor(anchor, next)
    })
  }

  const endPinch = () => {
    if (pinchRef.current?.raf) cancelAnimationFrame(pinchRef.current.raf)
    pinchRef.current = null
  }

  const onTouchDown = (e) => {
    if (e.pointerType !== 'touch') return
    const touches = touchesRef.current
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 2 && !pinchRef.current) {
      e.stopPropagation()
      startPinch()
      return
    }
    if (touches.size > 1) {
      ignoredTouches.current.add(e.pointerId)
      e.stopPropagation()
      return
    }
    if (!e.target.closest?.('[data-page]')) {
      const el = containerRef.current
      touchPanRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    }
  }

  const onTouchMove = (e) => {
    if (e.pointerType !== 'touch') return
    const touches = touchesRef.current
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const tp = touchPanRef.current
    if (tp && tp.id === e.pointerId) {
      const el = containerRef.current
      el.scrollLeft = tp.left - (e.clientX - tp.x)
      el.scrollTop = tp.top - (e.clientY - tp.y)
      e.stopPropagation()
      return
    }
    if (ignoredTouches.current.has(e.pointerId)) {
      e.stopPropagation()
      updatePinch()
    }
  }

  const onTouchUp = (e) => {
    if (e.pointerType !== 'touch') return
    touchesRef.current.delete(e.pointerId)
    if (touchesRef.current.size < 2) endPinch()
    if (pendingTouchRef.current?.e.pointerId === e.pointerId && e.type === 'pointercancel') clearPendingTouch()
    if (touchPanRef.current?.id === e.pointerId) {
      touchPanRef.current = null
      e.stopPropagation()
    }
    if (ignoredTouches.current.delete(e.pointerId)) e.stopPropagation()
  }

  if (!sizes) {
    return <div className="flex flex-1 items-center justify-center bg-ink-200 text-ink-500">페이지 불러오는 중…</div>
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
      const color = tool === 'highlight' ? markupStyle.highlightColor : tool === 'memo' ? markupStyle.memoColor : markupStyle.color
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
        className="absolute inset-0 touch-none overflow-auto bg-desk"
        onScroll={onScroll}
        onPointerDownCapture={onTouchDown}
        onPointerMoveCapture={onTouchMove}
        onPointerUpCapture={onTouchUp}
        onPointerCancelCapture={onTouchUp}
        onPointerLeave={() => {
          setCursor(null)
          pointerRef.current = null
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((it) => it.kind === 'file' && it.type.startsWith('image/'))) e.preventDefault()
        }}
        onDrop={(e) => {
          const images = [...e.dataTransfer.files].filter(isImageFile)
          if (!images.length) return
          e.preventDefault()
          onDropImages(images, e.clientX, e.clientY)
        }}
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
                  className={`absolute inset-0 touch-none select-none ${tool === 'select' || tool === 'memo' || panning ? 'memo-hover' : ''}`}
                  style={{ cursor: cursorStyle }}
                  onPointerDown={(e) => onPointerDown(e, page)}
                  onPointerMove={(e) => onPointerMove(e, page)}
                  onPointerUp={(e) => onPointerUp(e, page)}
                  onDoubleClick={(e) => {
                    if (tool === 'select') {
                      // 포인터 캡처 때문에 e.target 이 svg 일 수 있어 좌표로 다시 찾음
                      const hit = document.elementFromPoint(e.clientX, e.clientY)
                      const t = hit?.closest('[data-type="text"]')
                      const img = hit?.closest('[data-type="image"]')
                      const memo = hit?.closest('[data-type="memo"]')
                      if (t) editExisting(t.dataset.shape)
                      else if (memo) onOpenMemo(memo.dataset.shape, page, toPage(e, e.currentTarget), { force: true })
                      else if (img) onCropImage(img.dataset.shape)
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
                  {visible.has(i) && (
                    <PageShapes
                      items={byPage.get(page)}
                      zoom={zoom}
                      mmPerPt={mmPerPt}
                      unit={unit}
                      selectedIds={selectedIds}
                      tool={tool}
                      editingId={editing?.page === page ? editing.id : null}
                      croppingId={croppingId}
                    />
                  )}
                  {visible.has(i) && tool === 'select' && !croppingId && (
                    <SelectionBox
                      items={byPage.get(page)}
                      selectedIds={selectedIds}
                      zoom={zoom}
                      width={w}
                      height={h}
                      editingId={editing?.page === page ? editing.id : null}
                      canDelete={!marquee}
                      onDelete={onDelete}
                      isPinching={isPinching}
                    />
                  )}
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
                  {flash && flash.page === page && (
                    <rect
                      key={flash.nonce}
                      className="search-flash"
                      x={flash.rect.x * zoom - 4}
                      y={flash.rect.y * zoom - 4}
                      width={flash.rect.w * zoom + 8}
                      height={flash.rect.h * zoom + 8}
                      rx={3}
                      fill="#fbbf24"
                      fillOpacity={0.3}
                      stroke="#f59e0b"
                      strokeWidth={2.5}
                      pointerEvents="none"
                    />
                  )}
                </svg>
                {sizes.length > 1 && (
                  <div className="pointer-events-none absolute -bottom-px left-1/2 translate-y-full -translate-x-1/2 pt-0.5 text-[11px] text-ink-500">
                    {page} / {sizes.length}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {sizes.length > 1 && (
        <div className="pointer-events-none absolute top-3 right-4 rounded-full bg-ink-900/70 px-3 py-1 text-sm text-white shadow">
          {pageNum} / {sizes.length} 페이지
        </div>
      )}
      {drawing && <DrawHint tool={tool} count={draftPts.length} />}
    </div>
  )
}

// 한 페이지의 측정·마크업 도형. 화면 근처 페이지만 그리고, 그 페이지 항목·배율 등이 그대로면 다시 그리지 않음
const PageShapes = memo(function PageShapes({ items, zoom, mmPerPt, unit, selectedIds, tool, editingId, croppingId }) {
  if (!items) return null
  return items.map((m) =>
    m.id === editingId ? null : (
      <MeasurementShape
        key={m.id}
        m={m}
        zoom={zoom}
        mmPerPt={mmPerPt}
        unit={unit}
        selected={selectedIds.includes(m.id)}
        showHandles={tool === 'select'}
        showResize={tool === 'text' && m.type === 'text'}
        cropping={m.id === croppingId}
      />
    ),
  )
})

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
      <div className="rounded-full bg-ink-900/80 px-4 py-1.5 text-center text-sm text-white shadow">
        {text} <span className="text-ink-400">· Esc 취소</span>
      </div>
    </div>
  )
}
