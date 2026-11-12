// 홈 '현황판': 찾기, 이어서 보기(최근 연 도면 첫 쪽 그림), Equipment 진척, Issue, 최근 수정, 달력·메모장.
// 도면 목록 요약(summary)만 쓰고 PDF 는 읽지 않음. 첫 쪽 그림은 도면을 열 때 만들어 둔 것(lib/thumbs.js)
import { Suspense, lazy, useMemo, useSyncExternalStore } from 'react'
import { FolderIcon, timeAgo } from './Library'
import RecentActivity from './RecentActivity'
import IssueBoard from './IssueBoard'
import HomeCalendar from './Calendar'
import { recentOpened } from './RecentDocs'
import { colorHex, displayName, folderPath } from '../lib/library'
import { INST_STATUSES } from '../lib/instrument'
import { getThumb, subscribeThumbs } from '../lib/thumbs'

const HomeNotepad = lazy(() => import('./HomeNotepad'))

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+'

export default function HomeDashboard({ list, library, openIds, store, onOpen, onOpenActivity, onSearch, onShowEquip, onShowDocs }) {
  const recent = useMemo(() => recentOpened(list, 8), [list])
  return (
    <div className="mx-auto grid w-full max-w-[100rem] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        <button
          onClick={onSearch}
          className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left text-ink-400 shadow-xs ring-1 ring-ink-200 transition-colors hover:ring-brand-400 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[15px]">도면, Tag. No, 메모, 도면 속 글자 찾기</span>
          <kbd className="shrink-0 rounded-md bg-ink-100 px-1.5 py-0.5 font-sans text-xs text-ink-500">{MOD}K</kbd>
        </button>

        <ContinueCards items={recent} library={library} openIds={openIds} onOpen={onOpen} onShowDocs={onShowDocs} />

        <div className="grid gap-6 xl:grid-cols-2">
          <EquipProgress list={list} onShowEquip={onShowEquip} />
          <div className="min-w-0 space-y-6">
            <IssueBoard list={list} library={library} onOpen={(doc, row) => onOpenActivity(doc, { a: 'edit', id: row.id, p: row.page, r: row.rect, open: true })} />
            <RecentActivity list={list} library={library} onGo={onOpenActivity} />
          </div>
        </div>
      </div>

      <aside className="min-w-0 space-y-6">
        <HomeCalendar
          store={store}
          list={list}
          library={library}
          onOpenEquip={(doc, row) => onOpenActivity(doc, { a: 'edit', id: row.id, p: row.page, r: row.rect })}
        />
        <Suspense fallback={<div className="h-[24rem] rounded-xl bg-surface ring-1 ring-ink-200" />}>
          <HomeNotepad store={store} className="h-[24rem]" />
        </Suspense>
      </aside>
    </div>
  )
}

function SectionTitle({ icon, children, action }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-ink-500">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={icon} />
      </svg>
      {children}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}

const linkBtn = '-my-1 rounded-lg px-2 py-1 text-sm font-medium tracking-normal text-brand-600 transition-colors hover:bg-brand-50'

// 이어서 보기: 최근 연 도면 8개를 첫 쪽 그림 카드로
function ContinueCards({ items, library, openIds, onOpen, onShowDocs }) {
  // 그림이 새로 저장되면 다시 그림
  useSyncExternalStore(subscribeThumbs, () => items.map((d) => (getThumb(d.id) ? 1 : 0)).join(''))
  return (
    <section>
      <SectionTitle icon="M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2" action={<button onClick={onShowDocs} className={linkBtn}>도면 폴더 →</button>}>
        이어서 보기
      </SectionTitle>
      {items.length === 0 ? (
        <div className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-ink-400 ring-1 ring-ink-200">최근 열어본 도면이 여기에 보여요.</div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => {
            const thumb = getThumb(item.id)
            const path = folderPath(library, library.assign[item.id])
            const last = path[path.length - 1]
            const isOpen = openIds.includes(item.id)
            return (
              <li key={item.id} className="min-w-0">
                <button
                  onClick={() => onOpen(item)}
                  title={item.name}
                  className="group flex w-full flex-col overflow-hidden rounded-xl bg-surface text-left shadow-xs ring-1 ring-ink-200 transition-colors hover:ring-brand-400"
                >
                  <div className="theme-light relative aspect-[4/3] w-full overflow-hidden border-b border-ink-100 bg-white">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover object-top" loading="lazy" decoding="async" />
                    ) : (
                      <div className="bg-grid flex h-full w-full items-center justify-center">
                        <svg viewBox="0 0 24 24" className="h-8 w-8 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                          <path d="M6 2h9l5 5v15H6z" />
                          <path d="M15 2v5h5" />
                        </svg>
                      </div>
                    )}
                    {isOpen && <span className="absolute top-2 left-2 rounded bg-brand-600 px-1.5 py-0.5 text-[11px] font-medium text-white">열려 있음</span>}
                    {item.summary?.rev && <span className="absolute top-2 right-2 rounded bg-ink-800/80 px-1.5 py-0.5 text-[11px] font-medium text-white">{item.summary.rev}</span>}
                  </div>
                  <div className="min-w-0 px-3 py-2">
                    <div className="truncate text-sm font-medium text-ink-800 group-hover:text-brand-700">{displayName(library, item.id, item.name)}</div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-400">
                      {last && (
                        <span className="shrink-0" style={{ color: colorHex(last.color) }}>
                          <FolderIcon className="h-3 w-3" color="currentColor" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{last ? last.name : '폴더 없음'}</span>
                      <span className="shrink-0 tabular-nums">{timeAgo(item.lastOpened)}</span>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Equipment 진척: 모든 도면 Equipment 를 상태별로 센 막대 (숨긴 것도 셈)
function statusCounts(list) {
  const c = new Map(INST_STATUSES.map((s) => [s.id, 0]))
  let total = 0
  let issues = 0
  for (const d of list ?? [])
    for (const r of d.summary?.inst ?? []) {
      c.set(r.status, (c.get(r.status) ?? 0) + 1)
      total++
      if (r.issue) issues++
    }
  return { counts: c, total, issues }
}

function EquipProgress({ list, onShowEquip }) {
  const { counts, total, issues } = useMemo(() => statusCounts(list), [list])
  const doneShare = total ? Math.round(((counts.get('checked') ?? 0) / total) * 100) : 0
  return (
    <section className="min-w-0">
      <SectionTitle icon="M5 10a7 7 0 1014 0 7 7 0 10-14 0zM12 10l3.5-3M12 17v4M9 21h6" action={<button onClick={onShowEquip} className={linkBtn}>Equipment 화면 →</button>}>
        Equipment 진척
      </SectionTitle>
      <div className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-ink-200">
        {total === 0 ? (
          <p className="py-4 text-center text-sm text-ink-400">도면에 Equipment 박스를 그리면 상태별 진척이 여기에 보여요.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-ink-900 tabular-nums">{total.toLocaleString()}</span>
              <span className="text-sm text-ink-500">개</span>
              <span className="ml-auto text-sm text-ink-500">
                Loop Check 완료 <b className="font-semibold text-ok-700 tabular-nums">{doneShare}%</b>
              </span>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-ink-100" role="img" aria-label="상태별 Equipment 비율">
              {INST_STATUSES.map((s) => {
                const n = counts.get(s.id) ?? 0
                return n ? <span key={s.id} style={{ width: `${(n / total) * 100}%`, background: s.color }} title={`${s.label} ${n}`} /> : null
              })}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
              {INST_STATUSES.map((s) => (
                <li key={s.id}>
                  <button onClick={() => onShowEquip(s.id)} className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-ink-50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-ink-600">{s.label}</span>
                    <span className="font-medium text-ink-900 tabular-nums">{counts.get(s.id) ?? 0}</span>
                  </button>
                </li>
              ))}
              {issues > 0 && (
                <li>
                  <button onClick={() => onShowEquip('issue')} className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-danger-50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger-600" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-danger-700">Issue</span>
                    <span className="font-medium text-danger-700 tabular-nums">{issues}</span>
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
