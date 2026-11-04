import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addCable, cableById, cableSheets, findSheet, findTag, readCableFile, searchCables, sheetHead, useCables } from '../lib/cableSchedule'
import SheetTable from './SheetTable'

const CableScheduleDialog = lazy(() => import('./CableScheduleDialog'))

// Equipment 카드 안 Cable schedule: 홈에 올려 둔 파일 중 고른 시트를 보여 줌.
// 엑셀 "찾기 → 통합 문서"처럼 태그가 찾아진 열로 걸러 이 계기 줄만. 머리줄 ▾ 로 더 거르면 그 필터는 이 카드에만 저장
// (memo.cables = [{ id, sheet, all?, picks }], lib/cableSchedule.js)

// 카드에 저장한 필터 { 열: [값] } ↔ SheetTable 필터 { "0:열": Set }
const toPicks = (p) => Object.fromEntries(Object.entries(p ?? {}).map(([c, v]) => [`0:${c}`, new Set(v)]))
const fromPicks = (p) =>
  Object.fromEntries(
    Object.entries(p)
      .filter(([, v]) => v)
      .map(([k, v]) => [k.split(':')[1], [...v]]),
  )

const cableKey = (c) => `${c.id}|${c.sheet ?? ''}`

export default function CableSchedules({ store, memo, onChange }) {
  const list = Array.isArray(memo.cables) ? memo.cables : []
  const update = (i, patch) => onChange({ cables: list.map((x, k) => (k === i ? { ...x, ...patch } : x)) })
  const remove = (i) => onChange({ cables: list.filter((_, k) => k !== i) })
  return list.map((c, i) => <CableView key={cableKey(c)} store={store} entry={c} tag={memo.inst?.tag ?? ''} onUpdate={(p) => update(i, p)} onRemove={() => remove(i)} />)
}

function CableView({ store, entry, tag, onUpdate, onRemove }) {
  useCables() // 목록이 바뀌면(파일 바꾸기·삭제) 다시 그림
  const item = cableById(entry.id)
  const [sheets, setSheets] = useState(null) // null 읽는 중 | 시트들 | 'error'
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!item) return
    let alive = true
    cableSheets(store, item)
      .then((s) => alive && setSheets(s))
      .catch((e) => {
        console.warn('Cable schedule 읽기 실패', e)
        if (alive) setSheets('error')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, item?.id, item?.fv])

  const sheet = Array.isArray(sheets) && item ? findSheet(sheets, entry.sheet ?? item.sheet) : null
  const hit = useMemo(() => (sheet ? findTag(sheet, tag) : null), [sheet, tag])
  const count = hit ? hit.rows.size : 0
  const useTag = !entry.all && count > 0
  const rowOk = useCallback((r) => !useTag || !!hit?.rows.has(r), [useTag, hit])
  const head = useMemo(() => (sheet ? sheetHead(sheet, hit?.rows.size ? Math.min(...hit.rows) : 0) : null), [sheet, hit])
  const filters = useMemo(() => (sheet && head ? [{ r1: head.head, c1: sheet.used.c1, c2: sheet.used.c2, r2: sheet.used.r2, cols: {} }] : []), [sheet, head])
  const picks = useMemo(() => toPicks(entry.picks), [entry.picks])
  const range = sheet && head ? { r1: head.top, r2: sheet.used.r2, c1: sheet.used.c1, c2: Math.min(sheet.used.c2, sheet.used.c1 + 59) } : null

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-ink-200">
      <div className="flex flex-wrap items-center gap-1.5 bg-brand-50 px-2 py-1 text-xs">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 items-center gap-1 font-medium text-ink-800" title={open ? '접기' : '펼치기'}>
          <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="shrink-0 rounded bg-brand-600 px-1 text-[10px] font-semibold text-white">Cable</span>
          <span className="min-w-0 truncate" title={item?.name}>
            {item ? item.name : '지운 cable schedule'}
          </span>
        </button>
        {Array.isArray(sheets) && sheets.length > 1 && (
          <select
            value={sheet?.sheet ?? ''}
            onChange={(e) => onUpdate({ sheet: e.target.value, picks: undefined })}
            className="max-w-36 rounded border border-ink-200 bg-surface px-1 py-0.5 text-xs text-ink-700"
            aria-label="시트 고르기"
            title="시트 고르기"
          >
            {sheets.map((s) => (
              <option key={s.sheet} value={s.sheet}>
                {s.sheet}
              </option>
            ))}
          </select>
        )}
        {sheet && Array.isArray(sheets) && sheets.length <= 1 && <span className="text-ink-500">{sheet.sheet}</span>}
        {sheet && <span className="shrink-0 text-ink-500 tabular-nums">{useTag ? `${count}줄` : '전체'}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {sheet && count > 0 && (
            <button
              onClick={() => onUpdate({ all: entry.all ? undefined : true })}
              className="rounded px-1.5 py-0.5 text-ink-600 ring-1 ring-ink-200 hover:bg-surface"
              title={entry.all ? `${tag} 가 든 줄만 보기` : '이 시트 전체 줄 보기'}
            >
              {entry.all ? '이 계기만' : '전체 보기'}
            </button>
          )}
          <button onClick={onRemove} className="rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600" title="이 카드에서 빼기 (파일은 목록에 남아요)" aria-label="cable schedule 빼기">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      </div>
      {open && (
        <>
          {!item && <p className="px-3 py-2 text-xs text-ink-400">홈 Cable schedule setting 에서 지운 파일이에요. ✕ 로 빼 주세요.</p>}
          {item && sheets === null && <p className="px-3 py-3 text-xs text-ink-400">읽는 중…</p>}
          {item && sheets === 'error' && <p className="px-3 py-3 text-xs text-danger-600">파일을 읽지 못했어요.</p>}
          {sheet && !entry.all && count === 0 && (
            <p className="border-b border-ink-100 px-3 py-1.5 text-xs text-warn-700">{tag.trim() ? `이 시트에서 ${tag} 를 찾지 못해 전체 줄을 보여요.` : 'Tag. No 를 넣으면 그 계기 줄만 보여요.'}</p>
          )}
          {sheet && range && <SheetTable sheet={sheet} range={range} filters={filters} picks={picks} onPicks={(p) => onUpdate({ picks: fromPicks(p) })} rowOk={rowOk} />}
        </>
      )}
    </div>
  )
}

// Cable schedule 가져오기: 올린 파일 모두(모든 시트·열)에서 이 계기 Tag. No 를 찾아 시트별로 보여 줌 + 새로 올리기
// onPick([{ id, sheet }])
export function CablePicker({ store, tag, have, onPick, onClose }) {
  const { items } = useCables()
  const fileRef = useRef(null)
  const [result, setResult] = useState(null) // { key, hits: [{ item, sheet, n }] }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manage, setManage] = useState(false)
  const [showAll, setShowAll] = useState(false) // 찾은 것 말고 모든 파일 고르기

  const key = `${tag}|${items.map((x) => `${x.id}@${x.fv || 0}`).join()}`
  useEffect(() => {
    if (!tag.trim()) return
    let alive = true
    searchCables(store, items, tag).then((h) => alive && setResult({ key, hits: h }))
    return () => {
      alive = false
    }
  }, [store, items, tag, key])
  const hits = !tag.trim() ? [] : result?.key === key ? result.hits : null // null 찾는 중

  const found = (hits ?? []).filter((h) => h.n > 0)
  const failed = (hits ?? []).filter((h) => h.n < 0)
  const isHave = (id, sheet) => have.some((c) => c.id === id && (c.sheet ?? '') === sheet)
  const fresh = found.filter((h) => !isHave(h.item.id, h.sheet))

  const upload = async (files) => {
    setBusy(true)
    setError('')
    for (const f of files) {
      try {
        const { item, blob } = await readCableFile(f)
        await addCable(store, item, blob) // 목록이 바뀌면 다시 찾음
      } catch (e) {
        console.warn('Cable schedule 올리기 실패', e)
        setError(e?.message?.length < 80 ? e.message : `${f.name} 을(를) 올리지 못했어요.`)
      }
    }
    setBusy(false)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose} onKeyDown={(e) => e.key === 'Escape' && !manage && onClose()}>
        <div role="dialog" aria-modal="true" aria-labelledby="cable-pick-title" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-md flex-col rounded-2xl bg-surface p-4 shadow-xl">
          <div className="flex items-center gap-2">
            <h3 id="cable-pick-title" className="text-base font-semibold text-ink-900">
              Cable schedule 가져오기
            </h3>
            <button onClick={onClose} aria-label="닫기" className="ml-auto rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-500">
            {tag.trim() ? `올린 파일 ${items.length}개의 모든 시트에서 ${tag} 를 찾았어요. 고르면 찾은 열로 걸러 보여요.` : 'Tag. No 를 먼저 넣으면 올린 파일 모두에서 찾아 줘요.'}
          </p>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl ring-1 ring-ink-200">
            {items.length === 0 && <div className="px-3 py-5 text-center text-sm text-ink-400">올린 cable schedule 이 없어요. 아래에서 올려 주세요.</div>}
            {items.length > 0 && hits === null && <div className="px-3 py-5 text-center text-sm text-ink-400">찾는 중…</div>}
            {items.length > 0 && hits && !showAll && (
              <ul className="divide-y divide-ink-100">
                {found.length === 0 && <li className="px-3 py-4 text-center text-sm text-ink-400">{tag.trim() ? `${tag} 가 든 시트가 없어요.` : '찾을 Tag. No 가 없어요.'}</li>}
                {found.map((h) => {
                  const added = isHave(h.item.id, h.sheet)
                  return (
                    <li key={`${h.item.id}|${h.sheet}`}>
                      <button onClick={() => onPick([{ id: h.item.id, sheet: h.sheet }])} disabled={added} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 disabled:opacity-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink-800" title={h.item.name}>
                            {h.item.name}
                          </span>
                          <span className="block truncate text-xs text-ink-500">{h.sheet}</span>
                        </span>
                        <span className={`shrink-0 text-xs tabular-nums ${added ? 'text-ink-400' : 'font-semibold text-ok-700'}`}>{added ? '가져옴' : `${h.n}줄`}</span>
                      </button>
                    </li>
                  )
                })}
                {failed.map((h) => (
                  <li key={h.item.id} className="px-3 py-1.5 text-xs text-danger-600">
                    {h.item.name}: 파일을 읽지 못했어요
                  </li>
                ))}
              </ul>
            )}
            {items.length > 0 && showAll && (
              <ul className="divide-y divide-ink-100">
                {items.map((it) => (
                  <li key={it.id}>
                    <button onClick={() => onPick([{ id: it.id, sheet: it.sheet }])} className="w-full truncate px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-50" title={it.name}>
                      {it.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && <div className="mt-2 rounded-lg bg-warn-50 px-3 py-1.5 text-xs text-warn-800">{error}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!showAll && fresh.length > 1 && (
              <button onClick={() => onPick(fresh.map((h) => ({ id: h.item.id, sheet: h.sheet })))} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-press">
                찾은 {fresh.length}개 모두
              </button>
            )}
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-ink-200 hover:bg-brand-50 disabled:opacity-50">
              {busy ? '올리는 중…' : '새 파일 올리기'}
            </button>
            {items.length > 0 && (
              <button onClick={() => setShowAll((v) => !v)} className="rounded-lg px-2 py-1.5 text-sm text-ink-600 hover:bg-ink-100" title="찾은 것과 상관없이 파일을 골라 시트를 직접 고르기">
                {showAll ? '찾은 것만' : '파일 직접 고르기'}
              </button>
            )}
            <button onClick={() => setManage(true)} className="ml-auto rounded-lg px-2 py-1.5 text-sm text-ink-600 hover:bg-ink-100">
              목록 관리
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm"
              multiple
              className="hidden"
              onChange={(e) => {
                upload([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>
      {manage && (
        <Suspense fallback={null}>
          <CableScheduleDialog store={store} onClose={() => setManage(false)} />
        </Suspense>
      )}
    </>
  )
}
