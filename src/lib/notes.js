// 직접 넣은 글(텍스트 상자, 메모 범위의 글)도 검색되게: 도면 글자 색인과 같은 모양으로 뽑아 둡니다.
// → [[글자, x, y, w, h, 쪽, 종류('text'|'memo')], ...]  (좌표는 배율 1 페이지 좌표)
// 홈 목록 요약(summary.notes)에도 넣어서 홈 검색이 측정값 전체를 받지 않고도 찾게 합니다.
import { rectOf, textMetricsOf } from './markup'
import { markdownPlainLines } from './memoPlain'

const MAX_NOTE_CHARS = 500 // 요약이 너무 커지지 않게 글 하나당 이만큼만
const r1 = (v) => Math.round(v * 10) / 10

export function noteItems(measurements) {
  const out = []
  for (const m of measurements ?? []) {
    if ((m.type !== 'text' && m.type !== 'memo') || m.hidden || !m.points?.length) continue
    let s = String(m.text ?? '').replace(/!\[[^\]]*\]\(img:[^)]*\)/g, '') // 예전 메모 글 속 사진 표시
    if (m.type === 'memo') s = markdownPlainLines(s).join(' ') // 메모는 마크다운 기호(#, |, ** 등)를 빼고
    s = s
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NOTE_CHARS)
    if (!s) continue
    let r
    if (m.type === 'text') {
      const box = textMetricsOf(m)
      r = { x: m.points[0].x, y: m.points[0].y, w: box.width, h: box.height }
    } else r = rectOf(m.points[0], m.points[1] ?? m.points[0])
    out.push([s, r1(r.x), r1(r.y), r1(r.w), r1(r.h), m.page ?? 1, m.type])
  }
  return out
}
