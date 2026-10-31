// 도면 글자 고르기·복사 (글자 복사 도구). 검색 색인(textIndex.js)의 글자 덩어리와 위치를 그대로 씁니다.
// PDF 에 들어 있는 글자든 OCR 로 읽은 글자든 같은 모양이라 둘 다 복사됩니다.
// 색인에는 덩어리마다 상자 하나만 있어서, 가로쓰기 덩어리 일부만 고를 때는 글자 폭을 어림해 잘라 냅니다.

// 글자 폭 어림 (한글·한자는 넓고, 숫자·영문은 좁고, 띄어쓰기는 더 좁게)
const wide = /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿＀-￯]/
const charWeight = (ch) => (ch === ' ' ? 0.35 : wide.test(ch) ? 1 : 0.6)

// 덩어리 하나의 글자별 가로 위치 (0~1 사이 누적 비율). 같은 덩어리를 여러 번 고를 때를 위해 기억해 둠
const edgeCache = new WeakMap()
function edgesOf(item) {
  let e = edgeCache.get(item)
  if (e) return e
  const chars = Array.from(item[0])
  const ws = chars.map(charWeight)
  const total = ws.reduce((a, b) => a + b, 0) || 1
  const edges = [0]
  let acc = 0
  for (const w of ws) edges.push((acc += w) / total)
  e = { chars, edges }
  edgeCache.set(item, e)
  return e
}

const isFlat = ([s, , , w, h]) => w >= h && Array.from(s).length > 1

// 상자 r 과 겹치는 글자들 → [{ text, rect, cy, h }] (rect: 고른 부분만)
export function pickText(items, r) {
  if (!items) return []
  const out = []
  for (const it of items) {
    const [s, x, y, w, h] = it
    if (x > r.x + r.w || x + w < r.x || y > r.y + r.h || y + h < r.y) continue
    if (isFlat(it)) {
      // 세로로 덩어리 높이의 30% 이상 걸쳐야 (옆 줄을 스치기만 한 건 빼고)
      const overlapY = Math.min(y + h, r.y + r.h) - Math.max(y, r.y)
      if (overlapY < h * 0.3) continue
      const { chars, edges } = edgesOf(it)
      const a = (r.x - x) / w
      const b = (r.x + r.w - x) / w
      // 글자 가운데가 상자 안에 들어오는 것만
      let i0 = -1
      let i1 = -1
      for (let i = 0; i < chars.length; i++) {
        const mid = (edges[i] + edges[i + 1]) / 2
        if (mid >= a && mid <= b) {
          if (i0 < 0) i0 = i
          i1 = i
        }
      }
      if (i0 < 0) continue
      const text = chars.slice(i0, i1 + 1).join('').trim()
      if (!text) continue
      const rx = x + w * edges[i0]
      out.push({ text, rect: { x: rx, y, w: x + w * edges[i1 + 1] - rx, h }, cy: y + h / 2, h })
    } else {
      // 세로쓰기·한 글자: 상자가 가운데를 덮으면 통째로
      const cx = x + w / 2
      const cy = y + h / 2
      const covers = cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
      const small = r.w < w && r.h < h // 덩어리 안을 조금만 끈 경우
      if (!covers && !small) continue
      out.push({ text: s, rect: { x, y, w, h }, cy, h })
    }
  }
  return out
}

// 한 점 위의 글자 덩어리 (마우스를 올렸을 때 / 눌렀을 때) → { text, rect } | null. 가장 작은 덩어리 우선
export function textAt(items, p, pad = 0) {
  if (!items) return null
  let best = null
  for (const [s, x, y, w, h] of items) {
    if (p.x < x - pad || p.x > x + w + pad || p.y < y - pad || p.y > y + h + pad) continue
    if (!best || w * h < best.rect.w * best.rect.h) best = { text: s, rect: { x, y, w, h } }
  }
  return best
}

// 고른 조각들을 읽는 순서(위→아래, 같은 줄은 왼→오)로 이어 붙임
export function joinPicked(picked) {
  const sorted = [...picked].sort((a, b) => a.cy - b.cy || a.rect.x - b.rect.x)
  const lines = []
  for (const p of sorted) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(p.cy - line.cy) < Math.min(p.h, line.h) * 0.5) line.parts.push(p)
    else lines.push({ cy: p.cy, h: p.h, parts: [p] })
  }
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.rect.x - b.rect.x)
        .map((p) => p.text)
        .join(' '),
    )
    .join('\n')
}

// OCR 은 한글을 한 자씩 띄워 읽을 때가 많아("드 레 스 룸") 한 글자짜리끼리 이어진 띄어쓰기는 붙임 ("침 실2" 처럼 섞인 건 그대로)
export const tidyOcr = (text) => text.replace(/(?<=(?:^|\s)[가-힣])[ ](?=[가-힣](?:\s|$))/gm, '')

// 클립보드에 넣기 (보안 연결이 아니거나 권한이 없으면 예전 방식으로)
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}
