import { withoutTrashed } from '../lib/trash'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DOC_ROLES } from '../lib/instrument'
import { EMPTY_LIBRARY, displayName, folderLabel } from '../lib/library'
import { FolderSelect } from './Library'

// 메모 범위에 연결할 도면 고르기. 앱에 올려 둔 도면 중 하나와 (원하면) 페이지를 고릅니다.
// initial: 이미 연결된 { id, name, page, role }. role: 관련 문서 종류 (Hook-up, 루프도 …, 비워도 됨)
// onImportFile(file, folderId): 컴퓨터의 PDF 를 탭을 열지 않고 올림 → { id, name, pages }
export default function LinkPicker({ store, currentId, currentName, library, onImportFile, initial, defaultRole = '', onCancel, onConfirm, onUnlink }) {
  const [list, setList] = useState(null) // null = 불러오는 중
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(initial?.id ?? null)
  const [page, setPage] = useState(String(initial?.page ?? 1))
  const [role, setRole] = useState(initial?.role ?? defaultRole)
  const [added, setAdded] = useState([]) // 이 창에서 방금 올린 도면
  const [upload, setUpload] = useState(null) // { file, folder, busy, error } 올릴 PDF 와 저장할 폴더
  const fileRef = useRef(null)
  const lib = library ?? EMPTY_LIBRARY

  useEffect(() => {
    let cancelled = false
    store
      .listRecent()
      .then((rows) => !cancelled && setList(withoutTrashed(rows)))
      .catch(() => !cancelled && setList([]))
    return () => {
      cancelled = true
    }
  }, [store])

  // 이 도면은 맨 위에, 나머지는 최근 연 순서. 이전에 연결한 도면이 목록에 없으면(오래돼서) 그대로 보여 줌
  const items = useMemo(() => {
    const rows = (list ?? []).filter((r) => !added.some((a) => a.id === r.id))
    const all = [...added, { id: currentId, name: currentName }, ...rows.filter((r) => r.id !== currentId && !added.some((a) => a.id === r.id))]
    if (initial && !all.some((r) => r.id === initial.id)) all.push({ id: initial.id, name: initial.name })
    const q = query.trim().toLowerCase()
    const label = (r) => `${displayName(lib, r.id, r.name)} ${r.name}`.toLowerCase()
    return q ? all.filter((r) => label(r).includes(q)) : all
  }, [list, added, currentId, currentName, initial, query, lib])

  const chooseFile = (file) => {
    if (!file) return
    if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      setUpload({ file: null, folder: '', error: 'PDF 파일만 올릴 수 있어요.' })
      return
    }
    // 저장할 폴더 기본값: 지금 도면이 들어 있는 폴더
    setUpload({ file, folder: lib.assign[currentId] ?? '', busy: false, error: '' })
  }

  const doUpload = async () => {
    if (!upload?.file || upload.busy) return
    setUpload((u) => ({ ...u, busy: true, error: '' }))
    try {
      const rec = await onImportFile(upload.file, upload.folder || null)
      setAdded((a) => [{ id: rec.id, name: rec.name, fresh: true }, ...a.filter((x) => x.id !== rec.id)])
      setPicked(rec.id)
      setQuery('')
      setUpload(null)
    } catch (e) {
      console.warn(e)
      setUpload((u) => ({
        ...u,
        busy: false,
        error: e?.code === 'bad_pdf' ? '이 PDF 를 열 수 없어요. 암호가 걸려 있거나 손상된 파일인지 확인해 주세요.' : '올리지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.',
      }))
    }
  }

  const chosen = items.find((r) => r.id === picked) ?? (initial?.id === picked ? initial : null)
  const pageNo = Math.max(1, Math.round(Number(page) || 1))

  const submit = (e) => {
    e.preventDefault()
    if (chosen) onConfirm({ id: chosen.id, name: chosen.name, page: pageNo, role: role.trim() })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white p-5 shadow-2xl"
      >
        <h2 className="text-lg font-bold">관련 도면 연결</h2>
        <p className="mt-1 text-sm text-ink-500">메모장에서 누르면 고른 도면의 그 페이지가 미리 보여요. 올려 둔 도면에서 고르거나, 컴퓨터의 PDF 를 바로 올려 연결할 수 있어요.</p>
        <input
          autoFocus
          placeholder="도면 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-3 rounded-md border border-ink-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        {onImportFile && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                chooseFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {upload?.file ? (
              <div className="mt-2 rounded-md border border-brand-200 bg-brand-50/60 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-danger-500" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h8l4 4v14H6zM14 3v4h4" strokeLinejoin="round" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink-800" title={upload.file.name}>
                    {upload.file.name}
                  </span>
                </div>
                <label className="mt-2 block text-xs font-medium text-ink-600">
                  저장할 폴더
                  <FolderSelect library={lib} value={upload.folder} onChange={(folder) => setUpload((u) => ({ ...u, folder }))} />
                </label>
                {upload.error && <div className="mt-2 text-xs text-danger-600">{upload.error}</div>}
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" disabled={upload.busy} onClick={() => setUpload(null)} className="rounded-md px-3 py-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-40">
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={upload.busy}
                    onClick={doUpload}
                    className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {upload.busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                    {upload.busy ? '올리는 중…' : '올리기'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-ink-300 px-3 py-2 text-sm font-medium text-brand-700 hover:border-brand-400 hover:bg-brand-50"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" />
                  </svg>
                  컴퓨터에서 PDF 올리기
                </button>
                {upload?.error && <div className="mt-1 text-xs text-danger-600">{upload.error}</div>}
              </>
            )}
          </>
        )}
        <ul className="mt-2 min-h-24 flex-1 overflow-y-auto rounded-md border border-ink-200" role="listbox" aria-label="도면 목록">
          {list === null && <li className="px-3 py-4 text-center text-sm text-ink-400">도면 목록 불러오는 중…</li>}
          {list !== null && items.length === 0 && <li className="px-3 py-4 text-center text-sm text-ink-400">찾는 도면이 없어요</li>}
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={picked === r.id}
                onClick={() => setPicked(r.id)}
                onDoubleClick={() => onConfirm({ id: r.id, name: r.name, page: pageNo, role: role.trim() })}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${picked === r.id ? 'bg-brand-50 text-brand-800' : 'hover:bg-ink-50'}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 3h8l4 4v14H6zM14 3v4h4" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={r.name}>
                    {displayName(lib, r.id, r.name)}
                  </span>
                  {lib.assign[r.id] && <span className="block truncate text-xs text-ink-400">{folderLabel(lib, lib.assign[r.id])}</span>}
                </span>
                {r.id === currentId && <span className="shrink-0 text-xs text-ink-400">지금 도면</span>}
                {r.fresh && <span className="shrink-0 rounded bg-ok-50 px-1.5 py-0.5 text-xs text-ok-700">방금 올림</span>}
              </button>
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-600">
          열 페이지
          <input
            inputMode="numeric"
            value={page}
            onChange={(e) => setPage(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => e.target.select()}
            className="w-16 rounded-md border border-ink-300 px-2 py-1 text-center"
          />
          <span className="text-xs text-ink-400">쪽 (없는 페이지면 마지막 쪽)</span>
        </label>
        <div className="mt-3 text-sm text-ink-600">
          문서 종류 <span className="text-xs text-ink-400">(고르지 않아도 돼요)</span>
          <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="문서 종류">
            {DOC_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole((cur) => (cur === r ? '' : r))}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${role === r ? 'bg-ink-800 text-white' : 'text-ink-600 ring-1 ring-ink-300 hover:bg-ink-100'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {onUnlink && (
            <button type="button" onClick={onUnlink} className="rounded-md px-3 py-2 text-sm text-danger-600 hover:bg-danger-50">
              연결 끊기
            </button>
          )}
          <button type="button" onClick={onCancel} className="ml-auto rounded-md px-4 py-2 text-sm text-ink-600 hover:bg-ink-100">
            취소
          </button>
          <button disabled={!chosen} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
            연결
          </button>
        </div>
      </form>
    </div>
  )
}
