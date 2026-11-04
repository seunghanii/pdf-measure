import { useEffect, useMemo, useRef, useState } from 'react'
import { addCable, cableSheets, findSheet, guessHeader, guessTagCols, readCableFile, removeCable, rowsForTag, updateCable, useCables } from '../lib/cableSchedule'
import { colName } from '../lib/excel'

// 홈 "Cable schedule setting": cable schedule 엑셀을 여러 개 올려 두고 파일마다 시트·제목 줄·태그 열을 정함.
// Equipment 카드에서 "Cable schedule" 로 알맞은 파일을 골라 가져오면 그 계기 Tag. No 가 든 줄만 보여 줌.
// focusId: 이 파일 설정을 바로 열어서 시작 (카드의 ⚙ 단추)

const fmtDate = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function CableScheduleDialog({ store, onClose, focusId = null }) {
  const { items } = useCables()
  const inputRef = useRef(null)
  const replaceRef = useRef(null)
  const [editId, setEditId] = useState(focusId)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  const upload = async (files) => {
    if (!files.length) return
    setError('')
    setDone('')
    setBusy(true)
    const added = []
    for (const f of files) {
      try {
        const { item, blob } = await readCableFile(f)
        await addCable(store, item, blob)
        added.push(item)
      } catch (e) {
        console.warn('Cable schedule 올리기 실패', e)
        setError(e?.message?.length < 80 ? e.message : `${f.name} 을(를) 올리지 못했어요.`)
      }
    }
    setBusy(false)
    if (added.length === 1) setEditId(added[0].id)
    if (added.length) setDone(`${added.length}개를 올렸어요. 태그 열이 맞는지 확인해 주세요.`)
  }

  // 같은 자리에 새 판 파일 (카드에 걸어 둔 필터는 그대로)
  const replace = async (id, file) => {
    if (!file) return
    setError('')
    setDone('')
    setBusy(true)
    try {
      const { item, blob, sheets: s } = await readCableFile(file)
      const old = items.find((x) => x.id === id)
      const keepSheet = s.some((x) => x.sheet === old?.sheet)
      await updateCable(store, id, keepSheet ? { name: item.name } : { name: item.name, sheet: item.sheet, top: item.top, head: item.head, cols: item.cols }, blob)
      setDone(`${item.name} 로 바꿨어요. 이 파일을 쓰는 카드에 바로 보여요.`)
    } catch (e) {
      console.warn('Cable schedule 바꾸기 실패', e)
      setError(e?.message?.length < 80 ? e.message : '파일을 바꾸지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const dragProps = {
    onDragEnter: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(true)
    },
    onDragOver: (e) => {
      e.preventDefault()
      e.stopPropagation()
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
    },
    onDrop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      upload([...(e.dataTransfer.files ?? [])])
    },
  }

  const editing = items.find((x) => x.id === editId)
  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()} {...dragProps}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cable-title"
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-full w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl ${dragOver ? 'ring-4 ring-brand-300' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="cable-title" className="text-lg font-semibold text-ink-900">
              Cable schedule setting
            </h3>
            <p className="mt-1 text-sm text-pretty text-ink-500">
              Cable schedule 엑셀을 여러 개 올려 두세요. Equipment 카드에서 알맞은 파일을 골라 가져오면 그 계기 Tag. No 가 든 줄만 엑셀 양식 그대로 보여요. 파일은 한 번씩만 저장돼요.
            </p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="-mt-1 -mr-1 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => inputRef.current?.click()} disabled={busy} className={`${btn} bg-brand-600 text-white hover:bg-brand-press`}>
            {busy ? '올리는 중…' : '엑셀 올리기'}
          </button>
          <span className="text-xs text-ink-400">.xlsx · .xlsm, 여러 개를 한 번에 골라도 되고 끌어다 놓아도 돼요.</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm"
            multiple
            className="hidden"
            onChange={(e) => {
              upload([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <input
            ref={replaceRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={(e) => {
              replace(replaceRef.current.dataset.id, e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        {error && <div className="mt-3 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-800">{error}</div>}
        {done && <div className="mt-3 rounded-lg bg-ok-50 px-3 py-2 text-sm text-ok-800">{done}</div>}

        <ul className="mt-4 divide-y divide-ink-100 rounded-xl ring-1 ring-ink-200">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-400">아직 올린 cable schedule 이 없어요.</li>}
          {items.map((it) => (
            <li key={it.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ok-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 11l5 6M14 11l-5 6" />
                </svg>
                <span className="min-w-0 truncate text-sm font-medium text-ink-800" title={it.name}>
                  {it.name}
                </span>
                <span className="text-xs text-ink-400">
                  {it.sheet} · 태그 열 {it.cols.length ? it.cols.map(colName).join(', ') : '없음'} · {fmtDate(it.fv || it.at)}
                </span>
                <span className="ml-auto flex shrink-0 gap-1 text-xs">
                  <button onClick={() => setEditId(editId === it.id ? null : it.id)} aria-expanded={editId === it.id} className="rounded px-2 py-0.5 text-ink-600 ring-1 ring-ink-200 hover:bg-ink-100">
                    설정
                  </button>
                  <button
                    onClick={() => {
                      replaceRef.current.dataset.id = it.id
                      replaceRef.current.click()
                    }}
                    disabled={busy}
                    className="rounded px-2 py-0.5 text-ink-600 ring-1 ring-ink-200 hover:bg-ink-100"
                    title="새 판 파일로 바꾸기 (카드에 걸어 둔 필터는 그대로)"
                  >
                    파일 바꾸기
                  </button>
                  {confirmDel === it.id ? (
                    <>
                      <button onClick={() => (removeCable(store, it.id), setConfirmDel(null))} className="rounded bg-danger-600 px-2 py-0.5 font-medium text-white hover:bg-danger-700">
                        삭제
                      </button>
                      <button onClick={() => setConfirmDel(null)} className="rounded px-2 py-0.5 text-ink-500 hover:bg-ink-100">
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDel(it.id)}
                      className="rounded px-2 py-0.5 text-danger-600 hover:bg-danger-50"
                      title="목록에서 지우기 (이 파일을 가져온 카드에서는 안 보이게 돼요)"
                    >
                      삭제
                    </button>
                  )}
                </span>
              </div>
              {editing?.id === it.id && <ItemEditor key={`${it.id}@${it.fv || 0}`} store={store} item={it} onSaved={() => setDone('설정을 저장했어요.')} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// 파일 하나 설정: 시트, 제목 줄, 태그 열, 시험해 보기
function ItemEditor({ store, item, onSaved }) {
  const [sheets, setSheets] = useState(null)
  const [draft, setDraft] = useState(item)
  const [probe, setProbe] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    cableSheets(store, item)
      .then((s) => alive && setSheets(s))
      .catch((e) => {
        console.warn('Cable schedule 읽기 실패', e)
        if (alive) setErr('파일을 읽지 못했어요. "파일 바꾸기"로 다시 올려 주세요.')
      })
    return () => {
      alive = false
    }
  }, [store, item])

  const sheet = sheets ? findSheet(sheets, draft.sheet) : null
  const probeCount = useMemo(() => (sheet && probe.trim() ? rowsForTag(sheet, draft, probe).size : null), [sheet, probe, draft])
  if (err) return <p className="mt-2 text-xs text-danger-600">{err}</p>
  if (!sheet) return <p className="mt-2 text-xs text-ink-400">읽는 중…</p>

  const setSheet = (name) => {
    const s = sheets.find((x) => x.sheet === name)
    const { top, head } = guessHeader(s)
    setDraft((d) => ({ ...d, sheet: s.sheet, top, head, cols: guessTagCols(s, head) }))
  }
  const setRow = (key, v) =>
    setDraft((d) => {
      const n = Math.max(1, Math.round(Number(v)) || 1)
      return key === 'head' ? { ...d, head: n, top: Math.min(d.top, n) } : { ...d, top: Math.min(n, d.head) }
    })
  const toggleCol = (c) => setDraft((d) => ({ ...d, cols: d.cols.includes(c) ? d.cols.filter((x) => x !== c) : [...d.cols, c].sort((a, b) => a - b) }))
  const changed = draft.sheet !== item.sheet || draft.top !== item.top || draft.head !== item.head || draft.cols.join() !== item.cols.join()
  const num = 'w-14 rounded-md border border-ink-300 px-1.5 py-0.5 text-center text-sm tabular-nums outline-none focus:border-brand-500'

  return (
    <div className="mt-2 space-y-3 rounded-lg bg-ink-50 p-3 ring-1 ring-ink-200">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-700">
        <label className="flex items-center gap-1.5">
          시트
          <select value={sheet.sheet} onChange={(e) => setSheet(e.target.value)} className="max-w-44 rounded-md border border-ink-300 bg-surface px-1.5 py-0.5 text-sm">
            {sheets.map((s) => (
              <option key={s.sheet} value={s.sheet}>
                {s.sheet}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-1.5">
          제목 줄
          <input value={draft.top} onChange={(e) => setRow('top', e.target.value)} className={num} aria-label="제목 시작 줄" />~
          <input value={draft.head} onChange={(e) => setRow('head', e.target.value)} className={num} aria-label="제목 끝 줄" />
        </span>
        <span className="text-xs text-ink-400 tabular-nums">목록 {Math.max(0, sheet.used.r2 - draft.head).toLocaleString()}줄</span>
      </div>
      <div>
        <div className="text-xs font-semibold text-ink-700">태그가 들어 있는 열</div>
        <p className="text-xs text-ink-500">카드의 Tag. No 가 이 열들 중 하나에 들어 있는 줄을 보여 줘요 (예: From, To).</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Array.from({ length: sheet.used.c2 - sheet.used.c1 + 1 }, (_, i) => sheet.used.c1 + i).map((c) => {
            const on = draft.cols.includes(c)
            const title = sheet.cells.get(`${draft.head},${c}`)?.text || sheet.cells.get(`${draft.top},${c}`)?.text || ''
            return (
              <button
                key={c}
                onClick={() => toggleCol(c)}
                aria-pressed={on}
                title={title}
                className={`max-w-40 truncate rounded-full px-2.5 py-0.5 text-xs ring-1 transition-colors ${on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-ink-600 ring-ink-200 hover:bg-ink-100'}`}
              >
                <b className="tabular-nums">{colName(c)}</b>
                {title && <span className="ml-1">{title}</span>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
        시험해 보기
        <input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder="Tag. No"
          aria-label="시험해 볼 Tag. No"
          className="w-40 rounded-md border border-ink-200 bg-surface px-2 py-0.5 text-sm uppercase outline-none focus:border-brand-500"
        />
        {probeCount != null && (
          <span className={probeCount ? 'text-ok-700' : 'text-warn-700'}>{probeCount ? `${probeCount}줄 찾음` : draft.cols.length ? '맞는 줄이 없어요' : '태그 열을 골라 주세요'}</span>
        )}
        <button
          onClick={async () => {
            await updateCable(store, item.id, { sheet: draft.sheet, top: draft.top, head: draft.head, cols: draft.cols })
            onSaved()
          }}
          disabled={!changed || !draft.cols.length}
          className="ml-auto rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-press disabled:opacity-40"
        >
          저장
        </button>
      </div>
    </div>
  )
}
