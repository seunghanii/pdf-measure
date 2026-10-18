// 메모 범위: 도면 위 사각형 범위를 누르면 메모장(마크다운, 사진)이 열리거나, 연결한 다른 도면이 열립니다.
// 항목 모양: { type: 'memo', points: [두 모서리], color, text (마크다운), link?: { id, name, page } }
// 메모 속 사진은 도면에 넣는 사진과 같은 저장소(images.js)에 두고, 글에는 ![사진](img:사진id) 로 적습니다.
import { rectOf } from './markup'

export const MEMO_COLORS = ['#f59e0b', '#2563eb', '#16a34a', '#db2777', '#64748b']
export const DEFAULT_MEMO_COLOR = MEMO_COLORS[0]

const IMG_REF = /\(img:([a-z0-9]+)\)/g

// 메모 글에 들어 있는 사진 id 들
export function memoImageIds(text) {
  return [...String(text ?? '').matchAll(IMG_REF)].map((m) => m[1])
}

export const memoImageMarkdown = (imageId) => `![사진](img:${imageId})`

// 메모 내용이 비어 있고 도면만 연결된 범위는 누르면 바로 그 도면이 열림
export const isLinkOnly = (m) => !!m.link && !String(m.text ?? '').trim()

// 목록·툴팁에 보여 줄 한 줄 요약
export function memoSummary(m) {
  const first = String(m.text ?? '')
    .split('\n')
    .map((l) =>
      l
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '[사진]')
        .replace(/^[#>\-*+\s]+|\[[ xX]\]\s*/g, '')
        .replace(/[*_`~]/g, '')
        .trim(),
    )
    .find(Boolean)
  if (first) return first
  if (m.link) return `→ ${m.link.name}${m.link.page > 1 ? ` ${m.link.page}쪽` : ''}`
  return ''
}

// 그 점을 덮는 메모들. 겹치면 작은 범위가 먼저(같은 크기면 나중에 만든 것이 먼저)
export function memosAt(items, page, p) {
  return items
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => {
      if (m.type !== 'memo' || m.page !== page || m.hidden) return false
      const r = rectOf(m.points[0], m.points[1] ?? m.points[0])
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    })
    .sort((a, b) => {
      const ra = rectOf(a.m.points[0], a.m.points[1] ?? a.m.points[0])
      const rb = rectOf(b.m.points[0], b.m.points[1] ?? b.m.points[0])
      const d = ra.w * ra.h - rb.w * rb.h
      return Math.abs(d) > 1e-6 ? d : b.i - a.i
    })
    .map(({ m }) => m)
}

// 화면에 그릴 때: 큰 범위를 먼저(아래에) 그려서 겹친 작은 범위도 누를 수 있게
export function memoDrawOrder(a, b) {
  const ra = rectOf(a.points[0], a.points[1] ?? a.points[0])
  const rb = rectOf(b.points[0], b.points[1] ?? b.points[0])
  return rb.w * rb.h - ra.w * ra.h
}
