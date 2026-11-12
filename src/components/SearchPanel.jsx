import { useEffect, useMemo, useRef, useState } from 'react'
import { ensureIndexed, listIndexes, onIndexed, scopeOf, useIndexerStatus } from '../lib/indexer'
import { searchIndex, searchNotes, splitMatch, textHas } from '../lib/textIndex'
import { colorHex, displayName, fileBase } from '../lib/library'
import { INST_STATUSES } from '../lib/instrument'

const INST_STATUS_MAP = new Map(INST_STATUSES.map((s) => [s.id, s]))

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
  return (
    <>
      {splitMatch(text, query).map(([s, hit], i) =>
        hit ? (
          <mark key={i} className="rounded-sm bg-warn-200 px-0.5 text-ink-900">
            {s}
          </mark>
        ) : (
          s
        ),
      )}
    </>
  )
}

// 찾은 곳 옆 작은 표시: 직접 넣은 글이면 종류, OCR 로 읽은 글자면 OCR
export function HitBadge({ hit }) {
  const label = hit.note === 'text' ? '텍스트' : hit.note === 'memo' ? '박스' : hit.note === 'measure' ? '측정' : hit.ocr ? 'OCR' : null
  if (!label) return null
  return (
    <span className={`shrink-0 text-[10px] ${hit.note ? 'text-warn-600' : 'text-ink-400'}`}>
      {label}
      {hit.hidden ? ' · 숨김' : ''}
    </span>
  )
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

// 찾기·명령 창 (⌘K / Ctrl+K, 홈에선 Ctrl+F 도): 명령, Equipment Tag, 도면 이름, 모든 도면의 글자
// ↑↓ 로 고르고 Enter (명령·Equipment·도면 줄). 글자 찾은 곳은 눌러서 이동
export default function SearchPanel({ store, recent, library, onOpenHit, onOpenDoc, onClose, commands = [] }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
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

  // 별명·파일 이름으로 도면 찾기 (색인 없이도 바로)
  const nameHits = useMemo(() => {
    if (!query.trim()) return []
    return docs.filter((d) => textHas(`${library.aliases?.[d.id] ?? ''} ${fileBase(d.name)}`, query))
  }, [docs, library, query])

  // 명령: 검색어가 없으면 전부, 있으면 이름에 든 것
  const cmdHits = useMemo(() => (query.trim() ? commands.filter((c) => textHas(`${c.label} ${c.hint ?? ''} ${c.words ?? ''}`, query)) : commands), [commands, query])
  // Equipment: 도면 요약의 Tag·Description
  const equipHits = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const out = []
    for (const doc of docs)
      for (const r of doc.summary?.inst ?? []) {
        if (out.length >= 30) break
        if (textHas(`${r.tag} ${r.desc ?? ''}`, q)) out.push({ doc, row: r })
      }
    return out
  }, [docs, query])
  // 키보드로 고를 줄 (명령 → Equipment → 도면)
  const picks = useMemo(
    () => [
      ...cmdHits.map((c) => ({ key: `c:${c.id}`, run: () => c.run() })),
      ...equipHits.map(({ doc, row }) => ({
        key: `e:${doc.id}:${row.id}`,
        run: () => onOpenHit(doc, { page: row.page, rect: { x: row.rect[0], y: row.rect[1], w: row.rect[2], h: row.rect[3] }, hidden: !!row.hidden, itemId: row.id }),
      })),
      ...nameHits.map((doc) => ({ key: `d:${doc.id}`, run: () => onOpenDoc(doc) })),
    ],
    [cmdHits, equipHits, nameHits, onOpenHit, onOpenDoc],
  )
  const cur = Math.min(cursor, picks.length - 1)
  const activeKey = picks[cur]?.key
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!picks.length) return
      const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + picks.length) % picks.length
      setCursor(next)
      document.getElementById(`sp-${picks[next].key}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      picks[cur]?.run()
    }
  }
  const rowCls = (key) => `flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm ${activeKey === key ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-brand-50'}`

  const missing = indexes ? docs.filter((d) => !indexes.has(d.id)).length : 0
  const folderOf = (id) => library.folders.find((f) => f.id === library.assign[id])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onPointerDown={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
          <SearchIcon className="h-5 w-5 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onInputKey}
            aria-label="찾기"
            placeholder="도면, Tag. No, 도면 속 글자, 명령 (예: P-101, 측정, 달력)"
            className="min-w-0 flex-1 text-base outline-none placeholder:text-ink-400"
          />
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-ink-500 hover:bg-ink-100">
            닫기
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {cmdHits.length > 0 && (
            <section className="border-b border-ink-100 px-2 py-2">
              <div className="px-2 py-1 text-xs font-semibold text-ink-500">명령</div>
              <ul>
                {cmdHits.map((c) => (
                  <li key={c.id}>
                    <button id={`sp-c:${c.id}`} onClick={() => c.run()} className={rowCls(`c:${c.id}`)}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={c.icon ?? 'M9 18l6-6-6-6'} />
                      </svg>
                      <span className="min-w-0 flex-1 truncate">
                        <Highlighted text={c.label} query={query} />
                        {c.hint && <span className="ml-2 text-xs text-ink-400">{c.hint}</span>}
                      </span>
                      {c.keys && <kbd className="shrink-0 rounded bg-ink-100 px-1.5 font-sans text-[11px] text-ink-500">{c.keys}</kbd>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {equipHits.length > 0 && (
            <section className="border-b border-ink-100 px-2 py-2">
              <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-ink-500">
                Equipment
                <span className="ml-auto font-normal text-ink-400">{equipHits.length >= 30 ? '30개 넘음' : `${equipHits.length}개`}</span>
              </div>
              <ul>
                {equipHits.map(({ doc, row }) => {
                  const st = INST_STATUS_MAP.get(row.status)
                  return (
                    <li key={`${doc.id}:${row.id}`}>
                      <button
                        id={`sp-e:${doc.id}:${row.id}`}
                        onClick={() => onOpenHit(doc, { page: row.page, rect: { x: row.rect[0], y: row.rect[1], w: row.rect[2], h: row.rect[3] }, hidden: !!row.hidden, itemId: row.id })}
                        className={rowCls(`e:${doc.id}:${row.id}`)}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: st?.color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-mono text-[13px] font-medium">
                            <Highlighted text={row.tag || '(Tag 없음)'} query={query} />
                          </span>
                          {row.desc && (
                            <span className="ml-2 text-xs text-ink-500">
                              <Highlighted text={row.desc} query={query} />
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-ink-400">
                          {st?.label} · {displayName(library, doc.id, doc.name)} {row.page}쪽
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {nameHits.length > 0 && (
            <section className="border-b border-ink-100 px-2 py-2">
              <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-ink-500">
                도면
                <span className="ml-auto font-normal text-ink-400">{nameHits.length}개</span>
              </div>
              <ul>
                {nameHits.map((doc) => {
                  const alias = library.aliases?.[doc.id]
                  const folder = folderOf(doc.id)
                  return (
                    <li key={doc.id}>
                      <button id={`sp-d:${doc.id}`} onClick={() => onOpenDoc(doc)} title={doc.name} className={rowCls(`d:${doc.id}`)}>
                        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-danger-500" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                          <path d="M6 2h9l5 5v15H6z" />
                          <path d="M15 2v5h5" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">
                            <Highlighted text={alias || fileBase(doc.name)} query={query} />
                          </span>
                          {alias && (
                            <span className="ml-2 text-xs text-ink-400">
                              <Highlighted text={fileBase(doc.name)} query={query} />
                            </span>
                          )}
                        </span>
                        {folder && (
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                            style={{ background: colorHex(folder.color) }}
                          >
                            {folder.name}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {failed && <p className="px-4 py-6 text-center text-sm text-danger-600">검색 준비에 실패했어요. 새로 고침해 보세요.</p>}
          {!failed && !indexes && <p className="px-4 py-6 text-center text-sm text-ink-400">검색 준비 중…</p>}
          {indexes && query.trim() && results.length === 0 && nameHits.length === 0 && equipHits.length === 0 && cmdHits.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-400">찾는 글자가 들어 있는 도면이 없어요: "{query}"</p>
          )}
          {indexes && !query.trim() && (
            <p className="px-4 py-4 text-center text-sm text-ink-400">
              도면 이름·별명으로 도면을 찾거나, Tag. No·도면 번호·글자처럼 도면 {docs.length - missing}개에 적힌 글자를 입력하세요.
            </p>
          )}
          {results.map(({ doc, hits }) => {
            const folder = folderOf(doc.id)
            return (
              <section key={doc.id} className="border-b border-ink-100 px-2 py-2">
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className="truncate text-sm font-semibold" title={doc.name}>
                    {displayName(library, doc.id, doc.name)}
                  </span>
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
