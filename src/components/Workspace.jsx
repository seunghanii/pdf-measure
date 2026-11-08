import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { distance } from '../lib/geometry'
import { PT_TO_PAPER_MM, UNITS, calibrationInput } from '../lib/units'
import { TYPE_INFO } from '../lib/measure'
import { canCategorize, newCategoryId, nextCategoryColor, withCategory } from '../lib/categories'
import { DEFAULT_BOX_OPACITY, FULL_CROP, MARKUP_STROKE, STROKE_TYPES, isCropped, isMarkup, rectOf, shapeOf, strokeOf } from '../lib/markup'
import { ImageSource, freshImageIds, getImageBlob, isImageFile, newImageId, prepareImage, rememberImage } from '../lib/images'
import { TOOLS, toolForDigit } from '../lib/tools'
import { toggleSnap } from '../lib/snapSetting'
import { useAutosave } from '../lib/autosave'
import { useDocIndex } from '../lib/indexer'
import { isTypingTarget } from '../lib/dom'
import { clipFor, clipboardMarker, copyItems, currentClip, makeClip, pasteItems } from '../lib/itemClipboard'
import PdfViewer from './PdfViewer'
import Toolbar from './Toolbar'
import Sidebar from './Sidebar'
import CalibrationDialog from './CalibrationDialog'
import DocSearch from './DocSearch'
import LinkPicker from './LinkPicker'
import BoxIcon from './BoxIcon'
import { DEFAULT_MEMO_COLOR, isLinkOnly, memoPhotoIds, memosAt } from '../lib/memo'
import { itemLabel, itemRect } from '../lib/activity'
import { backlinksFor, refreshLinkNames } from '../lib/backlinks'
import { linkBoxName } from '../lib/drawingNo'
import { composeMap, fixLinksAfterPageEdit, orderToMap, pageLogV, pushPageLog, renameMovedLinkBox } from '../lib/pageLinks'
import { memoFileIds } from '../lib/excel'
import { DEFAULT_STATUS, cardBoxFor, donePatch, doneUpTo, instForTag, tagPatch, isInst, itemGroup, linksPatch, memoLinkPhotoIds, memoLinks, statusOf } from '../lib/instrument'
import { liveItemTrash, pushItems, withoutTrashed } from '../lib/trash'
import { MAX_ZOOM, MIN_ZOOM } from '../lib/zoom'
import { adaptState, newRevKey, revisionReport } from '../lib/revision'
import { loadUncalHidden } from '../lib/scalePanel'
import RevisionDialog from './RevisionDialog'
import NotepadFloat from './NotepadFloat'
import { useMemoDock } from '../lib/memoDock'
import PageNavigator, { carryThumbs } from './PageNavigator'
import { loadPdf } from '../lib/pdf'
import { MAX_UPLOAD_BYTES } from '../lib/cloudStore'
import { buildPdf, popPageEdit, setPageEditCarry, takePageEditCarry, invertOrder, loadPageNavOpen, pageEditUndo, rememberPageEdit, remapIndex, remapState, rotatedSizes, savePageNavOpen, undoState } from '../lib/pageEdit'
import { readTagInBox } from '../lib/tagRead'

// 메모장은 마크다운 읽는 도구까지 필요할 때만 불러옴
const MemoPanel = lazy(() => import('./MemoPanel'))
const InstrumentPanel = lazy(() => import('./InstrumentPanel'))

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// 도면 하나(탭 하나)의 작업 공간. 탭을 바꿔도 마운트된 채로 남아서 상태가 유지됩니다.
// boxPick: 이 도면에서 연결할 박스를 고르는 중 { from, memoId, target } (App 이 보관)
// boxPickResult: 이 도면의 메모가 박스 고르기를 끝냄 { memoId, index, fresh, result: { link } | { cancelled } }
// onStartBoxPick(요청), onFinishBoxPick(결과), onBoxPickApplied(): 다른(또는 같은) 도면 탭을 오가며 박스 고르기
export default function Workspace({ doc, active, searchJump: rawSearchJump, onOpenLink, boxPick, boxPickResult, onStartBoxPick, onFinishBoxPick, onBoxPickApplied, library, onImportFile, onReviseDoc, pendingRevision, onPendingRevisionDone, onReplaceFile, onReloadDoc, sidebarOpen, setSidebarOpen, notepadOpen, setNotepadOpen, instKinds, onAddKind, onSetDocRoles }) {
  const { pdfDoc, name: fileName } = doc
  const saved = doc.savedState
  const [pageNum, setPageNum] = useState(() => Math.min(saved?.pageNum ?? 1, pdfDoc.numPages))
  const [zoom, setZoom] = useState(1)
  const [fitKey, setFitKey] = useState(1)
  const [fittedKey, setFittedKey] = useState(0)
  const [linkChoice, setLinkChoice] = useState(null) // '도면 열기' 박스를 눌러 갈 곳(또는 메모 열기)을 고르는 중 { id }
  const viewRef = useRef(null) // 보던 자리 (탭을 떠나면 PdfViewer 가 사라지므로 여기 보관)
  // 기준 길이 없는 도면은 기준선 긋기로 시작 (오른쪽 축척 칸을 접어 두었으면 선택 도구로)
  // 페이지 편집 뒤 다시 그려질 때는 쓰던 도구 그대로
  const carried = useState(() => takePageEditCarry(doc.id))[0]
  const [tool, setTool] = useState(() => carried?.tool ?? (saved?.calibration ? 'length' : loadUncalHidden() ? 'select' : 'calibrate'))
  const [measurements, setMeasurements] = useState(saved?.measurements ?? [])
  const [history, setHistory] = useState([])
  // 휴지통: 지운 항목 [{ item, at }]. 7일 지난 것은 열 때 뺌 (lib/trash.js)
  const [trash, setTrash] = useState(() => liveItemTrash(saved?.trash))
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
    shape: 'rect', // 도형 도구: 'rect' 사각형 | 'ellipse' 원
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
  const [linkPicking, setLinkPicking] = useState(null) // 도면 연결 고르는 중인 메모 { id, fresh: 방금 그린 범위, index: 바꿀 연결 (없으면 추가) }
  const memoDock = useMemoDock()
  const [instPanel, setInstPanel] = useState(null) // 계기 목록 창: 'list' | 'find' (태그 찾기)
  const placeRef = useRef(null) // 뷰어가 사진 넣을 자리를 알려 주는 함수
  const imageInputRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(doc.notice ?? '') // 개정판으로 바꾼 직후 안내
  // 개정판: 지금 판 { label, name, size, at } 과 예전 판 목록 (lib/revision.js). 바꾼 적 없으면 비어 있음
  // pageLog: 페이지 편집 기록 (다른 도면의 쪽 연결을 새 쪽으로 옮길 때, lib/pageLinks.js). 함께 저장되도록 여기에 둠
  const [revs, setRevs] = useState(() => ({ rev: saved?.rev ?? null, revisions: saved?.revisions ?? [], ...(saved?.pageLog && { pageLog: saved.pageLog }) }))
  const [revisionOpen, setRevisionOpen] = useState(false)
  // 왼쪽 위 페이지 탐색 창 (열림은 모든 도면 공통, 페이지를 바꾸면 탭이 새로 그려져도 열린 채로)
  const [pageNavOpen, setPageNavOpenRaw] = useState(loadPageNavOpen)
  const setPageNavOpen = useCallback((open) => {
    setPageNavOpenRaw(open)
    savePageNavOpen(open)
  }, [])
  const [pageBusy, setPageBusy] = useState('') // 페이지 편집 저장 중 안내
  const [revisionFile, setRevisionFile] = useState(null) // 개정 창을 열며 바로 고를 PDF (관련 도면 연결에서 넘어옴)
  // 다른 도면의 관련 도면 연결에서 "개정판으로 바꾸기"를 고르면 이 도면이 열리고 개정 창에 그 PDF 가 들어감
  useEffect(() => {
    if (!pendingRevision) return
    onPendingRevisionDone?.()
    if (!onReplaceFile || Date.now() - pendingRevision.nonce > 60_000) return
    setRevisionFile(pendingRevision.file)
    setRevisionOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRevision?.nonce])
  const autosaveCtl = useRef(null)
  // 툴바·목록에서 특정 페이지로 이동 요청 (뷰어가 스크롤)
  const [jump, setJump] = useState(null)
  const jumpTo = useCallback(
    (page) => setJump({ page: Math.min(Math.max(1, page), pdfDoc.numPages), nonce: Date.now() + Math.random() }),
    [pdfDoc],
  )
  // 검색 결과로 이동: 그 글자가 화면 가운데 오도록 확대하고 잠깐 깜빡임
  const jumpToHit = useCallback(
    (hit) =>
      setJump({ page: hit.page, rect: hit.rect, peekId: hit.hidden ? hit.itemId : null, nonce: Date.now() + Math.random() }),
    [],
  )
  // 박스 연결로 왔으면 그 박스의 지금 자리로 (고른 뒤 옮겼어도). 박스가 지워졌으면 고를 때의 쪽만
  const searchJump = useMemo(() => {
    if (!rawSearchJump?.item) return rawSearchJump
    const m = measurements.find((x) => x.id === rawSearchJump.item)
    if (!m) return { ...rawSearchJump, rect: null, missing: true }
    return { ...rawSearchJump, page: m.page ?? 1, rect: itemRect(m) ?? rawSearchJump.rect, peekId: m.hidden ? m.id : null }
    // 이동 요청(nonce)마다 한 번만 정함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSearchJump])
  useEffect(() => {
    if (searchJump?.missing) setNotice('연결한 박스가 이 도면에서 지워져서, 고를 때의 쪽만 열었어요.')
  }, [searchJump])
  // 홈 화면 검색에서 고른 위치 ({ page, rect, nonce }) 와 이 화면의 이동 요청 중 나중 것
  const pickedJump = searchJump && (!jump || searchJump.nonce > jump.nonce) ? searchJump : jump
  const clampedJump = pickedJump && pickedJump.page > pdfDoc.numPages ? { ...pickedJump, page: pdfDoc.numPages } : pickedJump
  // 숨긴 항목을 찾아 이동하면, 깜빡이는 동안만 그 항목을 흐리게 보여 줌 (숨김 설정은 그대로)
  const peekItem = clampedJump?.peekId ? measurements.find((m) => m.id === clampedJump.peekId && m.hidden) : null
  const viewerJump = useMemo(
    () => (clampedJump && peekItem ? { ...clampedJump, peek: peekItem } : clampedJump),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clampedJump?.nonce, clampedJump?.page, !!peekItem],
  )
  const searchRef = useRef(null)

  // 측정값이 바뀌면 잠시 뒤 자동 저장 (로그인했으면 서버, 아니면 이 브라우저)
  const store = doc.store
  const cloud = store.kind === 'cloud'
  const textIndex = useDocIndex(store, doc.id) // 도면 글자 (글자 복사 도구)
  // 다른 기기(창)에서 고친 것을 합친 상태를 화면에 반영 (되돌리기 목록은 그대로)
  const applyRemote = useCallback((st) => {
    const items = st.measurements ?? []
    setMeasurements(items)
    setTrash(liveItemTrash(st.trash))
    setCategories(st.categories ?? [])
    setCalibration(st.calibration ?? null)
    if (st.unit) setUnit(st.unit)
    if (st.markupStyle) setMarkupStyle((prev) => ({ ...prev, ...st.markupStyle }))
    counters.current = { ...counters.current, ...st.counters }
    setRevs({ rev: st.rev ?? null, revisions: st.revisions ?? [] })
    const live = new Set(items.map((m) => m.id))
    setSelectedIds((ids) => (ids.every((id) => live.has(id)) ? ids : ids.filter((id) => live.has(id))))
  }, [])
  const syncStatus = useAutosave({
    store,
    docId: doc.id,
    measurements,
    categories,
    calibration,
    unit,
    markupStyle,
    counters,
    pageNum,
    trash,
    revs,
    controlRef: autosaveCtl,
    saved,
    stamp: doc.savedStamp,
    size: doc.savedSize,
    active,
    onRemote: applyRemote,
    onReload: onReloadDoc,
  })

  // 축척: PDF 1pt 가 실제 몇 mm 인지
  const mmPerPt = useMemo(() => {
    if (!calibration) return null
    if (calibration.mode === 'ratio') return PT_TO_PAPER_MM * calibration.ratio
    const d = distance(calibration.points[0], calibration.points[1])
    return d > 0 ? calibration.realMm / d : null
  }, [calibration])

  const measurementsRef = useRef(measurements)
  const historyRef = useRef(history)
  const trashRef = useRef(trash)
  useLayoutEffect(() => {
    measurementsRef.current = measurements
    historyRef.current = history
    trashRef.current = trash
  })

  // 지운 뒤 Ctrl+Z 로 되살린 항목은 휴지통에서 뺌 (같은 항목이 두 곳에 있지 않게)
  useEffect(() => {
    if (!trash.length) return
    const ids = new Set(measurements.map((m) => m.id))
    if (trash.some((t) => ids.has(t.item.id))) setTrash((tr) => tr.filter((t) => !ids.has(t.item.id)))
  }, [measurements, trash])

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

  const readNewTag = useRef(null) // 방금 그린 Equipment 박스 (그려지면 박스 안 글자로 Tag. No 채움)
  const onComplete = useCallback(
    (type, points, page, extra) => {
      if (type === 'calibrate') {
        setPendingCalibration({ page, points })
        return
      }
      const ellipse = type === 'rect' && markupStyle.shape === 'ellipse'
      const counter = ellipse ? 'ellipse' : type // 원은 따로 번호 (원 1, 원 2 …)
      counters.current[counter] = (counters.current[counter] ?? 0) + 1
      const m = {
        id: newId(),
        type,
        page,
        points,
        name: `${ellipse ? '원' : TYPE_INFO[type].name} ${counters.current[counter]}`,
      }
      if (ellipse) m.shape = 'ellipse' // 사각형은 예전처럼 shape 없이 저장
      if (isMarkup(type)) {
        m.color = type === 'highlight' ? markupStyle.highlightColor : type === 'memo' ? markupStyle.memoColor : markupStyle.color
        if (type === 'memo') {
          m.text = ''
          // 계기 카드로 그리기: 태그·상태 칸이 있는 메모 (상태 색)
          if (markupStyle.memoKind === 'inst') {
            m.inst = { tag: '', kind: '', status: DEFAULT_STATUS }
            m.color = statusOf(DEFAULT_STATUS).color
            readNewTag.current = m.id
          }
        }
        if (type === 'text') {
          m.fontSize = markupStyle.fontSize
          m.boxOpacity = markupStyle.boxOpacity
          m.align = markupStyle.textAlign
        }
        if (STROKE_TYPES.includes(type)) m.strokeWidth = markupStyle.strokeWidth
      }
      Object.assign(m, extra)
      // 도면 열기 박스 이름: 이 도면의 원래 번호 + (쪽 OF 전체 쪽). 별명은 쓰지 않음
      if (type === 'memo' && markupStyle.memoKind === 'link') m.name = linkBoxName(fileName, page, pdfDoc.numPages)
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
    [categories, commit, markupStyle, fileName, pdfDoc],
  )

  // ---------- 측정 분류 ----------
  const addCategory = (name, color) => {
    const cat = { id: newCategoryId(), name, color: color ?? nextCategoryColor(categories) }
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
  // page 를 주면 그 쪽으로 옮김 (다른 페이지 위에 끌어 놓기)
  // 기본 이름 그대로인 링크 박스("도면 번호 (3 OF 10)")는 이름도 새 쪽으로
  const onSetPoints = useCallback(
    (map, page) => {
      setMeasurements((prev) =>
        prev.map((m) =>
          map[m.id] ? (page ? { ...m, points: map[m.id], page, name: renameMovedLinkBox(m, page, fileName, pdfDoc.numPages) } : { ...m, points: map[m.id] }) : m,
        ),
      )
    },
    [fileName, pdfDoc],
  )

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
  const selShape = selectedMarkups.find((m) => m.type === 'rect')
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
          ...(selShape && { shape: shapeOf(selShape) }),
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
      if (patch.shape && m.type === 'rect' && shapeOf(m) !== patch.shape) out.shape = patch.shape === 'ellipse' ? 'ellipse' : undefined
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
      setNotice(`PDF 로 내보냈어요: ${base}_마크업.pdf. 브라우저의 다운로드 폴더를 확인해 주세요.`)
    } catch (e) {
      console.error(e)
      setNotice('PDF 내보내기에 실패했어요. 다시 해 주세요.')
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

  // 지운 사진 정리: 도면을 열 때 어디에도 쓰이지 않는 사진(지운 뒤 저장된 것)을 저장소에서 지움
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const ids = await store.listImageIds(doc.id)
        if (!ids.length) return
        const used = new Set()
        for (const list of [measurementsRef.current, ...historyRef.current, trashRef.current.map((t) => t.item)])
          for (const m of list) {
            if (m.type === 'image') used.add(m.imageId)
            if (m.type === 'memo') {
              memoPhotoIds(m).forEach((id) => used.add(id))
              memoFileIds(m).forEach((id) => used.add(id)) // 첨부한 엑셀
              memoLinkPhotoIds(m).forEach((id) => used.add(id)) // 관련 도면으로 연결한 사진
            }
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
        setLinkChoice({ id: target.id, nonce: Date.now() }) // 박스 아래에 갈 곳 목록 + 메모 열기
        return
      }
      setLinkPicking(null)
      setMemoOpen({ id: target.id, others: stack.length > 1 ? stack.map((m) => m.id) : [] })
    },
    [],
  )
  const closeLinkChoice = useCallback(() => setLinkChoice(null), [])
  const editLinks = useCallback(
    (id) => {
      setLinkChoice(null)
      openMemoAt(id, null, null, { force: true })
    },
    [openMemoAt],
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

  // ---------- 박스 고르기 (도면 연결이 다른 박스를 가리키게) ----------
  // 이 도면의 메모가 연결할 박스를 고르고 돌아옴: 연결을 더하거나 바꿈. 취소면 방금 그린 빈 범위는 지움
  useEffect(() => {
    if (!boxPickResult) return
    const { memoId, index, fresh, result } = boxPickResult
    onBoxPickApplied?.()
    const memo = measurementsRef.current.find((m) => m.id === memoId)
    if (!memo) return
    const links = memoLinks(memo)
    if (result?.link) {
      const next = index != null && links[index] ? links.map((l, i) => (i === index ? result.link : l)) : [...links, result.link]
      editMemo(memo.id, linksPatch(next))
      setNotice(`"${result.link.itemName}" 박스를 연결했어요. 누르면 그 박스로 가요.`)
      // 메모·계기 카드였으면 메모장을 다시 열어 둠 (연결만 있는 범위는 그대로)
      if (memo.inst || String(memo.text ?? '').trim() || memoPhotoIds(memo).length || links.length) setMemoOpen({ id: memo.id, others: [] })
    } else if (fresh && !links.length && !memo.inst && !String(memo.text ?? '').trim()) deleteItems([memo.id], { keep: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxPickResult])

  // 이 도면에서 박스를 고르는 중 (다른 도면, 또는 이 도면의 메모가 이 도면 박스를 고름)
  const pickItem = useCallback(
    (id) => {
      if (!boxPick) return
      const m = measurementsRef.current.find((x) => x.id === id)
      if (!m) return
      if (boxPick.from === doc.id && id === boxPick.memoId) {
        setNotice('지금 연결하는 박스 자신은 고를 수 없어요. 다른 박스를 눌러 주세요.')
        return
      }
      onFinishBoxPick({ link: { ...boxPick.target, page: m.page ?? 1, item: m.id, itemName: itemLabel(m), rect: itemRect(m) } })
    },
    [boxPick, doc.id, onFinishBoxPick],
  )
  // 박스 고르기 중 빈 곳을 끌면: 그 자리에 새 메모 범위를 만들고 그것을 연결
  const pickNewBox = useCallback(
    (type, points, page) => {
      if (!boxPick || type !== 'memo') return
      counters.current.memo = (counters.current.memo ?? 0) + 1
      const m = { id: newId(), type: 'memo', page, points, name: `메모 ${counters.current.memo}`, color: DEFAULT_MEMO_COLOR, text: '' }
      // '도면 열기' 박스에서 왔으면 새 박스도 그 박스로 돌아가는 '도면 열기' 박스 (같은 색)
      if (boxPick.back) {
        const { color, ...back } = boxPick.back
        if (color) m.color = color
        Object.assign(m, linksPatch([back]))
        m.name = linkBoxName(fileName, page, pdfDoc.numPages)
      }
      commit((prev) => [...prev, m])
      onFinishBoxPick({ link: { ...boxPick.target, page, item: m.id, itemName: itemLabel(m), rect: itemRect(m) } })
    },
    [boxPick, commit, onFinishBoxPick, fileName, pdfDoc],
  )
  useEffect(() => {
    if (!boxPick || !active) return
    const down = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onFinishBoxPick({ cancelled: true })
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [boxPick, active, onFinishBoxPick])

  // ---------- 계기 카드 ----------
  const instCount = useMemo(() => measurements.filter(isInst).length, [measurements])
  // 목록에서 이 도면 카드로: 그 자리로 이동(확대·깜빡임)하고 선택. open: 카드(메모장)도 엶 (두 번 누름)
  const goToCard = useCallback(
    (row, open) => {
      const [x, y, w, h] = row.rect
      jumpToHit({ page: row.page, rect: { x, y, w, h }, hidden: !!row.hidden, itemId: row.id })
      if (!row.hidden) setSelectedIds([row.id])
      if (open && !row.hidden) openMemoAt(row.id, null, null, { force: true })
      else setMemoOpen(null) // 메모장이 그 자리를 가리지 않게
    },
    [jumpToHit, openMemoAt],
  )
  const setCardStatus = useCallback(
    (id, status) => {
      beginEdit()
      // 목록의 상태 칸은 하나만 고름: 그 단계까지 고른 작업·날짜는 두고 뒤 단계는 뺌
      const inst = measurementsRef.current.find((m) => m.id === id)?.inst
      updateItem(id, donePatch(inst, doneUpTo(inst, status)))
    },
    [beginEdit, updateItem],
  )
  // Equipment 박스 안 글자로 Tag. No 채우기 (PDF 글자, 없으면 박스 부분만 OCR)
  // force: '박스 읽기' 단추 (이미 적힌 태그도 바꾸고, 못 읽으면 알림). 아니면 새 박스: 그사이 사용자가 태그를 쳤으면 그대로 둠
  const [tagReading, setTagReading] = useState(() => new Set())
  const readTag = useCallback(
    async (id, force = false) => {
      const m = measurementsRef.current.find((x) => x.id === id)
      if (!m?.points?.length) return
      const rect = rectOf(m.points[0], m.points[1] ?? m.points[0])
      const busy = (on) =>
        setTagReading((cur) => {
          const next = new Set(cur)
          if (on) next.add(id)
          else next.delete(id)
          return next
        })
      busy(true)
      let hit = null
      try {
        hit = await readTagInBox({ pdfDoc, page: m.page ?? 1, rect })
      } catch (e) {
        console.warn('박스 글자 읽기 실패', e)
      } finally {
        busy(false)
      }
      const cur = measurementsRef.current.find((x) => x.id === id)
      if (!cur?.inst) return
      if (!hit) {
        if (force) setNotice('박스 안에서 Tag. No 를 읽지 못했어요. 글자가 박스 안에 다 들어오게 그리거나 직접 입력해 주세요.')
        return
      }
      if (!force && cur.inst.tag?.trim()) return
      if (hit.tag === cur.inst.tag) return
      if (force) beginEdit()
      updateItem(id, tagPatch(cur, hit.tag, instKinds, { canon: true }))
    },
    [pdfDoc, instKinds, beginEdit, updateItem],
  )
  useEffect(() => {
    const id = readNewTag.current
    if (!id || !measurements.some((m) => m.id === id)) return
    readNewTag.current = null
    readTag(id)
  }, [measurements, readTag])
  // 태그 찾기에서 고른 태그 자리마다 계기 카드 만들기 (되돌리기 한 번에 모두 취소)
  const createCards = useCallback(
    (hits) => {
      if (!hits.length) return
      const color = statusOf(DEFAULT_STATUS).color
      const cards = hits.map((h, i) => {
        const inst = instForTag(h.tag, instKinds, DEFAULT_STATUS)
        return { id: `${newId()}${i}`, type: 'memo', page: h.page, points: cardBoxFor(h.rect), name: inst.tag, text: '', color, inst }
      })
      commit((prev) => [...prev, ...cards])
      setSelectedIds(cards.map((c) => c.id))
      setNotice(`Equipment ${cards.length}개를 만들었어요. 잘못 만든 것은 Ctrl+Z 로 한 번에 되돌릴 수 있어요.`)
    },
    [commit, instKinds],
  )

  // ids: 지울 항목 id 배열 (기준선은 목록에서 따로 지움). 지운 항목은 휴지통으로 (keep: false 면 바로 버림)
  const deleteItems = useCallback(
    (ids, { keep = true } = {}) => {
      const del = new Set(ids.filter((id) => id !== 'calibration'))
      if (!del.size) return
      const gone = measurementsRef.current.filter((m) => del.has(m.id))
      if (keep && gone.length) setTrash((tr) => pushItems(tr, gone))
      commit((prev) => prev.filter((m) => !del.has(m.id)))
      setSelectedIds((s) => s.filter((id) => !del.has(id)))
    },
    [commit],
  )

  // ---------- 항목 복사·붙여넣기 (Ctrl/Cmd+C, X, V) — lib/itemClipboard.js ----------
  const categoriesRef = useRef(categories)
  categoriesRef.current = categories
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const addCategoryRef = useRef(addCategory)
  addCategoryRef.current = addCategory
  const copySelected = useCallback(
    ({ cut = false } = {}) => {
      const set = new Set(selectedIds)
      const items = measurementsRef.current.filter((m) => set.has(m.id) && !m.hidden)
      if (!items.length) return null
      const c = copyItems(items, { categories: categoriesRef.current, store, docId: doc.id, spot: placeRef.current?.() })
      if (cut) deleteItems(items.map((m) => m.id))
      setNotice(
        `${items.length === 1 ? `"${items[0].name}" 항목을` : `항목 ${items.length}개를`} ${cut ? '잘라' : '복사해'} 뒀어요. 이 도면이나 다른 도면에서 Ctrl+V 로 붙여넣으세요.`,
      )
      return c
    },
    [deleteItems, doc.id, selectedIds, store],
  )
  const pasting = useRef(false)
  // here: false 면 마우스 자리를 보지 않고 원래 자리 옆에 (복제 단추)
  const pasteClip = useCallback(
    async (c, { here = true } = {}) => {
      if (pasting.current) return
      pasting.current = true
      try {
        const { items, failed } = await pasteItems(c, {
          docId: doc.id,
          store,
          spot: here ? placeRef.current?.() : undefined,
          numPages: pdfDoc.numPages,
          counters: counters.current,
          categories: categoriesRef.current,
          addCategory: (name, color) => addCategoryRef.current(name, color),
          newId,
        })
        if (!items.length) return
        commit((prev) => [...prev, ...items])
        setTool('select')
        setSelectedIds(items.map((m) => m.id))
        if (failed) setNotice(`사진·엑셀 파일 ${failed}개는 복사하지 못했어요. 인터넷 연결을 확인해 주세요.`)
        else if (items[0].page !== pageNum && new Set(items.map((m) => m.page)).size === 1) jumpTo(items[0].page)
      } catch (e) {
        console.error(e)
        setNotice('붙여넣기에 실패했어요. 다시 시도해 주세요.')
      } finally {
        pasting.current = false
      }
    },
    [commit, doc.id, jumpTo, pageNum, pdfDoc, store],
  )

  // 복제: 고른 항목(메모·계기 카드는 글·사진·엑셀·계기 정보·관련 도면까지)을 원래 자리 살짝 옆에 하나 더.
  // 복사·붙여넣기와 같은 길을 쓰되, Ctrl+C 로 복사해 둔 것은 그대로 둠
  const duplicateItems = useCallback(
    (ids) => {
      const set = new Set(ids)
      const items = measurementsRef.current.filter((m) => set.has(m.id) && m.id !== 'calibration' && !m.hidden)
      if (!items.length) return
      const c = makeClip(items, { categories: categoriesRef.current, store, docId: doc.id })
      pasteClip(c, { here: false })
    },
    [doc.id, pasteClip, store],
  )

  // 키보드 자리: 글 입력 중이거나 화면 글자를 드래그로 골라 둔 경우는 브라우저 기본 복사·붙여넣기
  const itemKeysOff = (e) =>
    isTypingTarget(e.target) || isTypingTarget(document.activeElement) || !!pendingCalibration
  const textSelected = () => !!window.getSelection?.()?.toString()
  const lastCopy = useRef(null) // 키를 누를 때 만든 복사본 (곧 이어 오는 copy 이벤트가 같은 것을 씀)
  const lastPasteEvent = useRef(0)

  // Ctrl+C/X: 고른 항목 복사 → 시스템 클립보드에는 표시 글. Ctrl+V: 복사한 항목, 아니면 사진 넣기
  useEffect(() => {
    if (!active) return
    const onCopy = (e) => {
      if (e.defaultPrevented || itemKeysOff(e) || textSelected()) return
      const recent = lastCopy.current && Date.now() - lastCopy.current.at < 400 ? lastCopy.current.clip : null
      const c = recent ?? copySelected({ cut: e.type === 'cut' })
      if (!c) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', clipboardMarker(c))
    }
    const onPaste = (e) => {
      lastPasteEvent.current = Date.now()
      // 메모·입력칸이 이미 처리한 붙여넣기는 무시. 메모가 붙여넣으며 글자 자리(e.target)를
      // 바꿔 끼우면 그 요소가 문서에서 떨어져 isContentEditable 이 false 가 되므로
      // 지금 포커스된 요소와 defaultPrevented 도 함께 봄 (엑셀 표가 도면에 사진으로도 들어가던 문제)
      if (e.defaultPrevented || isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return
      // 복사해 둔 항목: 시스템 클립보드 글이 그때 넣은 표시 그대로일 때만 (그 뒤 다른 걸 복사했으면 그것이 우선)
      const c = clipFor(e.clipboardData?.getData('text/plain'))
      if (c) {
        e.preventDefault()
        pasteClip(c)
        return
      }
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
      if (!files.length) return
      e.preventDefault()
      insertImages(files)
    }
    // 사파리처럼 글자를 고르지 않으면 copy/paste 이벤트를 안 보내는 브라우저용: 키로 직접
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat) return
      if (itemKeysOff(e) || textSelected()) return
      if (e.code === 'KeyD') {
        // Ctrl/Cmd+D: 고른 항목 복제 (브라우저 즐겨찾기 대신)
        if (!selectedIdsRef.current.length) return
        e.preventDefault()
        duplicateItems(selectedIdsRef.current)
      } else if (e.code === 'KeyC' || e.code === 'KeyX') {
        const c = copySelected({ cut: e.code === 'KeyX' })
        if (!c) return
        lastCopy.current = { clip: c, at: Date.now() }
        navigator.clipboard?.writeText(clipboardMarker(c)).catch(() => {})
      } else if (e.code === 'KeyV' && currentClip()) {
        const at = Date.now()
        setTimeout(() => {
          if (lastPasteEvent.current >= at) return // 붙여넣기 이벤트가 왔으면 거기서 처리
          navigator.clipboard
            ?.readText()
            .then((t) => {
              const c = clipFor(t)
              if (c) pasteClip(c)
            })
            .catch(() => {})
        }, 80)
      }
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCopy)
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCopy)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, copySelected, duplicateItems, insertImages, pasteClip, pendingCalibration])

  // 휴지통에서 되살리기: 원래 자리(같은 페이지·좌표)로 돌아감
  const restoreItems = useCallback(
    (ids) => {
      const set = new Set(ids)
      const back = trashRef.current.filter((t) => set.has(t.item.id)).map((t) => t.item)
      if (!back.length) return
      const have = new Set(measurementsRef.current.map((m) => m.id))
      const add = back.filter((m) => !have.has(m.id))
      setTrash((tr) => tr.filter((t) => !set.has(t.item.id)))
      if (add.length) commit((prev) => [...prev, ...add])
      setNotice(`${back.length === 1 ? `"${back[0].name}" 항목을` : `항목 ${back.length}개를`} 되살렸어요.`)
    },
    [commit],
  )
  // 휴지통에서 완전히 지우기 (ids 가 없으면 휴지통 비우기)
  const purgeTrash = useCallback((ids) => {
    if (!ids) return setTrash([])
    const set = new Set(ids)
    setTrash((tr) => tr.filter((t) => !set.has(t.item.id)))
  }, [])

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
      // E: Equipment 박스, K: 링크 박스 (박스 도구를 그 종류로). N(메모 박스)은 아래 TOOLS 에서
      const boxKind = e.shiftKey ? null : e.code === 'KeyE' ? 'inst' : e.code === 'KeyK' ? 'link' : null
      if (boxKind && pdfDoc) {
        e.preventDefault()
        setTool('memo')
        setMarkupStyle((st) => ({ ...st, memoKind: boxKind }))
        return
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())?.id
      if (t && pdfDoc) setTool(t)
      if (t === 'memo') setMarkupStyle((st) => (st.memoKind !== 'note' ? { ...st, memoKind: 'note' } : st))
      if (e.key === 'Delete' || (e.key === 'Backspace' && tool === 'select')) {
        if (selectedIds.length) {
          e.preventDefault()
          deleteItems(selectedIds)
        }
      }
      if (e.key === 'Escape' && memoOpen) setMemoOpen(null)
      else if (e.key === 'Escape' && instPanel) setInstPanel(null)
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
  }, [active, cropping, deleteItems, instPanel, jumpTo, memoOpen, pageNum, pdfDoc, pendingCalibration, savePdf, selectedIds, setSidebarOpen, sidebarOpen, tool, undo])

  const visibleMeasurements = useMemo(() => measurements.filter((m) => !m.hidden), [measurements])

  // ---------- 여기로 연결한 박스 (양방향 연결) ----------
  // 다른 도면의 요약은 이 탭을 볼 때마다 다시 받음 (목록은 잠깐 모아 두고 저장할 때 고쳐지므로 가벼움)
  const [otherDocs, setOtherDocs] = useState(null)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    store
      .listRecent()
      .then((rows) => !cancelled && setOtherDocs(withoutTrashed(rows)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, store, rawSearchJump])
  const backlinks = useMemo(() => backlinksFor(doc.id, fileName, measurements, otherDocs), [doc.id, fileName, measurements, otherDocs])
  // 연결한 박스의 이름을 그쪽에서 바꿨으면 연결에 적힌 이름도 맞춤 (되돌리기 목록에는 넣지 않음)
  useEffect(() => {
    const fix = refreshLinkNames(doc.id, measurements, otherDocs)
    if (fix) setMeasurements((prev) => prev.map((m) => (fix.has(m.id) ? { ...m, ...linksPatch(fix.get(m.id)) } : m)))
  }, [doc.id, measurements, otherDocs])

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
  // group: 'measure' | 'markup' | 'inst'
  const setAllHidden = (hidden, group) => {
    const inGroup = (m) => itemGroup(m) === group
    if (hidden) {
      const ids = new Set(measurementsRef.current.filter(inGroup).map((m) => m.id))
      setSelectedIds((s) => s.filter((x) => !ids.has(x)))
    }
    setMeasurements((prev) => prev.map((m) => (inGroup(m) ? { ...m, hidden } : m)))
  }

  if (!active) return null

  // ---------- 개정판으로 바꾸기 ----------
  // 처음 바꿀 때는 지금 PDF 를 "처음 판" 으로 (크기는 도면 id "이름|크기" 에서)
  const currentRev = revs.rev ?? { label: '처음 판', name: fileName, size: Number(doc.id.slice(doc.id.lastIndexOf('|') + 1)) || 0, at: null }
  const applyRevision = async ({ file, newPdf, oldSizes, newSizes, fit, label, fromRev, report }) => {
    // '페이지 편집 전' 보관본으로 복원하면 판 이름은 원래 이름 그대로, 지금 PDF 는 '페이지 편집 후' 로 보관
    const restoringBackup = !!fromRev?.pageBackup
    if (restoringBackup) label = label.replace(/ · 페이지 편집 전$/, '')
    // 예전 판으로 복원: 그 판 뒤에 페이지를 넣고 지우고 옮겼으면 항목을 그 판의 쪽 번호로 되돌린 뒤 맞춤
    let base = { measurements, trash, calibration }
    let pageLog = revs.pageLog
    const back = fromRev ? composeMap(revs.pageLog, fromRev.pv ?? 0, newPdf.numPages) : null
    if (back && back.some((p, i) => p !== i + 1)) {
      const order = back.map((p, i) => (p && p <= pdfDoc.numPages ? { src: p } : { blank: newSizes[i] }))
      const re = remapState({ measurements, trash, calibration, pageNum }, order, pdfDoc.numPages)
      const map = orderToMap(order, pdfDoc.numPages)
      base = {
        measurements: fixLinksAfterPageEdit(re.measurements, measurements, { docId: doc.id, fileName, map, oldNumPages: pdfDoc.numPages, newNumPages: order.length }),
        trash: re.trash,
        calibration: re.calibration,
      }
      oldSizes = order.map((e, i) => (e.src ? oldSizes[e.src - 1] : newSizes[i]))
      report = revisionReport(oldSizes, newSizes, base.measurements)
      pageLog = pushPageLog(revs.pageLog, map)
    }
    const adapted = adaptState(base, oldSizes, newSizes, fit)
    const keepKey = newRevKey()
    const now = Date.now()
    const rest = revs.revisions.filter((r) => r.key !== fromRev?.key)
    const buildState = (kept) => ({
      measurements: adapted.measurements,
      categories,
      calibration: adapted.calibration,
      unit,
      markupStyle,
      counters: counters.current,
      trash: adapted.trash,
      pageNum: Math.min(pageNum, newPdf.numPages),
      rev: { label, name: file.name, size: file.size, at: now },
      // pv: 이 판일 때의 페이지 편집 횟수 (나중에 복원할 때 그 뒤 편집을 되돌리려고)
      revisions: [{ ...currentRev, ...(restoringBackup && { label: `${currentRev.label} · 페이지 편집 후` }), key: keepKey, file: kept, replacedAt: now, pv: pageLogV(revs.pageLog) }, ...rest],
      ...(pageLog && { pageLog }),
      activity: autosaveCtl.current?.activity?.() ?? [],
    })
    const parts = [`"${label}" 판으로 ${fromRev ? '복원했어요' : '바꿨어요'}.`]
    if (fit && report.scaled.length) parts.push('쪽 크기가 바뀌어 마크업과 축척을 새 크기에 맞췄어요.')
    if (report.reshaped.length) parts.push(`${report.reshaped.map((p) => p.page).join(', ')}쪽은 비율이 달라 마크업 자리를 확인해 주세요.`)
    if (report.goneCount) parts.push(`${report.goneFrom}쪽부터 있던 항목 ${report.goneCount}개는 보관만 해 뒀어요.`)
    if (calibration) parts.push('기준 길이가 맞는지 한 번 확인해 주세요.')
    // 바꾸는 동안 자동 저장을 멈춤 (예전 PDF 에 맞춘 상태가 새 상태를 덮어쓰지 않게)
    await autosaveCtl.current?.stop()
    try {
      await onReplaceFile({ file, pdfDoc: newPdf, keepKey, buildState, dropRevKey: fromRev?.key, notice: parts.join(' ') })
    } catch (e) {
      autosaveCtl.current?.resume()
      throw e
    }
  }
  // ---------- 페이지 편집 (빈 페이지 넣기·지우기·순서 바꾸기) ----------
  // order: lib/pageEdit.js 의 새 쪽 목록, label: 되돌리기에 보일 이름, focus: 편집 뒤 볼 쪽 (새 번호)
  const pageUndo = pageEditUndo(doc.id)
  const canUndoPages = !!pageUndo && pageUndo.pdf === pdfDoc
  const nowState = () => ({ measurements, trash, calibration, pageNum })
  // backup: 편집 전 PDF 를 예전 판 '페이지 편집 전' 으로 보관 (이 창에서 이 도면을 처음 편집할 때만, 그런 보관본은 하나만 둠)
  const savePages = async ({ file, newPdf, next, index, notice, backup = false }) => {
    await autosaveCtl.current?.stop()
    const keepKey = backup ? newRevKey() : null
    const oldBackups = backup ? revs.revisions.filter((r) => r.pageBackup) : []
    try {
      const now = Date.now()
      let keptBackup = false
      const revisionsAfter = (kept) =>
        (keptBackup = backup && !!kept)
          ? [
              { ...currentRev, label: `${currentRev.label} · 페이지 편집 전`, key: keepKey, file: true, replacedAt: now, pv: pageLogV(revs.pageLog), pageBackup: true },
              ...revs.revisions.filter((r) => !r.pageBackup),
            ]
          : revs.revisions
      const buildState = (kept) => ({
        measurements: next.measurements,
        categories,
        calibration: next.calibration,
        unit,
        markupStyle,
        counters: counters.current,
        trash: next.trash,
        pageNum: next.pageNum,
        // 지금 판의 크기만 새 파일에 맞춤 (판 이름·예전 판 목록은 그대로)
        ...(revs.rev ? { rev: { ...revs.rev, name: file.name, size: file.size } } : {}),
        revisions: revisionsAfter(kept),
        pageLog: next.pageLog,
        activity: autosaveCtl.current?.activity?.() ?? [],
      })
      setPageEditCarry(doc.id, { tool: tool === 'calibrate' ? 'select' : tool })
      await onReplaceFile({ file, pdfDoc: newPdf, buildState, index, notice, ...(keepKey && { keepKey }) })
      // 예전 '페이지 편집 전' 보관본은 새것으로 바꿈
      if (keptBackup) for (const r of oldBackups) store.removeRevisionFile(doc.id, r.key).catch((e) => console.warn('예전 보관본 지우기 실패', e))
    } catch (e) {
      takePageEditCarry(doc.id)
      autosaveCtl.current?.resume()
      throw e
    }
  }
  const editPages = async (order, { label, focus }) => {
    if (pageBusy || !onReplaceFile) return
    setPageBusy('페이지를 저장하고 있어요…')
    setNotice('')
    let newPdf = null
    try {
      const file = await buildPdf(pdfDoc, order, fileName)
      if (cloud && file.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('too large'), { code: 'too_large' })
      newPdf = await loadPdf(await file.arrayBuffer())
      carryThumbs(pdfDoc, newPdf, order)
      const key = newRevKey()
      const before = nowState()
      const sizes = await rotatedSizes(pdfDoc, order)
      const next = remapState(before, order, pdfDoc.numPages, { editKey: key, sizes })
      if (focus) next.pageNum = focus
      // 쪽 번호로 건 연결·링크 박스 기본 이름도 새 쪽으로, 다른 도면의 연결을 위해 편집 기록을 남김
      const map = orderToMap(order, pdfDoc.numPages)
      next.measurements = fixLinksAfterPageEdit(next.measurements, before.measurements, { docId: doc.id, fileName, map, oldNumPages: pdfDoc.numPages, newNumPages: order.length })
      next.pageLog = pushPageLog(revs.pageLog, map)
      const oldFile = new File([await pdfDoc.getData()], fileName, { type: 'application/pdf' })
      const parts = [`${label}: 완료했어요.`]
      if (next.goneCount) parts.push(`지운 쪽의 항목 ${next.goneCount}개는 휴지통에 있어요 (되돌리기를 누르면 원래대로).`)
      if (before.calibration?.mode === 'line' && next.calibration?.mode === 'ratio') parts.push('지운 쪽에 있던 기준선은 같은 축척(1:N)으로 바꿔 뒀어요.')
      // 이 창에서 처음 편집이면 편집 전 PDF 를 예전 판으로 보관 (창을 닫으면 되돌리기는 사라지므로)
      const backup = !pageEditUndo(doc.id)
      if (backup) parts.push("편집 전 PDF 는 '개정' 창에 '페이지 편집 전' 판으로 보관했어요.")
      await savePages({ file, newPdf, next, index: remapIndex(textIndex, order, pdfDoc.numPages, sizes), notice: parts.join(' '), backup })
      rememberPageEdit(doc.id, {
        key,
        label,
        pdf: newPdf,
        order,
        oldNumPages: pdfDoc.numPages,
        file: oldFile,
        index: textIndex,
        calBefore: before.calibration,
        calAfter: next.calibration,
      })
    } catch (e) {
      console.warn('페이지 편집 실패', e)
      newPdf?.loadingTask?.destroy()
      setNotice(
        e?.code === 'too_large'
          ? '페이지를 바꾼 PDF 가 50MB 를 넘어 서버에 올릴 수 없어요.'
          : '페이지를 바꾸지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요. (도면은 예전 그대로예요)',
      )
      setPageBusy('')
    }
  }
  const undoPages = async () => {
    const entry = pageEditUndo(doc.id)
    if (!entry || entry.pdf !== pdfDoc || pageBusy) return
    setPageBusy('되돌리고 있어요…')
    setNotice('')
    let newPdf = null
    try {
      newPdf = await loadPdf(await entry.file.arrayBuffer())
      const inv = invertOrder(entry.order, entry.oldNumPages)
      carryThumbs(pdfDoc, newPdf, inv)
      const next = undoState(nowState(), entry, await rotatedSizes(pdfDoc, inv))
      const map = orderToMap(invertOrder(entry.order, entry.oldNumPages), pdfDoc.numPages)
      next.measurements = fixLinksAfterPageEdit(next.measurements, measurements, { docId: doc.id, fileName, map, oldNumPages: pdfDoc.numPages, newNumPages: entry.oldNumPages })
      next.pageLog = pushPageLog(revs.pageLog, map)
      await savePages({ file: entry.file, newPdf, next, index: entry.index ?? null, notice: `${entry.label}: 되돌렸어요.` })
      popPageEdit(doc.id, newPdf)
    } catch (e) {
      console.warn('페이지 되돌리기 실패', e)
      newPdf?.loadingTask?.destroy()
      setNotice('되돌리지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
      setPageBusy('')
    }
  }
  const removeRevision = (r) => {
    setRevs((v) => ({ ...v, revisions: v.revisions.filter((x) => x.key !== r.key) }))
    if (r.file) store.removeRevisionFile(doc.id, r.key).catch((e) => console.warn('예전 판 PDF 지우기 실패', e))
  }

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
        pdfDoc={pdfDoc}
        pageNum={pageNum}
        setPageNum={jumpTo}
        zoom={zoom}
        setZoom={setZoom}
        onFit={() => setFitKey((k) => k + 1)}
        tool={tool}
        setTool={setTool}
        canUndo={history.length > 0}
        onUndo={undo}
        markupStyle={shownStyle}
        onChangeMarkupStyle={changeMarkupStyle}
        selectedMarkupType={selectedMarkupType}
        selectedHasStroke={tool === 'select' && !!selStroke}
        selectedHasShape={tool === 'select' && !!selShape}
        onInsertImage={() => imageInputRef.current?.click()}
        memoActions={
          tool === 'select' && onlyMemos
            ? {
                onOpen: () => openMemoAt(selMemos[0].id, null, null, { force: true }),
                onLink: () => {
                  setMemoOpen(null)
                  setLinkPicking({ id: selMemos[0].id })
                },
                linked: memoLinks(selMemos[0]).length > 0,
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
        onRevision={onReplaceFile ? () => setRevisionOpen(true) : null}
        revLabel={revs.rev?.label}
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
        {pageNavOpen && (
          <PageNavigator
            docId={doc.id}
            pdfDoc={pdfDoc}
            pageNum={pageNum}
            onGo={jumpTo}
            measurements={measurements}
            onEdit={onReplaceFile && !boxPick ? editPages : null}
            busy={pageBusy}
            undoLabel={canUndoPages ? pageUndo.label : null}
            onUndo={undoPages}
            onClose={() => setPageNavOpen(false)}
          />
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1">
          {!pageNavOpen && <PageNavButton pageNum={pageNum} numPages={pdfDoc.numPages} onClick={() => setPageNavOpen(true)} />}
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
            viewRef={viewRef}
            tool={boxPick ? 'memo' : tool}
            measurements={visibleMeasurements}
            calibration={calibration?.mode === 'line' && !calibration.hidden ? calibration : null}
            selectedIds={boxPick ? NO_IDS : selectedIds}
            onSelect={setSelectedIds}
            onComplete={boxPick ? pickNewBox : onComplete}
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
            onDelete={deleteItems}
            onDuplicate={duplicateItems}
            textIndex={textIndex}
            onPickItem={boxPick ? pickItem : undefined}
            backlinks={boxPick ? null : backlinks}
            onOpenLink={onOpenLink}
            linkChoice={boxPick ? null : linkChoice}
            onLinkChoiceClose={closeLinkChoice}
            onEditLinks={editLinks}
            library={library}
          />
          {/* 왼쪽 아래 메모장 단추: 계기 목록 창·아래에 길게 놓인 박스 메모가 그 자리를 덮을 때는 단추만 숨김 */}
          <NotepadFloat store={store} open={!!notepadOpen} setOpen={(v) => setNotepadOpen?.(v)} hideButton={!!instPanel || (!!memoItem && memoDock === 'bottom')} />
          {boxPick && <BoxPickBar from={boxPick.fromName} same={boxPick.from === doc.id} onCancel={() => onFinishBoxPick({ cancelled: true })} />}
          {instPanel && (
            <Suspense fallback={null}>
              <InstrumentPanel
                tab={instPanel}
                onTab={setInstPanel}
                onClose={() => setInstPanel(null)}
                measurements={measurements}
                store={store}
                docId={doc.id}
                docName={fileName}
                textIndex={textIndex}
                onGoHere={goToCard}
                onGoOther={(row) => {
                  const [x, y, w, h] = row.rect
                  onOpenLink?.({ id: row.docId, name: row.docName, page: row.page, rect: { x, y, w, h } })
                }}
                onSetStatus={setCardStatus}
                onPreview={(hit) => jumpToHit({ page: hit.page, rect: hit.rect })}
                onCreateCards={createCards}
                kinds={instKinds}
              />
            </Suspense>
          )}
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
                backlinks={backlinks.get(memoItem.id)}
                onPickLink={(index) => setLinkPicking({ id: memoItem.id, index })}
                store={store}
                library={library}
                docId={doc.id}
                onNotice={setNotice}
                kinds={instKinds}
                onAddKind={onAddKind}
                tagReading={tagReading.has(memoItem.id)}
                onReadTag={(force) => readTag(memoItem.id, force)}
              />
            </Suspense>
          )}
        </div>
        </div>
        {!sidebarOpen && (
          <div className="flex shrink-0 justify-center border-t border-ink-200 bg-surface p-1 md:w-10 md:flex-col md:justify-start md:border-t-0 md:border-l md:py-3">
            <SidebarToggle open={false} onClick={() => setSidebarOpen(true)} />
          </div>
        )}
        {/* 접어도 지우지 않고 숨기기만 (검색어·축척 창 상태 유지, 다시 펼칠 때 새로 그리지 않음) */}
        <Sidebar
          collapsed={!sidebarOpen}
          numPages={pdfDoc.numPages}
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
            // 그 묶음만 지움 (계기 카드는 마크업 전체 삭제에 들어가지 않음). 지운 것은 휴지통으로
            deleteItems(measurementsRef.current.filter((m) => itemGroup(m) === group).map((m) => m.id))
          }}
          trash={trash}
          onRestore={restoreItems}
          onPurge={purgeTrash}
          calibrating={tool === 'calibrate'}
          onStartCalibrate={() => setTool((t) => (t === 'calibrate' ? 'select' : 'calibrate'))}
          onEditCalibration={editCalibration}
          onApplyRatio={applyRatio}
          onResetCalibration={() => setCalibration(null)}
          fileName={fileName}
          instCount={instCount}
          onOpenInstruments={setInstPanel}
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
          library={library}
          onImportFile={onImportFile}
          onReviseDoc={onReviseDoc}
          onSetRoles={onSetDocRoles}
          onPickBox={
            onStartBoxPick
              ? (target) => {
                  // 연결 박스가 '도면 열기' 박스(글·사진·계기 카드 없음)면, 대상 도면에 새로 그린 박스도 이 박스로 돌아오는 '도면 열기' 박스로 만듦
                  const linkBox = !linkItem.inst && !String(linkItem.text ?? '').trim() && !memoPhotoIds(linkItem).length
                  const back = linkBox
                    ? { id: doc.id, name: fileName, page: linkItem.page ?? 1, item: linkItem.id, itemName: itemLabel(linkItem), rect: itemRect(linkItem), color: linkItem.color }
                    : null
                  onStartBoxPick({ from: doc.id, fromName: fileName, memoId: linkItem.id, index: linkPicking.index ?? null, fresh: !!linkPicking.fresh, target, back })
                  setLinkPicking(null)
                  setMemoOpen(null)
                }
              : null
          }
          initial={linkPicking.index != null ? memoLinks(linkItem)[linkPicking.index] : null}
          onCancel={() => {
            // 방금 그린 범위에서 연결을 취소하면 빈 범위는 남기지 않음
            if (linkPicking.fresh && !memoLinks(linkItem).length && !linkItem.inst && !String(linkItem.text ?? '').trim()) deleteItems([linkItem.id], { keep: false })
            setLinkPicking(null)
          }}
          onUnlink={
            linkPicking.index != null
              ? () => {
                  editMemo(linkItem.id, linksPatch(memoLinks(linkItem).filter((_, i) => i !== linkPicking.index)))
                  setLinkPicking(null)
                }
              : null
          }
          onConfirm={(raw) => {
            // 다른 도면 쪽으로 건 연결: 그 도면의 페이지 편집 횟수를 적어 둠 (뒤에 페이지가 바뀌면 쪽을 옮기려고)
            const target = !raw.photo && !raw.item && raw.id !== doc.id ? otherDocs.find((r) => r.id === raw.id) : null
            const link = raw.photo || raw.item || raw.id === doc.id ? raw : { ...raw, pv: raw.pv ?? pageLogV(target?.summary?.pl) }
            const links = memoLinks(linkItem)
            const next = linkPicking.index != null ? links.map((l, i) => (i === linkPicking.index ? link : l)) : [...links, link]
            editMemo(linkItem.id, linksPatch(next))
            setLinkPicking(null)
          }}
        />
      )}

      {revisionOpen && (
        <RevisionDialog
          pdfDoc={pdfDoc}
          store={store}
          docId={doc.id}
          current={currentRev}
          revisions={revs.revisions}
          items={[...measurements, ...trash.map((t) => t.item)]}
          calibrated={!!calibration}
          calPage={calibration?.mode === 'line' ? calibration.page : null}
          initialFile={revisionFile}
          onCancel={() => {
            setRevisionOpen(false)
            setRevisionFile(null)
          }}
          onApply={applyRevision}
          onRemoveRev={removeRevision}
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

const NO_IDS = []

// 도면 왼쪽 위: 페이지 탐색 창 열기 (몇 쪽 / 전체)
function PageNavButton({ pageNum, numPages, onClick }) {
  return (
    <button
      onClick={onClick}
      title="페이지 탐색 (페이지 추가·삭제·순서 바꾸기)"
      aria-label="페이지 탐색 열기"
      className="absolute top-3 left-3 z-10 flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-surface/95 px-2.5 text-xs font-medium text-ink-700 shadow-sm backdrop-blur transition-colors hover:bg-ink-50 hover:text-ink-900"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="9" rx="1.5" />
        <rect x="3" y="15" width="7" height="6" rx="1.5" />
        <rect x="14" y="15" width="7" height="6" rx="1.5" />
      </svg>
      <span className="tabular-nums">
        {pageNum} / {numPages}
      </span>
    </button>
  )
}

// 박스 고르기 안내 (도면 위쪽 가운데). 항목을 누르면 고르고, Esc·취소로 그만둠
function BoxPickBar({ from, same, onCancel }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full bg-brand-700 py-1.5 pr-1.5 pl-4 text-sm text-white shadow-lg">
        <BoxIcon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">
          연결할 박스를 누르거나 새로 그리세요
          {!same && from && <span className="text-white/70"> · 고르면 "{from}" 로 돌아가요</span>}
        </span>
        <button onClick={onCancel} className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25" title="박스 고르기 그만두기 (Esc)">
          취소
        </button>
      </div>
    </div>
  )
}
