import { useRef, useState } from 'react'
import { AuthPanel, MigrationCard } from './Account'
import Library, { FolderDialog, FolderIcon } from './Library'
import { addFolder, editFolder } from '../lib/library'

const STEPS = [
  { n: 1, title: 'PDF 도면 열기', text: '버튼을 누르거나 파일을 화면에 끌어다 놓으세요.' },
  { n: 2, title: '기준 길이 지정', text: '치수를 아는 선의 양 끝을 클릭하고 실제 길이를 입력합니다.' },
  { n: 3, title: '측정하기', text: '길이, 면적, 각도 도구로 원하는 곳을 클릭해 잽니다.' },
]

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
    <div className="bg-grid flex-1 overflow-auto p-6">
      <div className="mx-auto w-full max-w-2xl">
        {showLogin && <AuthPanel />}
        {cloud && <MigrationCard store={store} onDone={onMigrated} />}
        <div
          className={`group cursor-pointer rounded-2xl border border-dashed border-ink-300 bg-white/90 px-6 text-center shadow-sm transition-colors hover:border-brand-400 hover:bg-brand-50/60 ${
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
              <h2 className="text-xs font-semibold tracking-wide text-ink-500">{cloud ? '서버에 저장된 도면' : '최근 연 도면'}</h2>
              {!fetching && (
                <button
                  onClick={() => setFolderDialog({})}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
                >
                  <FolderIcon className="h-4 w-4" color="currentColor" />
                  새 폴더
                </button>
              )}
            </div>
            {fetching ? (
              <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-ink-400 shadow-xs ring-1 ring-ink-200">
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
              샘플 평면도 열기
            </button>
          </section>
        ) : (
          <>
            <div className="text-center">
              <button onClick={onOpenSample} className="mt-4 text-sm font-medium text-brand-600 hover:underline">
                도면이 없다면? 샘플 평면도로 체험해 보기 →
              </button>
            </div>
            <ol className="mt-10 grid gap-3 text-left sm:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-ink-200">
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
