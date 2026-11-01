// 엑셀 표시 형식(0.00, #,##0, 0%, yyyy-mm-dd, "개" 붙이기 …)으로 값을 엑셀 화면과 같은 글자로 바꿉니다.
// 자주 쓰는 형식만 다룹니다. 모르는 형식이면 일반(General)처럼 보여 줍니다.

// 엑셀에 미리 들어 있는 형식 번호
const BUILTIN = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: '#,##0;-#,##0',
  6: '#,##0;[Red]-#,##0',
  7: '#,##0.00;-#,##0.00',
  8: '#,##0.00;[Red]-#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'yyyy-mm-dd',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'yyyy-mm-dd h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@',
}
// 한국어 엑셀의 지역 날짜 형식 번호(27~36, 50~58)
for (const id of [27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]) BUILTIN[id] = 'yyyy-mm-dd'
BUILTIN[32] = 'h:mm'
BUILTIN[33] = 'h:mm:ss'
BUILTIN[55] = 'h:mm AM/PM'
BUILTIN[56] = 'h:mm:ss AM/PM'

export const builtinFormat = (id) => BUILTIN[id]

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// 형식 글을 ; 로 나눔 (따옴표·\ 안은 그대로)
function splitSections(fmt) {
  const out = []
  let cur = ''
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]
    if (c === '"') {
      const j = fmt.indexOf('"', i + 1)
      const end = j < 0 ? fmt.length : j
      cur += fmt.slice(i, end + 1)
      i = end
    } else if (c === '\\') {
      cur += fmt.slice(i, i + 2)
      i++
    } else if (c === ';') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

// [Red], [$-412], [<=100] 같은 대괄호를 정리. [$₩-412] 는 ₩ 글자로, [h] 등 경과 시간은 남김
function cleanSection(s) {
  let cond = null
  const body = s.replace(/\[([^\]]*)\]/g, (m, inner) => {
    if (/^[hms]+$/i.test(inner)) return m
    if (inner.startsWith('$')) {
      const sym = inner.slice(1).split('-')[0]
      return sym ? `"${sym}"` : ''
    }
    const c = /^(<=|>=|<>|<|>|=)(-?[\d.]+)$/.exec(inner)
    if (c) cond = { op: c[1], v: Number(c[2]) }
    return ''
  })
  return { body, cond }
}

const testCond = ({ op, v }, x) => (op === '<' ? x < v : op === '<=' ? x <= v : op === '>' ? x > v : op === '>=' ? x >= v : op === '=' ? x === v : x !== v)

// 따옴표 밖에 날짜·시간 글자가 있으면 날짜 형식
const stripQuoted = (s) => s.replace(/"[^"]*"/g, '').replace(/\\./g, '')
const isDateFormat = (s) => /[ymdhs]/i.test(stripQuoted(s).replace(/General/gi, '').replace(/E[+-]/g, ''))

export function generalText(v) {
  if (typeof v !== 'number') return String(v)
  if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v)
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-9 || a >= 1e11)) return v.toExponential(5).replace(/\.?0+e/, 'E').replace('E+', 'E+').replace(/E(-?)(\d)$/, 'E$10$2')
  return String(Number(v.toPrecision(11)))
}

// 엑셀 날짜 번호 → 날짜 (1900 날짜 체계의 2월 29일 오류 반영)
export function serialToDate(v, date1904 = false) {
  let d = v
  if (date1904) d += 1462
  else if (d < 60) d += 1
  const ms = Math.round((d - 25569) * 86400000)
  return new Date(ms)
}

function formatDate(fmt, v, date1904) {
  const dt = serialToDate(v, date1904)
  const Y = dt.getUTCFullYear(), M = dt.getUTCMonth(), D = dt.getUTCDate(), W = dt.getUTCDay()
  let h = dt.getUTCHours(), mi = dt.getUTCMinutes(), s = dt.getUTCSeconds()
  const frac = (v * 86400) % 1
  const ampm = /AM\/PM|A\/P|오전\/오후/i.test(fmt)
  // 낱말 단위로 자름
  const toks = []
  const re = /"([^"]*)"|\\(.)|(\[h+\]|\[m+\]|\[s+\])|(AM\/PM|A\/P|오전\/오후)|(y+|m+|d+|h+|s+(?:\.0+)?|e+|g+|aaaa|aaa)|(_.)|(\*.)|([\s\S])/gi
  let m
  while ((m = re.exec(fmt))) {
    if (m[1] !== undefined) toks.push({ lit: m[1] })
    else if (m[2] !== undefined) toks.push({ lit: m[2] })
    else if (m[3]) toks.push({ el: m[3].toLowerCase() })
    else if (m[4]) toks.push({ ap: m[4] })
    else if (m[5]) toks.push({ t: m[5].toLowerCase() })
    else if (m[6]) toks.push({ lit: ' ' })
    else if (m[7]) continue
    else toks.push({ lit: m[8] })
  }
  // m 이 분인지 월인지: 앞에 h 가 있거나 뒤에 s 가 오면 분
  toks.forEach((tk, i) => {
    if (!tk.t || tk.t[0] !== 'm' || tk.t.length > 2) return
    const prev = toks.slice(0, i).reverse().find((x) => x.t || x.el)
    const next = toks.slice(i + 1).find((x) => x.t || x.el)
    if ((prev && (prev.t?.[0] === 'h' || prev.el?.includes('h'))) || (next && next.t?.[0] === 's')) tk.min = true
  })
  const pm = h >= 12
  if (ampm) h = h % 12 || 12
  const p2 = (n) => String(n).padStart(2, '0')
  let out = ''
  for (const tk of toks) {
    if (tk.lit !== undefined) out += tk.lit
    else if (tk.ap) out += tk.ap === 'A/P' ? (pm ? 'P' : 'A') : tk.ap === '오전/오후' ? (pm ? '오후' : '오전') : pm ? 'PM' : 'AM'
    else if (tk.el) {
      const total = v * 24
      out += tk.el.includes('h') ? Math.floor(total) : tk.el.includes('m') ? Math.floor(total * 60) : Math.floor(total * 3600)
    } else {
      const t = tk.t
      if (t[0] === 'y' || t[0] === 'e') out += t.length <= 2 && t[0] === 'y' ? p2(Y % 100) : Y
      else if (t[0] === 'm' && tk.min) out += t.length === 2 ? p2(mi) : mi
      else if (t[0] === 'm') out += t.length === 1 ? M + 1 : t.length === 2 ? p2(M + 1) : t.length === 3 ? MONTHS[M] : t.length === 5 ? MONTHS[M][0] : MONTHS_LONG[M]
      else if (t[0] === 'd') out += t.length === 1 ? D : t.length === 2 ? p2(D) : t.length === 3 ? DAYS_EN[W] : DAYS_LONG[W]
      else if (t === 'aaa') out += DAYS[W]
      else if (t === 'aaaa') out += DAYS[W] + '요일'
      else if (t[0] === 'h') out += t.length >= 2 ? p2(h) : h
      else if (t[0] === 's') {
        const dec = (t.split('.')[1] ?? '').length
        out += t.startsWith('ss') ? p2(s) : s
        if (dec) out += '.' + String(Math.round(frac * 10 ** dec)).padStart(dec, '0').slice(0, dec)
      } else if (t[0] === 'g') continue
    }
  }
  return out
}

// 숫자 형식 하나(대괄호 정리 뒤)로 양수 값을 글자로
function formatNumber(fmt, x) {
  // 글자 그대로 붙는 부분과 숫자 자리 부분을 나눔
  const parts = []
  const re = /"([^"]*)"|\\(.)|(_.)|(\*.)|((?:[0#?,./ ](?=[0#?,./]*[0#?])|[0#?]|[Ee][+-](?=[0#]))+,*)|([\s\S])/g
  let m
  while ((m = re.exec(fmt))) {
    if (m[1] !== undefined) parts.push({ lit: m[1] })
    else if (m[2] !== undefined) parts.push({ lit: m[2] })
    else if (m[3]) parts.push({ lit: ' ' })
    else if (m[4]) continue
    else if (m[5]) parts.push({ num: m[5] })
    else parts.push({ lit: m[6] })
  }
  // 숫자 자리 패턴 전체 (사이에 낀 - 는 글자로 둠)
  const numIdx = parts.map((p, i) => (p.num && /[0#?]/.test(p.num) ? i : -1)).filter((i) => i >= 0)
  if (!numIdx.length) return parts.map((p) => p.lit ?? p.num.replace(/[,]/g, '')).join('')
  const pattern = parts
    .slice(numIdx[0], numIdx[numIdx.length - 1] + 1)
    .map((p) => p.num ?? '')
    .join('')
  let pct = (fmt.replace(/"[^"]*"/g, '').match(/%/g) ?? []).length
  let val = x * 100 ** pct
  let body
  const exp = /([0#?.,]+)E([+-])([0#]+)/i.exec(pattern)
  const frac = /^([#0?,]*)\s*([#0?]+)\/([#0?]+|\d+)$/.exec(pattern.trim())
  if (exp) {
    const [mi, ma] = exp[1].split('.')
    const dec = (ma ?? '').replace(/[^0#?]/g, '').length
    const intDigits = Math.max(1, mi.replace(/[^0#?]/g, '').length)
    let e = val === 0 ? 0 : Math.floor(Math.log10(val))
    if (intDigits > 1) e = Math.floor(e / intDigits) * intDigits
    const mant = val / 10 ** e
    body = mant.toFixed(dec) + 'E' + (e < 0 ? '-' : exp[2] === '+' ? '+' : '') + String(Math.abs(e)).padStart(exp[3].length, '0')
  } else if (frac) {
    const whole = frac[1] ? Math.floor(val) : 0
    const rest = val - whole
    const fixedDen = /^\d+$/.test(frac[3]) ? Number(frac[3]) : null
    let num = 0, den = 1
    if (fixedDen) {
      den = fixedDen
      num = Math.round(rest * den)
    } else {
      const maxDen = 10 ** frac[3].length - 1
      let best = Infinity
      for (let d = 1; d <= maxDen; d++) {
        const n = Math.round(rest * d)
        const err = Math.abs(rest - n / d)
        if (err < best - 1e-12) {
          best = err
          num = n
          den = d
        }
      }
    }
    body = num === 0 ? (frac[1] ? String(whole) : '0') : `${frac[1] && whole ? whole + ' ' : ''}${num}/${den}`
  } else {
    const [ip, dp = ''] = pattern.split('.')
    const thousands = /[0#?],[0#?]/.test(ip)
    // 정수부 끝 쉼표 하나당 1000 으로 나눔
    const scale = (ip.match(/,+$/)?.[0].length ?? 0)
    val /= 1000 ** scale
    const decZero = (dp.match(/0/g) ?? []).length
    const decAll = (dp.match(/[0#?]/g) ?? []).length
    let s = val.toFixed(decAll)
    let [i, d = ''] = s.split('.')
    // # 자리 끝 0 은 지움 (0 자리 개수까지는 남김)
    while (d.length > decZero && d.endsWith('0')) d = d.slice(0, -1)
    const minInt = (ip.match(/0/g) ?? []).length
    if (i === '0' && minInt === 0) i = ''
    i = i.padStart(minInt, '0')
    if (thousands) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    body = i + (dp && (d || dp.includes('.') || pattern.includes('.')) ? '.' + d : '')
    if (!pattern.includes('.')) body = i
  }
  return [...parts.slice(0, numIdx[0]).map((p) => p.lit ?? p.num), body, ...parts.slice(numIdx[numIdx.length - 1] + 1).map((p) => p.lit ?? p.num)].join('')
}

// 값 + 형식 → 화면 글자. 글자 값에는 4번째 칸(@) 형식을 씀
export function formatValue(v, fmt, date1904 = false) {
  if (v == null || v === '') return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  const raw = String(fmt ?? 'General')
  const sections = splitSections(raw)
  if (typeof v !== 'number') {
    const sec = sections.length >= 4 ? sections[3] : sections.find((s) => s.includes('@'))
    if (!sec) return String(v)
    return cleanSection(sec)
      .body.replace(/"([^"]*)"/g, '$1')
      .replace(/_./g, ' ')
      .replace(/\*./g, '')
      .replace(/\\(.)/g, '$1')
      .replace(/@/g, String(v))
  }
  try {
    const parsed = sections.map(cleanSection)
    let sec = parsed[0]
    let x = v
    if (parsed.some((p) => p.cond)) {
      sec = parsed.find((p) => p.cond && testCond(p.cond, v)) ?? parsed.find((p) => !p.cond) ?? parsed[0]
      if (v < 0 && sec !== parsed[0]) x = Math.abs(v)
    } else if (v < 0 && parsed.length >= 2) {
      sec = parsed[1]
      x = -v
    } else if (v === 0 && parsed.length >= 3) sec = parsed[2]
    const body = sec.body
    if (!body.trim() && parsed.length > 1) return ''
    if (/^\s*General\s*$/i.test(body) || !body.trim()) return generalText(v)
    if (isDateFormat(body)) return formatDate(body, x, date1904)
    if (/General/i.test(body)) return body.replace(/General/i, generalText(x)).replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1')
    const neg = x < 0
    const out = formatNumber(body, Math.abs(x))
    return neg ? '-' + out : out
  } catch {
    return generalText(v)
  }
}
