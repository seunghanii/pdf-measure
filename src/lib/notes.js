// 직접 넣은 글(텍스트 상자, 메모 범위의 글)도 검색되게: 도면 글자 색인과 같은 모양으로 뽑아 둡니다.
// → [[글자, x, y, w, h, 쪽, 종류('text'|'memo'|'measure'), 항목 id, 숨김(1|0)], ...]  (좌표는 배율 1 페이지 좌표)
// 숨긴 항목도 넣음: 화면에서만 감춘 것이라 검색으로는 찾을 수 있어야 함 (이동하면 잠깐 흐리게 보여 줌)
// 홈 목록 요약(summary.notes)에도 넣어서 홈 검색이 측정값 전체를 받지 않고도 찾게 합니다.
import { rectOf, textMetricsOf } from './markup'
import { markdownPlainLines } from './memoPlain'
import { isDefaultName } from './categories'

const MAX_NOTE_CHARS = 500 // 요약이 너무 커지지 않게 글 하나당 이만큼만
const r1 = (v) => Math.round(v * 10) / 10

// 측정 항목(길이·면적·각도)은 이름을 고쳤거나 분류가 있으면 "이름 · 분류" 로 넣음 (종류 'measure')
export function noteItems(measurements, categories) {
  const out = []
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]))
  for (const m of measurements ?? []) {
    if ((m.type === 'length' || m.type === 'area' || m.type === 'angle') && m.points?.length) {
      const cat = catName.get(m.cat)
      if (!cat && isDefaultName(m.name)) continue
      const s = [m.name?.trim(), cat].filter(Boolean).join(' · ')
      if (!s) continue
      const r = boundsOf(m.points)
      out.push([s, r1(r.x), r1(r.y), r1(r.w), r1(r.h), m.page ?? 1, 'measure', m.id, m.hidden ? 1 : 0])
      continue
    }
    if ((m.type !== 'text' && m.type !== 'memo') || !m.points?.length) continue
    let s = String(m.text ?? '').replace(/!\[[^\]]*\]\(img:[^)]*\)/g, '') // 예전 메모 글 속 사진 표시
    if (m.type === 'memo') {
      s = markdownPlainLines(s).join(' ') // 메모는 마크다운 기호(#, |, ** 등)를 빼고
      // 메모 제목(이름)도 찾히게 앞에 붙임: "제목 · 글". 기본 이름("메모 3")은 넣지 않음
      const title = isDefaultName(m.name) ? '' : String(m.name ?? '').trim()
      if (title) s = s.trim() ? `${title} · ${s}` : title
      // 계기 카드: 태그·종류·서비스·루프 번호도 찾히게 맨 앞에 (제목이 태그와 같으면 한 번만)
      if (m.inst) {
        const i = m.inst
        const head = [i.tag, i.kind, i.service, i.loop && `루프 ${i.loop}`]
          .map((v) => String(v ?? '').trim())
          .filter(Boolean)
        if (head.length) {
          if (title && title === head[0]) s = s.slice(title.length).replace(/^ · /, '')
          s = [head.join(' · '), s.trim()].filter(Boolean).join(' · ')
        }
      }
    }
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
    out.push([s, r1(r.x), r1(r.y), r1(r.w), r1(r.h), m.page ?? 1, m.type, m.id, m.hidden ? 1 : 0])
  }
  return out
}

function boundsOf(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
