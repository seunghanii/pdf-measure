import { useEffect, useMemo, useState } from 'react'

// 메모 범위에 연결할 도면 고르기. 앱에 올려 둔 도면 중 하나와 (원하면) 페이지를 고릅니다.
// initial: 이미 연결된 { id, name, page }
export default function LinkPicker({ store, currentId, currentName, initial, onCancel, onConfirm, onUnlink }) {
  const [list, setList] = useState(null) // null = 불러오는 중
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(initial?.id ?? null)
  const [page, setPage] = useState(String(initial?.page ?? 1))

  useEffect(() => {
    let cancelled = false
    store
      .listRecent()
      .then((rows) => !cancelled && setList(rows))
      .catch(() => !cancelled && setList([]))
    return () => {
      cancelled = true
    }
  }, [store])

  // 이 도면은 맨 위에, 나머지는 최근 연 순서. 이전에 연결한 도면이 목록에 없으면(오래돼서) 그대로 보여 줌
  const items = useMemo(() => {
    const rows = list ?? []
    const all = [{ id: currentId, name: currentName }, ...rows.filter((r) => r.id !== currentId)]
    if (initial && !all.some((r) => r.id === initial.id)) all.push({ id: initial.id, name: initial.name })
    const q = query.trim().toLowerCase()
    return q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all
  }, [list, currentId, currentName, initial, query])

  const chosen = items.find((r) => r.id === picked) ?? (initial?.id === picked ? initial : null)
  const pageNo = Math.max(1, Math.round(Number(page) || 1))

  const submit = (e) => {
    e.preventDefault()
    if (chosen) onConfirm({ id: chosen.id, name: chosen.name, page: pageNo })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white p-5 shadow-2xl"
      >
        <h2 className="text-lg font-bold">열릴 도면 고르기</h2>
        <p className="mt-1 text-sm text-slate-500">이 범위를 누르면 고른 도면이 새 탭으로 열려요. 앱에 한 번 열었던 도면 중에서 고를 수 있어요.</p>
        <input
          autoFocus
          placeholder="도면 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        />
        <ul className="mt-2 min-h-24 flex-1 overflow-y-auto rounded-md border border-slate-200" role="listbox" aria-label="도면 목록">
          {list === null && <li className="px-3 py-4 text-center text-sm text-slate-400">도면 목록 불러오는 중…</li>}
          {list !== null && items.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-400">찾는 도면이 없어요</li>}
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={picked === r.id}
                onClick={() => setPicked(r.id)}
                onDoubleClick={() => onConfirm({ id: r.id, name: r.name, page: pageNo })}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${picked === r.id ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50'}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 3h8l4 4v14H6zM14 3v4h4" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.id === currentId && <span className="shrink-0 text-xs text-slate-400">지금 도면</span>}
              </button>
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          열 페이지
          <input
            inputMode="numeric"
            value={page}
            onChange={(e) => setPage(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => e.target.select()}
            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center"
          />
          <span className="text-xs text-slate-400">쪽 (없는 페이지면 마지막 쪽)</span>
        </label>
        <div className="mt-4 flex items-center gap-2">
          {onUnlink && (
            <button type="button" onClick={onUnlink} className="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50">
              연결 끊기
            </button>
          )}
          <button type="button" onClick={onCancel} className="ml-auto rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            취소
          </button>
          <button disabled={!chosen} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            연결
          </button>
        </div>
      </form>
    </div>
  )
}
