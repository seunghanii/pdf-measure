import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { distance } from '../lib/geometry'
import { PT_TO_PAPER_MM, UNITS } from '../lib/units'
import { saveState } from '../lib/storage'
import { TYPE_INFO } from '../lib/measure'
import { DEFAULT_BOX_OPACITY, isMarkup } from '../lib/markup'
import { TOOLS, toolForDigit } from '../lib/tools'
import PdfViewer from './PdfViewer'
import Toolbar from './Toolbar'
import Sidebar from './Sidebar'
import CalibrationDialog from './CalibrationDialog'

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// 도면 하나(탭 하나)의 작업 공간. 탭을 바꿔도 마운트된 채로 남아서 상태가 유지됩니다.
export default function Workspace({ doc, active, onOpenFile }) {
  const { pdfDoc, name: fileName } = doc
  const saved = doc.savedState
  const [pageNum, setPageNum] = useState(() => Math.min(saved?.pageNum ?? 1, pdfDoc.numPages))
  const [zoom, setZoom] = useState(1)
  const [fitKey, setFitKey] = useState(1)
  const [fittedKey, setFittedKey] = useState(0)
  const [tool, setTool] = useState(saved?.calibration ? 'length' : 'calibrate')
  const [measurements, setMeasurements] = useState(saved?.measurements ?? [])
  const [history, setHistory] = useState([])
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
    ...saved?.markupStyle,
  }))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  // 툴바·목록에서 특정 페이지로 이동 요청 (뷰어가 스크롤)
  const [jump, setJump] = useState(null)
  const jumpTo = useCallback(
    (page) => setJump({ page: Math.min(Math.max(1, page), pdfDoc.numPages), nonce: Date.now() + Math.random() }),
    [pdfDoc],
  )

  // 측정값이 바뀌면 잠시 뒤 브라우저 저장소에 자동 저장
  const latest = useRef(null)
  useEffect(() => {
    const state = { measurements, calibration, unit, pageNum, markupStyle, counters: counters.current }
    latest.current = state
    const t = setTimeout(() => {
      saveState(doc.id, state).catch((e) => console.warn('저장 실패', e))
      latest.current = null
    }, 200)
    return () => clearTimeout(t)
  }, [doc.id, measurements, calibration, unit, pageNum, markupStyle])

  // 탭을 닫을 때 아직 저장 안 된 변경이 있으면 바로 저장
  useEffect(() => {
    const id = doc.id
    return () => {
      if (latest.current) saveState(id, latest.current).catch(() => {})
    }
  }, [doc.id])

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
        m.color = type === 'highlight' ? markupStyle.highlightColor : markupStyle.color
        if (type === 'text') {
          m.fontSize = markupStyle.fontSize
          m.boxOpacity = markupStyle.boxOpacity
        }
      }
      Object.assign(m, extra)
      commit((prev) => [...prev, m])
      setSelectedIds([m.id])
    },
    [commit, markupStyle],
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
  const selLine = selectedMarkups.find((m) => m.type !== 'highlight')
  const selHighlight = selectedMarkups.find((m) => m.type === 'highlight')
  const selectedMarkupType = selText ? 'text' : selLine ? selLine.type : selHighlight ? 'highlight' : null
  // 툴바에는 선택된 마크업의 현재 값을 보여 줌
  const shownStyle =
    tool === 'select' && selectedMarkups.length
      ? {
          ...markupStyle,
          ...(selLine && { color: selLine.color }),
          ...(selHighlight && { highlightColor: selHighlight.color }),
          ...(selText && { fontSize: selText.fontSize ?? 13, boxOpacity: selText.boxOpacity ?? DEFAULT_BOX_OPACITY }),
        }
      : markupStyle

  // 색·글자 크기·투명도: 다음에 그릴 마크업에 적용, 선택된 마크업이 있으면 전부 바꿈.
  // 슬라이더처럼 연달아 바뀌는 변경(live)은 되돌리기 한 번으로 묶음.
  const styleGesture = useRef(0)
  const changeMarkupStyle = (patch, { live = false } = {}) => {
    setMarkupStyle((st) => ({ ...st, ...patch }))
    const itemPatch = (m) => {
      const out = {}
      if (patch.color && m.type !== 'highlight') out.color = patch.color
      if (patch.highlightColor && m.type === 'highlight') out.color = patch.highlightColor
      if (patch.fontSize && m.type === 'text') out.fontSize = patch.fontSize
      if (patch.boxOpacity !== undefined && m.type === 'text') out.boxOpacity = patch.boxOpacity
      return Object.keys(out).length ? out : null
    }
    const targets = selectedMarkups.filter(itemPatch)
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
      const bytes = await exportPdfWithMarkups({ pdfDoc, items: measurementsRef.current, calibration, mmPerPt, unit })
      const base = fileName.replace(/\.pdf$/i, '')
      downloadBytes(bytes, `${base}_마크업.pdf`)
      setNotice(`"${base}_마크업.pdf" 로 저장했어요. 브라우저의 다운로드 폴더를 확인하세요.`)
    } catch (e) {
      console.error(e)
      setNotice('PDF 저장에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }, [calibration, fileName, mmPerPt, pdfDoc, saving, unit])

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

  const applyCalibration = ({ value, unit: u }) => {
    const realMm = value * UNITS[u].toMm
    setCalibration({
      mode: 'line',
      page: pendingCalibration.page,
      points: pendingCalibration.points,
      realMm,
      label: `기준 ${value.toLocaleString('ko-KR')} ${u}`,
    })
    setUnit(u)
    setPendingCalibration(null)
    setTool('length')
  }

  const applyRatio = (ratio) => {
    setCalibration({ mode: 'ratio', ratio })
    setTool('length')
  }

  // 단축키
  useEffect(() => {
    if (!active) return
    const onKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey
      // 브라우저 기본 동작 가로채기: 저장(Ctrl+S), 화면 확대(Ctrl +/-/0) → PDF 만 확대
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        savePdf()
        return
      }
      if (ctrl && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault()
        if (e.key === '0') setFitKey((k) => k + 1)
        else setZoom((z) => (e.key === '-' ? Math.max(0.1, z / 1.25) : Math.min(8, z * 1.25)))
        return
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || pendingCalibration) return
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
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())?.id
      if (t && pdfDoc) setTool(t)
      if (e.key === 'Delete' || (e.key === 'Backspace' && tool === 'select')) {
        if (selectedIds.length) {
          e.preventDefault()
          deleteItems(selectedIds)
        }
      }
      if (e.key === 'Escape' && tool === 'select') setSelectedIds([])
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(8, z * 1.25))
      if (e.key === '-') setZoom((z) => Math.max(0.1, z / 1.25))
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
  }, [active, deleteItems, jumpTo, pageNum, pdfDoc, pendingCalibration, savePdf, selectedIds, tool, undo])

  const visibleMeasurements = measurements.filter((m) => !m.hidden)

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
    <>
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
        onSave={savePdf}
        saving={saving}
      />

      {notice && (
        <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span>{notice}</span>
          <button className="ml-4 opacity-60 hover:opacity-100" onClick={() => setNotice('')}>
            닫기
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <PdfViewer
          pdfDoc={pdfDoc}
          pageNum={pageNum}
          onPageChange={setPageNum}
          jump={jump}
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
          markupStyle={markupStyle}
          mmPerPt={mmPerPt}
          unit={unit}
        />
        <Sidebar
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
          }}
          onDelete={(id) => deleteItems([id])}
          onToggleHidden={toggleHidden}
          onSetAllHidden={setAllHidden}
          onRename={(id, name) => setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)))}
          onClear={(group) => {
            commit((prev) => prev.filter((m) => (group === 'markup') !== isMarkup(m.type)))
            setSelectedIds([])
          }}
          onStartCalibrate={() => setTool('calibrate')}
          onApplyRatio={applyRatio}
          onResetCalibration={() => setCalibration(null)}
          fileName={fileName}
        />
      </div>

      {pendingCalibration && (
        <CalibrationDialog
          defaultUnit={unit}
          onCancel={() => setPendingCalibration(null)}
          onConfirm={applyCalibration}
        />
      )}
    </>
  )
}
