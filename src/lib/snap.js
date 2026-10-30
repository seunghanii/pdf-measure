// 자석(스냅): 도면의 벡터 선(끝점·교차점·선 위)과 이미 찍은 측정 점에 커서를 붙입니다.
// 스캔한 이미지 PDF 에는 벡터 선이 없어서 측정 점에만 붙습니다.
import { distance } from './geometry'
import { getPdfjs } from './pdf'

// 그리는 동작(선 긋기·채우기)만. endPath 는 보이지 않는 잘라내기 경로라 뺌
const paintOps = (OPS) =>
  new Set([
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

// 페이지의 그리기 명령을 받아, 선분 뽑기와 격자 만들기는 웹 워커(snap.worker.js)에서 합니다.
// 복잡한 도면은 선이 수십만 개라 화면 스레드에서 하면 처음 자석을 쓸 때 화면이 멈칫합니다.
let worker = null
let seq = 0
const waiting = new Map()

function buildInWorker(msg) {
  if (!worker) {
    worker = new Worker(new URL('./snap.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id)
      waiting.delete(data.id)
      if (data.error) w?.reject(new Error(data.error))
      else w?.resolve(data.index)
    }
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(e)
      waiting.clear()
      worker?.terminate()
      worker = null
    }
  }
  const id = ++seq
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker.postMessage({ id, ...msg })
  })
}

async function buildIndex(page) {
  const { OPS } = await getPdfjs()
  const PAINT_OPS = paintOps(OPS)
  const viewport = page.getViewport({ scale: 1 })
  const list = await page.getOperatorList()
  // 워커에는 자석에 필요한 명령만 보냄 (복사할 양을 줄이고, 복사할 수 없는 값이 섞이지 않게)
  const keep = new Set([OPS.save, OPS.restore, OPS.transform, OPS.paintFormXObjectBegin, OPS.paintFormXObjectEnd, OPS.beginGroup, OPS.endGroup, OPS.constructPath])
  const fnArray = []
  const argsArray = []
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]
    if (!keep.has(fn)) continue
    const args = list.argsArray[i]
    fnArray.push(fn)
    if (fn === OPS.transform) argsArray.push(args)
    else if (fn === OPS.paintFormXObjectBegin) argsArray.push([args?.[0] ?? null])
    else if (fn === OPS.beginGroup) argsArray.push([{ matrix: args?.[0]?.matrix ?? null }])
    else if (fn === OPS.constructPath) argsArray.push(PAINT_OPS.has(args?.[0]) ? [args[0], [args[1]?.[0]]] : [null, null])
    else argsArray.push(null)
  }
  const ops = {
    save: OPS.save,
    restore: OPS.restore,
    transform: OPS.transform,
    paintFormXObjectBegin: OPS.paintFormXObjectBegin,
    paintFormXObjectEnd: OPS.paintFormXObjectEnd,
    beginGroup: OPS.beginGroup,
    endGroup: OPS.endGroup,
    constructPath: OPS.constructPath,
    paint: [...PAINT_OPS],
  }
  const data = await buildInWorker({ fnArray, argsArray, ops, transform: viewport.transform, width: viewport.width, height: viewport.height })
  return new SnapIndex(data)
}

// 격자 칸마다 그 칸을 지나는 선분 번호 (워커가 만든 것: cellStart[칸]~cellStart[칸+1] 이 cellItems 의 범위)
class SnapIndex {
  constructor({ segs, cell, cols, rows, cellStart, cellItems }) {
    Object.assign(this, { segs, cell, cols, rows, cellStart, cellItems })
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
        const key = row * this.cols + col
        for (let k = this.cellStart[key]; k < this.cellStart[key + 1]; k++) {
          const s = this.cellItems[k]
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
      .then(buildIndex)
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
