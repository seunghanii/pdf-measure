import { withoutTrashed } from '../lib/trash'
import { useEffect, useMemo, useState } from 'react'
import { INST_STATUSES, compareTags, downloadInstCsv, findTags, guessKind, instRows, kindDesc, statusOf, tagKey } from '../lib/instrument'
import { textHas } from '../lib/textIndex'
import { useIndexerStatus } from '../lib/indexer'

// 계기 목록 창 (도면 왼쪽에 떠 있음, 열어 둔 채로 도면을 볼 수 있게. 좁은 화면은 화면 가득)
// - 목록: 계기 카드를 표로. 태그·상태로 걸러 보고, 누르면 도면의 그 자리로. CSV(엑셀) 내보내기
// - 태그 찾기: 도면 글자(PDF 글자 + OCR)에서 FT-1001 같은 태그를 찾아 카드를 한꺼번에 만듦
export default function InstrumentPanel({
  tab,
  onTab,
  onClose,
  measurements,
  store,
  docId,
  docName,
  textIndex,
  onGoHere, // (row) 이 도면 카드로 이동
  onGoOther, // (row) 다른 도면 카드로 이동
  onSetStatus, // (id, status)
  onPreview, // (hit) 찾은 태그 자리 보기
  onCreateCards, // (hits)
  kinds, // 계기 종류 목록
}) {
  return (
    <div
      className="fixed inset-x-2 top-16 bottom-2 z-40 flex flex-col md:absolute md:inset-x-auto md:top-14 md:bottom-3 md:left-3 md:z-20 md:w-[560px] md:max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex items-center gap-1 border-b border-ink-100 px-2 py-1.5">
        {[
          ['list', '계기 목록'],
          ['find', '태그 찾기'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            aria-pressed={tab === id}
            className={`rounded-md px-3 py-1 text-sm font-semibold ${tab === id ? 'bg-ink-800 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
          >
            {label}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="닫기 (Esc)" aria-label="닫기">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {tab === 'list' ? (
        <InstList measurements={measurements} store={store} docId={docId} docName={docName} onGoHere={onGoHere} onGoOther={onGoOther} onSetStatus={onSetStatus} onFind={() => onTab('find')} />
      ) : (
        <TagFinder docId={docId} kinds={kinds} measurements={measurements} textIndex={textIndex} onPreview={onPreview} onCreate={onCreateCards} onDone={() => onTab('list')} />
      )}
    </div>
  )
}

// ---------- 계기 목록 ----------
function InstList({ measurements, store, docId, docName, onGoHere, onGoOther, onSetStatus, onFind }) {
  const [scope, setScope] = useState('doc') // 'doc' 이 도면 | 'all' 모든 도면
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(null) // null: 전체
  const [others, setOthers] = useState(null) // 다른 도면들의 계기 줄 (모든 도면을 처음 고를 때 받음)

  useEffect(() => {
    if (scope !== 'all' || others) return
    let alive = true
    store
      .listRecent()
      .then((list) => {
        if (!alive) return
        const rows = []
        for (const d of withoutTrashed(list)) {
          if (d.id === docId) continue
          for (const r of d.summary?.inst ?? []) rows.push({ ...r, docId: d.id, docName: d.name })
        }
        setOthers(rows)
      })
      .catch(() => alive && setOthers([]))
    return () => {
      alive = false
    }
  }, [scope, others, store, docId])

  const here = useMemo(() => instRows(measurements).map((r) => ({ ...r, docId, docName })), [measurements, docId, docName])
  const all = useMemo(() => (scope === 'all' ? [...here, ...(others ?? [])] : here).sort(compareTags), [scope, here, others])

  const matched = useMemo(() => {
    const q = query.trim()
    if (!q) return all
    return all.filter((r) => textHas([r.tag, r.kind, kindDesc(r.tag), r.docName, ...r.docs.map((d) => `${d.role} ${d.name}`)].join(' '), q))
  }, [all, query])
  const counts = useMemo(() => {
    const c = new Map()
    for (const r of matched) c.set(r.status, (c.get(r.status) ?? 0) + 1)
    return c
  }, [matched])
  const rows = status ? matched.filter((r) => r.status === status) : matched
  const done = counts.get('checked') ?? 0

  // 같은 태그가 여러 번 (도면을 옮겨 그렸거나 잘못 적은 것) → 표시
  const dup = useMemo(() => {
    const n = new Map()
    for (const r of all) if (r.tag) n.set(tagKey(r.tag), (n.get(tagKey(r.tag)) ?? 0) + 1)
    return n
  }, [all])

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-ink-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="태그·종류 검색 (예: FT, 1001)"
            className="min-w-0 flex-1 rounded-md border border-ink-300 px-2.5 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            autoFocus
          />
          <div className="flex shrink-0 rounded ring-1 ring-ink-300" role="group" aria-label="범위">
            {[
              ['doc', '이 도면'],
              ['all', '모든 도면'],
            ].map(([v, l]) => (
              <button
                key={v}
                aria-pressed={scope === v}
                onClick={() => setScope(v)}
                className={`px-2 py-1 text-xs font-medium first:rounded-l last:rounded-r ${scope === v ? 'bg-ink-800 text-white' : 'text-ink-700 hover:bg-ink-100'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {/* 상태별 개수 (누르면 그 상태만) + 진행률 */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setStatus(null)}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${status === null ? 'bg-ink-800 text-white' : 'text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'}`}
          >
            전체 {matched.length}
          </button>
          {INST_STATUSES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatus((cur) => (cur === s.id ? null : s.id))}
              aria-pressed={status === s.id}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status === s.id ? 'text-white' : 'text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'}`}
              style={status === s.id ? { background: s.color } : undefined}
            >
              {status !== s.id && <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />}
              {s.label} <span className="tabular-nums">{counts.get(s.id) ?? 0}</span>
            </button>
          ))}
        </div>
        {matched.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
              {INST_STATUSES.map((s) => (
                <div key={s.id} style={{ width: `${((counts.get(s.id) ?? 0) / matched.length) * 100}%`, background: s.color }} />
              ))}
            </div>
            <span className="shrink-0 tabular-nums">
              Loop Check {done}/{matched.length} ({Math.round((done / matched.length) * 100)}%)
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {scope === 'all' && others === null && <p className="px-3 py-6 text-center text-sm text-ink-400">다른 도면의 계기 불러오는 중…</p>}
        {rows.length === 0 && (scope === 'doc' || others !== null) && (
          <div className="px-4 py-8 text-center text-sm text-ink-500">
            {all.length === 0 ? (
              <>
                아직 계기 카드가 없어요.
                <br />
                메모 도구(N)에서 <b>계기 카드</b>를 골라 계기 자리에 범위를 그리거나,
                <button onClick={onFind} className="mx-1 font-semibold text-brand-700 hover:underline">
                  태그 찾기
                </button>
                로 도면 글자에서 한꺼번에 만들 수 있어요.
              </>
            ) : (
              '조건에 맞는 계기가 없어요'
            )}
          </div>
        )}
        {rows.length > 0 && (
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="sticky top-0 bg-ink-50 text-xs text-ink-500">
              <tr>
                <th className="px-3 py-1.5 font-semibold">태그</th>
                <th className="px-2 py-1.5 font-semibold">종류</th>
                <th className="px-2 py-1.5 font-semibold">상태</th>
                <th className="px-2 py-1.5 font-semibold">{scope === 'all' ? '도면 · 쪽' : '쪽'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const here = r.docId === docId
                const go = () => (here ? onGoHere(r, false) : onGoOther(r))
                return (
                  <tr
                    key={`${r.docId}-${r.id}`}
                    onClick={go}
                    onDoubleClick={() => here && onGoHere(r, true)}
                    title={here ? '누르면 그 자리로, 두 번 누르면 카드 열기' : '그 도면을 열고 그 자리로'}
                    className="cursor-pointer border-t border-ink-100 hover:bg-brand-50/60">
                    <td className="px-3 py-1.5 align-top">
                      <span className="font-semibold text-ink-800 tabular-nums">{r.tag || <span className="font-normal text-ink-400">(태그 없음)</span>}</span>
                      {r.tag && dup.get(tagKey(r.tag)) > 1 && (
                        <span className="ml-1 rounded bg-warn-50 px-1 text-[10px] font-semibold text-warn-700" title="같은 태그 카드가 여러 개 있어요">
                          중복
                        </span>
                      )}
                      {r.hidden ? <span className="ml-1 text-[11px] text-ink-400">· 숨김</span> : null}
                      {r.docs.length > 0 && (
                        <div className="mt-0.5 truncate text-[11px] text-ink-400" title={r.docs.map((d) => `${d.role ? `${d.role}: ` : ''}${d.name}`).join('\n')}>
                          {r.docs.map((d) => d.role || '도면').join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="max-w-44 px-2 py-1.5 align-top">
                      <div className="truncate font-semibold text-ink-700">{r.kind || '—'}</div>
                    </td>
                    <td className="px-2 py-1.5 align-top" onClick={(e) => here && e.stopPropagation()}>
                      {here ? (
                        <select
                          value={r.status}
                          onChange={(e) => onSetStatus(r.id, e.target.value)}
                          className="rounded border-0 py-0.5 pr-6 pl-1.5 text-xs font-semibold text-white"
                          style={{ background: statusOf(r.status).color }}
                          aria-label="상태 바꾸기"
                        >
                          {INST_STATUSES.map((s) => (
                            <option key={s.id} value={s.id} className="bg-white text-ink-800">
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ background: statusOf(r.status).color }}>
                          {statusOf(r.status).label}
                        </span>
                      )}
                    </td>
                    <td className="max-w-36 px-2 py-1.5 align-top text-xs text-ink-500">
                      {scope === 'all' && <div className="truncate" title={r.docName}>{r.docName}</div>}
                      <span className="tabular-nums">{r.page}쪽</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-1.5">
        <span className="text-xs text-ink-400">{scope === 'all' ? '최근 연 도면 전체' : '이 도면'} · 누르면 그 자리로, 두 번 누르면 카드 열기</span>
        <button
          disabled={!rows.length}
          onClick={() => downloadInstCsv(rows, scope === 'all' ? '전체' : docName.replace(/\.pdf$/i, ''))}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-600 ring-1 ring-ink-300 hover:bg-ink-100 disabled:opacity-40"
          title="보이는 줄을 엑셀에서 열 수 있는 CSV 파일로 저장"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          엑셀로 내보내기
        </button>
      </div>
    </>
  )
}

// ---------- 태그 찾기 ----------
function TagFinder({ docId, kinds, measurements, textIndex, onPreview, onCreate, onDone }) {
  const indexing = useIndexerStatus().running
  const found = useMemo(() => findTags(textIndex), [textIndex])
  // 이미 카드가 있는 태그 (어느 쪽이든)
  const existing = useMemo(() => {
    const s = new Set()
    for (const m of measurements) if (m.type === 'memo' && m.inst?.tag) s.add(tagKey(m.inst.tag))
    return s
  }, [measurements])
  const [query, setQuery] = useState('')
  const [showExisting, setShowExisting] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const keyOf = (h) => `${h.page}|${tagKey(h.tag)}`

  const fresh = useMemo(() => found.filter((h) => !existing.has(tagKey(h.tag))), [found, existing])
  const list = useMemo(() => {
    const base = showExisting ? found : fresh
    const q = query.trim()
    return q ? base.filter((h) => textHas(`${h.tag} ${kindDesc(h.tag)}`, q)) : base
  }, [found, fresh, showExisting, query])
  const selectable = list.filter((h) => !existing.has(tagKey(h.tag)))
  const pickedHits = fresh.filter((h) => picked.has(keyOf(h)))
  const allPicked = selectable.length > 0 && selectable.every((h) => picked.has(keyOf(h)))

  const toggle = (h) =>
    setPicked((s) => {
      const n = new Set(s)
      const k = keyOf(h)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const toggleAll = () =>
    setPicked((s) => {
      const n = new Set(s)
      for (const h of selectable) {
        if (allPicked) n.delete(keyOf(h))
        else n.add(keyOf(h))
      }
      return n
    })

  if (!textIndex)
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-500">
        도면 글자를 읽는 중이에요 (스캔 도면은 OCR 이라 조금 걸려요).
        {indexing?.id === docId && indexing.progress && (
          <span className="tabular-nums">
            {' '}
            {indexing.progress.page}/{indexing.progress.pages}쪽{indexing.progress.ocr ? ` · OCR ${Math.round((indexing.progress.done ?? 0) * 100)}%` : ''}
          </span>
        )}
        <br />다 읽으면 여기에 태그가 보여요.
      </p>
    )

  return (
    <>
      <div className="flex flex-col gap-1.5 border-b border-ink-100 px-3 py-2">
        <p className="text-xs text-ink-500">
          도면 글자에서 <b>FT-1001</b>, <b>PT 101</b>, 동그라미 안 두 줄(<b>TT</b>/<b>2001</b>) 같은 태그를 찾았어요. 고른 태그 자리에 계기 카드가 생겨요.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="찾은 태그 거르기 (예: FT, 유량)"
            className="min-w-0 flex-1 rounded-md border border-ink-300 px-2.5 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          <label className="flex shrink-0 items-center gap-1 text-xs text-ink-500">
            <input type="checkbox" checked={showExisting} onChange={(e) => setShowExisting(e.target.checked)} />
            카드 있는 것도 보기
          </label>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {list.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-500">
            {found.length === 0 ? '이 도면 글자에서 태그 모양을 찾지 못했어요.' : fresh.length === 0 ? '찾은 태그는 모두 카드가 있어요.' : '조건에 맞는 태그가 없어요.'}
          </p>
        ) : (
          <ul>
            <li className="sticky top-0 flex items-center gap-2 bg-ink-50 px-3 py-1 text-xs text-ink-500">
              <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={!selectable.length} aria-label="모두 고르기" />
              <span>모두 고르기 ({selectable.length})</span>
            </li>
            {list.map((h) => {
              const has = existing.has(tagKey(h.tag))
              const k = keyOf(h)
              return (
                <li key={k} className="flex items-center gap-2 border-t border-ink-100 px-3 py-1.5 text-sm hover:bg-ink-50">
                  <input type="checkbox" checked={!has && picked.has(k)} disabled={has} onChange={() => toggle(h)} aria-label={`${h.tag} 고르기`} />
                  <button onClick={() => onPreview(h)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left" title="도면에서 이 자리 보기">
                    <span className="font-semibold text-ink-800 tabular-nums">{h.tag}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink-600">{guessKind(h.tag, kinds)}</span>
                    <span className="truncate text-xs text-ink-400">{kindDesc(h.tag)}</span>
                    {has && <span className="shrink-0 text-[11px] text-ok-700">카드 있음</span>}
                    <span className="ml-auto shrink-0 text-xs text-ink-400 tabular-nums">{h.page}쪽</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-1.5">
        <span className="text-xs text-ink-400">찾은 태그 {found.length}개 · 줄을 누르면 그 자리로 가요</span>
        <button
          disabled={!pickedHits.length}
          onClick={() => {
            onCreate(pickedHits)
            setPicked(new Set())
            onDone()
          }}
          className="ml-auto rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
        >
          고른 {pickedHits.length}개 카드 만들기
        </button>
      </div>
    </>
  )
}
