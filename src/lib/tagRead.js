// Equipment 박스 안 글자로 Tag. No 채우기.
// 1) 그 쪽의 PDF 글자(글자 정보)가 박스 안에 있으면 그것을,
// 2) 없으면(스캔본, 글자를 선으로 바꾼 도면) 박스 부분만 OCR. 도면 전체 OCR 을 기다리지 않고, 화면 밖 웹 워커에서 그리고 읽음.
//    계기 동그라미·가로줄은 지우고 읽고(ocrRender.worker.js clean), 영어·숫자만 읽는 OCR 을 따로 씀.
// 현장 태그 형식 00AAA00AA000 에 맞춰 자리마다 숫자/영문 헷갈림(G↔6, O↔0, S↔5, B↔8 …)을 고치고,
// 여러 번 읽은 것 중 Inst list 에 있는 태그를 먼저 고름.
// 계기 풍선처럼 두 줄("PT" / "02GCX30CP001")이면 앞 글자와 번호를 '-' 로 이어 "PT-02GCX30CP001" (태그 찾기와 같은 모양)
import { joinPicked, pickText } from './textSelect'
import { normTag } from './instrument'
import { pageTextItems } from './textIndex'
import { lookupTag } from './instList'

const PAD = 2 // 박스 테두리에 걸친 글자도 잡게 조금 넓혀 봄 (pt)
const TARGET_PX = 1600 // OCR 할 때 박스의 긴 변을 이만큼 키워 그림
const MIN_SCALE = 3
const MAX_SCALE = 12
const MAX_PIXELS = 6_000_000
const RENDERER_IDLE_MS = 60_000

const widen = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p })

// ---------- 읽은 줄 → 태그 ----------
const LETTERS = /^[A-Z]{1,5}$/
const CODE = /^(?=.*\d)[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/ // 숫자가 들어 있는 번호 (02GCX30CP001, 1001, 30-CP-001)
const TAG_LIKE = /^[A-Z]{1,5}-?(?=.*\d)[A-Z0-9][A-Z0-9-]*$/

// 한 줄 다듬기: 대문자, 계기 동그라미 테두리를 글자로 읽은 것(| ( ) [ ] 등)·한 글자 찌꺼기 빼기
function cleanLine(s) {
  const up = String(s ?? '')
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[^A-Z0-9\- ]/g, ' ')
  let tokens = up
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
  if (tokens.length > 1) tokens = tokens.filter((t) => t.length > 1)
  return tokens.join(' ')
}

// 번호 쪽 OCR 헷갈림 고치기 (형식에 안 맞는 번호용. KKS 번호는 I·O 를 쓰지 않음)
// 0 하나를 "0O" 처럼 두 번 읽는 일이 잦아 붙어 있는 0·O 는 0 하나로, 나머지 숫자 옆 O → 0, I → 1
const fixCode = (c) => c.replace(/0O|O0/g, '0').replace(/(?<=\d)[O]|[O](?=\d)/g, '0').replace(/(?<=\d)[I]|[I](?=\d)/g, '1')

// ---------- 현장 태그 형식: 00AAA00AA000 (KKS, 예 02GCX30CP001) ----------
// 자리마다 숫자(D)인지 영문(A)인지 정해져 있어서, OCR 이 헷갈린 글자(G↔6, O↔0, S↔5, B↔8 …)를 자리에 맞게 바꿈
export const TAG_FORMAT = 'DDAAADDAADDD'
const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', C: '0', I: '1', L: '1', J: '1', Z: '2', E: '3', A: '4', H: '4', S: '5', G: '6', B: '8', T: '7', Y: '7', P: '9', R: '8' }
const TO_LETTER = { 0: 'D', 1: 'I', 2: 'Z', 3: 'B', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B', 9: 'P' }
const isDigit = (ch) => ch >= '0' && ch <= '9'

// 형식에 맞추기 → { code, fixes(바꾼 글자 수) } | null. 같은 길이만 (못 바꾸는 글자가 있으면 null)
function fitExact(s) {
  if (s.length !== TAG_FORMAT.length) return null
  let code = ''
  let fixes = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (TAG_FORMAT[i] === 'D') {
      if (isDigit(ch)) code += ch
      else if (TO_DIGIT[ch]) {
        code += TO_DIGIT[ch]
        fixes++
      } else return null
    } else if (!isDigit(ch)) code += ch
    else if (TO_LETTER[ch]) {
      code += TO_LETTER[ch]
      fixes++
    } else return null
  }
  return { code, fixes }
}
// 한 글자를 두 번 읽은 경우(13글자)도: 한 글자씩 빼 보고 가장 덜 고친 것
export function fitTagFormat(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  let best = fitExact(s)
  if (!best && s.length === TAG_FORMAT.length + 1)
    for (let i = 0; i < s.length; i++) {
      const f = fitExact(s.slice(0, i) + s.slice(i + 1))
      if (f && (!best || f.fixes < best.fixes)) best = f
    }
  // 너무 많이 바꿔야 하면 이 형식이 아님 (숫자 자리 7개가 다 영문으로 읽힐 수는 있음)
  return best && best.fixes <= 7 ? best : null
}
// 종류 줄(PT, FT, PDT …): 숫자로 읽힌 글자를 영문으로
const kindLetters = (s) => {
  const t = s.replace(/\s+/g, '')
  if (!/^[A-Z0-9]{1,5}$/.test(t) || !/[A-Z]/.test(t)) return ''
  return [...t].map((ch) => (isDigit(ch) ? TO_LETTER[ch] : ch)).join('')
}

// 형식(00AAA00AA000)에 맞는 번호가 있으면 [종류-]번호, 없으면 ''
function formatTag(lines) {
  for (let i = 0; i < lines.length; i++) {
    const compact = lines[i].replace(/[\s-]+/g, '')
    const fit = fitTagFormat(compact)
    if (fit) {
      const kind = i > 0 ? kindLetters(lines[i - 1]) : ''
      return kind ? `${kind}-${fit.code}` : fit.code
    }
    // 한 줄에 종류와 번호가 같이 ("PT 02GCX30CP001", "PT-02GCX30CP001")
    const parts = lines[i].split(/[\s-]+/).filter(Boolean)
    if (parts.length >= 2) {
      const f = fitTagFormat(parts.slice(1).join(''))
      const kind = kindLetters(parts[0])
      if (f && kind) return `${kind}-${f.code}`
    }
  }
  return ''
}

// 박스 안 글자(줄 바꿈으로 나뉜 글) → Tag. No ('' 이면 못 찾음)
export function tagFromText(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
  if (!lines.length) return ''
  const formatted = formatTag(lines)
  if (formatted) return formatted
  // 형식에 안 맞는 태그 (FT-1001 등)
  // 위 줄 글자 + 아래 줄 번호 (계기 풍선)
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i]
    const b = lines[i + 1].replace(/\s+/g, '')
    if (LETTERS.test(a) && CODE.test(b)) return `${a}-${fixCode(b)}`
  }
  // 한 줄에 다 있는 것 ("FT-1001")
  for (const l of lines) {
    const t = normTag(l)
    if (TAG_LIKE.test(t)) return t
  }
  // 번호만 있는 줄
  const code = lines.map((l) => l.replace(/\s+/g, '')).find((l) => CODE.test(l))
  return code ? fixCode(code) : ''
}

// ---------- 박스 부분 OCR (렌더러는 도면마다 하나, 잠시 안 쓰면 닫음) ----------
const renderers = new WeakMap()
function getRenderer(pdfDoc) {
  let entry = renderers.get(pdfDoc)
  if (!entry) {
    entry = { promise: import('./ocr').then(({ openRenderer }) => openRenderer(pdfDoc)), timer: null }
    entry.promise.catch(() => renderers.delete(pdfDoc))
    renderers.set(pdfDoc, entry)
  }
  clearTimeout(entry.timer)
  entry.timer = setTimeout(async () => {
    renderers.delete(pdfDoc)
    ;(await entry.promise.catch(() => null))?.close()
  }, RENDERER_IDLE_MS)
  return entry.promise
}

// OCR 은 같은 그림도 크기에 따라 다르게 읽을 때가 있어(0 을 두 번 읽는 등) 크기 세 가지로 읽고 가장 많이 나온 태그를 씀
async function ocrBox(pdfDoc, pdfPage, r) {
  const { ocrRegion } = await import('./ocr')
  const renderer = await getRenderer(pdfDoc)
  let scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, TARGET_PX / Math.max(r.w, r.h)))
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(1, r.w * r.h)))
  const votes = new Map()
  const vote = (tag, text, conf) => {
    const v = votes.get(tag) ?? { tag, text, n: 0, conf: 0, listed: !!lookupTag(tag), fits: !!fitTagFormat(tag.split('-').pop()) }
    v.n++
    v.conf = Math.max(v.conf, conf)
    votes.set(tag, v)
    return v
  }
  for (const s of [scale, scale * 0.6, scale * 0.35]) {
    if (s < 2) continue
    const lines = await ocrRegion(renderer, pdfPage, r, s)
    const text = joinPicked(lines.map((l) => ({ text: l.s, rect: l, cy: l.y + l.h / 2, h: l.h })))
    const tag = tagFromText(text)
    if (!tag) continue
    const conf = lines.reduce((a, l) => a + l.conf, 0) / lines.length
    const v = vote(tag, text, conf)
    if (v.listed || (v.fits && v.n >= 2)) break // Inst list 에 있거나, 형식에 맞는 같은 태그가 두 번이면 충분
  }
  // Inst list 에 있는 태그 > 형식(00AAA00AA000)에 맞는 태그 > 여러 번 나온 것 > 확실한 것
  const best = [...votes.values()].sort((a, b) => b.listed - a.listed || b.fits - a.fits || b.n - a.n || b.conf - a.conf)[0]
  return best ? { tag: best.tag, text: best.text, ocr: true } : null
}

// 박스 r(배율 1 페이지 좌표) 안의 태그 → { tag, text, ocr } | null
// (도면 글자 색인의 OCR 결과는 도면 전체를 한꺼번에 읽은 것이라 덜 정확해서 쓰지 않고, 박스만 다시 읽음)
export async function readTagInBox({ pdfDoc, page, rect }) {
  const r = widen(rect, PAD)
  const fromItems = (items) => {
    const text = joinPicked(pickText(items, r))
    const tag = tagFromText(text)
    return tag ? { tag, text, ocr: false } : null
  }
  const pdfPage = await pdfDoc.getPage(page)
  const items = (await pageTextItems(pdfPage)).map((i) => [i.s.trim(), i.x, i.y, i.w, i.h]).filter((i) => i[0])
  const hit = fromItems(items)
  if (hit) return hit
  return ocrBox(pdfDoc, pdfPage, r)
}
