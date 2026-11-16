import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { stashPage, takePage } from '../lib/pageCache'
import { renderInWorker } from '../lib/pageRender'

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

  // 없어질 때(탭 전환 등) 그려 둔 밑그림을 맡겨 둠. 돌아오면 pdf.js 로 다시 그리지 않고 바로 씀
  const propsRef = useRef({ pdfDoc, page })
  useLayoutEffect(() => {
    propsRef.current = { pdfDoc, page }
  })
  useEffect(() => {
    const c = canvasRef.current // 없어질 때는 ref 가 먼저 비므로 미리 잡아 둠
    return () => {
      if (baseScaleRef.current) stashPage(propsRef.current.pdfDoc, propsRef.current.page, baseScaleRef.current, c)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const detail = detailRef.current
    detail.style.display = 'none' // 이전 배율의 상세 그림은 위치가 맞지 않음
    if (!visible) {
      // 그려 둔 밑그림은 맡겨 두고(다시 보이면 바로 씀) 화면 캔버스는 비움
      if (baseScaleRef.current) stashPage(pdfDoc, page, baseScaleRef.current, canvas)
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
    // 같은 배율로 그려 맡겨 둔 밑그림이 있으면 기다리지 않고 바로 씀 (탭 전환, 다시 스크롤해 온 페이지)
    const kept = !reuseBase && takePage(pdfDoc, page, baseScale)
    if (kept) {
      canvas.width = kept.width
      canvas.height = kept.height
      canvas.getContext('2d').drawImage(kept, 0, 0)
      kept.width = kept.height = 0
      baseScaleRef.current = baseScale
      if (!capped) {
        canvas.style.width = `${canvas.width / dpr}px`
        canvas.style.height = `${canvas.height / dpr}px`
      }
    }
    const timer = setTimeout(async () => {
      if (kept) return capped && scheduleDetail(0)
      if (reuseBase) return scheduleDetail(0)
      const pdfPage = await pdfPagePromise
      if (cancelled) return
      const scale = baseScale
      const viewport = pdfPage.getViewport({ scale })
      const bw = Math.floor(viewport.width)
      const bh = Math.floor(viewport.height)
      setRendering(true)
      // 워커가 준비돼 있으면 화면 밖에서 그린 그림을 받아 붙이기만 함 (lib/pageRender.js). 아니면 예전처럼 여기서 그림
      const job = renderInWorker(pdfDoc, { page, scale, w: bw, h: bh })
      let off = null
      const drawHere = () => {
        off = document.createElement('canvas')
        off.width = bw
        off.height = bh
        task = pdfPage.render({ canvas: off, canvasContext: off.getContext('2d'), viewport })
        return task.promise
      }
      let done
      if (job) {
        task = { cancel: job.cancel }
        // 워커가 이 페이지를 못 그리면 여기서 그림
        done = job.promise.catch((e) => {
          if (cancelled) throw e
          console.warn('워커 그리기 실패, 화면 쪽에서 그림', e)
          return drawHere()
        })
      } else done = drawHere()
      done
        .then((bitmap) => {
          if (cancelled) return bitmap?.close?.()
          // 다 그린 뒤 한 번에 교체해서 깜빡임 방지
          canvas.width = bw
          canvas.height = bh
          canvas.getContext('2d').drawImage(off ?? bitmap, 0, 0)
          if (off) off.width = off.height = 0 // 임시 캔버스 메모리 바로 비움 (크기는 아래에서 canvas 기준으로)
          else bitmap.close()
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
      const job = renderInWorker(pdfDoc, { page, scale: fullScale, left: x0 * dpr, top: y0 * dpr, w: pw, h: ph })
      let off = null
      const myTask = (detailTask = { cancel: () => {} })
      const drawHere = () => {
        off = document.createElement('canvas')
        off.width = pw
        off.height = ph
        const t = pdfPage.render({
          canvas: off,
          canvasContext: off.getContext('2d'),
          viewport,
          transform: [1, 0, 0, 1, -x0 * dpr, -y0 * dpr],
        })
        myTask.cancel = () => t.cancel()
        return t.promise
      }
      let done
      if (job) {
        myTask.cancel = job.cancel
        done = job.promise.catch((e) => {
          if (cancelled || detailTask !== myTask) throw e
          return drawHere()
        })
      } else done = drawHere()
      done
        .then((bitmap) => {
          if (cancelled || detailTask !== myTask) return bitmap?.close?.()
          detail.width = pw
          detail.height = ph
          detail.getContext('2d').drawImage(off ?? bitmap, 0, 0)
          if (off) off.width = off.height = 0
          else bitmap.close()
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
