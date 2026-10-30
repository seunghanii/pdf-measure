import { useEffect, useMemo, useRef, useState } from 'react'
import { ensureIndexed, listIndexes, onIndexed, scopeOf, useIndexerStatus } from '../lib/indexer'
import { searchIndex, searchNotes, splitMatch } from '../lib/textIndex'
import { colorHex } from '../lib/library'

const MAX_HITS_PER_DOC = 8

export function SearchIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  )
}

export function Highlighted({ text, query }) {
  const [a, b, c] = splitMatch(text, query)
  return (
    <>
      {a}
      {b && <mark className="rounded-sm bg-warn-200 px-0.5 text-ink-900">{b}</mark>}
      {c}
    </>
  )
}

// 찾은 곳 옆 작은 표시: 직접 넣은 글이면 종류, OCR 로 읽은 글자면 OCR
export function HitBadge({ hit }) {
  const label = hit.note === 'text' ? '글 상자' : hit.note === 'memo' ? '메모' : hit.ocr ? 'OCR' : null
  if (!label) return null
  return <span className={`shrink-0 text-[10px] ${hit.note ? 'text-warn-600' : 'text-ink-400'}`}>{label}</span>
}

// 검색 색인을 만드는 중이면 한 줄로 알려 줌
export function IndexerStatusLine({ onlyId }) {
  const { running, waiting } = useIndexerStatus()
  if (!running || (onlyId && running.id !== onlyId)) return null
  const p = running.progress
  const detail = !p
    ? '준비 중'
    : p.ocr
      ? `${p.pages > 1 ? `${p.page}/${p.pages}쪽 ` : ''}글자 그림 읽는 중(OCR) ${Math.round(100 * (p.done ?? 0))}%`
      : `${p.page}/${p.pages}쪽 글자 읽는 중`
  return (
    <div className="flex items-center gap-2 text-xs text-ink-500">
      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" />
      <span className="truncate">
        {onlyId ? '' : `"${running.name}" `}
        {detail}
        {!onlyId && waiting > 0 ? ` · 남은 도면 ${waiting}개` : ''}
      </span>
    </div>
  )
}

// 홈 화면 돋보기: 모든 도면에서 글자 찾기
export default function SearchPanel({ store, recent, library, onOpenHit, onClose }) {
  const [query, setQuery] = useState('')
  const [indexes, setIndexes] = useState(null) // Map id → 색인
  const [failed, setFailed] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 색인 불러오기, 없는 도면은 뒤에서 만들기
  useEffect(() => {
    let alive = true
    listIndexes(store)
      .then((map) => {
        if (!alive) return
        setIndexes(map)
        for (const doc of recent ?? []) {
          if (map.has(doc.id) || doc.hasFile === false) continue
          ensureIndexed(store, doc.id, doc.name, null)
        }
      })
      .catch((e) => {
        console.warn(e)
        if (alive) setFailed(true)
      })
    const off = onIndexed((scope, id, index) => {
      if (scope === scopeOf(store)) setIndexes((m) => new Map(m ?? []).set(id, index))
    })
    return () => {
      alive = false
      off()
    }
  }, [store, recent])

  const docs = useMemo(() => recent ?? [], [recent])
  const results = useMemo(() => {
    if (!indexes || !query.trim()) return []
    const out = []
    for (const doc of docs) {
      const hits = [...searchNotes(doc.summary?.notes, query, 500), ...searchIndex(indexes.get(doc.id), query, 500)]
      if (hits.length) out.push({ doc, hits })
    }
    return out
  }, [docs, indexes, query])

  const missing = indexes ? docs.filter((d) => !indexes.has(d.id)).length : 0
  const folderOf = (id) => library.folders.find((f) => f.id === library.assign[id])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink-900/30 p-4 pt-[8vh]" onPointerDown={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
          <SearchIcon className="h-5 w-5 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="도면 속 글자 찾기 (예: P-101, 거실, 도면번호)"
            className="min-w-0 flex-1 text-base outline-none placeholder:text-ink-400"
          />
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-ink-500 hover:bg-ink-100">
            닫기
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {failed && <p className="px-4 py-6 text-center text-sm text-danger-600">검색 색인을 불러오지 못했어요.</p>}
          {!failed && !indexes && <p className="px-4 py-6 text-center text-sm text-ink-400">색인 불러오는 중…</p>}
          {indexes && query.trim() && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-400">"{query}" 이(가) 들어 있는 도면이 없어요.</p>
          )}
          {indexes && !query.trim() && (
            <p className="px-4 py-6 text-center text-sm text-ink-400">
              도면 {docs.length - missing}개에서 찾을 수 있어요. 태그·실 이름·도면번호처럼 도면에 적힌 글자를 입력하세요.
            </p>
          )}
          {results.map(({ doc, hits }) => {
            const folder = folderOf(doc.id)
            return (
              <section key={doc.id} className="border-b border-ink-100 px-2 py-2">
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className="truncate text-sm font-semibold">{doc.name.replace(/\.pdf$/i, '')}</span>
                  {folder && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                      style={{ background: colorHex(folder.color) }}
                    >
                      {folder.name}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-ink-400">{hits.length}곳</span>
                </div>
                <ul>
                  {hits.slice(0, MAX_HITS_PER_DOC).map((hit, i) => (
                    <li key={i}>
                      <button
                        onClick={() => onOpenHit(doc, hit)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-brand-50"
                      >
                        <span className="w-12 shrink-0 text-xs text-ink-400">{hit.page}쪽</span>
                        <span className="min-w-0 flex-1 truncate">
                          <Highlighted text={hit.text} query={query} />
                        </span>
                        <HitBadge hit={hit} />
                      </button>
                    </li>
                  ))}
                  {hits.length > MAX_HITS_PER_DOC && (
                    <li className="px-2 py-1 text-xs text-ink-400">
                      외 {hits.length - MAX_HITS_PER_DOC}곳 · 도면을 열고 오른쪽 검색 창에서 모두 볼 수 있어요
                    </li>
                  )}
                </ul>
              </section>
            )
          })}
        </div>

        <div className="space-y-1 border-t border-ink-200 bg-ink-50 px-4 py-2">
          <IndexerStatusLine />
          {indexes && missing > 0 && (
            <p className="text-xs text-ink-400">아직 글자를 읽지 않은 도면 {missing}개는 다 읽으면 결과에 나와요.</p>
          )}
        </div>
      </div>
    </div>
  )
}
