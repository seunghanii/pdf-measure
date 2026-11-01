// 메모 글 ↔ 메모장 화면(HTML). 라이브러리 없이 메모에 쓰는 만큼만 다룹니다.
// 저장은 예전처럼 글자(마크다운)로 하고, 한 줄이 한 덩어리입니다. 그래서 예전 일반 글 메모는 그대로 열리고 그대로 저장됩니다.
//   # 제목, ## 소제목, ### 작은 제목, - 목록, 1. 번호 목록, - [ ] 할 일, > 인용, --- 구분선
//   **굵게**, *기울임*, ~~취소선~~, | 표 | (첫 줄은 머리줄, 둘째 줄은 |---|), 사진은 한 줄에 ![사진](img:사진id)
//   엑셀·구글 시트에서 붙여넣은 표는 양식(열 너비·병합·색·테두리·글꼴·정렬)을 살려 한 줄에 @xls {...} 로 저장
// 화면 HTML 은 여기서 글자를 이스케이프해 직접 만들기 때문에 붙여넣은 HTML 의 스크립트·스타일은 들어오지 않습니다.

import { cellsOf, RULE, TABLE_ROW, TABLE_SEP, XLS_LINE } from './memoPlain'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const HEADING = /^(#{1,3}) (.*)$/
const TASK = /^[-*+] \[([ xX])\] ?(.*)$/
const BULLET = /^[-*+] (.*)$/
const ORDERED = /^\d+[.)] (.*)$/
const QUOTE = /^> ?(.*)$/
const PHOTO_LINE = /^\s*!\[[^\]]*\]\(img:([a-z0-9]+)\)\s*$/
const ESCAPED_START = /^\\([#>\-*+|\d@])/

// ---------- 글 → HTML ----------

// 줄 안 꾸밈: **굵게** *기울임* ~~취소선~~, \ 로 기호 그대로
export function inlineHtml(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length && /[\\*~`|#>\-+_[\]@]/.test(s[i + 1])) {
      out += esc(s[i + 1])
      i += 2
      continue
    }
    const rest = s.slice(i)
    let m
    if ((m = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest))) {
      out += `<strong>${inlineHtml(m[1])}</strong>`
      i += m[0].length
    } else if ((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
      out += `<s>${inlineHtml(m[1])}</s>`
      i += m[0].length
    } else if ((m = /^\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/.exec(rest)) || (c === '*' && (m = /^\*([^\s*])\*/.exec(rest)))) {
      out += `<em>${inlineHtml(m[1])}</em>`
      i += m[0].length
    } else if (s.startsWith('<br>', i)) {
      out += '<br>'
      i += 4
    } else {
      out += esc(c)
      i++
    }
  }
  return out
}


// 표 HTML. rows: 칸 글(마크다운 줄 안 꾸밈 그대로)의 2차원 배열, 첫 줄은 머리줄
export function tableHtml(rows) {
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const cell = (tag, s) => `<${tag}>${s ? inlineHtml(s) : '<br>'}</${tag}>`
  const tr = (r, tag) => `<tr>${Array.from({ length: cols }, (_, i) => cell(tag, r[i] ?? '')).join('')}</tr>`
  // thead 는 쓰지 않음: 크롬이 붙여넣을 때 thead 를 표 밖으로 빼 버림
  return `<table><tbody>${tr(rows[0] ?? [], 'th')}${rows
    .slice(1)
    .map((r) => tr(r, 'td'))
    .join('')}</tbody></table>`
}

// 글 사이 사진 한 장 (편집 안 되는 덩어리. 주소는 메모장이 불러와서 채움)
export const photoHtml = (id) =>
  `<div class="memo-photo" data-img="${esc(id)}" contenteditable="false"><img alt="사진"><button type="button" data-del title="이 사진 빼기" aria-label="이 사진 빼기">×</button></div>`

// 메모 글 전체 → 메모장 HTML
export function markdownToHtml(md) {
  const lines = String(md ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const out = []
  let list = null // { tag, items: [] }
  const closeList = () => {
    if (list) out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`)
    list = null
  }
  const addItem = (tag, html) => {
    if (list?.tag !== tag) {
      closeList()
      list = { tag, items: [] }
    }
    list.items.push(html)
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m
    if ((m = PHOTO_LINE.exec(line))) {
      closeList()
      out.push(photoHtml(m[1]))
    } else if ((m = XLS_LINE.exec(line)) && (m = readXls(m[1]))) {
      closeList()
      out.push(xlsTableHtml(m))
    } else if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      closeList()
      const rows = [cellsOf(line)]
      i += 2
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cellsOf(lines[i++]))
      i--
      out.push(tableHtml(rows))
    } else if ((m = TASK.exec(line))) {
      addItem('ul', `<li data-task="${m[1] === ' ' ? '0' : '1'}">${inlineHtml(m[2]) || '<br>'}</li>`)
    } else if ((m = BULLET.exec(line)) && !RULE.test(line)) {
      addItem('ul', `<li>${inlineHtml(m[1]) || '<br>'}</li>`)
    } else if ((m = ORDERED.exec(line))) {
      addItem('ol', `<li>${inlineHtml(m[1]) || '<br>'}</li>`)
    } else {
      closeList()
      if (RULE.test(line)) out.push('<hr>')
      else if ((m = HEADING.exec(line))) out.push(`<h${m[1].length}>${inlineHtml(m[2]) || '<br>'}</h${m[1].length}>`)
      else if ((m = QUOTE.exec(line))) out.push(`<blockquote>${inlineHtml(m[1]) || '<br>'}</blockquote>`)
      else out.push(`<p>${inlineHtml(line.replace(ESCAPED_START, '$1')) || '<br>'}</p>`)
    }
  }
  closeList()
  // 마지막이 표·구분선·사진이면 그 뒤에 글을 쓸 수 있게 빈 줄 하나
  if (!out.length || /^<(table|hr|div class="memo-photo")/.test(out[out.length - 1])) out.push('<p><br></p>')
  return out.join('')
}

// ---------- 화면(DOM) → 글 ----------

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'HR', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'FIGURE', 'DL', 'DT', 'DD'])
const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'COLGROUP', 'COL', 'INPUT', 'BUTTON', 'SVG', 'IMG'])

const escText = (s) => s.replace(/\\/g, '\\\\').replace(/([*~])/g, '\\$1')

// 꾸밈 판단: 태그 또는 붙여넣은 HTML 의 style (엑셀·워드·웹은 font-weight 로 굵게를 표시하기도 함)
function marksOf(el) {
  const t = el.tagName
  const st = el.style
  return {
    b: t === 'STRONG' || t === 'B' || (st && (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600)),
    i: t === 'EM' || t === 'I' || (st && st.fontStyle === 'italic'),
    s: t === 'S' || t === 'STRIKE' || t === 'DEL' || (st && /line-through/.test(st.textDecoration || st.textDecorationLine || '')),
  }
}

// 줄 안 내용 → 마크다운. inCell: 표 칸이면 | 와 줄바꿈을 바꿔 적음
function inlineMd(node, inCell = false) {
  let out = ''
  for (const ch of node.childNodes) {
    if (ch.nodeType === 3) {
      let t = ch.nodeValue.replace(/​/g, '').replace(/ /g, ' ')
      t = escText(t)
      if (inCell) t = t.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
      else t = t.replace(/\n/g, ' ')
      out += t
    } else if (ch.nodeType === 1) {
      if (SKIP_TAGS.has(ch.tagName)) continue
      if (ch.tagName === 'BR') {
        // 덩어리 끝의 <br> 은 빈 줄 자리표시라 무시
        if (ch.nextSibling || inCell) out += inCell ? (ch.nextSibling ? '<br>' : '') : ' '
        continue
      }
      const inner = inlineMd(ch, inCell)
      if (!inner.trim()) {
        out += inner
        continue
      }
      const m = marksOf(ch)
      // 꾸밈 기호는 글자에 바로 붙어야 해서 앞뒤 공백은 밖으로
      const lead = inner.match(/^\s*/)[0]
      const tail = inner.match(/\s*$/)[0]
      let core = inner.trim()
      if (m.s) core = `~~${core}~~`
      if (m.i) core = `*${core}*`
      if (m.b) core = `**${core}**`
      out += lead + core + tail
    }
  }
  return out
}

// 덩어리 맨 앞이 마크다운 기호처럼 보이면 \ 를 붙여 일반 글로 남김
const guardStart = (s) => (/^(#{1,6} |[-*+] |\d+[.)] |> |\||@xls )/.test(s) || RULE.test(s) ? `\\${s}` : s)

const hasBlockChild = (el) => [...el.children].some((c) => BLOCK_TAGS.has(c.tagName))

// 표 → 칸 마크다운 2차원 배열 (합친 칸은 빈 칸으로 채움)
export function tableRows(table) {
  const rows = []
  for (const tr of table.querySelectorAll('tr')) {
    if (tr.closest('table') !== table) continue
    const row = []
    for (const cell of tr.children) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue
      const text = inlineMd(cell, true).trim()
      row.push(text)
      const span = Math.min(50, Number(cell.getAttribute('colspan')) || 1)
      for (let k = 1; k < span; k++) row.push('')
    }
    rows.push(row)
  }
  return rows
}

export function rowsToMarkdown(rows) {
  if (!rows.length) return []
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] || ' ').join(' | ')} |`
  return [line(rows[0]), `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map(line)]
}

// 덩어리 단위로 마크다운 줄 목록을 만듦
function blockLines(el, out) {
  let inline = null // 덩어리 밖에 떠 있는 글자 모음
  const flushInline = () => {
    const s = inline ? inlineMd(inline).trim() : ''
    if (s) out.push(guardStart(s))
    inline = null
  }
  for (const ch of el.childNodes) {
    const isBlock = ch.nodeType === 1 && BLOCK_TAGS.has(ch.tagName)
    if (!isBlock) {
      if (ch.nodeType === 1 && SKIP_TAGS.has(ch.tagName)) continue
      if (ch.nodeType === 3 && !inline && !ch.nodeValue.trim()) continue
      if (!inline) inline = ch.ownerDocument.createElement('span')
      inline.appendChild(ch.cloneNode(true))
      continue
    }
    flushInline()
    const t = ch.tagName
    if (ch.dataset?.img) out.push(`![사진](img:${ch.dataset.img})`)
    else if (t === 'TABLE' && ch.dataset?.xls) out.push(`@xls ${JSON.stringify(xlsFromDom(ch))}`)
    else if (t === 'TABLE') out.push(...rowsToMarkdown(tableRows(ch)))
    else if (t === 'HR') out.push('---')
    else if (t === 'UL' || t === 'OL') {
      let n = 1
      for (const li of ch.children) {
        if (li.tagName !== 'LI') {
          blockLines(li, out)
          continue
        }
        // 목록 안 목록(웹에서 붙여넣은 것)은 평평하게
        const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL')
        const clone = li.cloneNode(true)
        for (const c of clone.querySelectorAll(':scope > ul, :scope > ol')) c.remove()
        const text = hasBlockChild(clone) ? clone.textContent.replace(/\s+/g, ' ').trim() : inlineMd(clone).trim()
        const task = li.dataset?.task
        if (task !== undefined) out.push(`- [${task === '1' ? 'x' : ' '}] ${text}`.trimEnd())
        else out.push(t === 'OL' ? `${n++}. ${text}` : `- ${text}`)
        for (const c of nested) blockLines({ childNodes: [c] }, out)
      }
    } else if (/^H[1-6]$/.test(t)) {
      out.push(`${'#'.repeat(Math.min(3, Number(t[1])))} ${inlineMd(ch).trim()}`)
    } else if (t === 'BLOCKQUOTE') {
      if (hasBlockChild(ch)) {
        const inner = []
        blockLines(ch, inner)
        out.push(...inner.map((l) => `> ${l}`))
      } else out.push(`> ${inlineMd(ch).trim()}`.trimEnd())
    } else if (t === 'PRE') {
      out.push(...ch.textContent.replace(/\n$/, '').split('\n').map((l) => guardStart(escText(l))))
    } else if (hasBlockChild(ch)) {
      blockLines(ch, out)
    } else {
      out.push(guardStart(inlineMd(ch).replace(/\s+$/, '').replace(/^\s+/, '')))
    }
  }
  flushInline()
}

// 메모장(또는 붙여넣은 HTML) → 메모 글
export function htmlToMarkdown(root) {
  const out = []
  blockLines(root, out)
  return out.join('\n').replace(/\n+$/, '')
}

// ---------- 붙여넣기 ----------

// 엑셀·구글 시트가 복사하는 탭 구분 글 → 칸 2차원 배열 (따옴표로 감싼 칸 속 줄바꿈 처리)
export function parseTsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let q = false
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"' && cell === '') q = true
    else if (c === '\t') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell)
  rows.push(row)
  return rows
}

// 탭 구분 글을 표 칸 마크다운으로 (칸 속 기호는 글자 그대로)
export const tsvRows = (text) => parseTsv(text).map((r) => r.map((c) => escText(c.trim()).replace(/\|/g, '\\|').replace(/\n/g, '<br>')))

// ---------- 양식 있는 표 (엑셀·구글 시트에서 붙여넣은 것) ----------
// 저장 모양: { w: [열 너비 px, ...], rows: [{ h: 행 높이 px | 0, c: [{ t: 칸 글(줄 안 꾸밈), s: "css", cs, rs }] }] }
// 병합으로 가려진 칸은 c 에 넣지 않습니다 (HTML 표와 같음).

// 칸 꾸밈으로 받아 주는 것만 (붙여넣은 HTML 의 다른 스타일·스크립트는 버림)
const XLS_PROPS = [
  'background-color', 'color', 'font-weight', 'font-style', 'font-size', 'font-family', 'text-decoration-line', 'text-align', 'vertical-align', 'white-space', 'padding-left',
  ...['top', 'right', 'bottom', 'left'].flatMap((side) => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]),
]
const SIDES = ['top', 'right', 'bottom', 'left']
const XLS_PROP_SET = new Set([...XLS_PROPS, ...SIDES.map((x) => `border-${x}`)])
const SAFE_VALUE = /^[#\p{L}\p{N}_\s.,%()'"\-+]*$/u

// "a:b;c:d" → 허용된 것만 다시 이어 붙임
export function cleanCss(css) {
  const out = []
  for (const part of String(css ?? '').split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const prop = part.slice(0, i).trim().toLowerCase()
    const val = part.slice(i + 1).trim()
    if (!XLS_PROP_SET.has(prop) || !val || val.length > 120 || !SAFE_VALUE.test(val) || /url|expression|javascript/i.test(val)) continue
    out.push(`${prop}:${val}`)
  }
  return out.join(';')
}

const clampPx = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)))

function readXls(json) {
  try {
    const d = JSON.parse(json)
    if (!d || !Array.isArray(d.rows)) return null
    return d
  } catch {
    return null
  }
}

export function xlsTableHtml(d) {
  const w = Array.isArray(d.w) ? d.w.map((x) => clampPx(x, 2000)) : []
  const total = w.reduce((n, x) => n + x, 0)
  const cols = w.length ? `<colgroup>${w.map((x) => `<col style="width:${x}px">`).join('')}</colgroup>` : ''
  const rows = d.rows
    .map((r) => {
      const h = clampPx(r?.h, 600)
      const cells = (Array.isArray(r?.c) ? r.c : [])
        .map((c) => {
          const cs = clampPx(c?.cs, 200)
          const rs = clampPx(c?.rs, 1000)
          const css = cleanCss(c?.s)
          const text = typeof c?.t === 'string' ? c.t : ''
          return `<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${css ? ` style="${esc(css)}"` : ''}>${text ? inlineHtml(text) : '<br>'}</td>`
        })
        .join('')
      return `<tr${h ? ` style="height:${h}px"` : ''}>${cells || '<td><br></td>'}</tr>`
    })
    .join('')
  const font = d.f ? cleanCss(`font-family:${d.f}`) : ''
  const tstyle = [total ? `min-width:${total}px` : '', font].filter(Boolean).join(';')
  return `<table class="memo-xls" data-xls="1"${font ? ` data-font="${esc(d.f)}"` : ''}${tstyle ? ` style="${esc(tstyle)}"` : ''}>${cols}<tbody>${rows}</tbody></table>`
}

// 메모장 화면의 양식 표 → 저장 모양
function xlsFromDom(table) {
  const w = [...table.querySelectorAll(':scope > colgroup > col')].map((c) => clampPx(parseFloat(c.style.width), 2000))
  const rows = []
  for (const tr of table.querySelectorAll('tr')) {
    if (tr.closest('table') !== table) continue
    const c = []
    for (const cell of tr.children) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue
      const o = { t: inlineMd(cell, true).trim() }
      const css = cleanCss(cell.getAttribute('style'))
      if (css) o.s = css
      const cs = Number(cell.getAttribute('colspan')) || 1
      const rs = Number(cell.getAttribute('rowspan')) || 1
      if (cs > 1) o.cs = cs
      if (rs > 1) o.rs = rs
      c.push(o)
    }
    const row = { c }
    const h = clampPx(parseFloat(tr.style.height), 600)
    if (h) row.h = h
    rows.push(row)
  }
  const out = { rows }
  if (w.some(Boolean)) out.w = w
  if (table.dataset.font) out.f = table.dataset.font
  return out
}

// 붙여넣은 HTML 이 엑셀·구글 시트 표인지 (양식을 살릴지)
export const isSheetHtml = (html) => /urn:schemas-microsoft-com:office:excel|ProgId content=Excel|google-sheets-html-origin|<td[^>]*(rowspan|colspan)\s*=\s*"?([2-9]|\d\d)/i.test(html)

// 붙여넣은 표(DOMParser 문서 안) → 저장 모양. 엑셀은 <style> 의 .xl65 같은 규칙으로 꾸미므로 그 규칙을 칸마다 풀어 넣음
export function xlsFromPaste(table, doc) {
  const rules = []
  for (const st of doc.querySelectorAll('style')) {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(st.textContent.replace(/<!--|-->/g, ''))
      for (const r of sheet.cssRules) if (r.selectorText && r.style) rules.push(r)
    } catch {
      /* 못 읽는 규칙은 건너뜀 */
    }
  }
  const scratch = document.createElement('div').style
  // 표 전체 글꼴(구글 시트는 table 에 둠)을 기본으로
  const base = {}
  for (const p of ['font-family', 'font-size', 'color']) {
    const v = table.style?.getPropertyValue(p)
    if (v) base[p] = v
  }
  const styleOf = (cell) => {
    scratch.cssText = ''
    for (const [p, v] of Object.entries(base)) scratch.setProperty(p, v)
    for (const r of rules) {
      let hit = false
      try {
        hit = cell.matches(r.selectorText)
      } catch {
        hit = false
      }
      if (!hit) continue
      for (let i = 0; i < r.style.length; i++) {
        const p = r.style[i]
        scratch.setProperty(p, r.style.getPropertyValue(p))
      }
    }
    const align = cell.getAttribute('align')
    if (align) scratch.setProperty('text-align', align.toLowerCase())
    const valign = cell.getAttribute('valign')
    if (valign) scratch.setProperty('vertical-align', valign.toLowerCase() === 'center' ? 'middle' : valign.toLowerCase())
    const bg = cell.getAttribute('bgcolor')
    if (bg) scratch.setProperty('background-color', bg)
    const inline = cell.style
    for (let i = 0; i < inline.length; i++) scratch.setProperty(inline[i], inline.getPropertyValue(inline[i]))
    const out = []
    const get = (p) => scratch.getPropertyValue(p)
    for (const p of XLS_PROPS) {
      let v = get(p)
      if (!v || p.startsWith('border-') || /^(initial|inherit|unset)$/.test(v)) continue
      if (p === 'background-color' && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(v)) continue
      // 기본값은 적지 않음 (저장 크기 줄이기)
      if ((p === 'font-weight' && (v === '400' || v === 'normal')) || (p === 'font-style' && v === 'normal') || (p === 'text-decoration-line' && v === 'none')) continue
      if ((p === 'white-space' && /^(nowrap|pre)$/.test(v)) || (p === 'vertical-align' && /^(baseline|bottom)$/.test(v)) || (p === 'padding-left' && parseFloat(v) <= 2)) continue
      if (p === 'color' && /^(black|windowtext|rgb\(0, 0, 0\)|#000000)$/i.test(v)) continue
      if (p === 'white-space' && v === 'normal') v = 'pre-wrap'
      if (p === 'font-family') v = v.replace(/\bmonospace\b/g, 'sans-serif')
      out.push(`${p}:${v.replace(/;/g, '')}`)
    }
    for (const side of SIDES) {
      const st = get(`border-${side}-style`)
      if (!st || st === 'none' || st === 'hidden') continue
      const c = get(`border-${side}-color`) || 'black'
      out.push(`border-${side}:${get(`border-${side}-width`) || '1px'} ${st} ${/^(windowtext|currentcolor)$/i.test(c) ? 'black' : c}`)
    }
    return cleanCss(out.join(';'))
  }
  // 열 너비: <col width=64 span=2> 또는 style width
  const w = []
  for (const col of table.querySelectorAll('col')) {
    const span = Math.min(200, Number(col.getAttribute('span')) || 1)
    const px = Number(col.getAttribute('width')) || ptOrPx(col.style.width)
    for (let k = 0; k < span; k++) w.push(clampPx(px, 2000))
  }
  const rows = []
  for (const tr of table.querySelectorAll('tr')) {
    if (tr.closest('table') !== table) continue
    const c = []
    for (const cell of tr.children) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue
      const o = { t: inlineMd(cell, true).trim() }
      const css = styleOf(cell)
      if (css) o.s = css
      const cs = Math.min(200, Number(cell.getAttribute('colspan')) || 1)
      const rs = Math.min(1000, Number(cell.getAttribute('rowspan')) || 1)
      if (cs > 1) o.cs = cs
      if (rs > 1) o.rs = rs
      c.push(o)
    }
    const row = { c }
    const h = Number(tr.getAttribute('height')) || ptOrPx(tr.style.height)
    if (h) row.h = clampPx(h, 600)
    rows.push(row)
  }
  // 모든 칸에 되풀이되는 기본 글꼴 이름은 빼고 표에 한 번만 (f)
  const fams = new Map()
  const famOf = (css) => /(?:^|;)font-family:([^;]*)/.exec(css ?? '')?.[1]
  for (const r of rows) for (const cell of r.c) if (famOf(cell.s)) fams.set(famOf(cell.s), (fams.get(famOf(cell.s)) ?? 0) + 1)
  const common = [...fams].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (common)
    for (const r of rows)
      for (const cell of r.c) {
        if (famOf(cell.s) !== common) continue
        cell.s = cell.s.replace(/(^|;)font-family:[^;]*/, '').replace(/^;/, '')
        if (!cell.s) delete cell.s
      }
  const out = { rows }
  if (w.some(Boolean)) out.w = w
  if (common) out.f = common
  return out
}

// "48pt" → 64, "100px" → 100
function ptOrPx(v) {
  const m = /^([\d.]+)(pt|px)?$/.exec(String(v ?? '').trim())
  if (!m) return 0
  return m[2] === 'pt' ? (Number(m[1]) * 96) / 72 : Number(m[1])
}
