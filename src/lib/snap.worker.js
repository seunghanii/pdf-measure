// 자석(snap.js)용 웹 워커: 페이지 그리기 명령에서 선분을 뽑고, 커서 근처 선을 빨리 찾을 격자를 만듭니다.
// 화면 스레드를 막지 않으려고 여기서 계산하고, 결과는 숫자 배열로 넘겨줍니다(복사 없이 transfer).

const DRAW_MOVE = 0
const DRAW_LINE = 1
const DRAW_CURVE = 2
const DRAW_QUAD = 3
const DRAW_CLOSE = 4
const CURVE_STEPS = 8 // 곡선은 짧은 직선 여러 개로 나눠서 다룸
const MAX_SEGMENTS = 500_000 // 아주 복잡한 도면에서 메모리가 넘치지 않게
const GRID = 256 // 긴 변을 이만큼의 칸으로 나눔

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

// 그리기 명령 → 선분 [x1, y1, x2, y2, ...] (페이지 좌표, 배율 1, pt)
function extractSegments({ fnArray, argsArray, ops, transform }) {
  const paint = new Set(ops.paint)
  const segs = []
  let ctm = transform.slice()
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

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i]
    if (fn === ops.save) stack.push(ctm)
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm
    else if (fn === ops.transform) ctm = compose(ctm, args)
    else if (fn === ops.paintFormXObjectBegin || fn === ops.beginGroup) {
      stack.push(ctm)
      const matrix = fn === ops.beginGroup ? args[0]?.matrix : args[0]
      if (matrix) ctm = compose(ctm, matrix)
    } else if (fn === ops.paintFormXObjectEnd || fn === ops.endGroup) ctm = stack.pop() ?? ctm
    else if (fn === ops.constructPath) {
      const [op, data] = args
      if (paint.has(op) && data?.[0]) addPath(data[0])
    }
  }
  return new Float64Array(segs)
}

// 칸마다 그 칸을 지나는 선분 번호. 두 번 훑어 개수를 세고 채워서 한 덩어리 배열로 만듦
function buildGrid(segs, width, height) {
  const cell = Math.max(width, height, 1) / GRID
  const cols = Math.ceil(width / cell) + 1
  const rows = Math.ceil(height / cell) + 1
  const count = segs.length / 4
  const key = (x, y) => {
    const c = Math.floor(x / cell)
    const r = Math.floor(y / cell)
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1
    return r * cols + c
  }
  const visit = (s, fn) => {
    const x1 = segs[s * 4]
    const y1 = segs[s * 4 + 1]
    const x2 = segs[s * 4 + 2]
    const y2 = segs[s * 4 + 3]
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (cell / 2)) + 1
    let last = -1
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const kk = key(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
      if (kk === last || kk < 0) continue
      last = kk
      fn(kk)
    }
  }
  const cellStart = new Int32Array(cols * rows + 1)
  const lastSeg = new Int32Array(cols * rows).fill(-1)
  for (let s = 0; s < count; s++)
    visit(s, (k) => {
      if (lastSeg[k] === s) return
      lastSeg[k] = s
      cellStart[k + 1]++
    })
  for (let k = 0; k < cols * rows; k++) cellStart[k + 1] += cellStart[k]
  const cellItems = new Int32Array(cellStart[cols * rows])
  const fill = cellStart.slice(0, cols * rows)
  lastSeg.fill(-1)
  for (let s = 0; s < count; s++)
    visit(s, (k) => {
      if (lastSeg[k] === s) return
      lastSeg[k] = s
      cellItems[fill[k]++] = s
    })
  return { segs, cell, cols, rows, cellStart, cellItems }
}

self.onmessage = ({ data }) => {
  try {
    const segs = extractSegments(data)
    const index = buildGrid(segs, data.width, data.height)
    self.postMessage({ id: data.id, index }, [index.segs.buffer, index.cellStart.buffer, index.cellItems.buffer])
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e?.message ?? e) })
  }
}
