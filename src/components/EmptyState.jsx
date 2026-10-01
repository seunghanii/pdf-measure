import { useRef } from 'react'
import { AuthPanel, MigrationCard } from './Account'

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
  cloud, // 로그인해서 서버에 저장 중
  showLogin,
  store,
  onMigrated,
}) {
  const inputRef = useRef(null)
  const fetching = recent === null // 서버에서 목록을 불러오는 중
  const list = recent ?? []
  const hasRecent = list.length > 0 || fetching

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
            <h2 className="mb-2 px-1 text-sm font-semibold text-slate-500">{cloud ? '서버에 저장된 도면' : '최근 연 도면'}</h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm">
              {fetching && <li className="px-4 py-6 text-center text-sm text-slate-400">서버에서 도면 목록을 불러오는 중…</li>}
              {list.map((item) => {
                const count = item.state?.measurements?.length ?? 0
                const scale = scaleLabel(item.state)
                const isOpen = openIds.includes(item.id)
                return (
                  <li key={item.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-blue-50/50">
                    <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpenRecent(item)}>
                      <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                        <path d="M6 2h9l5 5v15H6z" />
                        <path d="M15 2v5h5" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-slate-800">{item.name}</span>
                          {isOpen && (
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
                    </button>
                    <button
                      onClick={() => {
                        const ask = cloud
                          ? `"${item.name}" 을(를) 서버에서 지울까요? PDF 파일과 측정값이 서버에서 완전히 지워집니다.`
                          : `"${item.name}" 을(를) 최근 목록에서 지울까요? 저장된 측정값도 함께 지워집니다.`
                        if (window.confirm(ask))
                          onRemoveRecent(item)
                      }}
                      disabled={isOpen}
                      title={isOpen ? '열려 있는 탭을 먼저 닫아 주세요' : '목록에서 지우기'}
                      className="rounded p-1.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 disabled:hidden"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                      </svg>
                    </button>
                  </li>
                )
              })}
            </ul>
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
    </div>
  )
}
