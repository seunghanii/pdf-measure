// 자석(스냅): 도면의 벡터 선(끝점·교차점·선 위)과 이미 찍은 측정 점에 커서를 붙입니다.
// 스캔한 이미지 PDF 에는 벡터 선이 없어서 측정 점에만 붙습니다.
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { distance } from './geometry'

const DRAW_MOVE = 0
const DRAW_LINE = 1
const DRAW_CURVE = 2
const DRAW_QUAD = 3
const DRAW_CLOSE = 4
const CURVE_STEPS = 8 // 곡선은 짧은 직선 여러 개로 나눠서 다룸
const MAX_SEGMENTS = 500_000 // 아주 복잡한 도면에서 메모리가 넘치지 않게

// 그리는 동작(선 긋기·채우기)만. endPath 는 보이지 않는 잘라내기 경로라 뺌
const PAINT_OPS = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
])

// 스냅 종류: 우선순위가 낮을수록 먼저 (같은 반경 안이면 끝점 > 교차점 > 선 위)
export const SNAP_KINDS = {
  point: { label: '측정점', rank: 0 },
  end: { label: '끝점', rank: 0 },
  cross: { label: '교차점', rank: 1 },
  line: { label: '선 위', rank: 2 },
}

// m(n(p)) : n 을 먼저, 그다음 m 을 적용
function compose(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

// 페이지의 그리기 명령에서 선분을 뽑아 페이지 좌표(배율 1, pt)로 변환
async function extractSegments(page) {
  const viewport = page.getViewport({ scale: 1 })
  const ops = await page.getOperatorList()
  const segs = [] // [x1, y1, x2, y2, ...] 평평한 배열
  let ctm = viewport.transform.slice()
  const stack = []

  const addPath = (data) => {
    let sx = 0
    let sy = 0 // 하위 경로 시작점 (closePath 용)
    let cx = 0
    let cy = 0
    const line = (x, y) => {
      const [ax, ay] = apply(ctm, cx, cy)
      const [bx, by] = apply(ctm, x, y)
      if (ax !== bx || ay !== by) segs.push(ax, ay, bx, by)
      cx = x
      cy = y
    }
    for (let i = 0; i < data.length && segs.length < MAX_SEGMENTS * 4; ) {
      switch (data[i++]) {
        case DRAW_MOVE:
          cx = sx = data[i++]
          cy = sy = data[i++]
          break
        case DRAW_LINE:
          line(data[i++], data[i++])
          break
        case DRAW_CURVE: {
          const [x0, y0, x1, y1, x2, y2, x3, y3] = [cx, cy, data[i++], data[i++], data[i++], data[i++], data[i++], data[i++]]
          for (let k = 1; k <= CURVE_STEPS; k++) {
            const t = k / CURVE_STEPS
            const u = 1 - t
            line(
              u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
              u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
            )
          }
          break
        }
        case DRAW_QUAD: {
          const [x0, y0, x1, y1, x2, y2] = [cx, cy, data[i++], data[i++], data[i++], data[i++]]
          for (let k = 1; k <= CURVE_STEPS; k++) {
            const t = k / CURVE_STEPS
            const u = 1 - t
            line(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2)
          }
          break
        }
        case DRAW_CLOSE:
          line(sx, sy)
          break
        default:
          return // 모르는 명령이면 이 경로는 건너뜀
      }
    }
  }

  const { fnArray, argsArray } = ops
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = compose(ctm, args)
    else if (fn === OPS.paintFormXObjectBegin || fn === OPS.beginGroup) {
      stack.push(ctm)
      const matrix = fn === OPS.beginGroup ? args[0]?.matrix : args[0]
      if (matrix) ctm = compose(ctm, matrix)
    } else if (fn === OPS.paintFormXObjectEnd || fn === OPS.endGroup) ctm = stack.pop() ?? ctm
    else if (fn === OPS.constructPath) {
      const [paint, data] = args
      if (PAINT_OPS.has(paint) && data?.[0]) addPath(data[0])
    }
  }
  return { segs: new Float64Array(segs), width: viewport.width, height: viewport.height }
}

// 격자 칸마다 그 칸을 지나는 선분 번호를 담아 두고, 커서 근처 칸만 찾아봄
class SnapIndex {
  constructor({ segs, width, height }) {
    this.segs = segs
    this.count = segs.length / 4
    this.cell = Math.max(width, height, 1) / 256
    this.cols = Math.ceil(width / this.cell) + 1
    this.rows = Math.ceil(height / this.cell) + 1
    this.grid = new Map()
    for (let s = 0; s < this.count; s++) {
      const x1 = segs[s * 4]
      const y1 = segs[s * 4 + 1]
      const x2 = segs[s * 4 + 2]
      const y2 = segs[s * 4 + 3]
      const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (this.cell / 2)) + 1
      let last = -1
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        const key = this.key(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
        if (key === last || key < 0) continue
        last = key
        let list = this.grid.get(key)
        if (!list) this.grid.set(key, (list = []))
        if (list[list.length - 1] !== s) list.push(s)
      }
    }
  }

  key(x, y) {
    const c = Math.floor(x / this.cell)
    const r = Math.floor(y / this.cell)
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1
    return r * this.cols + c
  }

  // p 에서 r 안에 있는 선분 [{ s, d, foot }] (가까운 순)
  near(p, r) {
    const c0 = Math.floor((p.x - r) / this.cell) - 1
    const c1 = Math.floor((p.x + r) / this.cell) + 1
    const r0 = Math.floor((p.y - r) / this.cell) - 1
    const r1 = Math.floor((p.y + r) / this.cell) + 1
    const seen = new Set()
    const out = []
    for (let row = Math.max(0, r0); row <= Math.min(this.rows - 1, r1); row++) {
      for (let col = Math.max(0, c0); col <= Math.min(this.cols - 1, c1); col++) {
        const list = this.grid.get(row * this.cols + col)
        if (!list) continue
        for (const s of list) {
          if (seen.has(s)) continue
          seen.add(s)
          const foot = closestOnSegment(p, this.seg(s))
          const d = distance(p, foot)
          if (d <= r) out.push({ s, d, foot })
        }
      }
    }
    return out.sort((a, b) => a.d - b.d)
  }

  seg(s) {
    const g = this.segs
    return [g[s * 4], g[s * 4 + 1], g[s * 4 + 2], g[s * 4 + 3]]
  }
}

function closestOnSegment(p, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - x1) * dx + (p.y - y1) * dy) / len2)) : 0
  return { x: x1 + dx * t, y: y1 + dy * t }
}

// 두 선분(또는 선분과 직선)의 교점. unboundedA 이면 a 를 끝없는 직선으로 봄
function intersect([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2], unboundedA = false) {
  const rx = ax2 - ax1
  const ry = ay2 - ay1
  const sx = bx2 - bx1
  const sy = by2 - by1
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null // 평행
  const t = ((bx1 - ax1) * sy - (by1 - ay1) * sx) / den
  const u = ((bx1 - ax1) * ry - (by1 - ay1) * rx) / den
  const eps = 1e-6
  if (u < -eps || u > 1 + eps) return null
  if (!unboundedA && (t < -eps || t > 1 + eps)) return null
  return { x: ax1 + rx * t, y: ay1 + ry * t }
}

// pdfDoc → 페이지 번호 → Promise<SnapIndex>
const cache = new WeakMap()

export function loadSnapIndex(pdfDoc, pageNum) {
  let pages = cache.get(pdfDoc)
  if (!pages) cache.set(pdfDoc, (pages = new Map()))
  let task = pages.get(pageNum)
  if (!task) {
    task = pdfDoc
      .getPage(pageNum)
      .then(extractSegments)
      .then((data) => new SnapIndex(data))
      .catch((e) => {
        console.warn('자석: 도면 선을 읽지 못했어요', e)
        return null
      })
    pages.set(pageNum, task)
  }
  return task
}

// 커서 p 에서 반경 r(pt) 안의 가장 좋은 스냅 지점. 없으면 null
// points: 붙을 수 있는 측정 점들, index: 도면 선 (없어도 됨)
export function findSnap(p, r, { index, points = [] }) {
  let best = null
  const consider = (q, kind) => {
    const d = distance(p, q)
    if (d > r) return
    const rank = SNAP_KINDS[kind].rank
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { x: q.x, y: q.y, kind, rank, d }
  }
  for (const q of points) consider(q, 'point')
  if (index) {
    const near = index.near(p, r)
    for (const { s } of near) {
      const [x1, y1, x2, y2] = index.seg(s)
      consider({ x: x1, y: y1 }, 'end')
      consider({ x: x2, y: y2 }, 'end')
    }
    // 교차점은 가까운 선분 몇 개끼리만 계산
    const few = near.slice(0, 40)
    for (let i = 0; i < few.length; i++) {
      for (let j = i + 1; j < few.length; j++) {
        const q = intersect(index.seg(few[i].s), index.seg(few[j].s))
        if (q) consider(q, 'cross')
      }
    }
    if (near.length) consider(near[0].foot, 'line')
  }
  return best && { x: best.x, y: best.y, kind: best.kind }
}

// Shift 로 방향을 고정했을 때: from→p 방향 직선이 도면 선과 만나는 곳 중 p 에 가장 가까운 점
export function findRaySnap(from, p, r, { index, points = [] }) {
  let best = null
  const consider = (q, kind) => {
    const d = distance(p, q)
    if (d <= r && (!best || d < best.d)) best = { x: q.x, y: q.y, kind, d }
  }
  const dx = p.x - from.x
  const dy = p.y - from.y
  const len2 = dx * dx + dy * dy
  if (!len2) return null
  // 측정 점은 직선 위로 내린 발
  for (const q of points) {
    const t = ((q.x - from.x) * dx + (q.y - from.y) * dy) / len2
    const foot = { x: from.x + dx * t, y: from.y + dy * t }
    if (distance(foot, q) <= r) consider(foot, 'point')
  }
  if (index) {
    const ray = [from.x, from.y, p.x, p.y]
    for (const { s } of index.near(p, r)) {
      const q = intersect(ray, index.seg(s), true)
      if (q) consider(q, 'cross')
    }
  }
  return best && { x: best.x, y: best.y, kind: best.kind }
}
