// 홈 'Equipment' 화면: 모든 도면의 Equipment 를 한 표로. 상태·Issue·Type 으로 거르고, 줄을 누르면 그 도면 그 자리로.
// 도면 목록 요약(summary.inst)만 읽음 (상태 바꾸기는 도면 안 카드에서). Inst list·Cable schedule 설정도 여기서.
import { Suspense, lazy, useMemo, useState } from 'react'
import { INST_STATUSES, compareTags, doneDates, downloadInstCsv, fmtDay, instDone, kindDesc, statusOf } from '../lib/instrument'
import { displayName } from '../lib/library'
import { textHas } from '../lib/textIndex'
import { useInstList } from '../lib/instList'
import { useCables } from '../lib/cableSchedule'

const InstListDialog = lazy(() => import('./InstListDialog'))
const CableScheduleDialog = lazy(() => import('./CableScheduleDialog'))

const PAGE = 200 // 한 번에 그리는 줄 수 (스크롤이 무겁지 않게)

export default function HomeEquipment({ list, library, store, initialFilter, onOpenRow }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(() => (initialFilter && initialFilter !== 'issue' ? initialFilter : null))
  const [issueOnly, setIssueOnly] = useState(initialFilter === 'issue')
  const [kind, setKind] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [instListOpen, setInstListOpen] = useState(false)
  const [cableOpen, setCableOpen] = useState(false)
  const instCount = useInstList().rows.length
  const cableCount = useCables().items.length

  const all = useMemo(() => {
    const rows = []
    for (const d of list ?? []) {
      const docName = displayName(library, d.id, d.name)
      for (const r of d.summary?.inst ?? []) rows.push({ ...r, doc: d, docId: d.id, docName })
    }
    return rows.sort(compareTags)
  }, [list, library])
  const kinds = useMemo(() => [...new Set(all.map((r) => r.kind).filter(Boolean))].sort(), [all])

  const matched = useMemo(() => {
    const q = query.trim()
    return all.filter((r) => (!kind || r.kind === kind) && (!q || textHas([r.tag, r.desc, r.kind, kindDesc(r.tag), r.docName].join(' '), q)))
  }, [all, query, kind])
  const counts = useMemo(() => {
    const c = new Map()
    for (const r of matched) c.set(r.status, (c.get(r.status) ?? 0) + 1)
    return c
  }, [matched])
  const issueCount = matched.filter((r) => r.issue).length
  const rows = matched.filter((r) => (!status || r.status === status) && (!issueOnly || r.issue))
  const done = counts.get('checked') ?? 0

  const chip = (on) => `flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors pointer-coarse:py-2 ${on ? 'text-white' : 'bg-surface text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'}`

  return (
    <div className="mx-auto flex w-full max-w-[100rem] min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-semibold tracking-tight text-ink-900">Equipment</h2>
        <span className="text-sm text-ink-500 tabular-nums">
          {all.length.toLocaleString()}개 · Loop Check {matched.length ? Math.round((done / matched.length) * 100) : 0}%
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setInstListOpen(true)} className={toolBtn} title="CSV 계기 목록을 올려 Equipment Tag. No 로 Description·Type 자동 채우기">
            Inst list setting
            {instCount > 0 && <span className="rounded bg-brand-50 px-1.5 text-xs text-brand-700 tabular-nums">{instCount.toLocaleString()}</span>}
          </button>
          <button onClick={() => setCableOpen(true)} className={toolBtn} title="Cable schedule 엑셀을 여러 개 올려 두고 Equipment 카드에서 골라 보기">
            Cable schedule setting
            {cableCount > 0 && <span className="rounded bg-brand-50 px-1.5 text-xs text-brand-700 tabular-nums">{cableCount}</span>}
          </button>
          <button onClick={() => downloadInstCsv(rows, '전체')} disabled={!rows.length} className={toolBtn + ' disabled:opacity-40'}>
            엑셀로 내보내기
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShown(PAGE)
          }}
          placeholder="Tag. No, Description, 도면 이름"
          aria-label="Equipment 찾기"
          className="w-full min-w-0 rounded-lg border border-ink-300 bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 sm:w-72"
        />
        <button onClick={() => setStatus(null)} className={chip(status === null)} style={status === null ? { background: 'var(--color-ink-800)' } : undefined}>
          전체 <span className="tabular-nums">{matched.length}</span>
        </button>
        {INST_STATUSES.map((s) => (
          <button key={s.id} onClick={() => setStatus((c) => (c === s.id ? null : s.id))} aria-pressed={status === s.id} className={chip(status === s.id)} style={status === s.id ? { background: s.color } : undefined}>
            {status !== s.id && <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />}
            {s.label} <span className="tabular-nums">{counts.get(s.id) ?? 0}</span>
          </button>
        ))}
        {(issueCount > 0 || issueOnly) && (
          <button onClick={() => setIssueOnly((v) => !v)} aria-pressed={issueOnly} className={issueOnly ? chip(true) + ' bg-danger-600' : 'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-danger-700 ring-1 ring-danger-200 hover:bg-danger-50 pointer-coarse:py-2'}>
            Issue <span className="tabular-nums">{issueCount}</span>
          </button>
        )}
        {kinds.length > 0 && (
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type" className="rounded-full border border-ink-200 bg-surface px-3 py-1 text-sm text-ink-700">
            <option value="">Type 전체</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 overflow-auto rounded-xl bg-surface shadow-xs ring-1 ring-ink-200">
        {all.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-500">
            아직 Equipment 가 없어요. 도면을 열고 위 <b>Equipment</b> 모드에서 박스를 그리거나 Tag 찾기로 만들어요.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-500">조건에 맞는 Equipment 가 없어요.</p>
        ) : (
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-ink-50 text-left text-xs text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Tag. No</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">상태</th>
                <th className="px-3 py-2 font-semibold">완료</th>
                <th className="px-3 py-2 font-semibold">도면</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r) => {
                const st = statusOf(r.status)
                const dated = doneDates(r.done ?? instDone(r))
                const lastDone = dated[dated.length - 1]
                return (
                  <tr key={`${r.docId}-${r.id}`} onClick={() => onOpenRow(r.doc, r)} className="cursor-pointer border-t border-ink-100 hover:bg-brand-50/50" title="그 도면을 열고 이 Equipment 로 가기">
                    <td className="px-4 py-2 font-mono text-[13px] whitespace-nowrap text-ink-900">
                      {r.tag || <span className="text-ink-400">(Tag 없음)</span>}
                      {r.hidden ? <span className="ml-1.5 text-xs text-ink-400">· 숨김</span> : null}
                    </td>
                    <td className="max-w-[18rem] truncate px-3 py-2 text-ink-700">{r.desc}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-700">{r.kind}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${st.color}1f`, color: st.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} aria-hidden="true" />
                        {st.label}
                      </span>
                      {r.issue ? <span className="ml-1.5 text-xs font-medium text-danger-600">● Issue</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-ink-500 tabular-nums">{lastDone?.date ? fmtDay(lastDone.date) : ''}</td>
                    <td className="max-w-[16rem] px-3 py-2 whitespace-nowrap">
                      <span className="flex min-w-0 items-center gap-1 text-brand-700">
                        <span className="min-w-0 truncate">{r.docName}</span>
                        <span className="shrink-0 text-xs text-ink-400 tabular-nums">{r.page}쪽 ›</span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {rows.length > shown && (
          <button onClick={() => setShown((n) => n + PAGE)} className="w-full border-t border-ink-100 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
            {(rows.length - shown).toLocaleString()}개 더 보기
          </button>
        )}
      </div>
      <p className="px-1 text-xs text-ink-400">상태·Type 은 도면 안 Equipment 카드에서 바꿔요. 방금 바꾼 값은 홈으로 돌아오면 반영돼요.</p>

      {instListOpen && (
        <Suspense fallback={null}>
          <InstListDialog store={store} onClose={() => setInstListOpen(false)} />
        </Suspense>
      )}
      {cableOpen && (
        <Suspense fallback={null}>
          <CableScheduleDialog store={store} onClose={() => setCableOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

const toolBtn =
  'flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-700 shadow-xs transition-colors hover:border-ink-300 hover:bg-ink-50 pointer-coarse:py-2.5'
