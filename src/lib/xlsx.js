// .xlsx/.xlsm 을 브라우저 안에서 직접 읽습니다 (값 + 양식). 매크로는 실행하지 않습니다.
// 읽는 양식: 열 너비, 행 높이, 숨긴 행·열, 병합 셀, 자동 필터, 글꼴(이름·크기·굵게·기울임·밑줄·취소선·색),
// 채우기 색, 테두리, 정렬(가로·세로·줄바꿈·들여쓰기), 표시 형식(0.00, #,##0, 날짜 …), 눈금선 표시 여부.
// excel.js 가 처음 엑셀을 열 때만 불러옵니다.

import { unzipSync, inflateSync, strFromU8 } from 'fflate'
import { builtinFormat, formatValue } from './numfmt'

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// 엑셀 기본 64색 (indexed 색)
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
]
// 테마 파일이 없을 때 쓰는 Office 기본 테마 색 (lt1 dk1 lt2 dk2 accent1~6 hlink folHlink 순서로 바꿔 둠)
const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72']

const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : [])
const kid = (el, name) => (el ? [...el.children].find((c) => c.localName === name) : undefined)
const num = (v, d = 0) => (v == null || v === '' ? d : Number(v))
const isTrue = (el, attr = 'val') => !!el && el.getAttribute(attr) !== '0' && el.getAttribute(attr) !== 'false'

function parseXml(files, path) {
  const f = files[path]
  if (!f) return null
  const doc = new DOMParser().parseFromString(strFromU8(f), 'application/xml')
  return doc.querySelector('parsererror') ? null : doc
}

// 셀 주소 "C12" → { r: 12, c: 3 }
export function parseRef(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref ?? '')
  if (!m) return null
  const c = [...m[1].toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
  return { r: Number(m[2]), c }
}

// ---------- 색 ----------
function hexToHsl(hex) {
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}
function hslToHex(h, s, l) {
  const f = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r, g, b
  if (s === 0) r = g = b = l
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = f(p, q, h + 1 / 3)
    g = f(p, q, h)
    b = f(p, q, h - 1 / 3)
  }
  return [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}
// 밝기 조절(tint): 음수면 어둡게, 양수면 밝게
function applyTint(hex, tint) {
  if (!tint) return hex
  const [h, s, l] = hexToHsl(hex)
  const nl = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  return hslToHex(h, s, nl)
}

function readColor(el, theme) {
  if (!el) return null
  if (el.getAttribute('auto') === '1') return null
  let hex = null
  const rgb = el.getAttribute('rgb')
  if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb.slice(-6)
  else if (el.hasAttribute('theme')) hex = theme[num(el.getAttribute('theme'))] ?? null
  else if (el.hasAttribute('indexed')) {
    const i = num(el.getAttribute('indexed'))
    if (i === 64 || i === 65) return null // 시스템 앞색·바탕색
    hex = INDEXED[i] ?? null
  }
  if (!hex || !/^[0-9A-F]{6}$/i.test(hex)) return null
  return '#' + applyTint(hex.toUpperCase(), num(el.getAttribute('tint')))
}

function readTheme(files, rels) {
  const t = Object.entries(rels).find(([, r]) => /theme$/.test(r.type))
  const doc = t ? parseXml(files, t[1].target) : parseXml(files, 'xl/theme/theme1.xml')
  if (!doc) return DEFAULT_THEME
  const scheme = doc.getElementsByTagNameNS('*', 'clrScheme')[0]
  if (!scheme) return DEFAULT_THEME
  const order = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
  const vals = order.map((n) => {
    const el = kid(scheme, n)
    const c = el && el.firstElementChild
    if (!c) return null
    return (c.getAttribute('lastClr') || c.getAttribute('val') || '').toUpperCase() || null
  })
  // 엑셀의 theme 번호는 lt1, dk1, lt2, dk2 순서
  const out = [vals[1], vals[0], vals[3], vals[2], ...vals.slice(4)]
  return out.map((v, i) => (v && /^[0-9A-F]{6}$/.test(v) ? v : DEFAULT_THEME[i]))
}

// ---------- 양식 ----------
function readFont(el, theme) {
  if (!el) return {}
  const u = kid(el, 'u')
  return {
    name: kid(el, 'name')?.getAttribute('val') ?? null,
    sz: num(kid(el, 'sz')?.getAttribute('val'), 11),
    b: isTrue(kid(el, 'b')),
    i: isTrue(kid(el, 'i')),
    u: !!u && u.getAttribute('val') !== 'none',
    strike: isTrue(kid(el, 'strike')),
    color: readColor(kid(el, 'color'), theme),
    va: kid(el, 'vertAlign')?.getAttribute('val') ?? null,
  }
}

function readStyles(files, theme) {
  const doc = parseXml(files, 'xl/styles.xml')
  const out = { numFmts: {}, xfs: [], fonts: [], fills: [], borders: [] }
  if (!doc) return out
  const root = doc.documentElement
  for (const f of kids(kid(root, 'numFmts'), 'numFmt')) out.numFmts[num(f.getAttribute('numFmtId'))] = f.getAttribute('formatCode')
  out.fonts = kids(kid(root, 'fonts'), 'font').map((f) => readFont(f, theme))
  out.fills = kids(kid(root, 'fills'), 'fill').map((f) => {
    const p = kid(f, 'patternFill')
    if (p) {
      const type = p.getAttribute('patternType')
      if (!type || type === 'none') return null
      const fg = readColor(kid(p, 'fgColor'), theme)
      const bg = readColor(kid(p, 'bgColor'), theme)
      return type === 'solid' ? fg ?? bg : fg ?? bg
    }
    const g = kid(f, 'gradientFill')
    if (g) return readColor(kid(kids(g, 'stop')[0], 'color'), theme)
    return null
  })
  out.borders = kids(kid(root, 'borders'), 'border').map((b) => {
    const side = (n) => {
      const el = kid(b, n) ?? (n === 'left' ? kid(b, 'start') : n === 'right' ? kid(b, 'end') : null)
      const style = el?.getAttribute('style')
      if (!style || style === 'none') return null
      return { style, color: readColor(kid(el, 'color'), theme) ?? '#000000' }
    }
    return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') }
  })
  out.xfs = kids(kid(root, 'cellXfs'), 'xf').map((x) => {
    const a = kid(x, 'alignment')
    return {
      numFmtId: num(x.getAttribute('numFmtId')),
      fontId: num(x.getAttribute('fontId')),
      fillId: num(x.getAttribute('fillId')),
      borderId: num(x.getAttribute('borderId')),
      h: a?.getAttribute('horizontal') ?? null,
      v: a?.getAttribute('vertical') ?? null,
      wrap: isTrue(a, 'wrapText') && a?.hasAttribute('wrapText'),
      indent: num(a?.getAttribute('indent')),
      shrink: a?.getAttribute('shrinkToFit') === '1',
    }
  })
  return out
}

// 공유 글자 (글자 일부만 꾸민 것은 조각 runs 로)
function readSharedStrings(files, path, theme) {
  const doc = parseXml(files, path)
  if (!doc) return []
  return kids(doc.documentElement, 'si').map((si) => richText(si, theme))
}
function richText(si, theme) {
  const runs = kids(si, 'r')
  if (!runs.length) return kids(si, 't').map((t) => t.textContent).join('')
  const parts = runs.map((r) => ({ t: kids(r, 't').map((t) => t.textContent).join(''), font: kid(r, 'rPr') ? readFont(kid(r, 'rPr'), theme) : null }))
  return parts.some((p) => p.font) ? { rich: parts, text: parts.map((p) => p.t).join('') } : parts.map((p) => p.t).join('')
}

function readRels(files, path) {
  const doc = parseXml(files, path)
  const out = {}
  if (!doc) return out
  const base = path.replace(/_rels\/[^/]+$/, '')
  for (const r of doc.documentElement.children) {
    let target = r.getAttribute('Target') ?? ''
    if (r.getAttribute('TargetMode') === 'External') continue
    target = target.startsWith('/') ? target.slice(1) : normalize(base + target)
    out[r.getAttribute('Id')] = { target, type: r.getAttribute('Type') ?? '' }
  }
  return out
}
function normalize(p) {
  const out = []
  for (const s of p.split('/')) {
    if (s === '..') out.pop()
    else if (s && s !== '.') out.push(s)
  }
  return out.join('/')
}

// 열 너비(글자 수) → 화면 px (엑셀 기본 글꼴 기준 숫자 폭 7px)
const colPx = (w) => Math.max(0, Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7))
const ptPx = (pt) => Math.round((pt * 96) / 72)

function readSheet(files, path, ctx) {
  const doc = parseXml(files, path)
  if (!doc) return null
  const root = doc.documentElement
  const fmt = kid(root, 'sheetFormatPr')
  const baseW = num(fmt?.getAttribute('baseColWidth'), 8)
  const defColPx = fmt?.hasAttribute('defaultColWidth') ? colPx(num(fmt.getAttribute('defaultColWidth'))) : colPx(baseW + 5 / 7) // 8 → 64px
  const defRowPx = ptPx(num(fmt?.getAttribute('defaultRowHeight'), 15))
  const view = kid(kid(root, 'sheetViews'), 'sheetView')
  const grid = view?.getAttribute('showGridLines') !== '0'

  const colW = {} // 열 번호 → px (숨김은 0)
  const colStyle = {}
  for (const c of kids(kid(root, 'cols'), 'col')) {
    const min = num(c.getAttribute('min')), max = Math.min(num(c.getAttribute('max')), 16384)
    const hidden = c.getAttribute('hidden') === '1'
    const w = c.hasAttribute('width') ? colPx(num(c.getAttribute('width'))) : defColPx
    for (let i = min; i <= Math.min(max, min + 1000); i++) {
      colW[i] = hidden ? 0 : w
      if (c.hasAttribute('style')) colStyle[i] = num(c.getAttribute('style'))
    }
  }

  const data = [] // 값 2차원 배열 (범위 고르기용)
  const cells = new Map() // "r,c" → { text, s, rich, num }
  const rowH = {}
  const hiddenH = {} // 숨긴 행의 원래 높이 (필터를 풀면 다시 보임)
  const rowStyles = new Map() // 행 전체 양식
  const used = { r1: 0, r2: 0, c1: 0, c2: 0 }
  const grow = (r, c) => {
    if (!used.r1 || r < used.r1) used.r1 = r
    if (r > used.r2) used.r2 = r
    if (!used.c1 || c < used.c1) used.c1 = c
    if (c > used.c2) used.c2 = c
  }
  // 값이 없어도 테두리·채우기가 있으면 양식의 일부로 셈
  const styled = (s) => {
    const xf = ctx.styles.xfs[s]
    if (!xf) return false
    const b = ctx.styles.borders[xf.borderId]
    return !!ctx.styles.fills[xf.fillId] || !!(b && (b.left || b.right || b.top || b.bottom))
  }
  for (const row of kids(kid(root, 'sheetData'), 'row')) {
    const r = num(row.getAttribute('r'), data.length + 1)
    if (row.getAttribute('hidden') === '1') {
      rowH[r] = 0
      if (row.hasAttribute('ht')) hiddenH[r] = ptPx(num(row.getAttribute('ht')))
    } else if (row.hasAttribute('ht')) rowH[r] = ptPx(num(row.getAttribute('ht')))
    const rowStyle = row.getAttribute('customFormat') === '1' ? num(row.getAttribute('s')) : null
    let cIdx = 0
    for (const c of kids(row, 'c')) {
      const ref = parseRef(c.getAttribute('r'))
      const col = ref ? ref.c : cIdx + 1
      cIdx = col
      const t = c.getAttribute('t') ?? 'n'
      const vEl = kid(c, 'v')
      const v = vEl?.textContent
      let value = null
      let rich = null
      if (t === 's') {
        const ss = ctx.strings[num(v)]
        if (ss && typeof ss === 'object') {
          rich = ss.rich
          value = ss.text
        } else value = ss ?? ''
      } else if (t === 'inlineStr') {
        const is = richText(kid(c, 'is') ?? c, ctx.theme)
        if (typeof is === 'object') {
          rich = is.rich
          value = is.text
        } else value = is
      } else if (t === 'b') value = v === '1'
      else if (t === 'e') value = v ?? ''
      else if (t === 'str' || t === 'd') value = v ?? ''
      else if (v != null && v !== '') value = Number(v)
      const s = c.hasAttribute('s') ? num(c.getAttribute('s')) : (rowStyle ?? colStyle[col] ?? 0)
      const xf = ctx.styles.xfs[s]
      const code = xf ? (ctx.styles.numFmts[xf.numFmtId] ?? builtinFormat(xf.numFmtId) ?? 'General') : 'General'
      const text = value == null ? '' : typeof value === 'number' ? formatValue(value, code, ctx.date1904) : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : formatValue(String(value), code)
      if (value != null && value !== '') {
        while (data.length < r) data.push([])
        data[r - 1][col - 1] = text
        grow(r, col)
      } else if (styled(s)) grow(r, col)
      cells.set(`${r},${col}`, { text, s, rich, num: typeof value === 'number', bool: typeof value === 'boolean', err: t === 'e' })
    }
    if (rowStyle != null) rowStyles.set(r, rowStyle)
  }
  const merges = kids(kid(root, 'mergeCells'), 'mergeCell')
    .map((m) => {
      const [a, b] = (m.getAttribute('ref') ?? '').split(':').map(parseRef)
      return a && b ? { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) } : null
    })
    .filter(Boolean)
  for (const m of merges) {
    grow(m.r1, m.c1)
    grow(m.r2, m.c2)
  }
  const filters = readFilters(files, path, root)
  for (const f of filters) {
    grow(f.r1, f.c1)
    grow(f.r1, f.c2)
  }
  return { data, cells, colW, colStyle, rowStyles, rowH, hiddenH, defColPx, defRowPx, merges, grid, filters, used: used.r1 ? used : { r1: 1, r2: 1, c1: 1, c2: 1 } }
}

// 자동 필터: 시트의 <autoFilter> 와 "표로 서식 지정"한 표(tables/tableN.xml)의 필터
// → [{ r1, c1, r2, c2, cols: { 열 번호: [보일 값 글, ...] } }] (r1 = 머리줄, 값 목록이 없으면 그 열은 거르지 않음)
function readFilters(files, path, root) {
  const out = []
  const read = (af) => {
    if (!af) return
    const [a, b] = (af.getAttribute('ref') ?? '').split(':').map(parseRef)
    if (!a) return
    const f = { r1: Math.min(a.r, b?.r ?? a.r), c1: Math.min(a.c, b?.c ?? a.c), r2: Math.max(a.r, b?.r ?? a.r), c2: Math.max(a.c, b?.c ?? a.c), cols: {} }
    for (const fc of kids(af, 'filterColumn')) {
      const list = kid(fc, 'filters')
      if (!list) continue // 숫자 조건·색 필터 등은 값 목록이 아니라서 건너뜀 (숨긴 행은 그대로 둠)
      const vals = kids(list, 'filter').map((x) => x.getAttribute('val') ?? '')
      if (list.getAttribute('blank') === '1') vals.push('')
      f.cols[f.c1 + num(fc.getAttribute('colId'))] = vals
    }
    out.push(f)
  }
  read(kid(root, 'autoFilter'))
  const rels = readRels(files, path.replace(/([^/]+)$/, '_rels/$1.rels'))
  for (const tp of kids(kid(root, 'tableParts'), 'tablePart')) {
    const rel = rels[tp.getAttributeNS(REL_NS, 'id') ?? tp.getAttribute('r:id')]
    const t = rel && parseXml(files, rel.target)?.documentElement
    if (t && t.getAttribute('headerRowCount') !== '0') read(kid(t, 'autoFilter'))
  }
  return out
}

// ---------- 압축 풀기 (엑셀 = zip) ----------
const u16le = (str) => Uint8Array.from([...str].flatMap((ch) => [ch.charCodeAt(0), 0]))
function hasBytes(data, pat) {
  const n = Math.min(data.length, 4 * 1024 * 1024)
  outer: for (let i = 0; i + pat.length <= n; i++) {
    for (let j = 0; j < pat.length; j++) if (data[i + j] !== pat[j]) continue outer
    return true
  }
  return false
}
// zip 이 아닌 파일이 왜 아닌지 (암호·보안 레이블로 잠긴 엑셀, 예전 .xls 등)
function notZipReason(data) {
  const cfb = data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0
  if (cfb) {
    if (hasBytes(data, u16le('EncryptedPackage')) || hasBytes(data, u16le('EncryptionInfo')))
      return '민감도 레이블(암호)로 잠긴 엑셀이라 읽을 수 없어요. 엑셀에서 레이블을 해제하거나, 값만 새 파일로 복사해 저장해 올려 주세요.'
    return '예전 엑셀(.xls) 형식이에요. 엑셀에서 .xlsx 로 다시 저장해 올려 주세요.'
  }
  if (data[0] === 0x50 && data[1] === 0x4b) return null
  return '엑셀(.xlsx) 파일이 아니에요. 엑셀에서 열어 .xlsx 로 다시 저장해 올려 주세요.'
}
// 끝의 목차(central directory)가 망가졌거나 못 찾을 때: 앞에서부터 파일 머리(PK 03 04)를 따라 읽음
function unzipByLocalHeaders(data, keep) {
  const files = {}
  const b2 = (o) => data[o] | (data[o + 1] << 8)
  const b4 = (o) => (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0
  const nextSig = (from) => {
    for (let i = from; i + 4 <= data.length; i++)
      if (data[i] === 0x50 && data[i + 1] === 0x4b && ((data[i + 2] === 3 && data[i + 3] === 4) || (data[i + 2] === 1 && data[i + 3] === 2) || (data[i + 2] === 7 && data[i + 3] === 8))) return i
    return data.length
  }
  let o = 0
  while (o + 30 <= data.length && b4(o) === 0x04034b50) {
    const flag = b2(o + 6)
    const method = b2(o + 8)
    let size = b4(o + 18)
    const nameLen = b2(o + 26)
    const start = o + 30 + nameLen + b2(o + 28)
    const name = strFromU8(data.subarray(o + 30, o + 30 + nameLen), !(flag & 0x800))
    let end = start + size
    if (flag & 8 || size === 0xffffffff || end > data.length) {
      end = nextSig(start)
      size = end - start
    }
    if (keep(name) && !(flag & 1)) {
      const raw = data.subarray(start, end)
      if (method === 0) files[name] = raw.slice()
      else if (method === 8) files[name] = inflateSync(raw)
    }
    o = end
    if (flag & 8 && b4(o) === 0x08074b50) o += 16
    else if (flag & 8 && b4(o) !== 0x04034b50) o = nextSig(o + 1)
  }
  return files
}
export function openZip(buf, keep = () => true) {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const why = notZipReason(data)
  if (why) throw new Error(why)
  try {
    return unzipSync(data, { filter: (f) => keep(f.name) })
  } catch (e) {
    let files = {}
    try {
      files = unzipByLocalHeaders(data, keep)
    } catch {
      // 아래에서 원래 오류로
    }
    if (Object.keys(files).length) return files
    console.warn('엑셀 압축 풀기 실패', e)
    throw new Error('엑셀 파일이 망가져 읽을 수 없어요. 엑셀에서 열어 다른 이름으로 다시 저장해 올려 주세요.')
  }
}

// 엑셀 Blob/ArrayBuffer → { sheets: [{ sheet, data, ...양식 }], styles }
export async function parseXlsx(blob) {
  const buf = blob instanceof ArrayBuffer ? blob : await blob.arrayBuffer()
  const files = openZip(buf, (name) => /\.(xml|rels)$/i.test(name))
  const wbRels0 = readRels(files, '_rels/.rels')
  const wbPath = Object.values(wbRels0).find((r) => /officeDocument$/.test(r.type))?.target ?? 'xl/workbook.xml'
  const wb = parseXml(files, wbPath)
  if (!wb) throw new Error('엑셀 파일이 아니에요')
  const relsPath = wbPath.replace(/([^/]+)$/, '_rels/$1.rels')
  const rels = readRels(files, relsPath)
  const theme = readTheme(files, rels)
  const stylesRel = Object.values(rels).find((r) => /styles$/.test(r.type))
  if (stylesRel && stylesRel.target !== 'xl/styles.xml') files['xl/styles.xml'] = files[stylesRel.target]
  const styles = readStyles(files, theme)
  const ssRel = Object.values(rels).find((r) => /sharedStrings$/.test(r.type))
  const strings = readSharedStrings(files, ssRel?.target ?? 'xl/sharedStrings.xml', theme)
  const pr = kid(wb.documentElement, 'workbookPr')
  const date1904 = pr?.getAttribute('date1904') === '1' || pr?.getAttribute('date1904') === 'true'
  const ctx = { strings, styles, theme, date1904 }
  const sheets = []
  for (const s of kids(kid(wb.documentElement, 'sheets'), 'sheet')) {
    const rid = s.getAttributeNS(REL_NS, 'id') ?? s.getAttribute('r:id')
    const target = rels[rid]?.target
    if (!target || !/worksheet$/.test(rels[rid].type)) continue // 차트 시트 등은 뺌
    const sh = readSheet(files, target, ctx)
    if (sh) sheets.push({ sheet: s.getAttribute('name'), hidden: s.getAttribute('state') === 'hidden' || s.getAttribute('state') === 'veryHidden', styles, ...sh })
  }
  return sheets
}

// ---------- 화면용 칸 꾸밈 ----------

const BORDER_CSS = {
  thin: '1px solid',
  hair: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
  dashed: '1px dashed',
  mediumDashed: '2px dashed',
  dotted: '1px dotted',
  double: '3px double',
  dashDot: '1px dashed',
  mediumDashDot: '2px dashed',
  dashDotDot: '1px dotted',
  mediumDashDotDot: '2px dotted',
  slantDashDot: '2px dashed',
}
export const borderCss = (b) => (b ? `${BORDER_CSS[b.style] ?? '1px solid'} ${b.color}` : null)

const fontFamily = (name) => (name ? `"${name.replace(/["\\]/g, '')}", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif` : undefined)

// 글꼴 → React style
export function fontStyle(f) {
  if (!f) return {}
  const deco = [f.u && 'underline', f.strike && 'line-through'].filter(Boolean).join(' ')
  return {
    fontFamily: fontFamily(f.name),
    fontSize: f.sz ? `${Math.round(((f.sz * 96) / 72) * 10) / 10}px` : undefined,
    fontWeight: f.b ? 700 : undefined,
    fontStyle: f.i ? 'italic' : undefined,
    textDecoration: deco || undefined,
    color: f.color ?? undefined,
    verticalAlign: f.va === 'superscript' ? 'super' : f.va === 'subscript' ? 'sub' : undefined,
  }
}

// 칸 양식 번호 → { style(React), border } (테두리는 이웃 칸과 맞춰야 해서 따로)
export function xfLook(styles, s, cell) {
  const xf = styles.xfs[s] ?? styles.xfs[0] ?? {}
  const font = styles.fonts[xf.fontId] ?? styles.fonts[0]
  const fill = styles.fills[xf.fillId] ?? null
  const border = styles.borders[xf.borderId] ?? {}
  let h = xf.h
  if (!h || h === 'general') h = cell?.num ? 'right' : cell?.bool || cell?.err ? 'center' : 'left'
  if (h === 'centerContinuous' || h === 'distributed') h = 'center'
  if (h === 'fill') h = 'left'
  const v = xf.v === 'top' ? 'top' : xf.v === 'center' || xf.v === 'distributed' || xf.v === 'justify' ? 'middle' : 'bottom'
  return {
    style: {
      ...fontStyle(font),
      backgroundColor: fill ?? undefined,
      textAlign: h,
      verticalAlign: v,
      whiteSpace: xf.wrap ? 'pre-wrap' : 'pre',
      paddingLeft: xf.indent ? `${3 + xf.indent * 9}px` : undefined,
    },
    border,
    wrap: xf.wrap,
  }
}
