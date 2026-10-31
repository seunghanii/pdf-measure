import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadPdf } from './lib/pdf'
import { fileIdOf, loadSession, localStore, saveSession } from './lib/storage'
import { createCloudStore, MAX_UPLOAD_BYTES } from './lib/cloudStore'
import { EMPTY_LIBRARY, loadOpenFolder, moveDoc, saveOpenFolder } from './lib/library'
import { cloudConfigured, networkHint, signOut, supabase } from './lib/supabase'
import Workspace from './components/Workspace'
import Toolbar from './components/Toolbar'
import TabBar from './components/TabBar'
import EmptyState from './components/EmptyState'
import { AccountMenu, PasswordDialog } from './components/Account'
import SearchPanel, { SearchIcon } from './components/SearchPanel'
import { ensureIndexed, forgetIndex } from './lib/indexer'

export default function App() {
  // ---------- 로그인 ----------
  // undefined: 확인 중, null: 로그인 안 함 (이 브라우저에만 저장)
  const [user, setUser] = useState(cloudConfigured ? undefined : null)
  const [passwordDialog, setPasswordDialog] = useState(null) // 'recovery' | 'change'
  useEffect(() => {
    if (!cloudConfigured) return
    supabase.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user ?? null))
      .catch(() => setUser(null))
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordDialog('recovery')
      setUser(session?.user ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = user?.id ?? null
  // 로그인하면 서버, 아니면 이 브라우저 저장소
  const store = useMemo(() => (userId ? createCloudStore(supabase, { id: userId }) : localStore), [userId])

  if (user === undefined)
    return (
      <div className="flex h-full items-center justify-center bg-ink-100 text-sm text-ink-500">서버에 연결하는 중…</div>
    )

  return (
    <>
      {/* 계정이 바뀌면 탭·목록을 새로 시작 */}
      <Session
        key={userId ?? 'local'}
        store={store}
        user={user}
        onLogout={() => setUser(null)}
        onChangePassword={() => setPasswordDialog('change')}
      />
      {passwordDialog && (
        <PasswordDialog recovery={passwordDialog === 'recovery'} onClose={() => setPasswordDialog(null)} />
      )}
    </>
  )
}

// 한 계정(또는 로그인 안 한 상태)의 열린 탭과 최근 목록
function Session({ store, user, onLogout, onChangePassword }) {
  const [docs, setDocs] = useState([]) // 열린 탭: { id, name, pdfDoc, savedState, store }
  const [activeId, setActiveId] = useState(null) // null = 홈(최근 파일)
  const [openFolderId, setOpenFolderId] = useState(loadOpenFolder) // 홈 화면에서 펼쳐 본 폴더
  const [sidebarOpen, setSidebarOpen] = useState(true) // 도면 오른쪽 목록 (모든 탭 공통, 새로 열면 늘 펼침)
  useEffect(() => saveOpenFolder(openFolderId), [openFolderId])
  const [recent, setRecent] = useState(store.kind === 'cloud' ? null : []) // null = 서버에서 불러오는 중
  const [library, setLibrary] = useState(EMPTY_LIBRARY) // 홈 화면 폴더
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [uploading, setUploading] = useState([]) // 서버에 올리는 중인 파일 이름
  const [loading, setLoading] = useState(false)
  const [restored, setRestored] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false) // 홈 화면 돋보기
  const [searchJump, setSearchJump] = useState(null) // 검색에서 고른 위치 { id, page, rect }
  const docsRef = useRef(docs)
  const opening = useRef(new Set())

  useEffect(() => {
    docsRef.current = docs
  }, [docs])

  const userId = user?.id ?? null
  const storeRef = useRef(store) // 이 Session 동안 바뀌지 않음
  const cloud = store.kind === 'cloud'

  const refreshRecent = useCallback(() => {
    const s = storeRef.current
    s.listRecent()
      .then(setRecent)
      .catch((e) => {
        setRecent([])
        if (s.kind === 'cloud') setError(networkHint(e) ?? '서버에서 도면 목록을 불러오지 못했어요.')
      })
    s.getLibrary()
      .then(setLibrary)
      .catch((e) => console.warn('폴더 정보를 불러오지 못함', e))
  }, [])

  // 폴더 정보 바꾸기: 화면에 먼저 반영하고 저장
  const updateLibrary = useCallback((change) => {
    setLibrary((prev) => {
      const next = change(prev)
      storeRef.current.saveLibrary(next).catch((e) => setError(networkHint(e) ?? '폴더 정보를 저장하지 못했어요.'))
      return next
    })
  }, [])

  // 화면에 보이는 이름만 바꿈. 파일 식별자(id)는 그대로라 측정값이 이어집니다.
  const renameDoc = useCallback(async (item, name) => {
    setRecent((list) => list?.map((r) => (r.id === item.id ? { ...r, name } : r)) ?? list)
    setDocs((list) => list.map((d) => (d.id === item.id ? { ...d, name } : d)))
    try {
      await storeRef.current.renameFile(item.id, name)
    } catch (e) {
      setError(networkHint(e) ?? `"${item.name}" 의 이름을 바꾸지 못했어요.`)
      refreshRecent()
    }
  }, [refreshRecent])

  const watchUpload = useCallback((upload, name) => {
    setUploading((u) => [...u, name])
    upload
      .catch((e) => {
        console.warn(e)
        setWarning(
          e?.code === 'too_large'
            ? `"${name}" 은(는) 50MB 가 넘어 PDF 파일은 서버에 올리지 못했어요. 측정값은 서버에 저장되고, 다른 컴퓨터에서는 같은 PDF 를 직접 열면 이어서 볼 수 있어요.`
            : `"${name}" PDF 를 서버에 올리지 못했어요. ${networkHint(e) ?? '다음에 이 파일을 열 때 다시 올려요.'}`,
        )
      })
      .finally(() =>
        setUploading((u) => {
          const i = u.indexOf(name)
          return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)]
        }),
      )
  }, [])

  // id 로 식별되는 PDF 를 새 탭으로 열기 (이미 열려 있으면 그 탭으로 이동)
  const openDoc = useCallback(
    async (id, file, { fromRecent = false, activate = true } = {}) => {
      const s = storeRef.current
      if (docsRef.current.some((d) => d.id === id)) {
        if (activate) setActiveId(id)
        s.touchFile(id).catch(() => {})
        return true
      }
      if (opening.current.has(id)) return false
      opening.current.add(id)
      try {
        const pdfDoc = await loadPdf(await file.arrayBuffer())
        let record = null
        try {
          record = fromRecent ? await s.touchFile(id) : await s.rememberFile(id, file)
        } catch (e) {
          console.warn(e)
          setWarning(
            s.kind === 'cloud'
              ? `"${file.name}" 을(를) 서버에 저장하지 못했어요. ${networkHint(e) ?? ''}`
              : '브라우저 저장 공간이 부족해 이 도면은 새로고침하면 사라질 수 있어요.',
          )
        }
        if (record?.upload) watchUpload(record.upload, file.name)
        const doc = { id, name: record?.name ?? file.name, pdfDoc, savedState: record?.state ?? null, store: s }
        setDocs((prev) => (prev.some((d) => d.id === id) ? prev : [...prev, doc]))
        if (activate) setActiveId(id)
        // 검색용 글자 색인이 없으면 뒤에서 만들어 저장 (스캔본은 OCR)
        ensureIndexed(s, id, doc.name, () => (pdfDoc.loadingTask?.destroyed ? null : pdfDoc))
        return true
      } finally {
        opening.current.delete(id)
      }
    },
    [watchUpload],
  )

  const openFile = useCallback(
    async (file) => {
      if (!file) return
      setError('')
      setLoading(true)
      try {
        if (storeRef.current.kind === 'cloud' && file.size > MAX_UPLOAD_BYTES)
          setWarning(`"${file.name}" 은(는) 50MB 가 넘어 PDF 파일은 서버에 올라가지 않아요. 측정값은 서버에 저장돼요.`)
        const id = fileIdOf(file)
        await openDoc(id, file)
        return id
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
        const blob = await storeRef.current.getFile(item.id)
        if (!blob) throw new Error('missing')
        await openDoc(item.id, new File([blob], item.name, { type: 'application/pdf' }), { fromRecent: true })
      } catch (e) {
        console.error(e)
        setError(
          e?.code === 'no_file'
            ? `"${item.name}" 의 PDF 파일은 서버에 없어요. 같은 PDF 를 다시 열면 저장된 측정값이 그대로 이어져요.`
            : (networkHint(e) ?? `"${item.name}" 을(를) 다시 열 수 없습니다. 목록에서 지우고 파일을 새로 열어 주세요.`),
        )
      } finally {
        setLoading(false)
        refreshRecent()
      }
    },
    [openDoc, refreshRecent],
  )

  // 메모 범위에 연결한 도면 열기 (이미 열려 있으면 그 탭으로), 고른 페이지로 이동
  const openLinked = useCallback(
    async (link) => {
      if (!link?.id) return
      await openRecent({ id: link.id, name: link.name })
      if (docsRef.current.some((d) => d.id === link.id) || link.page > 1)
        setSearchJump({ id: link.id, page: Math.max(1, link.page || 1), nonce: Date.now() })
    },
    [openRecent],
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
      const session = loadSession(userId)
      const restoredIds = []
      for (const id of session.open) {
        try {
          const blob = await store.getFile(id)
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
  }, [store, userId, openDoc, refreshRecent])

  useEffect(() => {
    if (restored) saveSession(userId, { open: docs.map((d) => d.id), active: activeId })
  }, [docs, activeId, restored, userId])

  // 홈 화면으로 돌아올 때 최근 목록 새로 고침
  useEffect(() => {
    if (activeId === null) refreshRecent()
  }, [activeId, refreshRecent])

  // 계정을 바꾸면 이 Session 이 사라지므로 열린 PDF 메모리 해제
  useEffect(
    () => () => {
      for (const d of docsRef.current) d.pdfDoc.loadingTask?.destroy()
    },
    [],
  )

  // 로그아웃: 탭을 닫아 마지막 변경을 서버에 보낸 뒤 로그아웃
  const logout = useCallback(async () => {
    const s = storeRef.current
    setActiveId(null)
    setDocs([])
    await new Promise((r) => setTimeout(r, 50))
    await s.whenIdle?.()
    try {
      await signOut()
    } catch (e) {
      console.warn(e)
    }
    onLogout() // 서버에 닿지 않아도 이 브라우저에서는 로그아웃
  }, [onLogout])

  // 홈 화면에서 Ctrl+F: 모든 도면 검색
  useEffect(() => {
    if (activeId !== null) return
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId])

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

  // 서버에 올리는 중에 창을 닫으려 하면 물어봄
  useEffect(() => {
    if (!uploading.length) return
    const onBeforeUnload = (e) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [uploading.length])

  // 창 어디에나 PDF 끌어다 놓기 (여러 개도 가능)
  const [dragOver, setDragOver] = useState(false)
  // 안내 끄기: 창 밖으로 빼거나 Esc 로 취소하면 dragleave 가 안쪽 요소에서만 오거나
  // 아예 안 올 때가 있어서, 창 전체에서 drop/dragend/blur 와 창 밖으로 나감을 보고,
  // 끌고 있는 동안 계속 오는 dragover 가 잠시 끊겨도 끔.
  useEffect(() => {
    if (!dragOver) return
    let timer
    const hide = () => {
      clearTimeout(timer)
      setDragOver(false)
    }
    const alive = () => {
      clearTimeout(timer)
      timer = setTimeout(hide, 400)
    }
    const onLeave = (e) => {
      if (!e.relatedTarget) hide() // 창 밖으로 나감
    }
    alive()
    window.addEventListener('dragover', alive, true)
    window.addEventListener('dragleave', onLeave, true)
    window.addEventListener('drop', hide, true) // 메모장처럼 안쪽에서 drop 을 멈춰도 끔
    window.addEventListener('dragend', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('dragover', alive, true)
      window.removeEventListener('dragleave', onLeave, true)
      window.removeEventListener('drop', hide, true)
      window.removeEventListener('dragend', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [dragOver])
  const onDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files].filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    )
    await openFiles(files)
  }

  // 홈 화면에서 폴더를 열어 둔 채 PDF 를 열면 그 폴더에 넣음.
  // 이미 다른 폴더에 있던 도면은 그대로 둠.
  const openFiles = async (files) => {
    const folderId = activeId === null && library.folders.some((f) => f.id === openFolderId) ? openFolderId : null
    for (const f of files) {
      const id = await openFile(f)
      if (id && folderId) updateLibrary((lib) => (lib.assign[id] ? lib : moveDoc(lib, id, folderId)))
    }
  }

  return (
    <div
      className="flex h-full flex-col bg-ink-100 text-ink-800"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return // 홈 화면에서 도면을 폴더로 끌 때
        e.preventDefault()
        setDragOver(true)
      }}
      onDrop={onDrop}
    >
      <TabBar docs={docs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onHome={() => setActiveId(null)} />

      {activeId === null && (
        <Toolbar
          onOpenFile={openFiles}
          right={
            <>
              <button
                onClick={() => setSearchOpen(true)}
                title="도면 속 글자 검색 (Ctrl+F)"
                className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-600 shadow-xs transition-colors hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900"
              >
                <SearchIcon />
                <span className="hidden sm:inline">검색</span>
              </button>
              {cloudConfigured && <AccountMenu user={user} onLogout={logout} onChangePassword={onChangePassword} />}
            </>
          }
        />
      )}

      {(error || warning) && (
        <div
          className={`flex items-center justify-between border-b px-4 py-2 text-sm ${
            error ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-warn-200 bg-warn-50 text-warn-800'
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

      {uploading.length > 0 && (
        <div className="flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-800">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
          서버에 PDF 올리는 중: {uploading.join(', ')} (끝날 때까지 창을 닫지 마세요)
        </div>
      )}

      {docs.map((doc) => (
        <Workspace
          key={doc.id}
          doc={doc}
          active={doc.id === activeId}
          onOpenFile={openFiles}
          searchJump={searchJump?.id === doc.id ? searchJump : null}
          onOpenLink={openLinked}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />
      ))}

      {activeId === null && (
        <EmptyState
          onOpenFile={openFiles}
          onOpenSample={openSample}
          loading={loading}
          recent={recent}
          openIds={docs.map((d) => d.id)}
          onOpenRecent={openRecent}
          library={library}
          onUpdateLibrary={updateLibrary}
          onRename={renameDoc}
          openFolderId={openFolderId}
          setOpenFolderId={setOpenFolderId}
          onRemoveRecent={async (item) => {
            try {
              await storeRef.current.removeFile(item.id)
              forgetIndex(storeRef.current, item.id)
              if (library.assign[item.id]) updateLibrary((lib) => moveDoc(lib, item.id, null))
            } catch (e) {
              setError(networkHint(e) ?? `"${item.name}" 을(를) 지우지 못했어요.`)
            }
            refreshRecent()
          }}
          cloud={cloud}
          showLogin={cloudConfigured && !user}
          store={store}
          onMigrated={refreshRecent}
        />
      )}

      {searchOpen && activeId === null && (
        <SearchPanel
          store={store}
          recent={recent}
          library={library}
          onClose={() => setSearchOpen(false)}
          onOpenHit={async (item, hit) => {
            setSearchOpen(false)
            await openRecent(item)
            setSearchJump({ id: item.id, page: hit.page, rect: hit.rect, nonce: Date.now() })
          }}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-600/20">
          <div className="rounded-xl border-2 border-dashed border-brand-600 bg-white px-8 py-6 text-lg font-semibold text-brand-700">
            여기에 PDF를 놓으세요
          </div>
        </div>
      )}
    </div>
  )
}
