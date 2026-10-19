import { useRef, useState } from 'react'
import { AuthPanel, MigrationCard } from './Account'
import { FOLDER_COLORS, addFolder, colorHex, deleteFolder, editFolder, moveDoc } from '../lib/library'

const STEPS = [
  { n: 1, title: 'PDF 도면 열기', text: '버튼을 누르거나 파일을 화면에 끌어다 놓으세요.' },
  { n: 2, title: '기준 길이 지정', text: '치수를 아는 선의 양 끝을 클릭하고 실제 길이를 입력합니다.' },
  { n: 3, title: '측정하기', text: '길이, 면적, 각도 도구로 원하는 곳을 클릭해 잽니다.' },
]

function timeAgo(ts) {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}일 전`
  return new Date(ts).toLocaleDateString('ko-KR')
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function scaleLabel(state) {
  const c = state?.calibration
  if (!c) return null
  return c.mode === 'ratio' ? `축척 1:${c.ratio.toLocaleString('ko-KR')}` : c.label
}

export default function EmptyState({
  onOpenFile,
  onOpenSample,
  loading,
  recent,
  openIds,
  onOpenRecent,
  onRemoveRecent,
  library,
  onUpdateLibrary,
  onRename,
  openFolderId, // 펼쳐 본 폴더. 이때 연 PDF 는 이 폴더에 들어감
  setOpenFolderId,
  cloud, // 로그인해서 서버에 저장 중
  showLogin,
  store,
  onMigrated,
}) {
  const inputRef = useRef(null)
  const [folderDialog, setFolderDialog] = useState(null) // {} = 새 폴더, 폴더 객체 = 고치기
  const fetching = recent === null // 서버에서 목록을 불러오는 중
  const list = recent ?? []
  const hasRecent = list.length > 0 || fetching || library.folders.length > 0

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto w-full max-w-2xl">
        {showLogin && <AuthPanel />}
        {cloud && <MigrationCard store={store} onDone={onMigrated} />}
        <div
          className={`cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 text-center transition hover:border-blue-400 hover:bg-blue-50/40 ${
            hasRecent ? 'py-6' : 'py-12'
          }`}
          onClick={() => inputRef.current?.click()}
        >
          <svg
            viewBox="0 0 48 48"
            className={`mx-auto text-blue-600 ${hasRecent ? 'h-9 w-9' : 'h-14 w-14'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M12 4h17l9 9v31H12z" strokeLinejoin="round" />
            <path d="M29 4v9h9" strokeLinejoin="round" />
            <path d="M18 34h14M18 34v-4M32 34v-4" strokeLinecap="round" />
          </svg>
          <p className="mt-3 text-lg font-semibold">
            {loading ? 'PDF 여는 중…' : 'PDF 도면을 여기에 끌어다 놓거나 클릭해서 여세요'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {cloud
              ? '여러 개를 한 번에 열 수 있어요. PDF와 측정값은 내 계정의 서버 저장소에 저장되고, 나만 볼 수 있어요.'
              : '여러 개를 한 번에 열 수 있어요. 파일은 서버로 전송되지 않고 내 브라우저에만 저장됩니다.'}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              onOpenFile([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>

        {hasRecent ? (
          <section className="mt-8">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-slate-500">{cloud ? '서버에 저장된 도면' : '최근 연 도면'}</h2>
              {!fetching && (
                <button
                  onClick={() => setFolderDialog({})}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50"
                >
                  <FolderIcon className="h-4 w-4" color="currentColor" />
                  새 폴더
                </button>
              )}
            </div>
            {fetching ? (
              <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
                서버에서 도면 목록을 불러오는 중…
              </div>
            ) : (
              <Library
                list={list}
                library={library}
                openIds={openIds}
                cloud={cloud}
                onOpen={onOpenRecent}
                onRemove={onRemoveRecent}
                onRename={onRename}
                onUpdateLibrary={onUpdateLibrary}
                onEditFolder={(folder) => setFolderDialog(folder)}
                openFolderId={openFolderId}
                setOpenFolderId={setOpenFolderId}
              />
            )}
            <button onClick={onOpenSample} className="mt-3 px-1 text-sm text-blue-600 hover:underline">
              샘플 평면도 열기
            </button>
          </section>
        ) : (
          <>
            <div className="text-center">
              <button onClick={onOpenSample} className="mt-4 text-sm font-medium text-blue-600 hover:underline">
                도면이 없다면? 샘플 평면도로 체험해 보기 →
              </button>
            </div>
            <ol className="mt-10 grid gap-3 text-left sm:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-xl bg-white p-4 shadow-sm">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                    {s.n}
                  </div>
                  <div className="mt-2 font-semibold">{s.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{s.text}</div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
      {folderDialog && (
        <FolderDialog
          folder={folderDialog}
          onClose={() => setFolderDialog(null)}
          onSave={(name, color) => {
            onUpdateLibrary((lib) =>
              folderDialog.id ? editFolder(lib, folderDialog.id, { name, color }) : addFolder(lib, name, color),
            )
            setFolderDialog(null)
          }}
        />
      )}
    </div>
  )
}

const DRAG_TYPE = 'application/x-pdf-measure-doc'

function FolderIcon({ className, color, open, fill }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? 'none'} fillOpacity={fill ? 0.2 : undefined} stroke={color} strokeWidth="1.8" strokeLinejoin="round">
      {open ? (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3.5 18M3 7v11h15.2a1 1 0 0 0 1-.7l2-6.3a1 1 0 0 0-1-1.3" />
      ) : (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      )}
    </svg>
  )
}

// 폴더별로 묶은 도면 목록
function Library({ list, library, openIds, cloud, onOpen, onRemove, onRename, onUpdateLibrary, onEditFolder, openFolderId, setOpenFolderId }) {
  const [dropTarget, setDropTarget] = useState(undefined) // 폴더 id, 'none' = 폴더 밖
  const [dragging, setDragging] = useState(false)

  const { folders, assign } = library
  const loose = list.filter((item) => !assign[item.id])
  const openFolder = folders.find((f) => f.id === openFolderId) ?? null
  const shown = openFolder ? list.filter((item) => assign[item.id] === openFolder.id) : loose
  const move = (docId, folderId) => onUpdateLibrary((lib) => moveDoc(lib, docId, folderId))

  // 도면을 끌어다 폴더(또는 폴더 밖 목록)에 놓기
  const dropProps = (key, folderId) => ({
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(key)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget((t) => (t === key ? undefined : t))
    },
    onDrop: (e) => {
      const id = e.dataTransfer.getData(DRAG_TYPE)
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(undefined)
      setDragging(false)
      move(id, folderId)
    },
  })

  const row = (item) => (
    <FileRow
      key={item.id}
      item={item}
      isOpen={openIds.includes(item.id)}
      cloud={cloud}
      folders={folders}
      folderId={assign[item.id] ?? null}
      onOpen={onOpen}
      onRemove={onRemove}
      onRename={onRename}
      onMove={move}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false)
        setDropTarget(undefined)
      }}
    />
  )

  return (
    <div className="space-y-3">
      {folders.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {folders.map((folder) => {
            const items = list.filter((item) => assign[item.id] === folder.id)
            const isOpen = folder.id === openFolderId
            const hex = colorHex(folder.color)
            return (
              <div
                key={folder.id}
                {...dropProps(folder.id, folder.id)}
                className={`group relative rounded-lg bg-white shadow-sm ring-2 transition ${
                  dropTarget === folder.id ? 'ring-blue-400' : isOpen ? '' : 'ring-transparent hover:ring-slate-200'
                }`}
                style={isOpen && dropTarget !== folder.id ? { '--tw-ring-color': hex } : undefined}
              >
                <button
                  className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left"
                  onClick={() => setOpenFolderId(isOpen ? null : folder.id)}
                  title={isOpen ? '폴더 닫기' : '폴더 열기'}
                >
                  <span style={{ color: hex }}>
                    <FolderIcon className="h-5 w-5 shrink-0" color="currentColor" open={isOpen} fill={hex} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{folder.name}</span>
                  <span className="shrink-0 text-xs text-slate-400 group-hover:hidden">{items.length}</span>
                </button>
                <div className="absolute top-1/2 right-1 hidden -translate-y-1/2 items-center rounded bg-white group-hover:flex">
                  <button
                    onClick={() => onEditFolder(folder)}
                    title="폴더 이름·색상 바꾸기"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    onClick={() => {
                      const ask = items.length
                        ? `"${folder.name}" 폴더를 지울까요? 안에 있는 도면 ${items.length}개는 지워지지 않고 폴더 밖으로 나와요.`
                        : `"${folder.name}" 폴더를 지울까요?`
                      if (!window.confirm(ask)) return
                      if (isOpen) setOpenFolderId(null)
                      onUpdateLibrary((lib) => deleteFolder(lib, folder.id))
                    }}
                    title="폴더 지우기"
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {openFolder ? (
        <div>
          <div className="mb-1 flex items-center gap-1 px-1 text-xs font-medium text-slate-500">
            <button onClick={() => setOpenFolderId(null)} className="hover:text-blue-600 hover:underline">
              전체
            </button>
            <span>›</span>
            <span style={{ color: colorHex(openFolder.color) }}>{openFolder.name}</span>
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm">
            {shown.length ? (
              shown.map(row)
            ) : (
              <li className="px-4 py-4 text-center text-sm text-slate-400">
                비어 있어요. 지금 PDF 를 열면 이 폴더에 들어가요. 다른 도면은 폴더 칸에 끌어다 놓거나 도면의 폴더 버튼으로 넣어 보세요.
              </li>
            )}
          </ul>
        </div>
      ) : (
        (shown.length > 0 || folders.length === 0) && (
          <div
            {...dropProps('none', null)}
            className={`rounded-xl ring-2 transition ${dropTarget === 'none' ? 'ring-blue-400' : 'ring-transparent'}`}
          >
            {folders.length > 0 && <div className="mb-1 px-1 text-xs font-medium text-slate-400">폴더 밖</div>}
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm">{shown.map(row)}</ul>
          </div>
        )
      )}
      {folders.length > 0 && dragging && (openFolder || loose.length === 0) && (
        <div
          {...dropProps('none', null)}
          className={`rounded-xl border-2 border-dashed px-4 py-3 text-center text-sm ${
            dropTarget === 'none' ? 'border-blue-400 text-blue-600' : 'border-slate-300 text-slate-400'
          }`}
        >
          여기에 놓으면 폴더에서 빼요
        </div>
      )}
    </div>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  )
}

const splitExt = (name) => {
  const m = name.match(/\.pdf$/i)
  return m ? [name.slice(0, m.index), m[0]] : [name, '']
}

function FileRow({ item, isOpen, cloud, folders, folderId, onOpen, onRemove, onRename, onMove, onDragStart, onDragEnd }) {
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const count = item.state?.measurements?.length ?? 0
  const scale = scaleLabel(item.state)
  const [base, ext] = splitExt(item.name)

  const finishRename = (value) => {
    setEditing(false)
    const next = value.trim()
    if (next && next !== base) onRename(item, next + ext)
  }

  return (
    <li
      className="group relative flex items-center gap-3 px-4 py-3 hover:bg-blue-50/50"
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, item.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <div
        role="button"
        tabIndex={0}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        onClick={() => !editing && onOpen(item)}
        onKeyDown={(e) => !editing && e.key === 'Enter' && onOpen(item)}
      >
        <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M6 2h9l5 5v15H6z" />
          <path d="M15 2v5h5" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editing ? (
              <input
                autoFocus
                defaultValue={base}
                onFocus={(e) => e.target.select()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename(e.currentTarget.value)
                  if (e.key === 'Escape') setEditing(false)
                }}
                onBlur={(e) => finishRename(e.currentTarget.value)}
                className="w-full min-w-0 rounded border border-blue-400 px-1.5 py-0.5 font-medium text-slate-800 outline-none ring-2 ring-blue-100"
              />
            ) : (
              <span className="truncate font-medium text-slate-800">{item.name}</span>
            )}
            {isOpen && !editing && (
              <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">열려 있음</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
            <span>{timeAgo(item.lastOpened)}</span>
            <span>· {formatSize(item.size)}</span>
            <span>· 측정 {count}개</span>
            {scale && <span className="text-orange-600">· {scale}</span>}
            {cloud && item.hasFile === false && <span className="text-amber-600">· PDF 파일 없음</span>}
          </div>
        </div>
      </div>
      <div className={`flex shrink-0 items-center ${menu ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
        <button
          onClick={() => setEditing(true)}
          title="이름 바꾸기"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <PencilIcon />
        </button>
        {folders.length > 0 && (
          <button
            onClick={() => setMenu((m) => !m)}
            title="폴더로 옮기기"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <FolderIcon className="h-4 w-4" color="currentColor" />
          </button>
        )}
        <button
          onClick={() => {
            const ask = cloud
              ? `"${item.name}" 을(를) 서버에서 지울까요? PDF 파일과 측정값이 서버에서 완전히 지워집니다.`
              : `"${item.name}" 을(를) 최근 목록에서 지울까요? 저장된 측정값도 함께 지워집니다.`
            if (window.confirm(ask)) onRemove(item)
          }}
          disabled={isOpen}
          title={isOpen ? '열려 있는 탭을 먼저 닫아 주세요' : '목록에서 지우기'}
          className="rounded p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:hidden"
        >
          <TrashIcon />
        </button>
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute top-full right-4 z-20 -mt-2 w-52 overflow-hidden rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
            <div className="px-3 py-1.5 text-xs font-medium text-slate-400">폴더로 옮기기</div>
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  onMove(item.id, f.id)
                  setMenu(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
              >
                <span style={{ color: colorHex(f.color) }}>
                  <FolderIcon className="h-4 w-4" color="currentColor" />
                </span>
                <span className="flex-1 truncate">{f.name}</span>
                {folderId === f.id && <span className="text-blue-600">✓</span>}
              </button>
            ))}
            {folderId && (
              <button
                onClick={() => {
                  onMove(item.id, null)
                  setMenu(false)
                }}
                className="w-full border-t border-slate-100 px-3 py-1.5 text-left text-slate-600 hover:bg-slate-50"
              >
                폴더에서 빼기
              </button>
            )}
          </div>
        </>
      )}
    </li>
  )
}

function FolderDialog({ folder, onClose, onSave }) {
  const [name, setName] = useState(folder.name ?? '')
  const [color, setColor] = useState(folder.color ?? FOLDER_COLORS[0].id)
  const editing = !!folder.id
  const submit = (e) => {
    e.preventDefault()
    if (name.trim()) onSave(name.trim(), color)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h3 className="text-lg font-semibold">{editing ? '폴더 고치기' : '새 폴더'}</h3>
        <label className="mt-4 block text-sm font-medium text-slate-600">
          폴더 이름
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="예: 1층 평면도"
            maxLength={40}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <div className="mt-4 text-sm font-medium text-slate-600">색상</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {FOLDER_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              onClick={() => setColor(c.id)}
              className={`h-8 w-8 rounded-full ring-offset-2 transition ${color === c.id ? 'ring-2 ring-slate-700' : 'hover:scale-110'}`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <span style={{ color: colorHex(color) }}>
            <FolderIcon className="h-6 w-6" color="currentColor" />
          </span>
          <span className="truncate font-semibold text-slate-700">{name.trim() || '폴더 이름'}</span>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            취소
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {editing ? '저장' : '만들기'}
          </button>
        </div>
      </form>
    </div>
  )
}
