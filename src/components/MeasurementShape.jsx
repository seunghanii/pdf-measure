import { angleArcPath, distance, polygonCentroid } from '../lib/geometry'
import { formatLength } from '../lib/units'
import { TYPE_INFO, describe } from '../lib/measure'
import { DEFAULT_BOX_OPACITY, FONT_FAMILY, MARKUP_STROKE, isMarkup, rectOf, textBoxMetrics } from '../lib/markup'

function Label({ x, y, text, sub, color }) {
  return (
    <g pointerEvents="none">
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="13"
        fontWeight="700"
        fill={color}
        stroke="white"
        strokeWidth="4"
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        {text}
      </text>
      {sub && (
        <text
          x={x}
          y={y + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          fill={color}
          stroke="white"
          strokeWidth="3.5"
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {sub}
        </text>
      )}
    </g>
  )
}

function SmallLabel({ x, y, text, color }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize="10.5"
      fill={color}
      stroke="white"
      strokeWidth="3"
      paintOrder="stroke"
      strokeLinejoin="round"
      pointerEvents="none"
    >
      {text}
    </text>
  )
}

// 선 방향에 수직으로 살짝 띄운 라벨 위치
function offsetLabel(a, b, dist = 14) {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  let nx = -(b.y - a.y) / len
  let ny = (b.x - a.x) / len
  if (ny > 0) {
    nx = -nx
    ny = -ny
  }
  return { x: mx + nx * dist, y: my + ny * dist }
}

export default function MeasurementShape({ m, zoom, mmPerPt, unit, selected, showHandles, draft, closeHint, endHint }) {
  if (isMarkup(m.type)) return <MarkupShape m={m} zoom={zoom} selected={selected} showHandles={showHandles} draft={draft} />
  const color = TYPE_INFO[m.type].color
  const pts = m.points.map((p) => ({ x: p.x * zoom, y: p.y * zoom }))
  const strokeWidth = selected ? 3 : 2
  const dash = draft ? '6 4' : undefined
  const common = { stroke: color, strokeWidth, strokeDasharray: dash, strokeLinecap: 'round', strokeLinejoin: 'round' }

  let body = null
  let label = null
  const info = draft && m.type === 'calibrate' ? { main: '' } : m.type === 'calibrate' ? { main: m.label } : describe(m, mmPerPt, unit)

  if (m.type === 'length' && pts.length > 2) {
    // 여러 구간: 구간마다 작은 길이, 마지막 점 옆에 총 길이
    const last = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    body = (
      <>
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" {...common} />
        <EndTick p={pts[0]} q={pts[1]} color={color} />
        <EndTick p={last} q={prev} color={color} />
      </>
    )
    const segLabels = mmPerPt
      ? pts.slice(1).map((b, i) => {
          const a = pts[i]
          const lp = offsetLabel(a, b, 10)
          return (
            <SmallLabel key={i} {...lp} color={color} text={formatLength(distance(m.points[i], m.points[i + 1]), mmPerPt, unit)} />
          )
        })
      : null
    const dx = last.x - prev.x
    const dy = last.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    label = (
      <>
        {segLabels}
        <Label x={last.x + (dx / len) * 18} y={last.y + (dy / len) * 18 - 4} text={info.main ? `총 ${info.main}` : ''} color={color} />
      </>
    )
  } else if (m.type === 'length' || m.type === 'calibrate') {
    const [a, b] = pts
    if (b) {
      body = (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
          <EndTick p={a} q={b} color={color} />
          <EndTick p={b} q={a} color={color} />
        </>
      )
      const lp = offsetLabel(a, b)
      if (info.main) label = <Label {...lp} text={info.main} color={color} />
    }
  } else if (m.type === 'area') {
    const d = pts.map((p) => `${p.x},${p.y}`).join(' ')
    const closed = !draft || closeHint
    body =
      pts.length >= 3 && closed ? (
        <polygon points={d} fill={color} fillOpacity={selected ? 0.25 : 0.15} {...common} />
      ) : (
        <>
          {pts.length >= 3 && <polygon points={d} fill={color} fillOpacity={0.08} stroke="none" />}
          <polyline points={d} fill="none" {...common} />
        </>
      )
    if (pts.length >= 3) {
      const c = polygonCentroid(pts)
      label = <Label x={c.x} y={c.y} text={info.main} sub={info.sub} color={color} />
    }
  } else if (m.type === 'angle') {
    const [a, v, b] = pts
    if (v) {
      body = <polyline points={[a, v, b].filter(Boolean).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" {...common} />
      if (b) {
        const r = Math.min(30, Math.hypot(a.x - v.x, a.y - v.y) * 0.6, Math.hypot(b.x - v.x, b.y - v.y) * 0.6)
        const arc = angleArcPath(a, v, b, Math.max(r, 8))
        const lr = Math.max(r, 8) + 22
        body = (
          <>
            {body}
            <path d={arc.d} fill="none" stroke={color} strokeWidth={1.5} />
          </>
        )
        label = (
          <Label
            x={v.x + Math.cos(arc.midAngle) * lr}
            y={v.y + Math.sin(arc.midAngle) * lr}
            text={info.main}
            color={color}
          />
        )
      }
    }
  }

  return (
    <g data-shape={draft ? undefined : m.id} style={{ cursor: showHandles ? 'pointer' : undefined }}>
      {/* 클릭하기 쉽게 투명한 굵은 선 */}
      {!draft && showHandles && m.type !== 'area' && (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
        />
      )}
      {body}
      {label}
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={showHandles ? 5 : draft ? 3 : 2.5}
          fill={showHandles ? 'white' : color}
          stroke={color}
          strokeWidth={showHandles ? 2 : 0}
          data-handle={showHandles ? '' : undefined}
          data-id={m.id}
          data-index={i}
          style={{ cursor: showHandles ? 'move' : undefined }}
        />
      ))}
      {closeHint && <circle cx={pts[0].x} cy={pts[0].y} r={9} fill="none" stroke={color} strokeWidth={2} />}
      {endHint && (
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={9} fill="none" stroke={color} strokeWidth={2} />
      )}
    </g>
  )
}

// 치수선 끝의 짧은 수직 표시
function EndTick({ p, q, color }) {
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
  const nx = (-(q.y - p.y) / len) * 6
  const ny = ((q.x - p.x) / len) * 6
  return <line x1={p.x - nx} y1={p.y - ny} x2={p.x + nx} y2={p.y + ny} stroke={color} strokeWidth={2} />
}

// 마크업: 형광펜, 텍스트 상자, 펜, 사각형, 화살표. 굵기와 글자 크기는 도면과 함께 확대됩니다.
function MarkupShape({ m, zoom, selected, showHandles, draft }) {
  const color = m.color ?? TYPE_INFO[m.type].color
  const pts = m.points.map((p) => ({ x: p.x * zoom, y: p.y * zoom }))
  const sw = Math.max(1, MARKUP_STROKE * zoom)
  let body = null
  let bounds = null
  let handles = false

  if (m.type === 'highlight' || m.type === 'rect') {
    const r = rectOf(pts[0], pts[1] ?? pts[0])
    bounds = r
    handles = true
    body =
      m.type === 'highlight' ? (
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={color} fillOpacity={0.38} style={{ mixBlendMode: 'multiply' }} />
      ) : (
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" stroke={color} strokeWidth={sw} />
      )
  } else if (m.type === 'arrow') {
    const [a, b] = pts
    if (b) {
      handles = true
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const head = Math.max(8, sw * 5)
      const p1 = { x: b.x - head * Math.cos(ang - 0.45), y: b.y - head * Math.sin(ang - 0.45) }
      const p2 = { x: b.x - head * Math.cos(ang + 0.45), y: b.y - head * Math.sin(ang + 0.45) }
      body = (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={Math.max(12, sw * 4)} />
          <line x1={a.x} y1={a.y} x2={b.x - Math.cos(ang) * head * 0.6} y2={b.y - Math.sin(ang) * head * 0.6} stroke={color} strokeWidth={sw} strokeLinecap="round" />
          <polygon points={`${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill={color} />
        </>
      )
    }
  } else if (m.type === 'pen') {
    const d = pts.map((p) => `${p.x},${p.y}`).join(' ')
    body = (
      <>
        <polyline points={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, sw * 4)} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={d} fill="none" stroke={color} strokeWidth={sw * 1.2} strokeLinecap="round" strokeLinejoin="round" />
      </>
    )
  } else if (m.type === 'text') {
    const size = m.fontSize ?? 13
    const box = textBoxMetrics(m.text, size)
    const x = pts[0].x
    const y = pts[0].y
    bounds = { x, y, w: box.width * zoom, h: box.height * zoom }
    body = (
      <>
        <rect x={x} y={y} width={box.width * zoom} height={box.height * zoom} fill="white" fillOpacity={m.boxOpacity ?? DEFAULT_BOX_OPACITY} stroke={color} strokeWidth={Math.max(0.75, 0.8 * zoom)} rx={2 * zoom} />
        <text fontSize={size * zoom} fontFamily={FONT_FAMILY} fill={color}>
          {box.lines.map((line, i) => (
            <tspan key={i} x={x + box.pad * zoom} y={y + (box.pad + box.lineHeight * i + size * 1.02) * zoom} xmlSpace="preserve">
              {line || ' '}
            </tspan>
          ))}
        </text>
      </>
    )
  }

  return (
    <g data-shape={draft ? undefined : m.id} data-type={m.type} style={{ cursor: showHandles ? 'move' : undefined }} opacity={draft ? 0.8 : 1}>
      {body}
      {selected && bounds && !draft && (
        <rect x={bounds.x - 3} y={bounds.y - 3} width={bounds.w + 6} height={bounds.h + 6} fill="none" stroke="#2563eb" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
      )}
      {showHandles &&
        handles &&
        !draft &&
        pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={5} fill="white" stroke={color} strokeWidth={2} data-handle="" data-id={m.id} data-index={i} style={{ cursor: 'crosshair' }} />
        ))}
    </g>
  )
}
