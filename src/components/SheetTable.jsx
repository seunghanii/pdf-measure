import { memo, useMemo, useRef, useState } from 'react'
import { colName } from '../lib/excel'
import { borderCss, fontStyle, xfLook } from '../lib/xlsx'

const GRID = '1px solid #dadce0' // 엑셀 눈금선
const ZOOMS = [50, 67, 75, 90, 100, 125, 150]

// 엑셀 시트의 한 범위를 엑셀 화면처럼 그림: 열 너비·행 높이·병합·테두리·채우기·글꼴·정렬 그대로
// sheet: lib/xlsx.js parseXlsx 의 시트 하나, range: { r1, r2, c1, c2 }
// colWidths: 사용자가 바꾼 열 너비 { 열 번호: px }, onColWidth(열 번호, px): 열 머리 경계를 끌어 바꾼 뒤
const HEIGHT_KEY = 'pdf-measure:sheet-h'
const loadHeight = () => {
  try {
    return Number(localStorage.getItem(HEIGHT_KEY)) || 384
  } catch {
    return 384
  }
}

function SheetTable({ sheet, range, colWidths, onColWidth }) {
  const [zoom, setZoom] = useState(100)
  const [height, setHeight] = useState(loadHeight)
  const [live, setLive] = useState(null) // 끄는 중인 열 { c, w }
  const scroller = useRef(null)
  const widths = useMemo(() => (live ? { ...colWidths, [live.c]: live.w } : colWidths), [colWidths, live])
  const model = useMemo(() => buildModel(sheet, range, widths), [sheet, range, widths])
  const { cols, rows, width } = model
  const step = (d) => setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + d))])

  // 열 머리 오른쪽 경계 끌기 → 열 너비
  const startCol = (e, c, w0) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const scale = zoom / 100
    let w = w0
    const move = (ev) => {
      w = Math.max(8, Math.round(w0 + (ev.clientX - x0) / scale))
      setLive({ c, w })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setLive(null)
      if (w !== w0) onColWidth?.(c, w)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  // 아래 손잡이 끌기 → 보이는 영역 높이 (모든 첨부 공통으로 기억)
  const startHeight = (e) => {
    e.preventDefault()
    const y0 = e.clientY
    const h0 = scroller.current?.getBoundingClientRect().height ?? height
    let h = h0
    const move = (ev) => {
      h = Math.max(80, Math.min(2000, Math.round(h0 + ev.clientY - y0)))
      setHeight(h)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      try {
        localStorage.setItem(HEIGHT_KEY, String(h))
      } catch {
        /* 저장 못 해도 지금 화면은 그대로 */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="theme-light relative">
      <div ref={scroller} className="overflow-auto bg-surface" style={{ maxHeight: height }}>
        <table className="border-separate border-spacing-0 text-ink-900" style={{ tableLayout: 'fixed', width: width + 32, zoom: zoom / 100, fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif', fontSize: '14.7px', lineHeight: 1.2 }}>
          <colgroup>
            <col style={{ width: 32 }} />
            {cols.map((c) => (
              <col key={c.c} style={{ width: c.w }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: 18 }}>
              <th className="sticky top-0 left-0 z-20 border-r border-b border-ink-200 bg-ink-100" />
              {cols.map((c) => (
                <th key={c.c} className="sticky top-0 z-10 border-r border-b border-ink-200 bg-ink-100 text-center text-[11px] font-normal text-ink-500">
                  {colName(c.c)}
                  {onColWidth && (
                    <span
                      onPointerDown={(e) => startCol(e, c.c, c.w)}
                      onDoubleClick={() => onColWidth(c.c, null)}
                      className="absolute top-0 -right-1 bottom-0 z-10 w-2 cursor-col-resize touch-none hover:bg-brand-400/50"
                      title="끌어서 열 너비 바꾸기 (두 번 누르면 원래대로)"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.r} style={{ height: row.h }}>
                <th className="sticky left-0 z-10 border-r border-b border-ink-200 bg-ink-100 text-center text-[11px] font-normal text-ink-500 tabular-nums">{row.r}</th>
                {row.cells.map((cell) => (
                  <td key={cell.c} colSpan={cell.cs > 1 ? cell.cs : undefined} rowSpan={cell.rs > 1 ? cell.rs : undefined} style={cell.style}>
                    {cell.rich ? cell.rich.map((p, i) => <span key={i} style={p.font ? fontStyle(p.font) : undefined}>{p.t}</span>) : cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        onPointerDown={startHeight}
        className="group flex h-2.5 cursor-row-resize touch-none items-center justify-center border-t border-ink-100 bg-ink-50 hover:bg-ink-100"
        title="끌어서 보이는 높이 바꾸기"
        role="separator"
        aria-orientation="horizontal"
        aria-label="표 높이 조절"
      >
        <span className="h-0.5 w-8 rounded-full bg-ink-300 group-hover:bg-ink-500" />
      </div>
      <div className="absolute right-3 bottom-4.5 flex items-center rounded-md bg-surface/90 text-[11px] text-ink-600 shadow-xs ring-1 ring-ink-200">
        <button onClick={() => step(-1)} disabled={zoom === ZOOMS[0]} className="px-1.5 py-0.5 hover:bg-ink-100 disabled:opacity-30" aria-label="작게 보기" title="작게 보기">
          −
        </button>
        <button onClick={() => setZoom(100)} className="min-w-10 px-1 py-0.5 tabular-nums hover:bg-ink-100" title="100%로">
          {zoom}%
        </button>
        <button onClick={() => step(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} className="px-1.5 py-0.5 hover:bg-ink-100 disabled:opacity-30" aria-label="크게 보기" title="크게 보기">
          +
        </button>
      </div>
    </div>
  )
}

export default memo(SheetTable)

// 칸 하나 하나의 꾸밈을 미리 계산
function buildModel(sheet, { r1, r2, c1, c2 }, custom) {
  const { cells, styles, colW, colStyle, rowStyles, rowH, defColPx, defRowPx, merges, grid } = sheet
  const cols = []
  for (let c = c1; c <= c2; c++) {
    const w = custom?.[c] ?? colW[c] ?? defColPx
    if (w > 0) cols.push({ c, w })
  }
  const rowList = []
  for (let r = r1; r <= r2; r++) {
    const h = rowH[r] ?? defRowPx
    if (h > 0) rowList.push({ r, h })
  }
  const visCol = new Set(cols.map((x) => x.c))
  const visRow = new Set(rowList.map((x) => x.r))

  const styleOf = (r, c) => cells.get(`${r},${c}`)?.s ?? rowStyles.get(r) ?? colStyle[c] ?? 0
  const bordersOf = (r, c) => styles.borders[styles.xfs[styleOf(r, c)]?.borderId] ?? {}
  const fillOf = (r, c) => styles.fills[styles.xfs[styleOf(r, c)]?.fillId] ?? null
  const textOf = (r, c) => cells.get(`${r},${c}`)?.text ?? ''

  // 병합: 범위 안에서 보이는 첫 칸이 대표, 나머지는 그리지 않음
  const anchor = new Map()
  const covered = new Set()
  for (const m of merges) {
    if (m.r2 < r1 || m.r1 > r2 || m.c2 < c1 || m.c1 > c2) continue
    const rs = rowList.filter((x) => x.r >= m.r1 && x.r <= m.r2)
    const cs = cols.filter((x) => x.c >= m.c1 && x.c <= m.c2)
    if (!rs.length || !cs.length) continue
    const ar = rs[0].r, ac = cs[0].c
    anchor.set(`${ar},${ac}`, { rs: rs.length, cs: cs.length, m, re: rs[rs.length - 1].r, ce: cs[cs.length - 1].c })
    for (const x of rs) for (const y of cs) if (x.r !== ar || y.c !== ac) covered.add(`${x.r},${y.c}`)
  }

  // 다음 보이는 열/행
  const nextCol = (c) => {
    for (let x = c + 1; x <= c + 200; x++) if (visCol.has(x) || x > c2) return x
    return c + 1
  }
  const nextRow = (r) => {
    for (let x = r + 1; x <= r + 1000; x++) if (visRow.has(x) || x > r2) return x
    return r + 1
  }
  const prevCol = (c) => {
    for (let x = c - 1; x >= 1; x--) if (colW[x] !== 0) return x
    return 0
  }
  const prevRow = (r) => {
    for (let x = r - 1; x >= 1; x--) if (rowH[x] !== 0) return x
    return 0
  }

  // 두 칸 사이 선: 어느 쪽에 적힌 테두리든 씀. 없으면 눈금선(채우기가 있으면 엑셀처럼 눈금선 숨김)
  const edge = (own, other, fillA, fillB) => {
    const b = own ?? other
    if (b) return borderCss(b)
    return grid && !fillA && !fillB ? GRID : '1px solid transparent'
  }

  const rows = rowList.map(({ r, h }) => {
    const out = []
    for (const { c } of cols) {
      const key = `${r},${c}`
      if (covered.has(key)) continue
      const a = anchor.get(key)
      const re = a ? a.re : r
      const ce = a ? a.ce : c
      const cell = cells.get(key)
      const look = xfLook(styles, styleOf(r, c), cell)
      const fill = fillOf(r, c)
      const st = { ...look.style, padding: '0 3px', paddingLeft: look.style.paddingLeft ?? '3px', overflow: 'hidden' }
      // 오른쪽 선: 대표 줄 기준 오른쪽 끝 칸의 오른쪽 또는 다음 칸의 왼쪽
      const nc = nextCol(ce)
      st.borderRight = edge(bordersOf(r, ce).right, bordersOf(r, nc).left, fill, fillOf(r, nc))
      const nr = nextRow(re)
      st.borderBottom = edge(bordersOf(re, c).bottom, bordersOf(nr, c).top, fill, fillOf(nr, c))
      if (c === cols[0].c) {
        const pc = prevCol(c)
        st.borderLeft = edge(bordersOf(r, c).left, pc ? bordersOf(r, pc).right : null, fill, pc ? fillOf(r, pc) : null)
      }
      if (r === rowList[0].r) {
        const pr = prevRow(r)
        st.borderTop = edge(bordersOf(r, c).top, pr ? bordersOf(pr, c).bottom : null, fill, pr ? fillOf(pr, c) : null)
      }
      // 줄바꿈 없는 왼쪽 정렬 글은 오른쪽 칸이 비어 있으면 넘쳐 보이게 (엑셀처럼)
      if (!look.wrap && st.textAlign === 'left' && !a && cell?.text && !textOf(r, nc) && visCol.has(nc)) st.overflow = 'visible'
      out.push({ c, cs: a?.cs ?? 1, rs: a?.rs ?? 1, style: st, text: cell?.text ?? '', rich: cell?.rich ?? null })
    }
    return { r, h, cells: out }
  })
  const width = cols.reduce((n, x) => n + x.w, 0)
  return { cols, rows, width }
}
