import { pageLogV } from '../lib/pageLinks'
import { withoutTrashed } from '../lib/trash'
import { useEffect, useMemo, useRef, useState } from 'react'
import { docRoleList, isBoxLink, unboxLink } from '../lib/instrument'
import { EMPTY_LIBRARY, displayName, folderLabel } from '../lib/library'
import { FolderSelect } from './Library'
import { isImageFile, newImageId, prepareImage, rememberImage, useImageUrl } from '../lib/images'
import { resolveFile } from '../lib/revision'
import { drawingNo, sameNumberDocs } from '../lib/drawingNo'
import BoxIcon from './BoxIcon'

// 연결할 사진은 메모 사진처럼 자세히 보이게 긴 변 2400px 로 줄여 이 도면 사진 저장소에 둠
const LINK_PHOTO_SIDE = 2400
const isPdfFile = (f) => f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))

// 메모 범위에 연결할 도면 고르기. 앱에 올려 둔 도면 중 하나와 (원하면) 페이지를 고릅니다.
// 사진도 연결할 수 있음: 컴퓨터에서 고르거나 끌어 놓거나 Ctrl+V → { photo, name, role, w, h }
// initial: 이미 연결된 { id, name, page, role } (사진이면 { photo, … }). role: 관련 문서 종류 (Hook-up, 데이터시트 …, 비워도 됨)
// onSetRoles(목록): 문서 종류 목록 고치기 (모든 도면 공통). 없으면 고치는 버튼을 숨김
// onImportFile(file, folderId): 컴퓨터의 PDF 를 탭을 열지 않고 올림 → { id, name, pages }
// onReviseDoc(doc, file): 같은 도면 번호의 기존 도면을 열어 이 PDF 로 개정판 바꾸기 창을 띄움
// 이미 올라가 있는 PDF(이름·크기 같음)면 올리지 않고 그 도면을 골라 둠. 도면 번호만 같으면 개정판·연결·새로 올리기 중 고름
// onPickBox({ id, name, role }): 그 도면을 열고 박스(메모 범위·Equipment·도형 …)를 눌러 고르기. 고르면 박스 연결이 됨
// initial 이 박스 연결이면 ({ item, itemName, rect }) 그 박스를 그대로 둘지, 페이지로만 갈지 고름
export default function LinkPicker({ store, currentId, currentName, library, onImportFile, onReviseDoc, onSetRoles, onPickBox, initial, defaultRole = '', onCancel, onConfirm, onUnlink }) {
  const [list, setList] = useState(null) // null = 불러오는 중
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(initial?.photo ? null : (initial?.id ?? null))
  // 고른 사진 { id, name, w, h } (저장 중이면 busy). 사진을 고르면 도면 고른 것은 풀림
  const [photo, setPhoto] = useState(initial?.photo ? { id: initial.photo, name: initial.name, w: initial.w, h: initial.h } : null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [page, setPage] = useState(String(initial?.page ?? 1))
  const [role, setRole] = useState(initial?.role ?? defaultRole)
  const [keepBox, setKeepBox] = useState(isBoxLink(initial)) // 이미 고른 박스 그대로 (같은 도면을 고른 동안만)
  const [added, setAdded] = useState([]) // 이 창에서 방금 올린 도면
  const [upload, setUpload] = useState(null) // { file, folder, busy, error } 올릴 PDF 와 저장할 폴더
  const fileRef = useRef(null)
  const [dropping, setDropping] = useState(false) // 컴퓨터의 파일을 이 창 위로 끌고 있음
  const [already, setAlready] = useState(null) // 고른 PDF 가 이미 올라가 있던 도면 { id, name }

  // 이 창이 떠 있는 동안 끌어 온 파일은 여기서만 받음: 앱 전체의 "PDF 열기" 끌어놓기(탭 열기)와
  // 도면에 사진 넣기로 넘어가지 않게 전파를 멈춤. 창 바깥 어두운 곳에 놓아도 올리기로 받음.
  const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  const dropProps = {
    onDragEnter: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
    },
    onDragOver: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      const ok = !upload?.busy && !photoBusy
      e.dataTransfer.dropEffect = ok ? 'copy' : 'none'
      if (ok) setDropping(true)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false)
    },
    onDrop: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDropping(false)
      if (upload?.busy || photoBusy) return
      const files = [...e.dataTransfer.files]
      chooseFile(files.find(isPdfFile) ?? files.find(isImageFile) ?? files[0])
    },
  }
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
    if (initial && !initial.photo && !all.some((r) => r.id === initial.id)) all.push({ id: initial.id, name: initial.name })
    const q = query.trim().toLowerCase()
    const label = (r) => `${displayName(lib, r.id, r.name)} ${r.name}`.toLowerCase()
    return q ? all.filter((r) => label(r).includes(q)) : all
  }, [list, added, currentId, currentName, initial, query, lib])

  const chooseFile = (file) => {
    if (!file) return
    if (isImageFile(file)) return addPhoto(file)
    if (!isPdfFile(file) || !onImportFile) {
      setUpload({ file: null, folder: '', error: onImportFile ? 'PDF 파일이나 사진만 올릴 수 있어요.' : '사진만 올릴 수 있어요.' })
      return
    }
    setAlready(null)
    // 이미 올라가 있는 도면 (같은 이름·크기, 또는 개정판으로 이어 둔 파일): 올리지 않고 그 도면을 고름
    const rows = [...added, ...(list ?? [])]
    const { id } = resolveFile(lib, file)
    const have = rows.find((r) => r.id === id)
    if (have) {
      setUpload(null)
      setPhoto(null)
      setPicked(have.id)
      setQuery('')
      setAlready({ id: have.id, name: have.name })
      return
    }
    // 도면 번호만 같은 도면 (rev 도면 등): 개정판으로 바꿀지 물어봄
    const seen = new Set()
    const matches = sameNumberDocs(rows, file.name, id)
      .filter((r) => !seen.has(r.id) && seen.add(r.id))
      .slice(0, 3)
    // 저장할 폴더 기본값: 지금 도면이 들어 있는 폴더 (이미 골라 둔 폴더가 있으면 그대로)
    setUpload((u) => ({ file, matches, folder: u?.file ? u.folder : (lib.assign[currentId] ?? ''), busy: false, error: '' }))
  }

  // 사진: 줄여서 이 도면 사진 저장소에 저장 (서버면 pdfs/<uid>/img). 저장되면 바로 고른 상태로
  const addPhoto = async (file) => {
    if (photoBusy) return
    setPhotoBusy(true)
    setUpload(null)
    try {
      const img = await prepareImage(file, { maxSide: LINK_PHOTO_SIDE })
      const id = newImageId()
      rememberImage(id, img.blob)
      await store.saveImage(currentId, id, img.blob)
      const name = file.name && file.name !== 'image.png' ? file.name : '붙여넣은 사진'
      setPhoto({ id, name, w: img.width, h: img.height })
      setPicked(null)
    } catch (e) {
      console.warn(e)
      setUpload({ file: null, folder: '', error: '사진을 올리지 못했어요. JPG·PNG 사진인지, 인터넷 연결을 확인해 주세요.' })
    } finally {
      setPhotoBusy(false)
    }
  }

  // 이 창에서 Ctrl+V 로 사진 붙여넣기 (도면에 사진 넣기로 넘어가지 않게 막음)
  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files ?? [])].find(isImageFile)
    if (!file) return
    e.preventDefault()
    e.stopPropagation()
    addPhoto(file)
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
  const box = keepBox && !photo && chosen && chosen.id === initial?.id ? initial : null

  // 같은 번호 도면을 개정판으로: 그 도면을 연결하고, 그 도면 탭에서 개정판 바꾸기 창을 띄움
  const reviseInto = (m) => {
    const file = upload.file
    onConfirm({ id: m.id, name: m.name, page: pageNo, role: role.trim(), pv: pageLogV(m.summary?.pl) })
    onReviseDoc(m, file)
  }

  const submit = (e) => {
    e.preventDefault()
    if (photo) onConfirm({ photo: photo.id, name: photo.name, role: role.trim(), w: photo.w, h: photo.h })
    else if (box) onConfirm({ ...box, name: chosen.name, role: role.trim() })
    else if (chosen)
      onConfirm({ ...unboxLink(initial?.id === chosen.id ? initial : {}), id: chosen.id, name: chosen.name, page: pageNo, role: role.trim(), pv: pageLogV(chosen.summary?.pl) })
  }
  const pickBox = () => chosen && onPickBox({ id: chosen.id, name: chosen.name, role: role.trim(), page: pageNo })

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel} {...dropProps}>
      <form
        onSubmit={submit}
        onPaste={onPaste}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className={`relative flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-surface p-5 shadow-2xl ${dropping ? 'ring-4 ring-brand-400' : ''}`}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-500 bg-brand-50/90 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" />
            </svg>
            <span className="text-base font-semibold">여기에 놓으면 관련 도면으로 올려요</span>
            <span className="text-xs text-brand-600">PDF 는 놓은 뒤 저장할 폴더를 고르고, 사진은 바로 연결돼요</span>
          </div>
        )}
        <h2 className="text-lg font-bold">관련 도면 연결</h2>
        <p className="mt-1 text-sm text-ink-500">메모장에서 누르면 고른 도면의 그 쪽이나 사진이 크게 보여요. 올려 둔 도면에서 고르거나, 컴퓨터의 PDF·사진(현장 사진, 명판 등)을 바로 올려 연결할 수 있어요.</p>
        <input
          autoFocus
          placeholder="도면 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-3 rounded-md border border-ink-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        {(
          <>
            <input
              ref={fileRef}
              type="file"
              accept={onImportFile ? 'application/pdf,.pdf,image/*' : 'image/*'}
              className="hidden"
              onChange={(e) => {
                chooseFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {photo ? (
              <PhotoChoice photo={photo} onRemove={() => setPhoto(null)} onReplace={() => fileRef.current?.click()} />
            ) : photoBusy ? (
              <div className="mt-2 flex items-center justify-center gap-2 rounded-md border border-brand-200 bg-brand-50/60 px-3 py-3 text-sm text-brand-700">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                사진 올리는 중…
              </div>
            ) : upload?.file ? (
              <div className="mt-2 rounded-md border border-brand-200 bg-brand-50/60 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-danger-500" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h8l4 4v14H6zM14 3v4h4" strokeLinejoin="round" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink-800" title={upload.file.name}>
                    {upload.file.name}
                  </span>
                </div>
                {upload.matches?.length > 0 && (
                  <div className="mt-2 rounded-md border border-warn-200 bg-warn-50 p-2 text-xs text-ink-700">
                    <div className="font-semibold text-warn-800">같은 도면 번호({drawingNo(upload.file.name)})의 도면이 있어요</div>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {upload.matches.map((m) => (
                        <li key={m.id} className="rounded bg-white/80 px-2 py-1.5 ring-1 ring-warn-200">
                          <div className="truncate font-medium text-ink-800" title={m.name}>
                            {displayName(lib, m.id, m.name)}
                          </div>
                          {(displayName(lib, m.id, m.name) !== m.name || lib.assign[m.id]) && (
                            <div className="truncate text-[11px] text-ink-400">
                              {[displayName(lib, m.id, m.name) !== m.name && m.name, lib.assign[m.id] && folderLabel(lib, lib.assign[m.id])].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {onReviseDoc && (
                              <button
                                type="button"
                                disabled={upload.busy}
                                onClick={() => reviseInto(m)}
                                title="그 도면을 열어 PDF 만 이 파일로 바꿔요. 마크업·메모·연결은 그대로, 예전 판은 보관"
                                className="rounded bg-ink-800 px-2 py-1 font-semibold text-white hover:bg-ink-700 disabled:opacity-50"
                              >
                                개정판으로 바꾸기
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={upload.busy}
                              onClick={() => {
                                setPicked(m.id)
                                setUpload(null)
                                setQuery('')
                              }}
                              title="올리지 않고 이미 있는 이 도면에 연결"
                              className="rounded px-2 py-1 font-medium text-ink-700 ring-1 ring-ink-300 hover:bg-ink-100 disabled:opacity-50"
                            >
                              기존 도면에 연결만
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1.5 text-[11px] text-ink-500">다른 도면이면 아래에서 폴더를 고르고 새 도면으로 올리세요.</div>
                  </div>
                )}
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
                    className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-press disabled:opacity-60"
                  >
                    {upload.busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                    {upload.busy ? '올리는 중…' : upload.matches?.length ? '새 도면으로 올리기' : '올리기'}
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
                  {onImportFile ? '컴퓨터에서 PDF·사진 올리기' : '컴퓨터에서 사진 올리기'}
                  <span className="font-normal text-ink-400">(끌어 놓기·Ctrl+V 도 돼요)</span>
                </button>
                {upload?.error && <div className="mt-1 text-xs text-danger-600">{upload.error}</div>}
              </>
            )}
          </>
        )}
        {already && !upload?.file && !photo && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-ok-200 bg-ok-50 px-3 py-2 text-sm text-ok-800" role="status">
            <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
            <span className="min-w-0">
              이미 올라가 있는 도면이에요: <b className="font-semibold">{displayName(lib, already.id, already.name)}</b>
              {lib.assign[already.id] && <span className="text-ok-700"> ({folderLabel(lib, lib.assign[already.id])})</span>}
              <span className="block text-xs text-ok-700">다시 올리지 않고 아래 목록에서 골라 뒀어요. 폴더도 그대로예요.</span>
            </span>
          </div>
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
                onClick={() => {
                  setPicked(r.id)
                  setPhoto(null)
                  if (already?.id !== r.id) setAlready(null)
                }}
                onDoubleClick={() =>
                  box && r.id === box.id ? onConfirm({ ...box, name: r.name, role: role.trim() }) : onConfirm({ id: r.id, name: r.name, page: pageNo, role: role.trim(), pv: pageLogV(r.summary?.pl) })
                }
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${picked === r.id && !photo ? 'bg-brand-50 text-brand-800' : 'hover:bg-ink-50'}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 3h8l4 4v14H6zM14 3v4h4" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={r.name}>
                    {displayName(lib, r.id, r.name)}
                  </span>
                  {lib.aliases?.[r.id] && <span className="block truncate text-[11px] text-ink-400">{r.name}</span>}
                  {lib.assign[r.id] && <span className="block truncate text-xs text-ink-400">{folderLabel(lib, lib.assign[r.id])}</span>}
                </span>
                {r.id === currentId && <span className="shrink-0 text-xs text-ink-400">지금 도면</span>}
                {r.fresh && <span className="shrink-0 rounded bg-ok-50 px-1.5 py-0.5 text-xs text-ok-700">방금 올림</span>}
              </button>
            </li>
          ))}
        </ul>
        {box ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-2 text-sm">
            <BoxIcon className="h-4 w-4 shrink-0 text-brand-600" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-brand-800">{box.itemName || '고른 박스'}</span>
              <span className="block text-xs text-ink-500">누르면 이 박스로 확대해 깜빡여요 · {box.page || 1}쪽</span>
            </span>
            {onPickBox && (
              <button type="button" onClick={pickBox} className="shrink-0 rounded px-2 py-1 text-xs text-ink-600 hover:bg-surface">
                다른 박스
              </button>
            )}
            <button type="button" onClick={() => setKeepBox(false)} className="shrink-0 rounded px-2 py-1 text-xs text-ink-500 hover:bg-surface hover:text-danger-600" title="박스 없이 쪽으로만 연결">
              ✕
            </button>
          </div>
        ) : (
          <div className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 ${photo ? 'hidden' : ''}`}>
            <label className="flex items-center gap-2 text-sm text-ink-600">
              열 쪽
              <input
                inputMode="numeric"
                value={page}
                onChange={(e) => setPage(e.target.value.replace(/[^0-9]/g, ''))}
                onFocus={(e) => e.target.select()}
                className="w-16 rounded-md border border-ink-300 px-2 py-1 text-center"
              />
              <span className="text-xs text-ink-400">쪽</span>
            </label>
            {onPickBox && (
              <button
                type="button"
                onClick={pickBox}
                disabled={!chosen || photoBusy}
                title="그 도면을 열고 연결할 박스를 누르거나 새로 그려서 연결"
                className="ml-auto flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-40"
              >
                <BoxIcon className="h-4 w-4" />
                박스 고르기·그리기
              </button>
            )}
            {onPickBox && chosen && (
              <p className="w-full text-xs text-ink-500">
                '박스 고르기·그리기'를 누르면 그 도면이 열려요. 있는 박스를 누르거나 빈 곳을 끌어 새 박스를 그리면 그 박스로 연결돼요.
              </p>
            )}
          </div>
        )}
        <RoleChips roles={docRoleList(lib.docRoles)} role={role} setRole={setRole} onSetRoles={onSetRoles} />
        <div className="mt-4 flex items-center gap-2">
          {onUnlink && (
            <button type="button" onClick={onUnlink} className="rounded-md px-3 py-2 text-sm text-danger-600 hover:bg-danger-50">
              연결 해제
            </button>
          )}
          <button type="button" onClick={onCancel} className="ml-auto rounded-md px-4 py-2 text-sm text-ink-600 hover:bg-ink-100">
            취소
          </button>
          <button disabled={photo ? false : !chosen || photoBusy} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-press disabled:opacity-40">
            연결
          </button>
        </div>
      </form>
    </div>
  )
}

// 고른 사진: 작은 그림 + 이름, 다른 사진으로 바꾸기·빼기
function PhotoChoice({ photo, onRemove, onReplace }) {
  const url = useImageUrl(photo.id)
  return (
    <div className="mt-2 flex items-center gap-3 rounded-md border border-brand-300 bg-brand-50 p-2 text-sm">
      <div className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded bg-surface ring-1 ring-ink-200">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-200 border-t-ink-500" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-brand-800" title={photo.name}>
          {photo.name}
        </div>
        <div className="text-xs text-ink-500">이 사진을 연결해요{photo.w ? ` · ${photo.w}×${photo.h}` : ''}</div>
      </div>
      <button type="button" onClick={onReplace} className="shrink-0 rounded px-2 py-1 text-xs text-ink-600 hover:bg-surface">
        바꾸기
      </button>
      <button type="button" onClick={onRemove} className="shrink-0 rounded px-2 py-1 text-xs text-ink-500 hover:bg-surface hover:text-danger-600" title="사진 대신 도면 고르기">
        ✕
      </button>
    </div>
  )
}

// 문서 종류 고르기 + 목록 고치기. 고치기에서는 칸마다 이름을 바꾸거나 ✕ 로 뺄 수 있고, + 로 새 종류를 더함.
// 목록에 없는 종류(예전에 고른 '루프도' 같은 것)가 골라져 있으면 그것도 버튼으로 보여 줌
function RoleChips({ roles, role, setRole, onSetRoles }) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const options = role && !roles.includes(role) ? [...roles, role] : roles
  const chip = 'rounded-full px-2.5 py-0.5 text-xs font-medium'
  const keep = (e) => {
    // 이 창은 form 이라 Enter 가 "연결"로 넘어가지 않게
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }
  const add = () => {
    const name = draft.trim()
    setDraft('')
    setAdding(false)
    if (!name) return
    if (!roles.includes(name)) onSetRoles([...roles, name])
    setRole(name)
  }
  const rename = (i, value) => {
    const name = value.trim()
    if (!name || name === roles[i]) return
    if (roles.includes(name)) return
    onSetRoles(roles.map((r, j) => (j === i ? name : r)))
    if (role === roles[i]) setRole(name)
  }
  const remove = (i) => {
    onSetRoles(roles.filter((_, j) => j !== i))
  }

  return (
    <div className="mt-3 text-sm text-ink-600">
      <div className="flex items-center gap-2">
        <span>
          문서 구분 <span className="text-xs text-ink-400">{editing ? '(이름을 고치거나 ✕ 로 삭제, 모든 도면 공통)' : '(고르지 않아도 돼요)'}</span>
        </span>
        {onSetRoles && (
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v)
              setAdding(false)
            }}
            className="ml-auto rounded px-1.5 py-0.5 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          >
            {editing ? '완료' : '구분 고치기'}
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1" role="group" aria-label="문서 구분">
        {editing
          ? roles.map((r, i) => (
              <span key={r} className="flex items-center rounded-full pl-1 pr-0.5 ring-1 ring-ink-300">
                <input
                  defaultValue={r}
                  aria-label={`${r} 이름`}
                  maxLength={30}
                  size={Math.max(3, r.length + 1)}
                  onKeyDown={keep}
                  onBlur={(e) => {
                    rename(i, e.target.value)
                    e.target.value = roles[i]
                  }}
                  className="min-w-0 rounded-full bg-transparent px-1.5 py-0.5 text-xs font-medium outline-none focus:bg-brand-50"
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`${r} 삭제`}
                  title="목록에서 삭제 (이미 연결한 문서의 구분은 그대로)"
                  className="grid h-5 w-5 place-items-center rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                >
                  ✕
                </button>
              </span>
            ))
          : options.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole((cur) => (cur === r ? '' : r))}
                className={`${chip} ${role === r ? 'bg-ink-800 text-surface' : 'text-ink-600 ring-1 ring-ink-300 hover:bg-ink-100'}`}
              >
                {r}
              </button>
            ))}
        {onSetRoles &&
          (adding ? (
            <input
              autoFocus
              value={draft}
              maxLength={30}
              placeholder="새 구분 이름"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setDraft('')
                  setAdding(false)
                } else keep(e)
              }}
              onBlur={add}
              className="w-28 rounded-full border border-brand-400 px-2.5 py-0.5 text-xs outline-none ring-2 ring-brand-200"
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={`${chip} text-ink-500 border border-dashed border-ink-300 hover:bg-ink-100 hover:text-ink-800`} title="문서 구분 더하기 (모든 도면 공통)">
              + 추가
            </button>
          ))}
      </div>
    </div>
  )
}

