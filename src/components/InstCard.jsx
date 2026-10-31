import { useState } from 'react'
import { INST_STATUSES, DEFAULT_STATUS, guessKind, memoLinks, linksPatch, normTag, statusOf } from '../lib/instrument'
import { isDefaultName } from '../lib/categories'

// 메모장 안의 계기 카드 칸: 태그 번호, 계기 종류, 상태
// onChange(patch): 메모 항목에 합칠 값. kinds: 계기 종류 목록, onAddKind(약어): 목록에 더하기 (모든 도면 공통)
export function InstFields({ memo, onChange, kinds, onAddKind }) {
  const inst = memo.inst
  const [adding, setAdding] = useState(false)
  const [newKind, setNewKind] = useState('')

  const setTag = (raw) => {
    const tag = raw.toUpperCase()
    const next = { ...inst, tag }
    // 종류를 비워 뒀거나 태그로 짐작한 값 그대로면 새 태그로 다시 짐작 (FT-1001 → FT)
    if (!inst.kind?.trim() || inst.kind === guessKind(inst.tag, kinds)) next.kind = guessKind(tag, kinds)
    const patch = { inst: next }
    // 메모 이름이 기본 이름이거나 예전 태그와 같으면 이름도 태그로
    if (isDefaultName(memo.name) || !memo.name?.trim() || memo.name === inst.tag) patch.name = tag || memo.name
    onChange(patch)
  }
  const setKind = (kind) => onChange({ inst: { ...inst, kind } })
  const setStatus = (status) => onChange({ inst: { ...inst, status }, color: statusOf(status).color })

  const addKind = () => {
    const k = newKind.trim().toUpperCase()
    if (k) {
      onAddKind?.(k)
      setKind(k)
    }
    setNewKind('')
    setAdding(false)
  }

  const label = 'text-[11px] font-semibold tracking-wide text-ink-500'
  const status = inst.status ?? DEFAULT_STATUS
  // 예전에 적은 종류(목록에 없는 글)도 고른 상태로 보이게
  const options = inst.kind && !kinds.includes(inst.kind) ? [...kinds, inst.kind] : kinds

  return (
    <div className="flex flex-col gap-2 border-b border-ink-100 px-3 py-2">
      <label className="flex items-center gap-2">
        <span className={`${label} w-14 shrink-0`}>태그 번호</span>
        <input
          value={inst.tag ?? ''}
          onChange={(e) => setTag(e.target.value)}
          onBlur={(e) => e.target.value && setTag(normTag(e.target.value))}
          placeholder="FT-1001"
          className="min-w-0 flex-1 rounded-md border border-ink-200 px-2 py-1 text-sm font-semibold tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          autoFocus={!inst.tag}
        />
      </label>
      <div className="flex items-start gap-2">
        <span className={`${label} w-14 shrink-0 pt-1`}>종류</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label="종류">
          {options.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={inst.kind === k}
              onClick={() => setKind(inst.kind === k ? '' : k)}
              className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${inst.kind === k ? 'bg-ink-800 text-white' : 'text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'}`}
            >
              {k}
            </button>
          ))}
          {adding ? (
            <input
              autoFocus
              value={newKind}
              onChange={(e) => setNewKind(e.target.value.toUpperCase())}
              onBlur={addKind}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addKind()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setNewKind('')
                  setAdding(false)
                }
              }}
              placeholder="예: FIC"
              className="w-16 rounded border border-brand-400 px-1.5 py-0.5 text-xs font-semibold outline-none"
              aria-label="새 종류"
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50" title="종류 더하기 (모든 도면에 적용)">
              + 추가
            </button>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className={`${label} w-14 shrink-0 pt-1`}>상태</span>
        <StatusPicker value={status} onChange={setStatus} className="min-w-0 flex-1" />
      </div>
    </div>
  )
}

// 상태 고르기 (설치 전 → 설치 → 결선 → 루프 체크 완료)
export function StatusPicker({ value, onChange, className = '', small = false }) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`} role="group" aria-label="상태">
      {INST_STATUSES.map((s) => {
        const on = value === s.id
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(s.id)}
            className={`flex items-center gap-1 rounded-full font-medium whitespace-nowrap ${small ? 'px-1.5 py-0 text-[11px]' : 'px-2 py-0.5 text-xs'} ${
              on ? 'text-white' : 'text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'
            }`}
            style={on ? { background: s.color } : undefined}
          >
            {!on && <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />}
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

// 관련 문서 (Hook-up, 루프도, 데이터시트 …) 여러 개. 누르면 그 페이지 미리보기가 뜨고, 거기서 파일 열기
// onPick(index): 고르기 창 열기 (index 없으면 새로 추가)
export function RelatedDocs({ memo, library, onChange, onOpen, onPick }) {
  const links = memoLinks(memo)
  const remove = (i) => onChange(linksPatch(links.filter((_, k) => k !== i)))
  return (
    <div className="border-b border-ink-100 px-3 py-1.5 text-xs">
      {links.length > 0 && (
        <ul className="mb-1 flex flex-col gap-1">
          {links.map((l, i) => (
            <li key={`${l.id}-${i}`} className="group flex items-center gap-1.5">
              <button
                onClick={() => onOpen(l)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-left text-brand-700 hover:bg-brand-100"
                title="이 도면 미리보기 (파일 열기 버튼으로 탭 열기)"
              >
                {l.role && <span className="shrink-0 rounded bg-white px-1.5 py-px text-[11px] font-semibold text-brand-800 ring-1 ring-brand-200">{l.role}</span>}
                {library?.aliases?.[l.id] ? (
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{library.aliases[l.id]}</span>
                    <span className="block truncate text-[11px] text-ink-400" title={l.name}>
                      {l.name}
                    </span>
                  </span>
                ) : (
                  <span className="truncate font-medium">{l.name}</span>
                )}
                {l.page > 1 && <span className="shrink-0 text-brand-500">{l.page}쪽</span>}
                <svg viewBox="0 0 24 24" className="ml-auto h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button onClick={() => onPick(i)} className="shrink-0 rounded px-1 py-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="바꾸기" aria-label="바꾸기">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />
                </svg>
              </button>
              <button onClick={() => remove(i)} className="shrink-0 rounded px-1 py-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600" title="연결 빼기" aria-label="연결 빼기">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => onPick()} className="flex items-center gap-1 py-0.5 text-ink-500 hover:text-ink-800" title="Hook-up, 루프도, 데이터시트 같은 관련 도면 연결">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
        </svg>
        {links.length ? '관련 도면 더 연결' : '관련 도면 연결'}
      </button>
    </div>
  )
}
