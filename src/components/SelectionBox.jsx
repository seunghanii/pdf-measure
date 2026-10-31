import { memo, useRef } from 'react'
import { itemCorners, strokeOf } from '../lib/markup'

// 선택 표시: 고른 항목마다 파란 테두리 상자, 그리고 상자 오른쪽 위에 × (누르면 이 페이지에서 고른 것 삭제).
// 화면 픽셀로 그려서 확대 배율과 상관없이 선 굵기와 버튼 크기가 같습니다.
const BLUE = 'var(--color-brand-600)'
const RED = 'var(--color-danger-600)'
const BTN_R = 11 // 보이는 × 단추 반지름(px)
const HIT_R = 16 // 손가락으로도 누르기 쉽게 잡히는 반지름(px)
const OFFSET = 20 // 상자 모서리에서 바깥으로 띄운 거리: 모서리 크기 손잡이와 겹치지 않게
const RESIZABLE = new Set(['highlight', 'rect', 'memo', 'text', 'image'])

// 항목을 감싸는 화면 좌표 사각형. 크기 손잡이가 있는 도형은 손잡이가 테두리 위에 오도록 살짝만 띄움
function boxOf(m, zoom) {
  const pts = itemCorners(m)
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const p of pts) {
    if (p.x < x1) x1 = p.x
    if (p.y < y1) y1 = p.y
    if (p.x > x2) x2 = p.x
    if (p.y > y2) y2 = p.y
  }
  const half = m.type === 'rect' || m.type === 'pen' || m.type === 'arrow' ? Math.max(0.75, strokeOf(m) * zoom) / 2 : 1.5
  const g = half + (RESIZABLE.has(m.type) ? 3 : 8)
  return { x: x1 * zoom - g, y: y1 * zoom - g, w: (x2 - x1) * zoom + g * 2, h: (y2 - y1) * zoom + g * 2 }
}

// 여러 개를 골랐을 때 모두를 감싸는 점선 상자(화면 픽셀). 이 안을 잡아 끌면 고른 것 전부가 함께 움직입니다.
// 한 페이지에 고른 항목이 2개 미만이면 null
export function groupBox(items, selectedIds, zoom, editingId) {
  if (!items || selectedIds.length < 2) return null
  const picked = items.filter((m) => m.id !== editingId && selectedIds.includes(m.id) && m.points?.length)
  if (picked.length < 2) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const m of picked) {
    const b = boxOf(m, zoom)
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.w)
    y2 = Math.max(y2, b.y + b.h)
  }
  return { x: x1 - 4, y: y1 - 4, w: x2 - x1 + 8, h: y2 - y1 + 8 }
}

const SelectionBox = memo(function SelectionBox({ items, selectedIds, zoom, width, height, editingId, canDelete, onDelete, isPinching }) {
  const downRef = useRef(null)
  if (!items || !selectedIds.length) return null
  const picked = items.filter((m) => m.id !== editingId && selectedIds.includes(m.id) && m.points?.length)
  if (!picked.length) return null
  const boxes = picked.map((m) => boxOf(m, zoom))

  // 여러 개를 골랐으면 모두를 감싸는 상자의 오른쪽 위에 × 하나
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  for (const b of boxes) {
    left = Math.min(left, b.x)
    top = Math.min(top, b.y)
    right = Math.max(right, b.x + b.w)
  }
  const deletable = canDelete && picked.some((m) => m.id !== 'calibration')
  // 페이지 밖으로 나가 잘리지 않게
  const cx = Math.min(Math.max(right + OFFSET, BTN_R + 2), width - BTN_R - 2)
  const cy = Math.max(Math.min(top - OFFSET, height - BTN_R - 2), BTN_R + 2)
  const ids = picked.map((m) => m.id)

  return (
    <g pointerEvents="none">
      {boxes.map((b, i) => (
        <g key={picked[i].id}>
          {/* 흰 테두리를 먼저 깔아 어두운 도면 위에서도 잘 보이게 */}
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill={BLUE} fillOpacity={0.05} stroke="white" strokeWidth={4} />
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill="none" stroke={BLUE} strokeWidth={1.5} />
        </g>
      ))}
      {picked.length > 1 && (
        // 안쪽 빈 곳에서도 '옮기기' 커서가 보이게 (실제 잡기는 PdfViewer 가 좌표로 판단)
        <rect x={left - 4} y={top - 4} width={right - left + 8} height={Math.max(...boxes.map((b) => b.y + b.h)) - top + 8} rx={3} fill="transparent" stroke={BLUE} strokeWidth={1} strokeDasharray="5 3" pointerEvents="all" style={{ cursor: 'move' }} />
      )}
      {deletable && (
        <g
          data-delete=""
          pointerEvents="auto"
          role="button"
          aria-label="선택한 항목 삭제"
          style={{ cursor: 'pointer' }}
          // 도면 쪽 동작(끌기·상자 선택)이 시작되지 않게 여기서 멈춤. 실제 삭제는 같은 자리에서 뗄 때
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            e.preventDefault()
            downRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
          }}
          onPointerUp={(e) => {
            const d = downRef.current
            downRef.current = null
            if (!d || d.id !== e.pointerId) return
            e.stopPropagation()
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || isPinching?.(e.pointerId)) return
            onDelete(ids)
          }}
          onPointerCancel={() => (downRef.current = null)}
        >
          <title>삭제 (Delete)</title>
          <circle cx={cx} cy={cy} r={HIT_R} fill="transparent" />
          <circle cx={cx} cy={cy} r={BTN_R + 2} fill="white" />
          <circle className="selection-delete" cx={cx} cy={cy} r={BTN_R} fill={RED} />
          <path d={`M${cx - 4} ${cy - 4}L${cx + 4} ${cy + 4}M${cx + 4} ${cy - 4}L${cx - 4} ${cy + 4}`} stroke="white" strokeWidth={2} strokeLinecap="round" />
        </g>
      )}
    </g>
  )
})

export default SelectionBox
