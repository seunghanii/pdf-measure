// 홈 왼쪽 아래 메모장: 할 일·간단한 업무 기록. 도면 메모와 같은 편집기라 쓰는 자리에서 마크다운이 바로 꾸며짐.
// 잠시 멈추면 저장 (로그인했으면 서버, 아니면 이 브라우저). 서버에 못 올려도 이 브라우저 사본이 남아 다음에 다시 올림.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { htmlToMarkdown } from '../lib/memoMarkdown'
import MemoEditor, { MemoHelp } from './MemoEditor'

const SAVE_DELAY_MS = 800

const STATUS = {
  saved: '',
  pending: '저장 대기…',
  saving: '저장 중…',
  error: '저장 못 함 (이 브라우저에는 남아 있어요)',
}

export default function HomeNotepad({ store, className = '', onClose }) {
  const [note, setNote] = useState(null) // null = 불러오는 중
  const [status, setStatus] = useState('saved')
  const [notice, setNotice] = useState('')
  const editorRef = useRef(null)
  const apiRef = useRef(null)
  const timer = useRef(0)
  const pending = useRef(false)
  const lastText = useRef('')
  const storeRef = useRef(store)
  useLayoutEffect(() => {
    storeRef.current = store
  })

  useEffect(() => {
    let alive = true
    store
      .getHomeNote()
      .then((n) => {
        if (!alive) return
        lastText.current = n.text
        setNote(n)
      })
      .catch((e) => {
        console.warn('메모장을 불러오지 못함', e)
        if (alive) {
          setNote({ text: '', at: 0 })
          setNotice('서버에서 메모장을 불러오지 못했어요. 새로 고침해 보세요.')
        }
      })
    return () => {
      alive = false
    }
  }, [store])

  const flush = () => {
    clearTimeout(timer.current)
    const el = editorRef.current
    if (!pending.current || !el) return
    pending.current = false
    const text = htmlToMarkdown(el)
    if (text === lastText.current) {
      setStatus('saved')
      return
    }
    lastText.current = text
    setStatus('saving')
    storeRef.current
      .saveHomeNote({ text, at: Date.now() })
      .then(() => !pending.current && setStatus('saved'))
      .catch((e) => {
        console.warn('메모장 저장 실패', e)
        setStatus('error')
      })
  }
  const flushRef = useRef(flush)
  useLayoutEffect(() => {
    flushRef.current = flush
  })

  const onEdit = () => {
    pending.current = true
    setStatus('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS)
  }

  // 홈을 떠날 때(도면을 열거나 창을 닫을 때)도 저장
  useEffect(() => {
    const onHide = () => flushRef.current()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flushRef.current()
    }
  }, [])

  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl bg-surface shadow-xs ring-1 ring-ink-200 ${className}`} aria-label="메모장">
      <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-brand-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 4h6M8 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2M9 11l2 2 4-4M9 17h6" />
        </svg>
        <h2 className="text-xs font-semibold tracking-wide text-ink-500">메모장</h2>
        <span className={`ml-auto truncate text-[11px] ${status === 'error' ? 'text-danger-500' : 'text-ink-400'}`} aria-live="polite">
          {STATUS[status]}
        </span>
        {onClose && (
          <button
            onClick={() => {
              flushRef.current()
              onClose()
            }}
            className="-my-1 -mr-1.5 shrink-0 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            title="메모장 닫기 (Esc)"
            aria-label="메모장 닫기"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto text-sm" onBlur={() => flushRef.current()}>
        {note === null ? (
          <div className="px-4 py-3 text-sm text-ink-400">불러오는 중…</div>
        ) : (
          <MemoEditor
            initial={note.text}
            editorRef={editorRef}
            apiRef={apiRef}
            onEdit={onEdit}
            onPasteFiles={() => setNotice('메모장에는 사진을 넣을 수 없어요. 사진은 도면 메모에 넣어 주세요.')}
            onPasteFail={() => setNotice('붙여넣은 내용을 읽지 못했어요.')}
            loadPhoto={async () => null}
            onOpenPhoto={() => {}}
            label="홈 메모장"
            placeholder={'할 일이나 업무 기록을 적어 두세요. "[] " 할 일, "- " 목록, "# " 제목처럼 바로 꾸며져요.'}
          />
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-1.5">
        <MemoHelp />
        {notice ? (
          <button onClick={() => setNotice('')} className="min-w-0 flex-1 truncate text-left text-[11px] text-warn-600" title={`${notice} (누르면 닫혀요)`}>
            {notice}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-400">쓰는 자리에서 바로 꾸며져요</span>
        )}
      </div>
    </section>
  )
}
