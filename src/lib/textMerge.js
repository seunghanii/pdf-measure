// 글자 조각 { s, x, y, w, h, flat, conf? } 을 같은 줄끼리 이어 붙이기 (textIndex.js, ocr.js)

// 같은 줄에 붙어 있는 조각을 한 덩어리로 (PDF 는 글자를 한 자씩 따로 넣는 경우가 많음)
export function mergeLine(items) {
  const flat = items.filter((i) => i.flat).sort((a, b) => a.x - b.x)
  const runs = []
  let open = []
  for (const it of flat) {
    open = open.filter((r) => it.x - (r.x + r.w) < r.h * 2)
    const run = open.find((r) => {
      const gap = it.x - (r.x + r.w)
      const cyA = r.y + r.h / 2
      const cyB = it.y + it.h / 2
      const h = Math.max(r.h, it.h)
      return gap > -h * 0.3 && gap < h * 0.8 && Math.abs(cyA - cyB) < h * 0.5 && Math.abs(r.h - it.h) < h * 0.6
    })
    if (run) {
      const gap = it.x - (run.x + run.w)
      const space = gap > run.h * 0.2 && !run.s.endsWith(' ') && !it.s.startsWith(' ')
      run.s += (space ? ' ' : '') + it.s
      if (run.conf != null) run.conf = Math.min(run.conf, it.conf ?? 100) // OCR 신뢰도: 가장 불확실한 낱말 기준
      const right = Math.max(run.x + run.w, it.x + it.w)
      const top = Math.min(run.y, it.y)
      const bottom = Math.max(run.y + run.h, it.y + it.h)
      run.w = right - run.x
      run.y = top
      run.h = bottom - top
    } else {
      const r = { ...it }
      runs.push(r)
      open.push(r)
    }
  }
  return [...runs, ...items.filter((i) => !i.flat)]
}
