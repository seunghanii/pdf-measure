import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useDocIndex } from '../lib/indexer'
import { noteItems } from '../lib/notes'
import { searchIndex, searchNotes } from '../lib/textIndex'
import { Highlighted, HitBadge, IndexerStatusLine, SearchIcon } from './SearchPanel'

const MAX_SHOWN = 40
const PREVIEW_W = 256
const PREVIEW_H = 96

// 도면 안 검색 창 (오른쪽 목록 맨 위). 찾은 곳마다 작은 미리보기, 누르면 그 위치로 이동
// 직접 넣은 글(텍스트 상자, 메모)은 도면 글자보다 먼저, 미리보기 없이 한 줄로 나옴
const DocSearch = forwardRef(function DocSearch({ doc, measurements, onGo }, inputRef) {
  const index = useDocIndex(doc.store, doc.id)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(-1)
  const searching = !!query.trim()
  const notes = useMemo(() => (searching ? noteItems(measurements) : null), [searching, measurements])
  const hits = useMemo(
    () => [...searchNotes(notes, query, 1000), ...searchIndex(index, query, 1000)],
    [notes, index, query],
  )
  const shown = hits.slice(0, MAX_SHOWN)

  const go = (i) => {
    if (!hits.length) return
    const n = (i + hits.length) % hits.length
    setCurrent(n)
    onGo(hits[n])
  }

  return (
    <section className="border-b border-ink-200 p-4">
      <div className="flex items-center gap-2 rounded-lg border border-ink-300 px-2.5 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <SearchIcon className="h-4 w-4 shrink-0 text-ink-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCurrent(-1)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              go(e.shiftKey ? current - 1 : current + 1)
            }
            if (e.key === 'Escape') {
              setQuery('')
              e.currentTarget.blur()
            }
          }}
          placeholder="도면에서 찾기 (태그, 실 이름…)"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
        />
        {query && (
          <span className="shrink-0 text-xs text-ink-400">
            {current >= 0 ? `${current + 1}/${hits.length}` : `${hits.length}곳`}
          </span>
        )}
      </div>

      <div className="mt-1.5">
        <IndexerStatusLine onlyId={doc.id} />
        {!index && !query && (
          <p className="text-xs text-ink-400">직접 넣은 글은 바로, 도면 글자는 다 읽은 뒤에 찾을 수 있어요.</p>
        )}
      </div>

      {query.trim() && (index || hits.length > 0) && (
        <div className="mt-2 max-h-80 space-y-1.5 overflow-auto">
          {!hits.length && <p className="py-2 text-center text-xs text-ink-400">찾는 글자가 없어요.</p>}
          {shown.map((hit, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              className={`block w-full overflow-hidden rounded-lg border text-left transition ${
                i === current ? 'border-brand-500 ring-2 ring-brand-100' : 'border-ink-200 hover:border-brand-300'
              }`}
            >
              {!hit.note && <HitPreview pdfDoc={doc.pdfDoc} hit={hit} />}
              <div className="flex items-center gap-2 px-2 py-1 text-xs">
                <span className="shrink-0 text-ink-400">{hit.page}쪽</span>
                <span className="min-w-0 flex-1 truncate">
                  <Highlighted text={hit.text} query={query} />
                </span>
                <HitBadge hit={hit} />
              </div>
            </button>
          ))}
          {hits.length > MAX_SHOWN && (
            <p className="py-1 text-center text-xs text-ink-400">
              외 {hits.length - MAX_SHOWN}곳 · Enter 로 차례로 이동할 수 있어요
            </p>
          )}
        </div>
      )}
    </section>
  )
})

export default DocSearch

// 찾은 곳 주변을 작게 그린 미리보기 (화면에 보일 때만 그림)
function HitPreview({ pdfDoc, hit }) {
  const canvasRef = useRef(null)
  const boxRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [frame, setFrame] = useState(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let task = null
    let cancelled = false
    ;(async () => {
      const page = await pdfDoc.getPage(hit.page)
      if (cancelled) return
      const { x, y, w, h } = hit.rect
      // 글자 높이가 약 18px 이 되게, 단 글자 덩어리가 칸에 들어오게
      const scale = Math.max(0.05, Math.min(18 / Math.max(h, 0.5), (PREVIEW_W * 0.8) / Math.max(w, 1), 12))
      const cx = (x + w / 2) * scale
      const cy = (y + h / 2) * scale
      const left = cx - PREVIEW_W / 2
      const top = cy - PREVIEW_H / 2
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current
      canvas.width = PREVIEW_W * dpr
      canvas.height = PREVIEW_H * dpr
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      task = page.render({
        canvasContext: ctx,
        canvas,
        viewport: page.getViewport({ scale: scale * dpr }),
        transform: [1, 0, 0, 1, -left * dpr, -top * dpr],
      })
      await task.promise.catch(() => {})
      if (!cancelled) setFrame({ x: x * scale - left, y: y * scale - top, w: w * scale, h: h * scale })
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, pdfDoc, hit])

  return (
    <div ref={boxRef} className="relative bg-ink-50" style={{ height: PREVIEW_H }}>
      <canvas ref={canvasRef} className="absolute top-0 left-1/2 -translate-x-1/2" style={{ width: PREVIEW_W, height: PREVIEW_H }} />
      {frame && (
        <div
          className="pointer-events-none absolute left-1/2 rounded-sm border-2 border-warn-500 bg-warn-300/25"
          style={{
            top: frame.y - 3,
            height: frame.h + 6,
            width: frame.w + 6,
            marginLeft: frame.x - PREVIEW_W / 2 - 3,
          }}
        />
      )}
    </div>
  )
}
