import { useMemo, useRef, useState } from 'react'
import { downloadCsv, instListCsv, listKey, readInstFile, replaceInstList, useInstList } from '../lib/instList'

// 홈 "Inst list setting": CSV/엑셀(제목 칸 Tag. No · Description · Type 을 찾아 그 아래, 엑셀은 모든 시트 합침)을 올려 계기 목록 전체를 바꿈.
// 이 목록은 Equipment 박스에 Tag. No 가 들어갈 때 Description·Type 을 채우는 데 씀 (lib/instList.js)
const SHOW = 200 // 표에 한 번에 보이는 줄

const fmtTime = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 지금 목록과 새 목록 비교: 더해짐·빠짐·바뀜 개수
function compare(oldRows, newRows) {
  const old = new Map(oldRows.map((r) => [listKey(r.tag), r]))
  let added = 0
  let changed = 0
  for (const r of newRows) {
    const o = old.get(listKey(r.tag))
    if (!o) added++
    else if (o.desc !== r.desc || o.type !== r.type) changed++
    old.delete(listKey(r.tag))
  }
  return { added, changed, removed: old.size }
}

function Table({ rows, empty }) {
  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-lg ring-1 ring-ink-200">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-ink-50 text-ink-500">
          <tr>
            <th className="px-2 py-1.5 font-semibold">Tag. No</th>
            <th className="px-2 py-1.5 font-semibold">Description</th>
            <th className="px-2 py-1.5 font-semibold">Type</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-2 py-6 text-center text-ink-400">
                {empty}
              </td>
            </tr>
          ) : (
            rows.slice(0, SHOW).map((r) => (
              <tr key={r.tag}>
                <td className="px-2 py-1 font-semibold whitespace-nowrap tabular-nums text-ink-800">{r.tag}</td>
                <td className="px-2 py-1 text-ink-700">{r.desc}</td>
                <td className="px-2 py-1 font-semibold whitespace-nowrap text-ink-600">{r.type}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function InstListDialog({ store, onClose }) {
  const list = useInstList()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(null) // 읽은 새 파일 { name, rows, skipped, dup, diff }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [done, setDone] = useState('')

  const shown = useMemo(() => {
    const words = query.toUpperCase().split(/\s+/).filter(Boolean)
    if (!words.length) return list.rows
    return list.rows.filter((r) => {
      const hay = `${r.tag} ${listKey(r.tag)} ${r.desc} ${r.type}`.toUpperCase()
      return words.every((w) => hay.includes(w))
    })
  }, [list.rows, query])

  const pick = async (file) => {
    if (!file) return
    setError('')
    setDone('')
    setBusy(true)
    try {
      const res = await readInstFile(file)
      if (!res.rows.length) setError('파일에서 Tag. No 를 하나도 찾지 못했어요. 제목 칸에 “Tag. No” 가 적혀 있는지 봐 주세요.')
      else setPending({ name: file.name, ...res, diff: compare(list.rows, res.rows) })
    } catch (e) {
      console.warn('Inst list 읽기 실패', e)
      // 엑셀 읽기가 알려 준 이유(민감도 레이블로 잠김, 예전 .xls 등)는 그대로 보여 줌
      setError(/[가-힣]/.test(e?.message ?? '') && e.message.length < 160 ? e.message : '파일을 읽지 못했어요. CSV(쉼표로 구분)나 엑셀(.xlsx) 파일인지 봐 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      await replaceInstList(store, { rows: pending.rows, name: pending.name })
      setDone(`${pending.rows.length.toLocaleString()}개로 바꿨어요.`)
      setPending(null)
      setQuery('')
    } catch (e) {
      console.warn('Inst list 저장 실패', e)
      setError('서버에 저장하지 못했어요. 이 브라우저에는 저장됐으니 인터넷 연결을 확인하고 다시 올려 주세요.')
    } finally {
      setBusy(false)
    }
  }

  // 앱 전체의 "PDF 끌어다 놓기"와 겹치지 않게 이 창에서 받고 멈춤
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
      pick(e.dataTransfer.files?.[0])
    },
  }

  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
      onKeyDown={(e) => e.key === 'Escape' && (pending ? setPending(null) : onClose())}
      {...dragProps}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inst-list-title"
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-full w-full max-w-2xl flex-col rounded-2xl bg-surface p-5 shadow-xl ${dragOver ? 'ring-4 ring-brand-300' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="inst-list-title" className="text-lg font-semibold text-ink-900">
              Inst list setting
            </h3>
            <p className="mt-1 text-sm text-pretty text-ink-500">
              Equipment 박스에 Tag. No 를 넣거나 박스 읽기로 읽으면 이 목록에서 찾아 Description 과 Type 을 자동으로 채워요.
            </p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="-mt-1 -mr-1 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600 ring-1 ring-ink-200">
          <div className="font-semibold text-ink-800">파일 양식</div>
          <div className="mt-1">
            제목 칸 <b>Tag. No</b> · <b>Description</b> · <b>Type</b> 을 찾아 그 아래 줄을 모두 읽어요. 제목은 어느 줄·열에 있어도 돼요 (못 찾으면 1행 제목, A·B·C 열). 엑셀(.xlsx·.xlsm)은 보이는 시트를 모두 합쳐요.
          </div>
          <div className="mt-1 text-ink-500">올릴 때마다 지금 목록 전체를 새 파일 내용으로 바꿔요.</div>
        </div>

        {pending ? (
          <div className="mt-4 min-h-0">
            <div className="text-sm text-ink-700">
              <b className="text-ink-900">{pending.name}</b> 에서 <b className="tabular-nums">{pending.rows.length.toLocaleString()}</b>개를 읽었어요.
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-500 tabular-nums">
              <span>새로 추가 {pending.diff.added.toLocaleString()}</span>
              <span>바뀜 {pending.diff.changed.toLocaleString()}</span>
              <span>빠짐 {pending.diff.removed.toLocaleString()}</span>
              {pending.dup > 0 && <span className="text-warn-700">같은 Tag. No {pending.dup}줄 (아래 줄로 씀)</span>}
              {pending.skipped > 0 && <span className="text-warn-700">Tag. No 없는 줄 {pending.skipped}개 건너뜀</span>}
            </div>
            {pending.sheets?.length > 1 && (
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-500 tabular-nums">
                {pending.sheets.map((sh, i) => (
                  <span key={i} className={sh.count < 0 ? 'text-warn-700' : ''}>
                    {sh.name}: {sh.count < 0 ? '제목 칸 없음, 건너뜀' : `${sh.count.toLocaleString()}줄`}
                  </span>
                ))}
              </div>
            )}
            <Table rows={pending.rows} />
            {pending.rows.length > SHOW && <div className="mt-1 text-xs text-ink-400">처음 {SHOW}줄만 보여요.</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPending(null)} disabled={busy} className={`${btn} text-ink-600 hover:bg-ink-100`}>
                취소
              </button>
              <button onClick={apply} disabled={busy} className={`${btn} bg-brand-600 text-white hover:bg-brand-press`}>
                {busy ? '저장 중…' : '이 목록으로 바꾸기'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={() => inputRef.current?.click()} disabled={busy} className={`${btn} bg-brand-600 text-white hover:bg-brand-press`}>
                {busy ? '읽는 중…' : list.rows.length ? 'CSV 올려서 목록 바꾸기' : 'CSV 올리기'}
              </button>
              <button
                onClick={() => downloadCsv(instListCsv(list.rows), list.rows.length ? 'Inst_list.csv' : 'Inst_list_양식.csv')}
                className={`${btn} text-brand-700 ring-1 ring-ink-200 hover:bg-brand-50`}
                title={list.rows.length ? '지금 목록을 CSV 로 받아 고친 뒤 다시 올릴 수 있어요' : '제목 줄만 있는 빈 양식'}
              >
                {list.rows.length ? '지금 목록 받기' : '빈 양식 받기'}
              </button>
              <span className="text-xs text-ink-400">파일을 이 창에 끌어다 놓아도 돼요.</span>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv,.txt,.xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  pick(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
            {error && <div className="mt-3 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-800">{error}</div>}
            {done && <div className="mt-3 rounded-lg bg-ok-50 px-3 py-2 text-sm text-ok-800">{done}</div>}

            <div className="mt-4 flex min-h-0 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-ink-700">
                  지금 목록 <b className="tabular-nums">{list.rows.length.toLocaleString()}</b>개
                  {list.at > 0 && (
                    <span className="ml-2 text-xs text-ink-400">
                      {list.name} · {fmtTime(list.at)}
                    </span>
                  )}
                </div>
                {list.rows.length > 0 && (
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="목록에서 찾기"
                    aria-label="Inst list 에서 찾기"
                    className="w-44 rounded-lg border border-ink-200 px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                )}
              </div>
              <Table rows={shown} empty={list.rows.length ? '찾는 Tag. No 가 없어요.' : '아직 올린 목록이 없어요.'} />
              {shown.length > SHOW && (
                <div className="mt-1 text-xs text-ink-400">
                  {shown.length.toLocaleString()}개 중 처음 {SHOW}줄만 보여요. 찾기로 좁혀 보세요.
                </div>
              )}
              {list.rows.length > 0 && (
                <p className="mt-3 text-xs text-pretty text-ink-500">
                  이미 만든 Equipment 는 그대로예요. 박스를 열면 Tag. No 아래 “목록 값으로 채우기”로 맞출 수 있어요.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
