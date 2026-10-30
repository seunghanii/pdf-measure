import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { distance } from '../lib/geometry'
import { PT_TO_PAPER_MM, UNITS, calibrationInput } from '../lib/units'
import { TYPE_INFO } from '../lib/measure'
import { canCategorize, newCategoryId, nextCategoryColor, withCategory } from '../lib/categories'
import { DEFAULT_BOX_OPACITY, FULL_CROP, MARKUP_STROKE, STROKE_TYPES, isCropped, isMarkup, rectOf, strokeOf } from '../lib/markup'
import { ImageSource, freshImageIds, getImageBlob, isImageFile, newImageId, prepareImage, rememberImage } from '../lib/images'
import { TOOLS, toolForDigit } from '../lib/tools'
import { toggleSnap } from '../lib/snapSetting'
import { useAutosave } from '../lib/autosave'
import { isTypingTarget } from '../lib/dom'
import PdfViewer from './PdfViewer'
import Toolbar from './Toolbar'
import Sidebar from './Sidebar'
import CalibrationDialog from './CalibrationDialog'
import DocSearch from './DocSearch'
import LinkPicker from './LinkPicker'
import { DEFAULT_MEMO_COLOR, isLinkOnly, memoPhotoIds, memosAt } from '../lib/memo'
import { MAX_ZOOM, MIN_ZOOM } from '../lib/zoom'

// 메모장은 마크다운 읽는 도구까지 필요할 때만 불러옴
const MemoPanel = lazy(() => import('./MemoPanel'))

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// 도면 하나(탭 하나)의 작업 공간. 탭을 바꿔도 마운트된 채로 남아서 상태가 유지됩니다.
export default function Workspace({ doc, active, onOpenFile, searchJump, onOpenLink, sidebarOpen, setSidebarOpen }) {
  const { pdfDoc, name: fileName } = doc
  const saved = doc.savedState
  const [pageNum, setPageNum] = useState(() => Math.min(saved?.pageNum ?? 1, pdfDoc.numPages))
  const [zoom, setZoom] = useState(1)
  const [fitKey, setFitKey] = useState(1)
  const [fittedKey, setFittedKey] = useState(0)
  const [tool, setTool] = useState(saved?.calibration ? 'length' : 'calibrate')
  const [measurements, setMeasurements] = useState(saved?.measurements ?? [])
  const [history, setHistory] = useState([])
  const [categories, setCategories] = useState(saved?.categories ?? []) // 측정 분류 [{ id, name, color }]
  const [calibration, setCalibration] = useState(saved?.calibration ?? null)
  const [pendingCalibration, setPendingCalibration] = useState(null)
  const [selectedIds, setSelectedIds] = useState([]) // 선택된 항목들 (드래그·Shift+클릭으로 여러 개)
  const [unit, setUnit] = useState(saved?.unit ?? 'mm')
  const counters = useRef(saved?.counters ?? { length: 0, area: 0, angle: 0 })
  const [markupStyle, setMarkupStyle] = useState(() => ({
    color: '#dc2626',
    highlightColor: '#facc15',
    fontSize: 13,
    boxOpacity: DEFAULT_BOX_OPACITY,
    textAlign: 'left',
    strokeWidth: MARKUP_STROKE,
    imageBorder: false,
    imageBorderColor: '#111827',
    imageBorderWidth: 1,
    memoColor: DEFAULT_MEMO_COLOR,
    memoKind: 'note', // 새 메모 범위: 'note' 메모장 | 'link' 다른 도면 열기
    measureCat: null, // 새로 재는 길이·면적·각도에 붙일 분류 id
    ...saved?.markupStyle,
  }))
  const [croppingId, setCroppingId] = useState(null) // 자르는 중인 사진
  const [memoOpen, setMemoOpen] = useState(null) // 열린 메모장 { id, others: 같은 자리에 겹친 메모 id 들 }
  const [linkPicking, setLinkPicking] = useState(null) // 도면 연결 고르는 중인 메모 { id, fresh: 방금 그린 범위 }
  const placeRef = useRef(null) // 뷰어가 사진 넣을 자리를 알려 주는 함수
  const imageInputRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  // 툴바·목록에서 특정 페이지로 이동 요청 (뷰어가 스크롤)
  const [jump, setJump] = useState(null)
  const jumpTo = useCallback(
    (page) => setJump({ page: Math.min(Math.max(1, page), pdfDoc.numPages), nonce: Date.now() + Math.random() }),
    [pdfDoc],
  )
  // 검색 결과로 이동: 그 글자가 화면 가운데 오도록 확대하고 잠깐 깜빡임
  const jumpToHit = useCallback(
    (hit) => setJump({ page: hit.page, rect: hit.rect, nonce: Date.now() + Math.random() }),
    [],
  )
  // 홈 화면 검색에서 고른 위치 ({ page, rect, nonce }) 와 이 화면의 이동 요청 중 나중 것
  const pickedJump = searchJump && (!jump || searchJump.nonce > jump.nonce) ? searchJump : jump
  const viewerJump = pickedJump && pickedJump.page > pdfDoc.numPages ? { ...pickedJump, page: pdfDoc.numPages } : pickedJump
  const searchRef = useRef(null)

  // 측정값이 바뀌면 잠시 뒤 자동 저장 (로그인했으면 서버, 아니면 이 브라우저)
  const store = doc.store
  const cloud = store.kind === 'cloud'
  const syncStatus = useAutosave({ store, docId: doc.id, measurements, categories, calibration, unit, markupStyle, counters, pageNum })

  // 축척: PDF 1pt 가 실제 몇 mm 인지
  const mmPerPt = useMemo(() => {
    if (!calibration) return null
    if (calibration.mode === 'ratio') return PT_TO_PAPER_MM * calibration.ratio
    const d = distance(calibration.points[0], calibration.points[1])
    return d > 0 ? calibration.realMm / d : null
  }, [calibration])

  const measurementsRef = useRef(measurements)
  const historyRef = useRef(history)
  useLayoutEffect(() => {
    measurementsRef.current = measurements
    historyRef.current = history
  })

  // 되돌리기(Ctrl+Z)가 가능한 변경
  const commit = useCallback((updater) => {
    const prev = measurementsRef.current
    setHistory((h) => [...h.slice(-49), prev])
    setMeasurements(typeof updater === 'function' ? updater(prev) : updater)
  }, [])

  // 드래그로 옮기기 직전 상태를 되돌리기 목록에 넣기
  const beginEdit = useCallback(() => {
    const prev = measurementsRef.current
    setHistory((h) => [...h.slice(-49), prev])
  }, [])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.length) return
    setMeasurements(h[h.length - 1])
    setHistory(h.slice(0, -1))
  }, [])

  const onComplete = useCallback(
    (type, points, page, extra) => {
      if (type === 'calibrate') {
        setPendingCalibration({ page, points })
        return
      }
      counters.current[type] = (counters.current[type] ?? 0) + 1
      const m = {
        id: newId(),
        type,
        page,
        points,
        name: `${TYPE_INFO[type].name} ${counters.current[type]}`,
      }
      if (isMarkup(type)) {
        m.color = type === 'highlight' ? markupStyle.highlightColor : type === 'memo' ? markupStyle.memoColor : markupStyle.color
        if (type === 'memo') m.text = ''
        if (type === 'text') {
          m.fontSize = markupStyle.fontSize
          m.boxOpacity = markupStyle.boxOpacity
          m.align = markupStyle.textAlign
        }
        if (STROKE_TYPES.includes(type)) m.strokeWidth = markupStyle.strokeWidth
      }
      Object.assign(m, extra)
      const cat = !isMarkup(type) && markupStyle.measureCat && categories.find((c) => c.id === markupStyle.measureCat)
      commit((prev) => [...prev, cat ? withCategory(m, cat) : m])
      setSelectedIds([m.id])
      // 새 메모 범위: 바로 메모장(쓰기)을 열거나, 연결할 도면을 고름
      if (type === 'memo') {
        if (markupStyle.memoKind === 'link') {
          setMemoOpen(null)
          setLinkPicking({ id: m.id, fresh: true })
        } else setMemoOpen({ id: m.id, others: [] })
      }
    },
    [categories, commit, markupStyle],
  )

  // ---------- 측정 분류 ----------
  const addCategory = (name) => {
    const cat = { id: newCategoryId(), name, color: nextCategoryColor(categories) }
    setCategories((list) => [...list, cat])
    return cat
  }
  // 이름·색 바꾸기. 색이 바뀌면 그 분류 항목들의 색도 함께 (분류 설정이라 되돌리기 목록에는 넣지 않음)
  const updateCategory = (id, patch) => {
    const cat = { ...categories.find((c) => c.id === id), ...patch }
    setCategories((list) => list.map((c) => (c.id === id ? cat : c)))
    if (patch.color) {
      const recolor = (ms) => ms.map((m) => (m.cat === id ? withCategory(m, cat) : m))
      setMeasurements(recolor)
      setHistory((h) => h.map(recolor))
    }
  }
  // 분류를 지우면 그 분류였던 항목은 분류 없음으로
  const deleteCategory = (id) => {
    const strip = (ms) => ms.map((m) => (m.cat === id ? withCategory(m, null) : m))
    setCategories((list) => list.filter((c) => c.id !== id))
    setMeasurements(strip)
    setHistory((h) => h.map(strip))
    if (markupStyle.measureCat === id) setMarkupStyle((st) => ({ ...st, measureCat: null }))
  }
  // 항목들에 분류 붙이기 (catId 가 null 이면 떼기). Ctrl+Z 로 되돌릴 수 있음
  const assignCategory = useCallback(
    (ids, catId) => {
      const cat = catId ? categories.find((c) => c.id === catId) : null
      const set = new Set(ids)
      commit((prev) => prev.map((m) => (set.has(m.id) && canCategorize(m) ? withCategory(m, cat) : m)))
    },
    [categories, commit],
  )

  // { id: points } 로 여러 항목의 점을 한꺼번에 바꾸기 (선택한 것 함께 옮기기)
  const onSetPoints = useCallback((map) => {
    setMeasurements((prev) => prev.map((m) => (map[m.id] ? { ...m, points: map[m.id] } : m)))
  }, [])

  const updateItem = useCallback((id, patch) => {
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  // 선택된 마크업. 텍스트가 섞여 있으면 툴바에 텍스트 설정(글자 크기·투명도)을 보여 줌
  const selectedMarkups = measurements.filter((m) => selectedIds.includes(m.id) && isMarkup(m.type))
  const selText = selectedMarkups.find((m) => m.type === 'text')
  const selLine = selectedMarkups.find((m) => m.type !== 'highlight' && m.type !== 'image' && m.type !== 'memo')
  const selMemos = selectedMarkups.filter((m) => m.type === 'memo')
  const onlyMemos = selMemos.length > 0 && selMemos.length === selectedMarkups.length
  const selHighlight = selectedMarkups.find((m) => m.type === 'highlight')
  const selStroke = selectedMarkups.find((m) => STROKE_TYPES.includes(m.type))
  const selImages = selectedMarkups.filter((m) => m.type === 'image')
  const selImage = selImages[0]
  const onlyImages = selImages.length > 0 && selImages.length === selectedMarkups.length
  const selectedMarkupType = selText ? 'text' : onlyImages ? 'image' : onlyMemos ? 'memo' : selLine ? selLine.type : selHighlight ? 'highlight' : null
  // 툴바에는 선택된 마크업의 현재 값을 보여 줌
  const shownStyle =
    tool === 'select' && selectedMarkups.length
      ? {
          ...markupStyle,
          ...(selLine && { color: selLine.color }),
          ...(selHighlight && { highlightColor: selHighlight.color }),
          ...(selStroke && { strokeWidth: strokeOf(selStroke) }),
          ...(selText && { fontSize: selText.fontSize ?? 13, boxOpacity: selText.boxOpacity ?? DEFAULT_BOX_OPACITY, textAlign: selText.align ?? 'left' }),
          ...(selMemos[0] && { memoColor: selMemos[0].color ?? DEFAULT_MEMO_COLOR }),
          ...(selImage && { imageBorder: !!selImage.border, imageBorderColor: selImage.color ?? '#111827', imageBorderWidth: strokeOf(selImage) }),
        }
      : markupStyle

  // 색·글자 크기·투명도·선 굵기: 다음에 그릴 마크업에 적용, 선택 도구에서 선택된 마크업이 있으면 전부 바꿈.
  // (그리기 도구일 때는 방금 그린 것이 선택돼 있어도 바꾸지 않음. 툴바도 다음에 그릴 값만 보여 줌)
  // 슬라이더처럼 연달아 바뀌는 변경(live)은 되돌리기 한 번으로 묶음.
  const styleGesture = useRef(0)
  const changeMarkupStyle = (patch, { live = false } = {}) => {
    setMarkupStyle((st) => ({ ...st, ...patch }))
    const itemPatch = (m) => {
      const out = {}
      if (patch.color && m.type !== 'highlight' && m.type !== 'memo') out.color = patch.color
      if (patch.memoColor && m.type === 'memo') out.color = patch.memoColor
      if (patch.highlightColor && m.type === 'highlight') out.color = patch.highlightColor
      if (patch.fontSize && m.type === 'text') out.fontSize = patch.fontSize
      if (patch.boxOpacity !== undefined && m.type === 'text') out.boxOpacity = patch.boxOpacity
      if (patch.textAlign && m.type === 'text') out.align = patch.textAlign
      if (patch.strokeWidth && STROKE_TYPES.includes(m.type)) out.strokeWidth = patch.strokeWidth
      if (m.type === 'image') {
        if (patch.imageBorder !== undefined) out.border = patch.imageBorder
        if (patch.imageBorderColor) out.color = patch.imageBorderColor
        if (patch.imageBorderWidth) out.strokeWidth = patch.imageBorderWidth
      }
      return Object.keys(out).length ? out : null
    }
    const targets = tool === 'select' ? selectedMarkups.filter(itemPatch) : []
    if (!targets.length) return
    const now = Date.now()
    if (!live || now - styleGesture.current > 800) beginEdit()
    styleGesture.current = live ? now : 0
    const ids = new Set(targets.map((m) => m.id))
    setMeasurements((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, ...itemPatch(m) } : m)))
  }

  // 마크업과 측정을 그려 넣은 PDF 를 다운로드 폴더에 저장
  const savePdf = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setNotice('')
    try {
      const { exportPdfWithMarkups, downloadBytes } = await import('../lib/exportPdf.jsx')
      const getImage = (imageId) => getImageBlob({ store, docId: doc.id }, imageId)
      const bytes = await exportPdfWithMarkups({ pdfDoc, items: measurementsRef.current, calibration, mmPerPt, unit, getImage })
      const base = fileName.replace(/\.pdf$/i, '')
      downloadBytes(bytes, `${base}_마크업.pdf`)
      setNotice(`"${base}_마크업.pdf" 로 저장했어요. 브라우저의 다운로드 폴더를 확인하세요.`)
    } catch (e) {
      console.error(e)
      setNotice('PDF 저장에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }, [calibration, doc.id, fileName, mmPerPt, pdfDoc, saving, store, unit])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const onMovePoint = useCallback((id, index, p) => {
    if (id === 'calibration') {
      setCalibration((c) => (c ? { ...c, points: c.points.map((q, i) => (i === index ? p : q)) } : c))
      return
    }
    setMeasurements((prev) =>
      prev.map((m) => (m.id === id ? { ...m, points: m.points.map((q, i) => (i === index ? p : q)) } : m)),
    )
  }, [])

  // ---------- 사진 넣기 (파일 선택, 붙여넣기, 끌어다 놓기) ----------
  const imageSource = useMemo(() => ({ store, docId: doc.id }), [store, doc.id])
  const insertImages = useCallback(
    async (files, clientX, clientY) => {
      const added = []
      let failed = 0
      for (const file of files.filter(isImageFile)) {
        let img
        try {
          img = await prepareImage(file)
        } catch (e) {
          console.warn('사진 읽기 실패', e)
          failed++
          continue
        }
        const spot = placeRef.current?.(clientX, clientY)
        if (!spot) continue
        const imageId = newImageId()
        rememberImage(imageId, img.blob)
        store.saveImage(doc.id, imageId, img.blob).catch((e) => {
          console.warn('사진 저장 실패', e)
          setNotice('사진을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 넣어 주세요.')
        })
        // 원래 크기(96dpi 기준)로 넣되, 화면에 보이는 크기의 40% 를 넘지 않게
        const k = Math.min(0.75, (spot.maxW * 0.4) / img.width, (spot.maxH * 0.4) / img.height)
        const w = img.width * k
        const h = img.height * k
        const shift = added.length * 16 // 여러 장이면 조금씩 비켜서
        const x = Math.max(0, spot.x - w / 2 + shift)
        const y = Math.max(0, spot.y - h / 2 + shift)
        counters.current.image = (counters.current.image ?? 0) + 1
        added.push({
          id: newId(),
          type: 'image',
          page: spot.page,
          points: [
            { x, y },
            { x: x + w, y: y + h },
          ],
          name: `${TYPE_INFO.image.name} ${counters.current.image}`,
          imageId,
          imgW: img.width,
          imgH: img.height,
          crop: FULL_CROP,
          border: markupStyle.imageBorder,
          color: markupStyle.imageBorderColor,
          strokeWidth: markupStyle.imageBorderWidth,
        })
      }
      if (failed) setNotice('이 사진 형식은 열 수 없어요. JPG나 PNG 사진을 넣어 주세요.')
      if (!added.length) return
      commit((prev) => [...prev, ...added])
      setTool('select')
      setSelectedIds(added.map((m) => m.id))
    },
    [commit, doc.id, markupStyle, store],
  )

  // Ctrl+V: 복사해 둔 사진을 바로 넣기 (마우스가 도면 위에 있으면 그 자리에)
  useEffect(() => {
    if (!active) return
    const onPaste = (e) => {
      if (isTypingTarget(e.target)) return
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
      if (!files.length) return
      e.preventDefault()
      insertImages(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [active, insertImages])

  // 지운 사진 정리: 도면을 열 때 어디에도 쓰이지 않는 사진(지운 뒤 저장된 것)을 저장소에서 지움
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const ids = await store.listImageIds(doc.id)
        if (!ids.length) return
        const used = new Set()
        for (const list of [measurementsRef.current, ...historyRef.current])
          for (const m of list) {
            if (m.type === 'image') used.add(m.imageId)
            if (m.type === 'memo') memoPhotoIds(m).forEach((id) => used.add(id))
          }
        const unused = ids.filter((id) => !used.has(id) && !freshImageIds.has(id))
        if (unused.length) await store.removeImages(doc.id, unused)
      } catch (e) {
        console.warn('사진 정리 실패', e)
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [doc.id, store])

  // 자르기는 그 사진이 선택돼 있고 선택 도구일 때만
  const cropping = croppingId && tool === 'select' && selectedIds.includes(croppingId) ? croppingId : null
  const startCrop = useCallback((id) => {
    setTool('select')
    setSelectedIds([id])
    setCroppingId(id)
  }, [])
  const resetCrop = (ids) => {
    const targets = measurementsRef.current.filter((m) => ids.includes(m.id) && m.type === 'image' && isCropped(m))
    if (!targets.length) return
    beginEdit()
    const byId = new Map(targets.map((m) => [m.id, m]))
    setMeasurements((prev) =>
      prev.map((m) => {
        const t = byId.get(m.id)
        if (!t) return m
        // 보이던 부분의 크기 비율 그대로 원본 전체를 보여 줌
        const r = rectOf(t.points[0], t.points[1])
        const c = t.crop
        const w = r.w / c.w
        const h = r.h / c.h
        const x = r.x - c.x * w
        const y = r.y - c.y * h
        return { ...m, crop: FULL_CROP, points: [{ x, y }, { x: x + w, y: y + h }] }
      }),
    )
  }

  // ---------- 메모 범위 ----------
  // 누른 자리에 메모가 겹쳐 있으면 가장 작은 범위(같은 크기면 나중에 만든 것)를 열고, 나머지는 메모장 위쪽에 보여 줌.
  // 내용 없이 도면만 연결된 범위는 바로 그 도면을 엶 (force: 더블클릭·목록에서 누름 → 항상 메모장)
  const openMemoAt = useCallback(
    (id, page, p, { force = false } = {}) => {
      const list = measurementsRef.current
      const stack = p ? memosAt(list, page, p) : []
      const target = (force ? list.find((m) => m.id === id) : stack[0]) ?? list.find((m) => m.id === id)
      if (!target) return
      if (!force && isLinkOnly(target)) {
        onOpenLink?.(target.link)
        return
      }
      setLinkPicking(null)
      setMemoOpen({ id: target.id, others: stack.length > 1 ? stack.map((m) => m.id) : [] })
    },
    [onOpenLink],
  )

  // 메모 글·이름·연결 고치기. 메모장을 연 동안의 변경은 되돌리기 한 번으로 묶음
  const memoGesture = useRef(null)
  const editMemo = useCallback(
    (id, patch) => {
      if (memoGesture.current !== id) {
        memoGesture.current = id
        beginEdit()
      }
      updateItem(id, patch)
    },
    [beginEdit, updateItem],
  )
  useEffect(() => {
    memoGesture.current = null
  }, [memoOpen?.id])

  const memoItem = memoOpen && measurements.find((m) => m.id === memoOpen.id && m.type === 'memo' && !m.hidden)
  const linkItem = linkPicking && measurements.find((m) => m.id === linkPicking.id)

  // ids: 지울 항목 id 배열 (기준선은 목록에서 따로 지움)
  const deleteItems = useCallback(
    (ids) => {
      const del = new Set(ids.filter((id) => id !== 'calibration'))
      if (!del.size) return
      commit((prev) => prev.filter((m) => !del.has(m.id)))
      setSelectedIds((s) => s.filter((id) => !del.has(id)))
    },
    [commit],
  )

  const lineCalibration = ({ value, unit: u }) => ({
    realMm: value * UNITS[u].toMm,
    value,
    unit: u,
    label: `기준 ${value.toLocaleString('ko-KR')} ${u}`,
  })

  const applyCalibration = (input) => {
    if (pendingCalibration.edit) {
      editCalibration(input)
      setPendingCalibration(null)
      return
    }
    setCalibration({ mode: 'line', page: pendingCalibration.page, points: pendingCalibration.points, ...lineCalibration(input) })
    setUnit(input.unit)
    setPendingCalibration(null)
    setTool('length')
  }

  // 이미 그은 기준선의 길이 숫자만 바꾸기 (선은 그대로, 축척과 모든 측정값이 바로 다시 계산됨)
  const editCalibration = (input) => {
    setCalibration((c) => (c?.mode === 'line' ? { ...c, ...lineCalibration(input) } : c))
    setUnit(input.unit)
  }

  const applyRatio = (ratio) => {
    setCalibration({ mode: 'ratio', ratio })
    if (tool === 'calibrate') setTool('length')
  }

  // 단축키
  useEffect(() => {
    if (!active) return
    const onKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey
      // 브라우저 기본 동작 가로채기: 저장(Ctrl+S), 화면 확대(Ctrl +/-/0) → PDF 만 확대
      // Ctrl+F: 브라우저 찾기 대신 도면 검색 창
      if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        const focus = () => {
          searchRef.current?.focus()
          searchRef.current?.select()
        }
        // 목록을 접어 뒀으면 펼친 뒤 (다음 그리기 후) 검색 칸으로
        if (sidebarOpen) focus()
        else {
          setSidebarOpen(true)
          requestAnimationFrame(focus)
        }
        return
      }
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        savePdf()
        return
      }
      if (ctrl && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault()
        if (e.key === '0') setFitKey((k) => k + 1)
        else setZoom((z) => (e.key === '-' ? Math.max(MIN_ZOOM, z / 1.25) : Math.min(MAX_ZOOM, z * 1.25)))
        return
      }
      if (isTypingTarget(e.target) || pendingCalibration) return
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      // Ctrl+A: 화면에 보이는 항목 전체 선택
      if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setTool('select')
        setSelectedIds(measurementsRef.current.filter((m) => !m.hidden).map((m) => m.id))
        return
      }
      // 숫자 키(1~9, 0)로 도구 바꾸기. Ctrl/Alt+숫자도 브라우저가 넘겨주는 경우엔 동작
      const digitTool = /^Digit\d$/.test(e.code) ? toolForDigit(e.code.slice(5)) : undefined
      if (digitTool && !e.shiftKey) {
        e.preventDefault()
        setTool(digitTool)
        return
      }
      if (ctrl || e.altKey) return
      // S: 자석 켜고 끄기 (한글 입력 상태에서도 되게 키 위치로 확인)
      if (e.code === 'KeyS' && !e.shiftKey) {
        e.preventDefault()
        toggleSnap()
        return
      }
      // 사진 자르기 끝내기
      if (cropping && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault()
        setCroppingId(null)
        return
      }
      // I: 사진 넣기 (파일 고르기)
      if (e.code === 'KeyI' && !e.shiftKey) {
        e.preventDefault()
        imageInputRef.current?.click()
        return
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())?.id
      if (t && pdfDoc) setTool(t)
      if (e.key === 'Delete' || (e.key === 'Backspace' && tool === 'select')) {
        if (selectedIds.length) {
          e.preventDefault()
          deleteItems(selectedIds)
        }
      }
      if (e.key === 'Escape' && memoOpen) setMemoOpen(null)
      if (e.key === 'Escape' && tool === 'select') setSelectedIds([])
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))
      if (e.key === '-') setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))
      if (e.key === 'PageDown') {
        e.preventDefault()
        jumpTo(pageNum + 1)
      }
      if (e.key === 'PageUp') {
        e.preventDefault()
        jumpTo(pageNum - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, cropping, deleteItems, jumpTo, memoOpen, pageNum, pdfDoc, pendingCalibration, savePdf, selectedIds, setSidebarOpen, sidebarOpen, tool, undo])

  const visibleMeasurements = useMemo(() => measurements.filter((m) => !m.hidden), [measurements])

  // 눈 아이콘: 화면에서 숨기기/보이기 (값은 그대로 남음)
  // 숨긴 항목은 선택에서도 빠짐 (보이지 않는 것이 함께 지워지거나 옮겨지지 않도록)
  const toggleHidden = (id) => {
    if (id === 'calibration') {
      setCalibration((c) => (c ? { ...c, hidden: !c.hidden } : c))
      return
    }
    const hiding = !measurementsRef.current.find((m) => m.id === id)?.hidden
    if (hiding) setSelectedIds((s) => s.filter((x) => x !== id))
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, hidden: !m.hidden } : m)))
  }
  // group: 'measure' | 'markup'
  const setAllHidden = (hidden, group) => {
    const inGroup = (m) => (group === 'markup') === isMarkup(m.type)
    if (hidden) {
      const ids = new Set(measurementsRef.current.filter(inGroup).map((m) => m.id))
      setSelectedIds((s) => s.filter((x) => !ids.has(x)))
    }
    setMeasurements((prev) => prev.map((m) => (inGroup(m) ? { ...m, hidden } : m)))
  }

  if (!active) return null

  return (
    <ImageSource.Provider value={imageSource}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          insertImages([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <Toolbar
        onOpenFile={onOpenFile}
        pdfDoc={pdfDoc}
        pageNum={pageNum}
        setPageNum={jumpTo}
        zoom={zoom}
        setZoom={setZoom}
        onFit={() => setFitKey((k) => k + 1)}
        tool={tool}
        setTool={setTool}
        calibrated={!!mmPerPt}
        canUndo={history.length > 0}
        onUndo={undo}
        markupStyle={shownStyle}
        onChangeMarkupStyle={changeMarkupStyle}
        selectedMarkupType={selectedMarkupType}
        selectedHasStroke={tool === 'select' && !!selStroke}
        onInsertImage={() => imageInputRef.current?.click()}
        memoActions={
          tool === 'select' && onlyMemos
            ? {
                onOpen: () => openMemoAt(selMemos[0].id, null, null, { force: true }),
                onLink: () => {
                  setMemoOpen(null)
                  setLinkPicking({ id: selMemos[0].id })
                },
                linked: !!selMemos[0].link,
              }
            : null
        }
        imageActions={
          tool === 'select' && onlyImages
            ? {
                cropping: !!cropping,
                cropped: selImages.some(isCropped),
                onToggleCrop: () => (cropping ? setCroppingId(null) : startCrop(selImage.id)),
                onResetCrop: () => resetCrop(selImages.map((m) => m.id)),
                onHide: () => {
                  setCroppingId(null)
                  selImages.forEach((m) => toggleHidden(m.id))
                },
              }
            : null
        }
        onSave={savePdf}
        saving={saving}
        syncStatus={cloud ? syncStatus : null}
      />

      {notice && (
        <div className="flex items-center justify-between border-b border-ok-200 bg-ok-50 px-4 py-2 text-sm text-ok-800">
          <span>{notice}</span>
          <button className="ml-4 opacity-60 hover:opacity-100" onClick={() => setNotice('')}>
            닫기
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <PdfViewer
            pdfDoc={pdfDoc}
            pageNum={pageNum}
            onPageChange={setPageNum}
            jump={viewerJump}
            zoom={zoom}
            onZoom={setZoom}
            fitKey={fitKey}
            fittedKey={fittedKey}
            onFitted={setFittedKey}
            tool={tool}
            measurements={visibleMeasurements}
            calibration={calibration?.mode === 'line' && !calibration.hidden ? calibration : null}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            onComplete={onComplete}
            onMovePoint={onMovePoint}
            onSetPoints={onSetPoints}
            onBeginEdit={beginEdit}
            onUpdateItem={updateItem}
            onEditCalibration={() => setPendingCalibration({ edit: true })}
            markupStyle={markupStyle}
            mmPerPt={mmPerPt}
            unit={unit}
            croppingId={cropping}
            onCropImage={startCrop}
            onDropImages={insertImages}
            placeRef={placeRef}
            onOpenMemo={openMemoAt}
          />
          {memoItem && (
            <Suspense fallback={null}>
              <MemoPanel
                key={memoItem.id}
                memo={memoItem}
                others={memoOpen.others.map((id) => measurements.find((m) => m.id === id)).filter((m) => m && !m.hidden)}
                onSwitch={(id) => setMemoOpen((cur) => ({ ...cur, id }))}
                onChange={(patch) => editMemo(memoItem.id, patch)}
                onClose={() => setMemoOpen(null)}
                onDelete={() => {
                  setMemoOpen(null)
                  deleteItems([memoItem.id])
                }}
                onOpenLink={onOpenLink}
                onPickLink={() => setLinkPicking({ id: memoItem.id })}
                store={store}
                docId={doc.id}
                onNotice={setNotice}
              />
            </Suspense>
          )}
        </div>
        {!sidebarOpen && (
          <div className="flex shrink-0 justify-center border-t border-ink-200 bg-white p-1 md:w-10 md:flex-col md:justify-start md:border-t-0 md:border-l md:py-3">
            <SidebarToggle open={false} onClick={() => setSidebarOpen(true)} />
          </div>
        )}
        {/* 접어도 지우지 않고 숨기기만 (검색어·축척 창 상태 유지, 다시 펼칠 때 새로 그리지 않음) */}
        <Sidebar
          collapsed={!sidebarOpen}
          calibration={calibration}
          mmPerPt={mmPerPt}
          unit={unit}
          setUnit={setUnit}
          measurements={measurements}
          pageNum={pageNum}
          selectedIds={selectedIds}
          onSelect={(m, additive) => {
            if (additive) {
              setSelectedIds((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))
              return
            }
            setSelectedIds([m.id])
            if (m.hidden) toggleHidden(m.id)
            jumpTo(m.page)
            if (m.type === 'memo') openMemoAt(m.id, null, null, { force: true })
          }}
          onDelete={(id) => deleteItems([id])}
          onToggleHidden={toggleHidden}
          onSetAllHidden={setAllHidden}
          onRename={(id, name) => setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)))}
          categories={categories}
          activeCategory={markupStyle.measureCat}
          onSetActiveCategory={(id) => setMarkupStyle((st) => ({ ...st, measureCat: id }))}
          onAddCategory={addCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
          onAssignCategory={assignCategory}
          onClear={(group) => {
            commit((prev) => prev.filter((m) => (group === 'markup') !== isMarkup(m.type)))
            setSelectedIds([])
          }}
          onStartCalibrate={() => setTool('calibrate')}
          onEditCalibration={editCalibration}
          onApplyRatio={applyRatio}
          onResetCalibration={() => setCalibration(null)}
          fileName={fileName}
          top={
            <DocSearch
              ref={searchRef}
              doc={doc}
              measurements={measurements}
              categories={categories}
              onGo={jumpToHit}
              action={<SidebarToggle open onClick={() => setSidebarOpen(false)} />}
            />
          }
        />
      </div>

      {linkItem && (
        <LinkPicker
          store={store}
          currentId={doc.id}
          currentName={fileName}
          initial={linkItem.link}
          onCancel={() => {
            // 방금 그린 범위에서 연결을 취소하면 빈 범위는 남기지 않음
            if (linkPicking.fresh && !linkItem.link && !String(linkItem.text ?? '').trim()) deleteItems([linkItem.id])
            setLinkPicking(null)
          }}
          onUnlink={
            linkItem.link
              ? () => {
                  editMemo(linkItem.id, { link: null })
                  setLinkPicking(null)
                }
              : null
          }
          onConfirm={(link) => {
            editMemo(linkItem.id, { link })
            setLinkPicking(null)
          }}
        />
      )}

      {pendingCalibration && (
        <CalibrationDialog
          defaultUnit={unit}
          initial={pendingCalibration.edit && calibration?.mode === 'line' ? calibrationInput(calibration) : null}
          onCancel={() => setPendingCalibration(null)}
          onConfirm={applyCalibration}
        />
      )}
    </ImageSource.Provider>
  )
}

// 오른쪽 목록 접기/펼치기 버튼. 넓은 화면은 좌우(목록이 오른쪽), 좁은 화면은 위아래(목록이 아래)
function SidebarToggle({ open, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={open ? '오른쪽 목록 접기' : '오른쪽 목록 펼치기'}
      aria-expanded={open}
      title={open ? '목록 접기 (도면 넓게 보기)' : '목록 펼치기'}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-90 md:rotate-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={open ? 'M6 6l6 6-6 6M13 6l6 6-6 6' : 'M18 6l-6 6 6 6M11 6l-6 6 6 6'} />
      </svg>
    </button>
  )
}
