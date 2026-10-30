import { memo, useEffect, useRef, useState } from 'react'

const MAX_CANVAS_PIXELS = 16_000_000 // 모바일 사파리 캔버스 한도 근처
// 크게 확대해서 상세 캔버스가 덮을 때 밑그림 해상도. 낮을수록 확대·축소할 때 덜 버벅임
const BASE_PIXELS_WHEN_DETAILED = 4_000_000

// 페이지 한 장의 캔버스. 화면 근처에 있을 때만 그리고, 멀어지면 메모리를 비웁니다.
// 크게 확대하면 페이지 전체를 선명하게 그릴 캔버스가 너무 커지므로, 전체는 낮은 해상도로 깔고
// 화면에 보이는 부분만 원래 해상도로 한 번 더 그려 위에 덮습니다(상세 캔버스).
// 배율 등 값이 그대로면 다시 그리지 않음 (스크롤·커서 이동 때 부모가 다시 그려도)
const PageCanvas = memo(function PageCanvas({ pdfDoc, page, size, zoom, visible, scrollRoot }) {
  const canvasRef = useRef(null)
  const detailRef = useRef(null)
  const baseScaleRef = useRef(0) // 지금 밑그림 캔버스에 그려진 배율 (0 = 비어 있음)
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const detail = detailRef.current
    detail.style.display = 'none' // 이전 배율의 상세 그림은 위치가 맞지 않음
    if (!visible) {
      canvas.width = 0
      canvas.height = 0
      detail.width = 0
      detail.height = 0
      baseScaleRef.current = 0
      return
    }
    let task = null
    let detailTask = null
    let detailTimer = null
    let detailArea = null // 지금 상세 캔버스가 덮고 있는 영역(CSS px)
    let cancelled = false
    const dpr = window.devicePixelRatio || 1
    const fullScale = zoom * dpr
    const fullPixels = size.width * size.height * fullScale * fullScale
    const capped = fullPixels > MAX_CANVAS_PIXELS
    const pdfPagePromise = pdfDoc.getPage(page)

    // 상세 캔버스가 덮을 만큼 크면 밑그림은 낮은 해상도로 한 번만 (배율이 바뀌어도 늘려서 씀)
    const baseScale = capped ? fullScale * Math.sqrt(BASE_PIXELS_WHEN_DETAILED / fullPixels) : fullScale
    const reuseBase = capped && Math.abs(baseScaleRef.current - baseScale) < 1e-6
    const timer = setTimeout(async () => {
      if (reuseBase) return scheduleDetail(0)
      const pdfPage = await pdfPagePromise
      if (cancelled) return
      const scale = baseScale
      const viewport = pdfPage.getViewport({ scale })
      const off = document.createElement('canvas')
      off.width = Math.floor(viewport.width)
      off.height = Math.floor(viewport.height)
      setRendering(true)
      task = pdfPage.render({ canvas: off, canvasContext: off.getContext('2d'), viewport })
      task.promise
        .then(() => {
          // 다 그린 뒤 한 번에 교체해서 깜빡임 방지
          canvas.width = off.width
          canvas.height = off.height
          canvas.getContext('2d').drawImage(off, 0, 0)
          off.width = off.height = 0 // 임시 캔버스 메모리 바로 비움 (크기는 아래에서 canvas 기준으로)
          baseScaleRef.current = scale
          // 캔버스 픽셀과 화면 픽셀을 1:1 로 맞춰서 브라우저가 다시 늘리며 흐려지지 않게
          if (!capped) {
            canvas.style.width = `${canvas.width / dpr}px`
            canvas.style.height = `${canvas.height / dpr}px`
          }
          setRendering(false)
          if (capped) scheduleDetail(0)
        })
        .catch(() => {})
    }, 120)

    // 화면에 보이는 부분(+ 여유)을 원래 해상도로 그립니다.
    const renderDetail = async () => {
      const root = scrollRoot.current
      const pageEl = canvas.parentElement
      if (!root || !pageEl || cancelled) return
      const rr = root.getBoundingClientRect()
      const pr = pageEl.getBoundingClientRect()
      const w = size.width * zoom
      const h = size.height * zoom
      // 보이는 영역을 페이지 좌표(CSS px)로
      const vx0 = Math.max(0, rr.left - pr.left)
      const vy0 = Math.max(0, rr.top - pr.top)
      const vx1 = Math.min(w, rr.right - pr.left)
      const vy1 = Math.min(h, rr.bottom - pr.top)
      if (vx1 <= vx0 || vy1 <= vy0) return
      // 이미 덮고 있으면 다시 그릴 필요 없음
      const a = detailArea
      if (a && vx0 >= a.x0 && vy0 >= a.y0 && vx1 <= a.x1 && vy1 <= a.y1) return
      // 스크롤해도 바로 다시 그리지 않도록 사방으로 여유를 두되, 캔버스 한도는 넘지 않게
      let mx = (vx1 - vx0) * 0.5
      let my = (vy1 - vy0) * 0.5
      const area = (vx1 - vx0 + 2 * mx) * (vy1 - vy0 + 2 * my) * dpr * dpr
      if (area > MAX_CANVAS_PIXELS) {
        const k = Math.sqrt(MAX_CANVAS_PIXELS / area)
        const cw = (vx1 - vx0 + 2 * mx) * k
        const ch = (vy1 - vy0 + 2 * my) * k
        mx = Math.max(0, (cw - (vx1 - vx0)) / 2)
        my = Math.max(0, (ch - (vy1 - vy0)) / 2)
      }
      const x0 = Math.floor(Math.max(0, vx0 - mx) * dpr) / dpr
      const y0 = Math.floor(Math.max(0, vy0 - my) * dpr) / dpr
      const x1 = Math.min(w, vx1 + mx)
      const y1 = Math.min(h, vy1 + my)
      const pw = Math.ceil((x1 - x0) * dpr)
      const ph = Math.ceil((y1 - y0) * dpr)
      if (pw * ph > MAX_CANVAS_PIXELS * 1.05) return // 화면 자체가 너무 큰 경우

      const pdfPage = await pdfPagePromise
      if (cancelled) return
      if (detailTask) detailTask.cancel()
      const viewport = pdfPage.getViewport({ scale: fullScale })
      const off = document.createElement('canvas')
      off.width = pw
      off.height = ph
      detailTask = pdfPage.render({
        canvas: off,
        canvasContext: off.getContext('2d'),
        viewport,
        transform: [1, 0, 0, 1, -x0 * dpr, -y0 * dpr],
      })
      const myTask = detailTask
      myTask.promise
        .then(() => {
          if (cancelled) return
          detail.width = pw
          detail.height = ph
          detail.getContext('2d').drawImage(off, 0, 0)
          off.width = off.height = 0
          detail.style.left = `${x0}px`
          detail.style.top = `${y0}px`
          detail.style.width = `${pw / dpr}px`
          detail.style.height = `${ph / dpr}px`
          detail.style.display = 'block'
          detailArea = { x0, y0, x1: x0 + pw / dpr, y1: y0 + ph / dpr }
        })
        .catch(() => {})
    }
    const scheduleDetail = (delay = 150) => {
      clearTimeout(detailTimer)
      detailTimer = setTimeout(renderDetail, delay)
    }
    const root = scrollRoot.current
    const onScroll = () => scheduleDetail()
    // 창 크기뿐 아니라 오른쪽 목록을 접고 펼 때도 보이는 칸이 바뀌므로 스크롤 영역 크기를 지켜봄
    let ro = null
    if (capped && root) {
      root.addEventListener('scroll', onScroll, { passive: true })
      let first = true // 지켜보기 시작할 때 한 번 오는 알림은 건너뜀 (첫 그리기는 위에서 함)
      ro = new ResizeObserver(() => {
        if (first) first = false
        else onScroll()
      })
      ro.observe(root)
    }

    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(detailTimer)
      if (task) task.cancel()
      if (detailTask) detailTask.cancel()
      if (capped && root) {
        root.removeEventListener('scroll', onScroll)
        ro.disconnect()
      }
    }
  }, [pdfDoc, page, size, zoom, visible, scrollRoot])

  return (
    <>
      <canvas ref={canvasRef} className="absolute top-0 left-0" style={{ width: size.width * zoom, height: size.height * zoom }} />
      <canvas ref={detailRef} className="pointer-events-none absolute" style={{ display: 'none' }} />
      {visible && rendering && (
        <div className="pointer-events-none absolute top-2 right-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
          그리는 중…
        </div>
      )}
    </>
  )
})

export default PageCanvas
