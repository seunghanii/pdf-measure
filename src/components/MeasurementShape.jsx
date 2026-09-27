import { angleArcPath, polygonCentroid } from '../lib/geometry'
import { TYPE_INFO, describe } from '../lib/measure'

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

export default function MeasurementShape({ m, zoom, mmPerPt, unit, selected, showHandles, draft, closeHint }) {
  const color = TYPE_INFO[m.type].color
  const pts = m.points.map((p) => ({ x: p.x * zoom, y: p.y * zoom }))
  const strokeWidth = selected ? 3 : 2
  const dash = draft ? '6 4' : undefined
  const common = { stroke: color, strokeWidth, strokeDasharray: dash, strokeLinecap: 'round', strokeLinejoin: 'round' }

  let body = null
  let label = null
  const info = draft && m.type === 'calibrate' ? { main: '' } : m.type === 'calibrate' ? { main: m.label } : describe(m, mmPerPt, unit)

  if (m.type === 'length' || m.type === 'calibrate') {
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
