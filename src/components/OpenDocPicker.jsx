import { useEffect, useMemo, useRef, useState } from 'react'
import { displayName, folderLabel, folderSubtree, folderTree } from '../lib/library'
import { textHas } from '../lib/textIndex'

const isPdfFile = (f) => f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))

// 탭 줄의 + 버튼: 홈으로 가지 않고 바로 도면을 골라 새 탭으로 열기.
// recent: 휴지통 뺀 도면 목록(최근 연 순서), openIds: 이미 열린 탭(누르면 그 탭으로)
// onOpen(item): 그 도면 열기, onOpenFiles(files, folderId): 컴퓨터의 PDF 를 열고 고른 폴더에 넣기
export default function OpenDocPicker({ recent, library, openIds, activeId, onOpen, onOpenFiles, onClose }) {
  const [query, setQuery] = useState('')
  // 폴더 거르기: 지금 보는 도면이 들어 있는 폴더부터 (그 아래 하위 폴더 도면도 보임). '' = 전체
  const [folder, setFolder] = useState(() => library.assign[activeId] ?? '')
  const [cursor, setCursor] = useState(0) // ↑↓ 로 고르는 줄
  const [dropping, setDropping] = useState(false)
  const fileRef = useRef(null)
  const listRef = useRef(null)
  const open = useMemo(() => new Set(openIds), [openIds])

  const items = useMemo(() => {
    const inFolder = folder && library.folders.some((f) => f.id === folder) ? folderSubtree(library, folder) : null
    const q = query.trim()
    return (recent ?? []).filter((r) => {
      if (inFolder && !inFolder.has(library.assign[r.id])) return false
      if (!q) return true
      const where = library.assign[r.id] ? folderLabel(library, library.assign[r.id]) : ''
      return textHas(`${displayName(library, r.id, r.name)} ${r.name} ${where}`, q)
    })
  }, [recent, library, folder, query])

  // 처음엔 지금 보는 도면 다음 줄부터 (지금 도면은 맨 위에 있으니 바로 Enter 하면 다른 도면이 열리게)
  const firstOther = items.findIndex((r) => r.id !== activeId)
  useEffect(() => setCursor(Math.max(0, firstOther)), [query, folder, firstOther])
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const pick = (r) => {
    if (!r) return
    onClose()
    onOpen(r)
  }
  const openFiles = (files) => {
    const pdfs = [...(files ?? [])].filter(isPdfFile)
    if (!pdfs.length) return
    onClose()
    onOpenFiles(pdfs, folder || null)
  }

  // 이 창 위에 끌어 온 PDF 는 여기서 받아 고른 폴더로 (앱 전체 끌어놓기 안내로 넘어가지 않게)
  const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  const dropProps = {
    onDragEnter: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
    },
    onDragOver: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false)
    },
    onDrop: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDropping(false)
      openFiles(e.dataTransfer.files)
    },
  }

  const onKeyDown = (e) => {
    e.stopPropagation() // 도면 단축키(숫자·문자)로 넘어가지 않게
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(items.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') {
      e.preventDefault()
      pick(items[cursor])
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={onClose} {...dropProps}>
      <div
        role="dialog"
        aria-label="도면 열기"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onPaste={(e) => e.stopPropagation()}
        className={`relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-surface p-5 shadow-2xl ${dropping ? 'ring-4 ring-brand-400' : ''}`}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-500 bg-brand-50/90 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" />
            </svg>
            <span className="text-base font-semibold">여기에 놓으면 새 탭으로 열어요</span>
            {folder && <span className="text-xs text-brand-600">새 도면은 '{folderLabel(library, folder)}' 폴더에 들어가요</span>}
          </div>
        )}
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-bold">도면 열기</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-7 w-7 items-center justify-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            autoFocus
            placeholder="도면 이름·별명 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-ink-300 bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          {library.folders.length > 0 && (
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              aria-label="폴더"
              title="이 폴더(하위 폴더 포함)의 도면만"
              className="w-36 shrink-0 rounded-md border border-ink-300 bg-surface px-2 py-1.5 text-sm text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            >
              <option value="">모든 폴더</option>
              {folderTree(library).map(({ folder: f, depth }) => (
                <option key={f.id} value={f.id}>
                  {'   '.repeat(depth) + (depth ? '└ ' : '') + f.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <ul ref={listRef} className="mt-2 min-h-24 flex-1 overflow-y-auto rounded-md border border-ink-200" role="listbox" aria-label="도면 목록">
          {recent === null && <li className="px-3 py-4 text-center text-sm text-ink-400">도면 목록 불러오는 중…</li>}
          {recent !== null && items.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-ink-400">
              {query.trim() || folder ? '찾는 도면이 없어요' : '아직 올린 도면이 없어요'}
            </li>
          )}
          {items.map((r, i) => {
            const shown = displayName(library, r.id, r.name)
            const where = library.assign[r.id] ? folderLabel(library, library.assign[r.id]) : ''
            return (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  data-cursor={i === cursor ? '1' : undefined}
                  onClick={() => pick(r)}
                  onMouseMove={() => i !== cursor && setCursor(i)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === cursor ? 'bg-brand-50 text-brand-800' : ''}`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h8l4 4v14H6zM14 3v4h4" strokeLinejoin="round" />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" title={r.name}>
                      {shown}
                    </span>
                    {library.aliases?.[r.id] && <span className="block truncate text-[11px] text-ink-400">{r.name}</span>}
                    {where && <span className="block truncate text-xs text-ink-400">{where}</span>}
                  </span>
                  {r.id === activeId ? (
                    <span className="shrink-0 text-xs text-ink-400">지금 도면</span>
                  ) : (
                    open.has(r.id) && <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-500">열려 있음</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            openFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-ink-300 px-3 py-2 text-sm font-medium text-brand-700 hover:border-brand-400 hover:bg-brand-50"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" />
          </svg>
          컴퓨터에서 PDF 열기
          <span className="font-normal text-ink-400">(끌어 놓아도 돼요{folder ? ' · 고른 폴더에 저장' : ''})</span>
        </button>
        <p className="mt-2 text-xs text-ink-400">누르면 새 탭으로 열려요 · ↑↓ 로 고르고 Enter · Esc 닫기</p>
      </div>
    </div>
  )
}
