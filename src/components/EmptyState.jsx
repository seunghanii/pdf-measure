import { Suspense, lazy, useRef, useState } from 'react'
import { AuthPanel, MigrationCard } from './Account'
import Library, { FolderDialog, FolderIcon } from './Library'
import RecentDocs from './RecentDocs'
import RecentActivity from './RecentActivity'
import HomeCalendar from './Calendar'
import { addFolder, editFolder } from '../lib/library'
import { TRASH_DAYS, leftLabel } from '../lib/trash'

// 메모장 편집기는 처음 홈을 그릴 때 기다리지 않게 따로 불러옴
const HomeNotepad = lazy(() => import('./HomeNotepad'))

const STEPS = [
  { n: 1, title: '도면 열기', text: '위 칸을 누르거나 PDF 파일을 화면에 끌어다 놓으세요.' },
  { n: 2, title: 'Equipment 박스 그리기', text: '툴바의 Equipment(E)로 계기 자리에 박스를 그리면 Tag. No 를 읽어 채워요.' },
  { n: 3, title: '상태·관련 도면 관리', text: '박스를 눌러 상태와 완료 날짜를 적고, Hook-up·데이터시트를 연결해요.' },
]

export default function EmptyState({
  onOpenFile,
  onOpenSample,
  loading,
  recent,
  openIds,
  onOpenRecent,
  onOpenActivity, // 최근 수정 기록을 눌렀을 때 (도면, 기록)
  onRemoveRecent,
  trashed = [], // 휴지통 도면 [{ id, name, at }]
  onRestoreDoc,
  onPurgeDoc,
  library,
  onUpdateLibrary,
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
  const openFolder = library.folders.find((f) => f.id === openFolderId) ?? null
  const hasRecent = list.length > 0 || fetching || library.folders.length > 0
  // 오른쪽 칸(최근 수정 + 최근 연 도면): 폴더 안에서도 늘. 넓은 화면은 오른쪽에, 좁은 화면은 PDF 열기 아래에 차례로
  const side = !fetching && list.length > 0

  return (
    <div className="bg-grid flex-1 overflow-auto p-4 sm:p-6">
      {(showLogin || cloud) && (
        <div className="mx-auto w-full max-w-[100rem]">
          {showLogin && <AuthPanel />}
          {cloud && <MigrationCard store={store} onDone={onMigrated} />}
        </div>
      )}
      {/* 넓은 화면은 세 칸(왼쪽 달력·메모장 | 가운데 도면 | 오른쪽 최근 수정·최근 열어본 도면)을 한 격자에 두어
          칸 사이 간격과 위쪽 선을 맞춤. 좁은 화면은 도면 열기 → 최근 → 내 도면 → 달력·메모장 차례 */}
      <div
        className={`mx-auto grid w-full max-w-[100rem] items-start gap-x-6 lg:grid-rows-[auto_1fr] ${
          side
            ? 'lg:grid-cols-[16rem_minmax(0,1fr)_17rem] xl:grid-cols-[18rem_minmax(0,1fr)_22rem]'
            : 'lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]'
        }`}
      >
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-ink-500">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2h9l5 5v15H6z" />
              <path d="M15 2v5h5M12 11v6M9 14l3-3 3 3" />
            </svg>
            도면 열기
          </div>
          <div
            className={`group cursor-pointer rounded-2xl border border-dashed border-ink-300 bg-surface/90 px-6 text-center shadow-sm transition-colors hover:border-brand-400 hover:bg-brand-50/60 ${
              hasRecent ? 'py-6' : 'py-12'
            }`}
            onClick={() => inputRef.current?.click()}
          >
            <svg
              viewBox="0 0 48 48"
              aria-hidden="true"
              className={`mx-auto rounded-2xl bg-brand-50 p-2 text-brand-600 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-100 ${hasRecent ? 'h-11 w-11' : 'h-16 w-16'}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 4h17l9 9v31H12z" strokeLinejoin="round" />
              <path d="M29 4v9h9" strokeLinejoin="round" />
              <path d="M18 34h14M18 34v-4M32 34v-4" strokeLinecap="round" />
            </svg>
            <p className="mt-4 text-lg font-semibold tracking-tight text-balance text-ink-900">
              {loading ? 'PDF 여는 중…' : 'PDF 도면을 여기에 끌어다 놓거나 클릭해서 여세요'}
            </p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-pretty text-ink-500">
              {cloud
                ? '여러 개를 한 번에 열 수 있어요. PDF와 측정값은 내 계정의 서버 저장소에 저장되고, 나만 볼 수 있어요.'
                : '여러 개를 한 번에 열 수 있어요. 파일은 서버로 보내지 않고 내 브라우저에만 저장돼요.'}
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
        </div>

        {/* 오른쪽 칸: 위 최근 수정, 아래 최근 연 도면 10개 */}
        {side && (
          <aside className="mt-8 min-w-0 space-y-8 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:mt-0">
            <RecentActivity list={list} library={library} onGo={onOpenActivity} />
            <RecentDocs list={list} library={library} openIds={openIds} onOpen={onOpenRecent} />
          </aside>
        )}

        <div className="min-w-0 lg:col-start-2 lg:row-start-2">
          {hasRecent ? (
            <section className="mt-8">
              <div className="mb-2 flex h-4 items-center justify-between px-1">
                <h2 className="text-xs font-semibold tracking-wide text-ink-500">내 도면</h2>
                {!fetching && (
                  <button
                    onClick={() => setFolderDialog({ parent: openFolder?.id ?? null })}
                    title={openFolder ? `"${openFolder.name}" 안에 하위 폴더 만들기` : '새 폴더 만들기'}
                    className="flex items-center gap-1 -my-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
                  >
                    <FolderIcon className="h-4 w-4" color="currentColor" />
                    {openFolder ? '하위 폴더' : '새 폴더'}
                  </button>
                )}
              </div>
              {fetching ? (
                <div className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-ink-400 shadow-xs ring-1 ring-ink-200">
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
                  onUpdateLibrary={onUpdateLibrary}
                  onEditFolder={(folder) => setFolderDialog(folder)}
                  openFolderId={openFolderId}
                  setOpenFolderId={setOpenFolderId}
                />
              )}
              <button onClick={onOpenSample} className="mt-3 px-1 text-sm text-brand-600 hover:underline">
                샘플 도면 열기
              </button>
            </section>
          ) : (
            <>
              <div className="text-center">
                <button onClick={onOpenSample} className="mt-4 text-sm font-medium text-brand-600 hover:underline">
                  도면이 없다면? 샘플 도면으로 써 보기 →
                </button>
              </div>
              <ol className="mt-10 grid gap-3 text-left sm:grid-cols-3">
                {STEPS.map((s) => (
                  <li key={s.n} className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-ink-200">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 tabular-nums ring-1 ring-brand-100">
                      {s.n}
                    </div>
                    <div className="mt-3 font-semibold text-ink-900">{s.title}</div>
                    <div className="mt-1 text-sm text-pretty text-ink-500">{s.text}</div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {trashed.length > 0 && <DocTrash trashed={trashed} cloud={cloud} onRestore={onRestoreDoc} onPurge={onPurgeDoc} />}
        </div>

        {/* 왼쪽 칸: 위 달력, 아래 메모장 */}
        <aside className="mt-8 min-w-0 space-y-8 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <HomeCalendar
            store={store}
            list={list}
            library={library}
            onOpenEquip={(doc, row) => onOpenActivity(doc, { a: 'edit', id: row.id, p: row.page, r: row.rect })}
          />
          <Suspense fallback={<div className="h-[28rem] rounded-xl bg-surface ring-1 ring-ink-200" />}>
            <HomeNotepad store={store} className="h-[28rem]" />
          </Suspense>
        </aside>
      </div>
      {folderDialog && (
        <FolderDialog
          folder={folderDialog}
          library={library}
          onClose={() => setFolderDialog(null)}
          onSave={(name, color, parent) => {
            onUpdateLibrary((lib) =>
              folderDialog.id ? editFolder(lib, folderDialog.id, { name, color, parent }) : addFolder(lib, name, color, parent),
            )
            setFolderDialog(null)
          }}
        />
      )}
    </div>
  )
}

// 홈 아래 휴지통: 지운 도면을 7일 동안 보관. 되살리면 원래 폴더·별명 그대로 돌아옴
function DocTrash({ trashed, cloud, onRestore, onPurge }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm text-ink-500 hover:text-ink-800"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
        <span className="font-semibold">휴지통 ({trashed.length})</span>
        <span className="text-xs text-ink-400">{TRASH_DAYS}일 뒤 완전 삭제</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`ml-auto h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-xl bg-surface shadow-xs ring-1 ring-ink-200">
          {trashed.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink-600">{d.name || d.id.slice(0, d.id.lastIndexOf('|'))}</div>
                <div className="text-xs text-ink-400">{leftLabel(d.at)}</div>
              </div>
              <button
                onClick={() => onRestore(d.id)}
                className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
              >
                되살리기
              </button>
              <button
                onClick={() =>
                  window.confirm(`완전히 삭제할까요?\n${d.name}\n\nPDF와 측정값이 ${cloud ? '서버에서 ' : ''}지워지고 되돌릴 수 없어요.`) && onPurge(d.id, d.name)
                }
                className="shrink-0 rounded-md px-2 py-1 text-xs text-danger-500 hover:bg-danger-50"
              >
                완전 삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
