import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPdf } from './lib/pdf'
import {
  fileIdOf,
  getFile,
  listRecent,
  loadSession,
  rememberFile,
  removeFile,
  saveSession,
  touchFile,
} from './lib/storage'
import Workspace from './components/Workspace'
import Toolbar from './components/Toolbar'
import TabBar from './components/TabBar'
import EmptyState from './components/EmptyState'

export default function App() {
  const [docs, setDocs] = useState([]) // 열린 탭: { id, name, pdfDoc, savedState }
  const [activeId, setActiveId] = useState(null) // null = 홈(최근 파일)
  const [recent, setRecent] = useState([])
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [loading, setLoading] = useState(false)
  const [restored, setRestored] = useState(false)
  const docsRef = useRef(docs)
  const opening = useRef(new Set())

  useEffect(() => {
    docsRef.current = docs
  }, [docs])

  const refreshRecent = useCallback(() => {
    listRecent()
      .then(setRecent)
      .catch(() => setRecent([]))
  }, [])

  // id 로 식별되는 PDF 를 새 탭으로 열기 (이미 열려 있으면 그 탭으로 이동)
  const openDoc = useCallback(
    async (id, file, { fromRecent = false, activate = true } = {}) => {
      if (docsRef.current.some((d) => d.id === id)) {
        if (activate) setActiveId(id)
        touchFile(id).catch(() => {})
        return true
      }
      if (opening.current.has(id)) return false
      opening.current.add(id)
      try {
        const pdfDoc = await loadPdf(await file.arrayBuffer())
        let record = null
        try {
          record = fromRecent ? await touchFile(id) : await rememberFile(id, file)
        } catch (e) {
          console.warn(e)
          setWarning('브라우저 저장 공간이 부족해 이 도면은 새로고침하면 사라질 수 있어요.')
        }
        const doc = { id, name: file.name, pdfDoc, savedState: record?.state ?? null }
        setDocs((prev) => (prev.some((d) => d.id === id) ? prev : [...prev, doc]))
        if (activate) setActiveId(id)
        return true
      } finally {
        opening.current.delete(id)
      }
    },
    [],
  )

  const openFile = useCallback(
    async (file) => {
      if (!file) return
      setError('')
      setLoading(true)
      try {
        await openDoc(fileIdOf(file), file)
      } catch (e) {
        console.error(e)
        setError(`"${file.name}" 을(를) 열 수 없습니다. 암호가 걸려 있거나 손상된 PDF인지 확인해 주세요.`)
      } finally {
        setLoading(false)
        refreshRecent()
      }
    },
    [openDoc, refreshRecent],
  )

  const openRecent = useCallback(
    async (item) => {
      setError('')
      setLoading(true)
      try {
        const blob = await getFile(item.id)
        if (!blob) throw new Error('missing')
        await openDoc(item.id, new File([blob], item.name, { type: 'application/pdf' }), { fromRecent: true })
      } catch (e) {
        console.error(e)
        setError(`"${item.name}" 을(를) 다시 열 수 없습니다. 목록에서 지우고 파일을 새로 열어 주세요.`)
      } finally {
        setLoading(false)
        refreshRecent()
      }
    },
    [openDoc, refreshRecent],
  )

  const openSample = useCallback(async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}sample.pdf`)
    const blob = await res.blob()
    openFile(new File([blob], '샘플 평면도.pdf', { type: 'application/pdf' }))
  }, [openFile])

  const closeTab = useCallback(
    (id) => {
      const list = docsRef.current
      const idx = list.findIndex((d) => d.id === id)
      if (idx < 0) return
      list[idx].pdfDoc.loadingTask?.destroy() // 워커 메모리 해제
      const rest = list.filter((d) => d.id !== id)
      setDocs(rest)
      if (activeId === id) setActiveId(rest[Math.min(idx, rest.length - 1)]?.id ?? null)
      refreshRecent()
    },
    [activeId, refreshRecent],
  )

  // 새로고침 전에 열려 있던 탭 복원
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const session = loadSession()
      const restoredIds = []
      for (const id of session.open) {
        try {
          const blob = await getFile(id)
          if (!blob || cancelled) continue
          const name = id.slice(0, id.lastIndexOf('|'))
          const ok = await openDoc(id, new File([blob], name, { type: 'application/pdf' }), {
            fromRecent: true,
            activate: false,
          })
          if (ok) restoredIds.push(id)
        } catch (e) {
          console.warn('탭 복원 실패', id, e)
        }
      }
      if (cancelled) return
      if (restoredIds.includes(session.active)) setActiveId(session.active)
      else if (restoredIds.length) setActiveId(restoredIds[restoredIds.length - 1])
      setRestored(true)
      refreshRecent()
    })()
    return () => {
      cancelled = true
    }
  }, [openDoc, refreshRecent])

  useEffect(() => {
    if (restored) saveSession({ open: docs.map((d) => d.id), active: activeId })
  }, [docs, activeId, restored])

  // 홈 화면으로 돌아올 때 최근 목록 새로 고침
  useEffect(() => {
    if (activeId === null) refreshRecent()
  }, [activeId, refreshRecent])

  // Ctrl+Tab 대신 Alt+←/→ 로 탭 이동
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      const list = docsRef.current
      if (!list.length) return
      e.preventDefault()
      const idx = list.findIndex((d) => d.id === activeId)
      const next = e.key === 'ArrowRight' ? idx + 1 : idx - 1
      setActiveId(list[(next + list.length) % list.length].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId])

  // 창 어디에나 PDF 끌어다 놓기 (여러 개도 가능)
  const [dragOver, setDragOver] = useState(false)
  const onDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files].filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    )
    for (const f of files) await openFile(f)
  }

  const openFiles = async (files) => {
    for (const f of files) await openFile(f)
  }

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
      <TabBar docs={docs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onHome={() => setActiveId(null)} />

      {activeId === null && <Toolbar onOpenFile={openFiles} />}

      {(error || warning) && (
        <div
          className={`flex items-center justify-between border-b px-4 py-2 text-sm ${
            error ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <span>{error || warning}</span>
          <button
            className="ml-4 opacity-60 hover:opacity-100"
            onClick={() => {
              setError('')
              setWarning('')
            }}
          >
            닫기
          </button>
        </div>
      )}

      {docs.map((doc) => (
        <Workspace key={doc.id} doc={doc} active={doc.id === activeId} onOpenFile={openFiles} />
      ))}

      {activeId === null && (
        <EmptyState
          onOpenFile={openFiles}
          onOpenSample={openSample}
          loading={loading}
          recent={recent}
          openIds={docs.map((d) => d.id)}
          onOpenRecent={openRecent}
          onRemoveRecent={async (item) => {
            await removeFile(item.id).catch(() => {})
            refreshRecent()
          }}
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
