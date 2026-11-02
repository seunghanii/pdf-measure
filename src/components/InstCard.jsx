import { useEffect, useRef, useState } from 'react'
import { INST_STATUSES, DEFAULT_STATUS, guessKind, memoLinks, linksPatch, normTag, statusOf } from '../lib/instrument'
import { isDefaultName } from '../lib/categories'
import { convertTyped, hasHangul } from '../lib/hangulKeys'
import { useImageUrl } from '../lib/images'

// 메모장 안의 계기 카드 칸: Tag. No, Description, 종류, 상태
// onChange(patch): 메모 항목에 합칠 값. kinds: 계기 종류 목록, onAddKind(약어): 목록에 더하기 (모든 도면 공통)
// Tag. No 칸: 기본은 영어 입력. 한글 자판 상태로 쳐도 영문 자판 글자로 바꿔 넣음 (ㄹㅅ → FT).
// 오른쪽 A/한 버튼으로 한글 그대로 쓰기. 웹페이지는 입력기(한/영)를 직접 바꿀 수 없어서 이렇게 함.
export function TagInput({ tag, onTag }) {
  const [lang, setLang] = useState(() => (hasHangul(tag) ? 'ko' : 'en'))
  const ref = useRef(null)
  const composing = useRef(false)
  const base = useRef(null) // 조합(한글 입력) 시작 전 값
  const latest = useRef({ tag, onTag, lang })
  useEffect(() => {
    latest.current = { tag, onTag, lang }
  })

  const putCaret = (el, at) =>
    requestAnimationFrame(() => {
      if (document.activeElement === el) el.setSelectionRange(at, at)
    })

  // 조합이 끝난 뒤 새로 친 한글만 영문으로
  const convertNow = () => {
    const el = ref.current
    const { tag: cur, onTag: set, lang: l } = latest.current
    if (composing.current) return
    if (!el || l !== 'en') {
      base.current = null
      return
    }
    const before = base.current ?? cur
    base.current = null
    const { value, caret } = convertTyped(before, el.value)
    if (value !== el.value || value !== cur) set(value)
    if (value !== el.value) putCaret(el, caret)
  }

  const onChange = (e) => {
    const v = e.target.value
    if (composing.current || e.nativeEvent.isComposing) return onTag(v)
    if (lang !== 'en') {
      base.current = null
      onTag(v)
      return
    }
    const { value, caret } = convertTyped(base.current ?? tag, v)
    base.current = null
    onTag(value)
    if (value !== v) putCaret(e.target, caret)
  }

  const toggle = () => {
    base.current = null
    setLang((l) => (l === 'en' ? 'ko' : 'en'))
    ref.current?.focus()
  }

  const en = lang === 'en'
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        ref={ref}
        value={tag}
        lang={en ? 'en' : 'ko'}
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onChange={onChange}
        onCompositionStart={() => {
          composing.current = true
          if (base.current == null) base.current = latest.current.tag
        }}
        onCompositionEnd={() => {
          composing.current = false
          // 다음 글자 조합이 바로 이어지면 그때 함께 바꿈 (조합 중 값을 바꾸면 입력기가 꼬임)
          setTimeout(convertNow, 0)
        }}
        onBlur={(e) => {
          let v = e.target.value
          if (en) v = convertTyped(base.current ?? latest.current.tag, v).value
          base.current = null
          if (v) onTag(normTag(v))
        }}
        placeholder="FT-1001"
        className="min-w-0 flex-1 rounded-md border border-ink-200 px-2 py-1 text-sm font-semibold tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        autoFocus={!tag}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        aria-pressed={!en}
        aria-label={en ? 'Tag. No 영어 입력 중, 누르면 한글 입력' : 'Tag. No 한글 입력 중, 누르면 영어 입력'}
        title={en ? '영어 입력 (한글 자판으로 쳐도 영문으로 바뀜). 누르면 한글 그대로 쓰기' : '한글 입력. 누르면 영어 입력'}
        className={`w-7 shrink-0 rounded py-1 text-xs font-semibold ${en ? 'text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50' : 'bg-ink-800 text-surface'}`}
      >
        {en ? 'A' : '한'}
      </button>
    </div>
  )
}

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
  const setDesc = (desc) => onChange({ inst: { ...inst, desc } })
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
        <span className={`${label} w-20 shrink-0`}>Tag. No</span>
        <TagInput tag={inst.tag ?? ''} onTag={setTag} />
      </label>
      <label className="flex items-center gap-2">
        <span className={`${label} w-20 shrink-0`}>Description</span>
        <input
          value={inst.desc ?? ''}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={(e) => e.target.value !== e.target.value.trim() && setDesc(e.target.value.trim())}
          placeholder="예: Fuel Gas Flow"
          className="min-w-0 flex-1 rounded-md border border-ink-200 px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </label>
      <div className="flex items-start gap-2">
        <span className={`${label} w-20 shrink-0 pt-1`}>종류</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label="종류">
          {options.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={inst.kind === k}
              onClick={() => setKind(inst.kind === k ? '' : k)}
              className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${inst.kind === k ? 'bg-ink-800 text-surface' : 'text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'}`}
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
        <span className={`${label} w-20 shrink-0 pt-1`}>상태</span>
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

// 관련 문서 (Hook-up, 데이터시트 …) 여러 개. 누르면 그 페이지 미리보기가 뜨고, 거기서 파일 열기
// onPick(index): 고르기 창 열기 (index 없으면 새로 추가)
export function RelatedDocs({ memo, library, onChange, onOpen, onPick }) {
  const links = memoLinks(memo)
  const remove = (i) => onChange(linksPatch(links.filter((_, k) => k !== i)))
  return (
    <div className="border-b border-ink-100 px-3 py-1.5 text-xs">
      {links.length > 0 && (
        <ul className="mb-1 flex flex-col gap-1">
          {links.map((l, i) => (
            <li key={`${l.photo ?? l.id}-${i}`} className="group flex items-center gap-1.5">
              {l.photo ? (
                <button
                  onClick={() => onOpen(l)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-left text-brand-700 hover:bg-brand-100"
                  title="이 사진 크게 보기"
                >
                  {l.role && <span className="shrink-0 rounded bg-surface px-1.5 py-px text-[11px] font-semibold text-brand-800 ring-1 ring-brand-200">{l.role}</span>}
                  <LinkThumb id={l.photo} />
                  <span className="truncate font-medium">{l.name || '사진'}</span>
                </button>
              ) : (
              <button
                onClick={() => onOpen(l)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-left text-brand-700 hover:bg-brand-100"
                title="이 도면 미리보기 (파일 열기 버튼으로 탭 열기)"
              >
                {l.role && <span className="shrink-0 rounded bg-surface px-1.5 py-px text-[11px] font-semibold text-brand-800 ring-1 ring-brand-200">{l.role}</span>}
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
              )}
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
      <button onClick={() => onPick()} className="flex items-center gap-1 py-0.5 text-ink-500 hover:text-ink-800" title="Hook-up, 데이터시트 같은 관련 도면이나 사진 연결">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
        </svg>
        {links.length ? '관련 도면 더 연결' : '관련 도면 연결'}
      </button>
    </div>
  )
}

// 사진 연결의 작은 그림
function LinkThumb({ id }) {
  const url = useImageUrl(id)
  return (
    <span className="grid h-6 w-8 shrink-0 place-items-center overflow-hidden rounded bg-surface ring-1 ring-brand-200">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 16l5-5 4 4 3-3 6 6" />
        </svg>
      )}
    </span>
  )
}
