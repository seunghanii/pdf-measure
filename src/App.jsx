import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { loadPdf } from './lib/pdf'
import { distance } from './lib/geometry'
import { PT_TO_PAPER_MM, UNITS } from './lib/units'
import PdfViewer from './components/PdfViewer'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import CalibrationDialog from './components/CalibrationDialog'
import EmptyState from './components/EmptyState'

let nextId = 1

export default function App() {
  const [pdfDoc, setPdfDoc] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pageNum, setPageNum] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [fitKey, setFitKey] = useState(0)
  const [tool, setTool] = useState('calibrate')
  const [measurements, setMeasurements] = useState([])
  const [history, setHistory] = useState([])
  const [calibration, setCalibration] = useState(null)
  const [pendingCalibration, setPendingCalibration] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [unit, setUnit] = useState('mm')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const counters = useRef({ length: 0, area: 0, angle: 0 })

  // 축척: PDF 1pt 가 실제 몇 mm 인지
  const mmPerPt = useMemo(() => {
    if (!calibration) return null
    if (calibration.mode === 'ratio') return PT_TO_PAPER_MM * calibration.ratio
    const d = distance(calibration.points[0], calibration.points[1])
    return d > 0 ? calibration.realMm / d : null
  }, [calibration])

  const openFile = useCallback(async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    try {
      const doc = await loadPdf(await file.arrayBuffer())
      setPdfDoc((old) => {
        old?.destroy()
        return doc
      })
      setFileName(file.name)
      setPageNum(1)
      setMeasurements([])
      setHistory([])
      setCalibration(null)
      setSelectedId(null)
      setTool('calibrate')
      counters.current = { length: 0, area: 0, angle: 0 }
      setFitKey((k) => k + 1)
    } catch (e) {
      console.error(e)
      setError('PDF 파일을 열 수 없습니다. 암호가 걸려 있거나 손상된 파일인지 확인해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  const openSample = useCallback(async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}sample.pdf`)
    const blob = await res.blob()
    openFile(new File([blob], '샘플 평면도.pdf', { type: 'application/pdf' }))
  }, [openFile])

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
    (type, points) => {
      if (type === 'calibrate') {
        setPendingCalibration({ page: pageNum, points })
        return
      }
      counters.current[type] += 1
      const m = {
        id: String(nextId++),
        type,
        page: pageNum,
        points,
        name: `${type === 'length' ? '길이' : type === 'area' ? '면적' : '각도'} ${counters.current[type]}`,
      }
      commit((prev) => [...prev, m])
      setSelectedId(m.id)
    },
    [commit, pageNum],
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
      if (e.key === 'PageDown' && pdfDoc) setPageNum((p) => Math.min(pdfDoc.numPages, p + 1))
      if (e.key === 'PageUp') setPageNum((p) => Math.max(1, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteMeasurement, pdfDoc, pendingCalibration, selectedId, undo])

  // 창 어디에나 PDF 끌어다 놓기
  const [dragOver, setDragOver] = useState(false)
  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (file) openFile(file)
  }

  const pageMeasurements = measurements.filter((m) => m.page === pageNum)

  return (
    <div
      className="flex h-full flex-col bg-slate-100 text-slate-800"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <Toolbar
        fileName={fileName}
        onOpenFile={openFile}
        pdfDoc={pdfDoc}
        pageNum={pageNum}
        setPageNum={setPageNum}
        zoom={zoom}
        setZoom={setZoom}
        onFit={() => setFitKey((k) => k + 1)}
        tool={tool}
        setTool={setTool}
        calibrated={!!mmPerPt}
        canUndo={history.length > 0}
        onUndo={undo}
      />

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {pdfDoc ? (
          <PdfViewer
            pdfDoc={pdfDoc}
            pageNum={pageNum}
            zoom={zoom}
            onZoom={setZoom}
            fitKey={fitKey}
            tool={tool}
            measurements={pageMeasurements}
            calibration={calibration?.mode === 'line' ? calibration : null}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onComplete={onComplete}
            onMovePoint={onMovePoint}
            mmPerPt={mmPerPt}
            unit={unit}
          />
        ) : (
          <EmptyState onOpenFile={openFile} onOpenSample={openSample} loading={loading} />
        )}
        {pdfDoc && (
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
              setPageNum(m.page)
            }}
            onDelete={deleteMeasurement}
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
        )}
      </div>

      {pendingCalibration && (
        <CalibrationDialog
          defaultUnit={unit}
          onCancel={() => setPendingCalibration(null)}
          onConfirm={applyCalibration}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/20">
          <div className="rounded-xl border-2 border-dashed border-blue-600 bg-white px-8 py-6 text-lg font-semibold text-blue-700">
            여기에 PDF를 놓으세요
          </div>
        </div>
      )}
    </div>
  )
}
