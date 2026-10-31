// 계기 카드: 메모 범위 하나를 계기(태그) 하나로 씁니다.
// 메모 항목에 inst: { tag, kind, status } 를 더하면 계기 카드가 됨 (없으면 예전 메모 그대로)
// kind 는 계기 종류 약어(FT, PT …). 목록은 KIND_PRESETS + 사용자가 더한 것(폴더 정보 library.kinds, 모든 도면 공통)
// (PR #44 판에 있던 service·loop 는 화면에서 뺐고, 이미 적힌 값은 검색에만 남음)
// 관련 문서(Hook-up, 루프도, 데이터시트 …)는 links: [{ id, name, page, role }] 로 여러 개.
// 예전 메모의 link(도면 하나)도 그대로 읽고, 고칠 때 links 로 옮기면서 link 에는 첫 번째를 남겨 둠.
// 상태 색은 분류처럼 항목 color 에 함께 넣어 두어 그리기 코드가 상태 목록을 몰라도 되게 함.
import { isMarkup, rectOf } from './markup'

export const INST_STATUSES = [
  { id: 'pre', label: '설치 전', color: '#64748b' },
  // id 는 PR #44 판 그대로 (설치·결선·루프 체크 완료 → 이름만 현장 용어로)
  { id: 'installed', label: 'Cable Pulling', color: '#2563eb' },
  { id: 'wired', label: 'Termination', color: '#d97706' },
  { id: 'checked', label: 'Loop Check', color: '#16a34a' },
]
export const DEFAULT_STATUS = 'pre'
export const statusOf = (id) => INST_STATUSES.find((s) => s.id === id) ?? INST_STATUSES[0]

export const DOC_ROLES = ['Hook-up', '루프도', '데이터시트', 'P&ID', '결선도', '기타']

export const KIND_PRESETS = ['FE', 'FT', 'LI', 'LS', 'LT', 'PDI', 'PDT', 'PI', 'PT', 'TI', 'TT', 'TW']

// 기본 목록 + 사용자가 더한 종류 (겹치지 않게)
export const kindList = (custom) => [...new Set([...KIND_PRESETS, ...(custom ?? [])])]

export const isInst = (m) => m?.type === 'memo' && !!m.inst

// 오른쪽 목록의 묶음: 'measure' 측정 | 'markup' 마크업 | 'inst' 계기 카드 (마크업 전체 삭제에 휩쓸리지 않게 따로)
export const itemGroup = (m) => (isInst(m) ? 'inst' : isMarkup(m.type) ? 'markup' : 'measure')

// 메모의 관련 문서 목록 (예전 link 하나짜리 포함)
export const memoLinks = (m) => (Array.isArray(m?.links) ? m.links : m?.link ? [m.link] : [])
// 관련 문서를 바꿀 때 항목에 넣을 값 (예전 판도 첫 번째 도면은 열 수 있게 link 도 둠)
export const linksPatch = (links) => ({ links, link: links[0] ?? null })

// 태그 모양 맞추기: 대문자, 띄어쓰기 → '-' ("ft 1001" → "FT-1001")
export function normTag(s) {
  return String(s ?? '')
    .toUpperCase()
    .trim()
    .replace(/\s*[-_ ]\s*/g, '-')
}
// 비교용: 기호 모두 뺌 ("FT-1001" = "FT1001")
export const tagKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// ---------- 태그 글자로 계기 종류 짐작 (ISA 5.1) ----------
const VARIABLE = {
  A: '분석',
  B: '연소',
  C: '전도도',
  D: '밀도',
  E: '전압',
  F: '유량',
  H: '수동',
  I: '전류',
  J: '전력',
  K: '시간',
  L: '레벨',
  M: '수분',
  P: '압력',
  Q: '수량',
  R: '방사선',
  S: '속도',
  T: '온도',
  V: '진동',
  W: '중량',
  X: '',
  Y: '이벤트',
  Z: '위치',
}
// 뒤 글자(기능). 긴 것부터 맞춤
const FUNCTION = [
  ['ICV', '지시 조절 밸브'],
  ['SHH', '스위치 (고고)'],
  ['SLL', '스위치 (저저)'],
  ['SH', '스위치 (고)'],
  ['SL', '스위치 (저)'],
  ['AH', '경보 (고)'],
  ['AL', '경보 (저)'],
  ['IC', '지시 조절기'],
  ['RC', '기록 조절기'],
  ['CV', '조절 밸브'],
  ['SV', '안전 밸브'],
  ['IT', '지시 전송기'],
  ['QI', '적산 지시계'],
  ['T', '전송기'],
  ['I', '지시계'],
  ['E', '소자'],
  ['G', '게이지'],
  ['S', '스위치'],
  ['V', '밸브'],
  ['C', '조절기'],
  ['R', '기록계'],
  ['Y', '변환기'],
  ['A', '경보'],
  ['Q', '적산계'],
  ['O', '오리피스'],
  ['W', '써모웰'],
]
const SPECIAL = { PSV: '안전 밸브', PRV: '감압 밸브', XV: '차단 밸브', HV: '수동 밸브', ZS: '리밋 스위치', ZSO: '리밋 스위치 (열림)', ZSC: '리밋 스위치 (닫힘)', PG: '압력계', TG: '온도계', LG: '레벨 게이지', FO: '오리피스', TW: '써모웰' }

// 태그 앞 글자가 계기 종류 목록에 있으면 그 약어 ("FT-1001" → "FT"), 없으면 ''
export function guessKind(tag, kinds = KIND_PRESETS) {
  const letters = String(tag ?? '').toUpperCase().match(/^[A-Z]+/)?.[0]
  return letters && kinds.includes(letters) ? letters : ''
}

// 태그 글자로 계기 이름 풀이 (ISA 5.1, 도움말용: "FT" → "유량 전송기")
export function kindDesc(tag) {
  const letters = String(tag ?? '').toUpperCase().match(/^[A-Z]+/)?.[0]
  if (!letters || letters.length < 2) return ''
  if (SPECIAL[letters]) return SPECIAL[letters]
  let v = VARIABLE[letters[0]]
  let rest = letters.slice(1)
  if (v === undefined) return ''
  // 두 번째 글자가 변수 수식어인 경우 (PD: 차압, TD: 온도차, FQ: 적산 유량)
  if (rest[0] === 'D' && rest.length > 1) {
    v = v === '압력' ? '차압' : `${v}차`
    rest = rest.slice(1)
  }
  const f = FUNCTION.find(([k]) => rest === k)?.[1] ?? FUNCTION.find(([k]) => rest.startsWith(k))?.[1]
  if (!f) return ''
  return v ? `${v} ${f}` : f
}

// ---------- 도면 글자에서 태그 찾기 ----------
// 태그로 보기 어려운 흔한 글자 (배관 호칭, 도면 번호, 단위 등)
const STOP = new Set('DN PN SCH EL NO NOS DWG REV REF KV KW KVA HP MM CM DIA NPS ANSI ASME API ISO KS JIS ID OD TOS BOP COP FL SH'.split(' '))
// 글자 2~4개 + (하이픈·띄어쓰기) + 숫자 2~5개 + (끝 글자 하나, 또는 -A / -01 같은 꼬리)
const TAG_RE = /(?<![A-Z0-9])([A-Z]{2,4})[ -]?(\d{2,5}[A-Z]?)(?:-([A-Z]|\d{1,2}))?(?![A-Z0-9])/g
const LETTERS_ONLY = /^[A-Z]{2,4}$/
const NUMBER_ONLY = /^\d{2,5}[A-Z]?$/

const okLetters = (l) => !STOP.has(l) && VARIABLE[l[0]] !== undefined

// index: textIndex.js 색인 → [{ tag, page, rect, text }]  (같은 쪽의 같은 태그는 하나만)
export function findTags(index) {
  if (!index?.pages) return []
  const out = []
  index.pages.forEach((p, pi) => {
    const page = pi + 1
    const seen = new Set()
    const add = (tag, rect, text) => {
      const k = tagKey(tag)
      if (seen.has(k)) return
      seen.add(k)
      out.push({ tag, page, rect, text })
    }
    const items = p.items
    for (const [s, x, y, w, h] of items) {
      const up = s.toUpperCase()
      for (const m of up.matchAll(TAG_RE)) {
        if (!okLetters(m[1])) continue
        const tag = `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''}`
        // 가로쓰기 글자 덩어리에서는 태그 부분만 비율로 잘라 냄
        const rect =
          w >= h && up.length > 1
            ? { x: x + (w * m.index) / up.length, y, w: (w * m[0].length) / up.length, h }
            : { x, y, w, h }
        add(tag, rect, s)
      }
    }
    // 계기 동그라미(풍선)처럼 글자(위)와 번호(아래)가 두 줄로 나뉜 것
    const numbers = items.filter((i) => NUMBER_ONLY.test(i[0]))
    if (!numbers.length) return
    for (const [s, x, y, w, h] of items) {
      const l = s.toUpperCase()
      if (!LETTERS_ONLY.test(l) || !okLetters(l)) continue
      const cx = x + w / 2
      let best = null
      for (const n of numbers) {
        const [ns, nx, ny, nw, nh] = n
        const ncx = nx + nw / 2
        const gap = ny - (y + h)
        // 아래쪽 가까이 있고, 가운데가 서로 맞음
        if (gap < -h * 0.4 || gap > Math.max(h, nh) * 1.2) continue
        if (Math.abs(ncx - cx) > Math.max(w, nw) * 0.6) continue
        if (Math.abs(nh - h) > Math.max(h, nh) * 0.6) continue
        if (!best || gap < best.gap) best = { ns, gap, rect: { x: Math.min(x, nx), y, w: Math.max(x + w, nx + nw) - Math.min(x, nx), h: ny + nh - y } }
      }
      if (best) add(`${l}-${best.ns.toUpperCase()}`, best.rect, `${s} / ${best.ns}`)
    }
  })
  return out
}

// 찾은 태그 글자 둘레로 메모 범위 상자 (약간 넉넉하게)
export function cardBoxFor(rect) {
  const pad = Math.max(6, Math.min(rect.w, rect.h) * 0.6)
  return [
    { x: rect.x - pad, y: rect.y - pad },
    { x: rect.x + rect.w + pad, y: rect.y + rect.h + pad },
  ]
}

// ---------- 계기 목록 ----------
const r1 = (v) => Math.round(v * 10) / 10

// 도면 하나의 계기 카드 → 목록 줄 (홈 목록 요약에도 이 모양으로 넣어 둠: 모든 도면 목록이 측정값 전체를 받지 않게)
export function instRows(measurements) {
  const out = []
  for (const m of measurements ?? []) {
    if (!isInst(m) || !m.points?.length) continue
    const r = rectOf(m.points[0], m.points[1] ?? m.points[0])
    const i = m.inst
    out.push({
      id: m.id,
      page: m.page ?? 1,
      rect: [r1(r.x), r1(r.y), r1(r.w), r1(r.h)],
      tag: i.tag ?? '',
      kind: i.kind ?? '',
      status: i.status ?? DEFAULT_STATUS,
      docs: memoLinks(m).map((l) => ({ id: l.id, name: l.name, page: l.page ?? 1, role: l.role ?? '' })),
      hidden: m.hidden ? 1 : 0,
    })
  }
  return out
}

// 태그를 사람 순서로 (FT-2 < FT-10)
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
export const compareTags = (a, b) => collator.compare(a.tag || '￿', b.tag || '￿') || a.page - b.page

// CSV 한 칸
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

export function downloadInstCsv(rows, fileBase) {
  const head = ['태그', '계기 종류', '상태', '도면', '페이지', '관련 문서']
  const lines = [head, ...rows.map((r) => [r.tag, r.kind, statusOf(r.status).label, r.docName, r.page, r.docs.map((d) => `${d.role ? `${d.role}: ` : ''}${d.name}${d.page > 1 ? ` (${d.page}쪽)` : ''}`).join('; ')])]
  const csv = lines.map((l) => l.map(cell).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }) // 엑셀에서 한글이 깨지지 않게 BOM
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${fileBase || '계기'}_계기목록.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
