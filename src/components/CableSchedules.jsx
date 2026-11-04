import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addCable, cableById, cableSheets, findSheet, readCableFile, rowsForTag, useCables } from '../lib/cableSchedule'
import SheetTable from './SheetTable'

const CableScheduleDialog = lazy(() => import('./CableScheduleDialog'))

// Equipment 카드 안 Cable schedule: 홈에 올려 둔 파일 중 고른 것들을 보여 줌.
// 처음엔 이 계기 Tag. No 가 든 줄만, 머리줄 ▾ 로 더 거르면 그 필터는 이 카드에만 저장 (memo.cables, lib/cableSchedule.js)

// 카드에 저장한 필터 { 열: [값] } ↔ SheetTable 필터 { "0:열": Set }
const toPicks = (p) => Object.fromEntries(Object.entries(p ?? {}).map(([c, v]) => [`0:${c}`, new Set(v)]))
const fromPicks = (p) =>
  Object.fromEntries(
    Object.entries(p)
      .filter(([, v]) => v)
      .map(([k, v]) => [k.split(':')[1], [...v]]),
  )

export default function CableSchedules({ store, memo, onChange }) {
  const list = Array.isArray(memo.cables) ? memo.cables : []
  const [settings, setSettings] = useState(undefined) // 열린 설정 창: null 목록 | 파일 id
  const update = (i, patch) => onChange({ cables: list.map((x, k) => (k === i ? { ...x, ...patch } : x)) })
  const remove = (i) => onChange({ cables: list.filter((_, k) => k !== i) })
  return (
    <>
      {list.map((c, i) => (
        <CableView key={c.id} store={store} entry={c} tag={memo.inst?.tag ?? ''} onUpdate={(p) => update(i, p)} onRemove={() => remove(i)} onSettings={() => setSettings(c.id)} />
      ))}
      {settings !== undefined && (
        <Suspense fallback={null}>
          <CableScheduleDialog store={store} focusId={settings} onClose={() => setSettings(undefined)} />
        </Suspense>
      )}
    </>
  )
}

function CableView({ store, entry, tag, onUpdate, onRemove, onSettings }) {
  useCables() // 설정이 바뀌면 다시 그림
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

  const sheet = Array.isArray(sheets) && item ? findSheet(sheets, item.sheet) : null
  const rows = useMemo(() => (sheet && item ? rowsForTag(sheet, item, tag) : null), [sheet, item, tag])
  const useTag = !entry.all && !!tag.trim()
  const rowOk = useCallback((r) => !useTag || !!rows?.has(r), [useTag, rows])
  const filters = useMemo(() => (sheet && item ? [{ r1: item.head, c1: sheet.used.c1, c2: sheet.used.c2, r2: sheet.used.r2, cols: {} }] : []), [sheet, item])
  const picks = useMemo(() => toPicks(entry.picks), [entry.picks])
  const range = sheet && item ? { r1: item.top, r2: sheet.used.r2, c1: sheet.used.c1, c2: Math.min(sheet.used.c2, sheet.used.c1 + 59) } : null
  const count = rows ? rows.size : 0

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-ink-200">
      <div className="flex flex-wrap items-center gap-1.5 bg-brand-50 px-2 py-1 text-xs">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 items-center gap-1 font-medium text-ink-800" title={open ? '접기' : '펼치기'}>
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform ${open ? '' : '-rotate-90'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="shrink-0 rounded bg-brand-600 px-1 text-[10px] font-semibold text-white">Cable</span>
          <span className="min-w-0 truncate" title={item?.name}>
            {item ? item.name : '지운 cable schedule'}
          </span>
        </button>
        {item && sheet && <span className="shrink-0 text-ink-500 tabular-nums">{useTag ? `${count}줄` : '전체'}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {item && tag.trim() && (
            <button
              onClick={() => onUpdate({ all: entry.all ? undefined : true })}
              className="rounded px-1.5 py-0.5 text-ink-600 ring-1 ring-ink-200 hover:bg-surface"
              title={entry.all ? `${tag} 가 든 줄만 보기` : '이 파일 전체 줄 보기'}
            >
              {entry.all ? '이 계기만' : '전체 보기'}
            </button>
          )}
          {item && (
            <button
              onClick={onSettings}
              className="rounded p-1 text-ink-500 hover:bg-surface hover:text-ink-800"
              title="이 cable schedule 설정 (시트·제목 줄·태그 열)"
              aria-label="cable schedule 설정"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
              </svg>
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
          {sheet && !tag.trim() && !entry.all && <p className="border-b border-ink-100 px-3 py-1.5 text-xs text-ink-500">Tag. No 를 넣으면 그 계기 줄만 보여요.</p>}
          {sheet && useTag && count === 0 && (
            <p className="border-b border-ink-100 px-3 py-1.5 text-xs text-warn-700">이 파일의 태그 열에 {tag} 가 든 줄이 없어요. 다른 cable schedule 을 고르거나 ⚙ 에서 태그 열을 확인해 주세요.</p>
          )}
          {sheet && range && <SheetTable sheet={sheet} range={range} filters={filters} picks={picks} onPicks={(p) => onUpdate({ picks: fromPicks(p) })} rowOk={rowOk} />}
        </>
      )}
    </div>
  )
}

// Cable schedule 가져오기: 목록에서 고르기 (이 계기 줄이 있는 파일을 위로) + 새로 올리기
export function CablePicker({ store, tag, have, onPick, onClose }) {
  const { items } = useCables()
  const fileRef = useRef(null)
  const [counts, setCounts] = useState({}) // id → 이 계기 줄 수 (읽는 중이면 없음)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manage, setManage] = useState(false)

  useEffect(() => {
    if (!tag.trim()) return
    let alive = true
    for (const it of items) {
      cableSheets(store, it)
        .then((s) => alive && setCounts((c) => ({ ...c, [it.id]: rowsForTag(findSheet(s, it.sheet), it, tag).size })))
        .catch(() => alive && setCounts((c) => ({ ...c, [it.id]: -1 })))
    }
    return () => {
      alive = false
    }
  }, [store, items, tag])

  const sorted = [...items].sort((a, b) => (counts[b.id] > 0) - (counts[a.id] > 0))
  const upload = async (files) => {
    setBusy(true)
    setError('')
    const ids = []
    for (const f of files) {
      try {
        const { item, blob } = await readCableFile(f)
        await addCable(store, item, blob)
        ids.push(item.id)
      } catch (e) {
        console.warn('Cable schedule 올리기 실패', e)
        setError(e?.message?.length < 80 ? e.message : `${f.name} 을(를) 올리지 못했어요.`)
      }
    }
    setBusy(false)
    if (ids.length) onPick(ids)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose} onKeyDown={(e) => e.key === 'Escape' && !manage && onClose()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cable-pick-title"
          onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-full w-full max-w-md flex-col rounded-2xl bg-surface p-4 shadow-xl"
        >
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
          <p className="mt-1 text-xs text-ink-500">{tag.trim() ? `${tag} 가 든 줄이 있는 파일을 위에 보여요.` : 'Tag. No 를 먼저 넣으면 그 계기 줄이 있는 파일을 찾아 줘요.'}</p>
          <ul className="mt-3 min-h-0 flex-1 divide-y divide-ink-100 overflow-y-auto rounded-xl ring-1 ring-ink-200">
            {items.length === 0 && <li className="px-3 py-5 text-center text-sm text-ink-400">올린 cable schedule 이 없어요. 아래에서 올려 주세요.</li>}
            {sorted.map((it) => {
              const n = counts[it.id]
              const added = have.includes(it.id)
              return (
                <li key={it.id}>
                  <button onClick={() => onPick([it.id])} disabled={added} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 disabled:opacity-50">
                    <span className="min-w-0 flex-1 truncate text-ink-800" title={it.name}>
                      {it.name}
                    </span>
                    {added ? (
                      <span className="shrink-0 text-xs text-ink-400">가져옴</span>
                    ) : tag.trim() ? (
                      <span className={`shrink-0 text-xs tabular-nums ${n > 0 ? 'font-semibold text-ok-700' : 'text-ink-400'}`}>{n == null ? '…' : n > 0 ? `${n}줄` : n < 0 ? '못 읽음' : '없음'}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
          {error && <div className="mt-2 rounded-lg bg-warn-50 px-3 py-1.5 text-xs text-warn-800">{error}</div>}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-ink-200 hover:bg-brand-50 disabled:opacity-50"
            >
              {busy ? '올리는 중…' : '새 파일 올리기'}
            </button>
            <button onClick={() => setManage(true)} className="rounded-lg px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100">
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
