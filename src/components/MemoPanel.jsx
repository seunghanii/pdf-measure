import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { cachedImageUrl, getImageBlob, isImageFile, newImageId, prepareImage, rememberImage } from '../lib/images'
import { memoImageIds, memoImageMarkdown, memoSummary } from '../lib/memo'

marked.use({ gfm: true, breaks: true })
// 메모 속 링크는 새 창으로
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const LOADING_IMG =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#f1f5f9"/><text x="120" y="64" text-anchor="middle" font-size="13" fill="#94a3b8">사진 불러오는 중…</text></svg>')

// 마크다운 → 안전한 HTML. 사진(img:id)은 이미 불러온 주소로 바꿔 끼움
function renderMarkdown(text) {
  const src = String(text ?? '').replace(/\(img:([a-z0-9]+)\)/g, '(memo-img/$1)')
  const html = DOMPurify.sanitize(marked.parse(src))
  return html
    .replace(/src="memo-img\/([a-z0-9]+)"/g, (_, id) => `src="${cachedImageUrl(id) ?? LOADING_IMG}" data-img="${id}"`)
    .replace(/<input disabled="" type="checkbox"/g, '<input type="checkbox"') // 체크 상자는 눌러서 바꿀 수 있게
}

// 할 일 목록의 n번째 체크 상자 켜고 끄기
function toggleTask(text, n) {
  let i = 0
  return text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/gm, (all, lead, mark) => (i++ === n ? `${lead}[${mark === ' ' ? 'x' : ' '}]` : all))
}

// 메모장. 도면 오른쪽 위에 떠 있고, 보기(마크다운)와 쓰기를 오갑니다.
// others: 같은 자리에 겹친 메모들 (누르면 그 메모로 바뀜)
export default function MemoPanel({
  memo,
  others,
  startEditing,
  onEditingChange,
  onSwitch,
  onChange,
  onClose,
  onDelete,
  onOpenLink,
  onPickLink,
  store,
  docId,
  onNotice,
}) {
  const [editing, setEditingState] = useState(startEditing)
  const [text, setText] = useState(memo.text ?? '')
  const [, setLoaded] = useState(0)
  const [zoomed, setZoomed] = useState(null) // 크게 보는 사진 주소
  const [busy, setBusy] = useState(0) // 사진 넣는 중
  const areaRef = useRef(null)
  const fileRef = useRef(null)
  const pending = useRef(null) // 아직 저장 안 된 글

  const setEditing = (v) => {
    setEditingState(v)
    onEditingChange(v)
  }

  // 글은 잠시 멈추면 저장 (글자마다 저장하면 도면 화면까지 매번 다시 그려짐). 닫을 때도 저장
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })
  const flush = () => {
    if (pending.current === null) return
    const t = pending.current
    pending.current = null
    onChangeRef.current({ text: t })
  }
  useEffect(() => {
    if (pending.current === null) return
    const t = setTimeout(flush, 400)
    return () => clearTimeout(t)
  }, [text])
  useEffect(() => () => flush(), [])

  const updateText = (next) => {
    setText(next)
    pending.current = next
  }

  // 글 속 사진 불러오기
  const imageIds = useMemo(() => memoImageIds(text), [text])
  useEffect(() => {
    const source = { store, docId }
    for (const id of imageIds) if (!cachedImageUrl(id)) getImageBlob(source, id).then(() => setLoaded((n) => n + 1))
  }, [imageIds, store, docId])

  const loadedKey = imageIds.map(cachedImageUrl).join() // 사진을 다 불러오면 다시 그림
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => (editing ? '' : renderMarkdown(text)), [editing, text, loadedKey])

  // ---------- 쓰기 도우미 ----------
  // 고른 글자를 앞뒤로 감싸기 (굵게 등)
  const wrap = (before, after = before) => {
    const el = areaRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const sel = text.slice(a, b) || '글자'
    updateText(text.slice(0, a) + before + sel + after + text.slice(b))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + before.length, a + before.length + sel.length)
    })
  }
  // 고른 줄마다 앞에 붙이기 (제목, 목록, 할 일)
  const prefixLines = (prefix) => {
    const el = areaRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const start = text.lastIndexOf('\n', a - 1) + 1
    const endIdx = text.indexOf('\n', b)
    const end = endIdx < 0 ? text.length : endIdx
    const block = text
      .slice(start, end)
      .split('\n')
      .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l))
      .join('\n')
    updateText(text.slice(0, start) + block + text.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start, start + block.length)
    })
  }
  const insertAtCursor = (snippet) => {
    const el = areaRef.current
    const a = el ? el.selectionStart : text.length
    const b = el ? el.selectionEnd : text.length
    setText((cur) => {
      const before = cur.slice(0, a)
      const pad = before && !before.endsWith('\n') ? '\n' : ''
      const next = before + pad + snippet + '\n' + cur.slice(b)
      pending.current = next
      requestAnimationFrame(() => {
        if (!el) return
        el.focus()
        const pos = (before + pad + snippet + '\n').length
        el.setSelectionRange(pos, pos)
      })
      return next
    })
  }

  // 사진 넣기 (도면에 넣는 사진과 같은 방식: 긴 변 1800px 로 줄여 따로 저장)
  const addImages = async (files) => {
    const list = files.filter(isImageFile)
    if (!list.length) return
    if (!editing) setEditing(true)
    setBusy((n) => n + list.length)
    for (const file of list) {
      try {
        const img = await prepareImage(file)
        const imageId = newImageId()
        rememberImage(imageId, img.blob)
        store.saveImage(docId, imageId, img.blob).catch((e) => {
          console.warn('사진 저장 실패', e)
          onNotice('메모 사진을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 넣어 주세요.')
        })
        insertAtCursor(memoImageMarkdown(imageId))
      } catch (e) {
        console.warn('사진 읽기 실패', e)
        onNotice('이 사진 형식은 열 수 없어요. JPG나 PNG 사진을 넣어 주세요.')
      } finally {
        setBusy((n) => n - 1)
      }
    }
  }

  const color = memo.color ?? '#f59e0b'
  const link = memo.link
  const toolBtn = 'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm text-slate-600 hover:bg-slate-100'

  return (
    <div
      className="absolute top-14 right-3 z-20 flex max-h-[calc(100%-4.25rem)] w-[min(400px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (zoomed) setZoomed(null)
          else onClose()
        }
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((it) => it.kind === 'file')) e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files].filter(isImageFile)
        e.stopPropagation()
        if (!files.length) return
        e.preventDefault()
        addImages(files)
      }}
    >
      {/* 머리: 이름, 보기/쓰기, 닫기 */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2" style={{ borderTop: `3px solid ${color}` }}>
        <input
          value={memo.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 rounded px-1 py-0.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:bg-white focus:outline focus:outline-blue-300"
          aria-label="메모 이름"
        />
        <button
          onClick={() => {
            if (editing) flush()
            setEditing(!editing)
          }}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${editing ? 'bg-slate-800 text-white' : 'text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100'}`}
          title={editing ? '다 썼으면 보기로' : '메모 고치기'}
        >
          {editing ? '보기' : '쓰기'}
        </button>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="닫기 (Esc)">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* 같은 자리에 겹친 메모 */}
      {others.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          <span className="mr-0.5">겹친 메모</span>
          {others.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                flush()
                onSwitch(o.id)
              }}
              title={memoSummary(o)}
              className={`max-w-32 truncate rounded-full px-2 py-0.5 ${o.id === memo.id ? 'bg-slate-800 text-white' : 'bg-white ring-1 ring-slate-200 hover:bg-slate-100'}`}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      {/* 연결된 도면 */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs">
        {link ? (
          <>
            <button
              onClick={() => onOpenLink(link)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-left text-blue-700 hover:bg-blue-100"
              title="연결된 도면을 새 탭으로 열기"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />
              </svg>
              <span className="truncate font-medium">{link.name}</span>
              {link.page > 1 && <span className="shrink-0 text-blue-500">{link.page}쪽</span>}
            </button>
            <button onClick={onPickLink} className="shrink-0 text-slate-500 hover:underline">
              바꾸기
            </button>
          </>
        ) : (
          <button onClick={onPickLink} className="flex items-center gap-1 text-slate-500 hover:text-slate-800" title="이 메모에서 열 수 있는 도면 연결">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
            </svg>
            도면 연결
          </button>
        )}
      </div>

      {editing ? (
        <>
          <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-2 py-1">
            <button className={`${toolBtn} font-bold`} onClick={() => wrap('**')} title="굵게">
              B
            </button>
            <button className={`${toolBtn} italic`} onClick={() => wrap('*')} title="기울임">
              I
            </button>
            <button className={toolBtn} onClick={() => prefixLines('## ')} title="제목">
              제목
            </button>
            <button className={toolBtn} onClick={() => prefixLines('- ')} title="목록">
              • 목록
            </button>
            <button className={toolBtn} onClick={() => prefixLines('- [ ] ')} title="할 일 (체크 상자)">
              ☐ 할 일
            </button>
            <button className={toolBtn} onClick={() => fileRef.current?.click()} title="사진 넣기 (복사한 사진은 Ctrl+V, 끌어다 놓기도 돼요)">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01" />
              </svg>
              <span className="ml-1">사진</span>
            </button>
            {busy > 0 && <span className="ml-1 text-xs text-slate-400">사진 넣는 중…</span>}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addImages([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
          <textarea
            ref={areaRef}
            autoFocus
            value={text}
            onChange={(e) => updateText(e.target.value)}
            onBlur={flush}
            onPaste={(e) => {
              const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
              if (!files.length) return
              e.preventDefault()
              addImages(files)
            }}
            placeholder={'메모를 적어 주세요.\n\n# 제목\n- 목록\n- [ ] 할 일\n**굵게**\n\n사진은 Ctrl+V 로 붙여넣거나 끌어다 놓으세요.'}
            spellCheck={false}
            className="min-h-56 flex-1 resize-none px-3 py-2 font-mono text-[13px] leading-relaxed text-slate-800 outline-none"
          />
          <div className="flex items-center border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
            마크다운으로 적을 수 있어요
            <button onClick={onDelete} className="ml-auto rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50">
              메모 지우기
            </button>
          </div>
        </>
      ) : (
        <div
          className="min-h-24 flex-1 overflow-y-auto px-4 py-3"
          onDoubleClick={(e) => {
            if (e.target.closest('a, input, img')) return
            setEditing(true)
          }}
          onClick={(e) => {
            const img = e.target.closest('img[data-img]')
            if (img) return setZoomed(img.getAttribute('src'))
            if (e.target.matches('input[type="checkbox"]')) {
              e.preventDefault()
              const boxes = [...e.currentTarget.querySelectorAll('input[type="checkbox"]')]
              const next = toggleTask(text, boxes.indexOf(e.target))
              updateText(next)
              flush()
            }
          }}
        >
          {text.trim() ? (
            <div className="memo-md" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <button onClick={() => setEditing(true)} className="w-full py-6 text-center text-sm text-slate-400 hover:text-slate-600">
              아직 내용이 없어요. 눌러서 적어 보세요.
            </button>
          )}
        </div>
      )}

      {zoomed && (
        <div className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/75 p-6" onClick={() => setZoomed(null)}>
          <img src={zoomed} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  )
}
