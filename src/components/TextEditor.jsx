import { useEffect, useRef } from 'react'
import { FONT_FAMILY, textBoxMetrics } from '../lib/markup'

// 도면 위 텍스트 상자 입력창. Enter 로 완료, Shift+Enter 로 줄바꿈, Esc 로 취소.
export default function TextEditor({ editing, zoom, onChange, onCommit, onCancel }) {
  const ref = useRef(null)
  const openedAt = useRef(0)
  useEffect(() => {
    openedAt.current = performance.now()
    const t = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const size = editing.fontSize
  const box = textBoxMetrics(editing.text || '텍스트 입력', size, editing.boxWidth)
  return (
    <textarea
      ref={ref}
      value={editing.text}
      placeholder="텍스트 입력"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onCommit()
        }
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        if (performance.now() - openedAt.current > 150) onCommit()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
      className="absolute z-10 resize-none overflow-hidden rounded-sm border border-dashed bg-white/95 outline-none"
      style={{
        left: editing.point.x * zoom,
        top: editing.point.y * zoom,
        // 너비를 정한 상자는 그 너비 그대로 (글자가 넘치면 줄바꿈), 아니면 글자에 맞춰 늘어남
        width: editing.boxWidth ? box.width * zoom : Math.max(box.width * zoom + 8, 80),
        textAlign: editing.align ?? 'left',
        whiteSpace: editing.boxWidth ? 'pre-wrap' : 'pre',
        wordBreak: 'keep-all', // 화면 표시와 같게 낱말 단위로 줄바꿈
        overflowWrap: 'anywhere',
        height: box.height * zoom + 2,
        fontSize: size * zoom,
        lineHeight: 1.3,
        padding: `${box.pad * zoom}px`,
        color: editing.color,
        borderColor: editing.color,
        fontFamily: FONT_FAMILY,
      }}
    />
  )
}
