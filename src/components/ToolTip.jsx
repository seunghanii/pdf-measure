import { useEffect, useRef, useState } from 'react'

// 아이콘만 있는 단추의 이름표. 단추에 data-tip="이름" 과 data-key="단축키" 를 달면
// - 마우스: 올리고 잠깐(0.25초) 뒤 단추 아래에 바로 뜸 (브라우저 기본 설명은 1초쯤 늦고 단축키가 안 보임)
// - 손가락·펜: 길게 누르면(0.45초) 뜨고, 그때 손을 떼면 단추는 눌리지 않음 (짧게 누르면 그대로 동작)
// 툴바가 좁은 화면에서 옆으로 밀려도 잘리지 않게 화면 기준(fixed)으로 띄움
const HOVER_MS = 250
const PRESS_MS = 450

export default function ToolTips({ rootRef }) {
  const [tip, setTip] = useState(null) // { text, key, x, y }
  const timer = useRef(0)
  const swallowClick = useRef(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const target = (e) => e.target?.closest?.('[data-tip]')
    const show = (el) => {
      if (!el.isConnected) return
      const r = el.getBoundingClientRect()
      // data-tip-side="right": 왼쪽 세로 도구 줄처럼 단추 오른쪽에 띄움
      if (el.dataset.tipSide === 'right') setTip({ text: el.dataset.tip, key: el.dataset.key || '', x: r.right + 8, y: r.top + r.height / 2, side: 'right' })
      else setTip({ text: el.dataset.tip, key: el.dataset.key || '', x: r.left + r.width / 2, y: r.bottom + 6 })
    }
    const hide = () => {
      clearTimeout(timer.current)
      setTip(null)
    }
    const onOver = (e) => {
      if (e.pointerType !== 'mouse') return
      const el = target(e)
      clearTimeout(timer.current)
      if (!el) return setTip(null)
      timer.current = setTimeout(() => show(el), HOVER_MS)
    }
    const onOut = (e) => {
      if (e.pointerType !== 'mouse') return
      const el = target(e)
      if (el && el.contains(e.relatedTarget)) return
      hide()
    }
    const onDown = (e) => {
      if (e.pointerType === 'mouse') return hide()
      const el = target(e)
      clearTimeout(timer.current)
      if (!el) return
      timer.current = setTimeout(() => {
        show(el)
        swallowClick.current = true
      }, PRESS_MS)
    }
    const onUp = (e) => {
      if (e.pointerType === 'mouse') return
      clearTimeout(timer.current)
      if (swallowClick.current) timer.current = setTimeout(() => setTip(null), 1200)
    }
    // 길게 눌러 이름을 본 뒤 손을 떼면 단추를 누른 것으로 치지 않음
    const onClick = (e) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.preventDefault()
      e.stopPropagation()
    }
    const onMenu = (e) => target(e) && e.preventDefault() // 길게 누르기의 기본 메뉴 막기
    root.addEventListener('pointerover', onOver)
    root.addEventListener('pointerout', onOut)
    root.addEventListener('pointerdown', onDown, true)
    root.addEventListener('pointerup', onUp, true)
    root.addEventListener('pointercancel', onUp, true)
    root.addEventListener('click', onClick, true)
    root.addEventListener('contextmenu', onMenu)
    root.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    window.addEventListener('keydown', hide, true)
    return () => {
      clearTimeout(timer.current)
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerout', onOut)
      root.removeEventListener('pointerdown', onDown, true)
      root.removeEventListener('pointerup', onUp, true)
      root.removeEventListener('pointercancel', onUp, true)
      root.removeEventListener('click', onClick, true)
      root.removeEventListener('contextmenu', onMenu)
      root.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      window.removeEventListener('keydown', hide, true)
    }
  }, [rootRef])

  if (!tip) return null
  if (tip.side === 'right')
    return (
      <div
        role="tooltip"
        className="pointer-events-none fixed z-50 max-w-64 -translate-y-1/2 rounded-md bg-ink-800 px-2 py-1 text-xs leading-snug text-surface shadow-lg"
        style={{ left: tip.x, top: tip.y }}
      >
        {tip.text}
        {tip.key && <kbd className="ml-1.5 rounded bg-white/15 px-1 font-sans text-[11px] text-surface/80">{tip.key}</kbd>}
      </div>
    )
  const left = Math.max(8, Math.min(tip.x, window.innerWidth - 8))
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-64 -translate-x-1/2 rounded-md bg-ink-800 px-2 py-1 text-xs leading-snug text-surface shadow-lg"
      style={{ left: Math.max(8 + 64, Math.min(left, window.innerWidth - 8 - 64)), top: tip.y }}
    >
      {tip.text}
      {tip.key && <kbd className="ml-1.5 rounded bg-white/15 px-1 font-sans text-[11px] text-surface/80">{tip.key}</kbd>}
    </div>
  )
}
