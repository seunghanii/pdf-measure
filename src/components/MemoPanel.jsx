import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cachedImageUrl, getImageBlob, isImageFile, newImageId, prepareImage, rememberImage } from '../lib/images'
import { memoSummary, migrateMemo } from '../lib/memo'
import PhotoViewer from './PhotoViewer'

// 메모 사진은 자세히 볼 수 있게 도면 사진보다 크게 저장
const MEMO_PHOTO_SIDE = 2400

// 메모장 크기 (사용자가 끌어서 바꾼 크기, 이 브라우저에 기억)
const SIZE_KEY = 'pdf-measure:memo-size'
const MIN_W = 280
const MIN_H = 200
function loadSize() {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY))
    return s && s.w > 0 ? s : null
  } catch {
    return null
  }
}

// 메모장. 도면 오른쪽 위에 떠 있고, 글을 바로 쓰고 사진을 붙입니다.
// others: 같은 자리에 겹친 메모들 (누르면 그 메모로 바뀜)
export default function MemoPanel({ memo, others, onSwitch, onChange, onClose, onDelete, onOpenLink, onPickLink, store, docId, onNotice }) {
  // 예전(글 속 사진) 메모는 처음 열 때 사진 목록으로 옮김
  const [migrated] = useState(() => migrateMemo(memo))
  const [text, setText] = useState(migrated?.text ?? memo.text ?? '')
  const photos = memo.images ?? migrated?.images ?? []
  const [, setLoaded] = useState(0)
  const [viewing, setViewing] = useState(null) // 크게 보는 사진 번호
  const [busy, setBusy] = useState(0) // 사진 넣는 중
  const [size, setSize] = useState(loadSize) // { w, h } px, 없으면 기본 크기
  const panelRef = useRef(null)
  const areaRef = useRef(null)
  const fileRef = useRef(null)
  const pending = useRef(null) // 아직 저장 안 된 글

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
    if (migrated) onChangeRef.current(migrated)
    return () => flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (pending.current === null) return
    const t = setTimeout(flush, 400)
    return () => clearTimeout(t)
  }, [text])

  // 글 상자 높이를 글에 맞춤
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(96, el.scrollHeight)}px`
  }, [text, size])

  // 사진 불러오기
  const photoKey = photos.join()
  useEffect(() => {
    const source = { store, docId }
    for (const id of photos) if (!cachedImageUrl(id)) getImageBlob(source, id).then(() => setLoaded((n) => n + 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey, store, docId])

  // 사진 넣기 (도면 사진과 같은 방식으로 줄여서 따로 저장)
  const addImages = async (files) => {
    const list = files.filter(isImageFile)
    if (!list.length) return
    setBusy((n) => n + list.length)
    const added = []
    for (const file of list) {
      try {
        const img = await prepareImage(file, { maxSide: MEMO_PHOTO_SIDE })
        const imageId = newImageId()
        rememberImage(imageId, img.blob)
        store.saveImage(docId, imageId, img.blob).catch((e) => {
          console.warn('사진 저장 실패', e)
          onNotice('메모 사진을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 넣어 주세요.')
        })
        added.push(imageId)
      } catch (e) {
        console.warn('사진 읽기 실패', e)
        onNotice('이 사진 형식은 열 수 없어요. JPG나 PNG 사진을 넣어 주세요.')
      } finally {
        setBusy((n) => n - 1)
      }
    }
    if (added.length) {
      flush()
      onChange({ images: [...photos, ...added] })
    }
  }

  const removePhoto = (id) => {
    flush()
    onChange({ images: photos.filter((x) => x !== id) })
  }

  // 왼쪽 변·아래 변·왼쪽 아래 모서리를 끌어 크기 조절 (메모장은 오른쪽 위에 붙어 있음)
  const startResize = (e, dir) => {
    e.preventDefault()
    const el = panelRef.current
    const parent = el?.parentElement
    if (!el || !parent) return
    const r = el.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }
    const maxW = pr.width - 24
    const maxH = pr.bottom - r.top - 12
    let next = { w: r.width, h: r.height }
    const move = (ev) => {
      next = {
        w: dir.includes('w') ? Math.min(maxW, Math.max(MIN_W, start.w + (start.x - ev.clientX))) : start.w,
        h: dir.includes('s') ? Math.min(maxH, Math.max(MIN_H, start.h + (ev.clientY - start.y))) : start.h,
      }
      setSize(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ w: Math.round(next.w), h: Math.round(next.h) }))
      } catch {
        // 저장 못 해도 이번에는 그 크기로 보임
      }
    }
    document.body.style.cursor = dir === 'sw' ? 'nesw-resize' : dir === 'w' ? 'ew-resize' : 'ns-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const color = memo.color ?? '#f59e0b'
  const link = memo.link
  const urls = photos.map((id) => cachedImageUrl(id))

  return (
    <div
      ref={panelRef}
      style={size ? { width: size.w, height: size.h } : undefined}
      className={`absolute top-14 right-3 z-20 flex max-h-[calc(100%-4.25rem)] max-w-[calc(100%-1.5rem)] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ${size ? '' : 'w-[400px]'}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
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
      {/* 머리: 이름, 닫기 */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2" style={{ borderTop: `3px solid ${color}` }}>
        <input
          value={memo.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 rounded px-1 py-0.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:bg-white focus:outline focus:outline-blue-300"
          aria-label="메모 이름"
        />
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

      {/* 글과 사진 (같이 스크롤) */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <textarea
          ref={areaRef}
          autoFocus={!text && !photos.length}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            pending.current = e.target.value
          }}
          onBlur={flush}
          onPaste={(e) => {
            const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
            if (!files.length) return
            e.preventDefault()
            addImages(files)
          }}
          placeholder="메모를 적어 주세요. 사진은 Ctrl+V 로 붙여넣거나 끌어다 놓아도 돼요."
          spellCheck={false}
          rows={4}
          className="block w-full resize-none overflow-hidden px-4 py-3 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
        />
        {(photos.length > 0 || busy > 0) && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 px-3 pb-3">
            {photos.map((id, i) => (
              <div key={id} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                {urls[i] ? (
                  <img src={urls[i]} alt={`사진 ${i + 1}`} onClick={() => setViewing(i)} className="h-full w-full cursor-zoom-in object-cover transition hover:opacity-90" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">불러오는 중…</div>
                )}
                <button
                  title="이 사진 빼기"
                  onClick={() => removePhoto(id)}
                  className="absolute top-1 right-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm text-white group-hover:flex hover:bg-black/80"
                >
                  ×
                </button>
              </div>
            ))}
            {busy > 0 && <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">사진 넣는 중…</div>}
          </div>
        )}
      </div>

      {/* 아래: 사진 넣기, 지우기 */}
      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100"
          title="사진 넣기 (복사한 사진은 Ctrl+V, 끌어다 놓기도 돼요)"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01" />
          </svg>
          사진 넣기
        </button>
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
        <button onClick={onDelete} className="ml-auto rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50">
          메모 지우기
        </button>
      </div>

      {/* 크기 조절 손잡이: 왼쪽 변, 아래 변, 왼쪽 아래 모서리 */}
      <div onPointerDown={(e) => startResize(e, 'w')} className="absolute top-0 bottom-3 left-0 w-1.5 cursor-ew-resize" title="끌어서 너비 조절" />
      <div onPointerDown={(e) => startResize(e, 's')} className="absolute right-0 bottom-0 left-3 h-1.5 cursor-ns-resize" title="끌어서 높이 조절" />
      <div onPointerDown={(e) => startResize(e, 'sw')} className="absolute bottom-0 left-0 h-4 w-4 cursor-nesw-resize" title="끌어서 크기 조절">
        <svg viewBox="0 0 16 16" className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 7l6 6M3 11l2 2" />
        </svg>
      </div>

      {viewing !== null && <PhotoViewer key={viewing} urls={urls} index={Math.min(viewing, urls.length - 1)} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
