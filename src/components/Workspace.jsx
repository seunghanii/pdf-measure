import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { distance } from '../lib/geometry'
import { PT_TO_PAPER_MM, UNITS } from '../lib/units'
import { saveState } from '../lib/storage'
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
  const [selectedId, setSelectedId] = useState(null)
  const [unit, setUnit] = useState(saved?.unit ?? 'mm')
  const counters = useRef(saved?.counters ?? { length: 0, area: 0, angle: 0 })
  // 툴바·목록에서 특정 페이지로 이동 요청 (뷰어가 스크롤)
  const [jump, setJump] = useState(null)
  const jumpTo = useCallback(
    (page) => setJump({ page: Math.min(Math.max(1, page), pdfDoc.numPages), nonce: Date.now() + Math.random() }),
    [pdfDoc],
  )

  // 측정값이 바뀌면 잠시 뒤 브라우저 저장소에 자동 저장
  const latest = useRef(null)
  useEffect(() => {
    const state = { measurements, calibration, unit, pageNum, counters: counters.current }
    latest.current = state
    const t = setTimeout(() => {
      saveState(doc.id, state).catch((e) => console.warn('저장 실패', e))
      latest.current = null
    }, 200)
    return () => clearTimeout(t)
  }, [doc.id, measurements, calibration, unit, pageNum])

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

  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.length) return
    setMeasurements(h[h.length - 1])
    setHistory(h.slice(0, -1))
  }, [])

  const onComplete = useCallback(
    (type, points, page) => {
      if (type === 'calibrate') {
        setPendingCalibration({ page, points })
        return
      }
      counters.current[type] += 1
      const m = {
        id: newId(),
        type,
        page,
        points,
        name: `${type === 'length' ? '길이' : type === 'area' ? '면적' : '각도'} ${counters.current[type]}`,
      }
      commit((prev) => [...prev, m])
      setSelectedId(m.id)
    },
    [commit],
  )

  const onMovePoint = useCallback((id, index, p) => {
    if (id === 'calibration') {
      setCalibration((c) => (c ? { ...c, points: c.points.map((q, i) => (i === index ? p : q)) } : c))
      return
    }
    setMeasurements((prev) =>
      prev.map((m) => (m.id === id ? { ...m, points: m.points.map((q, i) => (i === index ? p : q)) } : m)),
    )
  }, [])

  const deleteMeasurement = useCallback((id) => {
    commit((prev) => prev.filter((m) => m.id !== id))
    setSelectedId((s) => (s === id ? null : s))
  }, [commit])

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
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || pendingCalibration) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const map = { v: 'select', h: 'pan', c: 'calibrate', l: 'length', a: 'area', g: 'angle' }
      const t = map[e.key.toLowerCase()]
      if (t && pdfDoc) setTool(t)
      if (e.key === 'Delete' && selectedId && selectedId !== 'calibration') deleteMeasurement(selectedId)
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
  }, [active, deleteMeasurement, jumpTo, pageNum, pdfDoc, pendingCalibration, selectedId, undo])

  const visibleMeasurements = measurements.filter((m) => !m.hidden)

  // 눈 아이콘: 화면에서 숨기기/보이기 (값은 그대로 남음)
  const toggleHidden = (id) => {
    if (id === 'calibration') {
      setCalibration((c) => (c ? { ...c, hidden: !c.hidden } : c))
      return
    }
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, hidden: !m.hidden } : m)))
  }
  const setAllHidden = (hidden) => setMeasurements((prev) => prev.map((m) => ({ ...m, hidden })))

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
      />

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
          selectedId={selectedId}
          onSelect={setSelectedId}
          onComplete={onComplete}
          onMovePoint={onMovePoint}
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
          selectedId={selectedId}
          onSelect={(m) => {
            setSelectedId(m.id)
            if (m.hidden) toggleHidden(m.id)
            jumpTo(m.page)
          }}
          onDelete={deleteMeasurement}
          onToggleHidden={toggleHidden}
          onSetAllHidden={setAllHidden}
          onRename={(id, name) => setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)))}
          onClear={() => {
            commit([])
            setSelectedId(null)
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
