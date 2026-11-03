import { useState } from 'react'
import { displayName, fileBase } from '../lib/library'

// 열린 도면 탭. 맨 왼쪽 집 아이콘은 홈(최근 파일 목록)입니다. 별명이 있으면 별명을 보여 줌
// 맨 오른쪽 + 는 홈으로 가지 않고 도면 고르기 창(OpenDocPicker)을 띄움
// 탭 이름을 더블 클릭하면 홈의 연필 버튼처럼 별명을 바꿀 수 있음 (비우면 원래 파일 이름)
export default function TabBar({ docs, library, activeId, onSelect, onClose, onHome, onAdd, onSetAlias }) {
  const [editingId, setEditingId] = useState(null)
  if (docs.length === 0) return null

  const finishAlias = (d, value) => {
    setEditingId(null)
    const alias = library?.aliases?.[d.id] ?? ''
    const next = value.trim()
    const wanted = next === fileBase(d.name) ? '' : next
    if (wanted !== alias) onSetAlias?.(d.id, wanted)
  }

  return (
    <nav className="flex items-end gap-0.5 overflow-x-auto border-b border-ink-200 bg-ink-100 px-2 pt-1.5" aria-label="열린 도면">
      <button
        onClick={onHome}
        title="홈 (최근 파일)"
        className={`mb-1 flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm ${
          activeId === null ? 'bg-surface font-semibold text-brand-700 shadow-xs ring-1 ring-ink-200' : 'text-ink-500 transition-colors hover:bg-surface/70 hover:text-ink-800'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" />
        </svg>
        <span className="hidden sm:inline">홈</span>
      </button>

      {docs.map((d) => {
        const active = d.id === activeId
        const editing = d.id === editingId
        const shown = displayName(library, d.id, d.name)
        return (
          <div
            key={d.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(d.id)}
            onAuxClick={(e) => e.button === 1 && onClose(d.id)}
            onDoubleClick={(e) => {
              if (!onSetAlias || e.target.closest('button, input')) return
              setEditingId(d.id)
            }}
            title={editing ? undefined : `${d.name}\n더블 클릭하면 이름 바꾸기`}
            className={`group relative -mb-px flex h-9 max-w-56 shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 pr-1.5 pl-3 text-sm ${
              active
                ? 'border-ink-200 bg-surface font-medium text-ink-900 before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-b before:bg-brand-600'
                : 'border-transparent text-ink-500 transition-colors hover:bg-surface/60 hover:text-ink-800'
            }`}
          >
            <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${active ? 'text-brand-600' : 'text-ink-400'}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M6 2h9l5 5v15H6z" />
              <path d="M15 2v5h5" />
            </svg>
            {editing ? (
              <input
                autoFocus
                defaultValue={library?.aliases?.[d.id] ?? ''}
                placeholder={fileBase(d.name)}
                aria-label="도면 별명"
                title="비워 두면 원래 파일 이름이 보여요"
                size={Math.max(8, Math.min(28, shown.length + 2))}
                onFocus={(e) => {
                  // 별명이 없으면 지금 보이는 파일 이름을 채워 두고 고칠 수 있게
                  if (!e.target.value) e.target.value = shown
                  e.target.select()
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    e.currentTarget.dataset.cancel = '1'
                    e.currentTarget.blur()
                  }
                }}
                onBlur={(e) => {
                  if (e.currentTarget.dataset.cancel) setEditingId(null)
                  else finishAlias(d, e.currentTarget.value)
                }}
                className="min-w-0 rounded border border-brand-400 bg-surface px-1 py-0.5 text-sm text-ink-800 outline-none ring-2 ring-brand-100"
              />
            ) : (
              <span className="truncate select-none">{shown}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(d.id)
              }}
              title="탭 닫기 (측정값은 저장되어 있어요)"
              aria-label="탭 닫기"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-ink-200 hover:text-ink-700 ${
                active ? '' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )
      })}

      <button
        onClick={onAdd ?? onHome}
        title="다른 도면 열기 (목록에서 골라 새 탭으로)"
        aria-label="다른 도면 열기"
        className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg text-ink-500 hover:bg-surface/70 hover:text-ink-800"
      >
        +
      </button>
    </nav>
  )
}
