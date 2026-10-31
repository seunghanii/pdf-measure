import { useEffect, useRef, useState } from 'react'
import { loadPdf } from '../lib/pdf'
import PhotoViewer from './PhotoViewer'

// 렌더 크기: 긴 변 기준 이 정도 픽셀이면 확대해도 글자가 읽힘 (메모리는 4M 픽셀 안쪽)
const MAX_PIXELS = 4_000_000
const LONG_SIDE = 2600

// 관련 도면 미리보기: 사진 크게 보기처럼 그 페이지를 띄우고, "파일 열기" 로 도면 탭을 엶.
// link: { id, name, page, role }, label: 화면에 보일 이름(별명)
export default function DocPreview({ store, link, label, onOpen, onClose }) {
  const [pdf, setPdf] = useState(null)
  const [pages, setPages] = useState(0)
  const [index, setIndex] = useState(Math.max(0, (link.page || 1) - 1))
  const [urls, setUrls] = useState({}) // 쪽 번호(0부터) → 그림 주소
  const [error, setError] = useState('')
  const rendering = useRef(new Set())
  const madeUrls = useRef([])

  // PDF 불러오기
  useEffect(() => {
    let cancelled = false
    let doc = null
    ;(async () => {
      try {
        const blob = await store.getFile(link.id)
        if (!blob) throw new Error('missing')
        doc = await loadPdf(await blob.arrayBuffer())
        if (cancelled) return doc.loadingTask?.destroy()
        setPages(doc.numPages)
        setIndex((i) => Math.min(i, doc.numPages - 1))
        setPdf(doc)
      } catch (e) {
        console.warn(e)
        if (!cancelled)
          setError(e?.code === 'no_file' ? '이 도면의 PDF 파일이 서버에 없어요. 같은 PDF 를 다시 열면 이어져요.' : '도면을 불러오지 못했어요.')
      }
    })()
    return () => {
      cancelled = true
      doc?.loadingTask?.destroy()
    }
  }, [store, link.id])

  useEffect(
    () => () => {
      for (const u of madeUrls.current) URL.revokeObjectURL(u)
    },
    [],
  )

  // 보고 있는 쪽 그리기 (한 번 그린 쪽은 다시 쓰고, 옆 쪽은 미리 그려 둠)
  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    const draw = async (i) => {
      if (i < 0 || i >= pdf.numPages || rendering.current.has(i)) return
      rendering.current.add(i)
      try {
        const page = await pdf.getPage(i + 1)
        const base = page.getViewport({ scale: 1 })
        let scale = LONG_SIDE / Math.max(base.width, base.height)
        scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (base.width * base.height)))
        const vp = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
        canvas.width = canvas.height = 0
        if (!blob) throw new Error('render')
        const url = URL.createObjectURL(blob)
        madeUrls.current.push(url)
        setUrls((u) => ({ ...u, [i]: url }))
      } catch (e) {
        rendering.current.delete(i)
        if (!cancelled) console.warn('미리보기 그리기 실패', e)
      }
    }
    draw(index).then(() => !cancelled && draw(index + 1))
    return () => {
      cancelled = true
    }
  }, [pdf, index])

  const list = Array.from({ length: Math.max(1, pages) }, (_, i) => urls[i] ?? null)
  const name = label || link.name

  return (
    <PhotoViewer
      urls={list}
      index={Math.min(index, list.length - 1)}
      onIndex={setIndex}
      onClose={onClose}
      unit="쪽"
      loadingText={error || '도면 불러오는 중…'}
      title={
        <span>
          {link.role && <span className="mr-1.5 rounded bg-white/20 px-1.5 py-px text-xs font-semibold">{link.role}</span>}
          {name}
          {pages > 0 && <span className="ml-2 text-white/60 tabular-nums">{index + 1} / {pages}쪽</span>}
        </span>
      }
      actions={
        <button
          onClick={() => onOpen({ ...link, page: index + 1 })}
          disabled={!!error}
          title="이 도면을 탭으로 열기"
          className="flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />
          </svg>
          파일 열기
        </button>
      }
    />
  )
}
