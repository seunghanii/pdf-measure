// 메모(계기 카드)에 첨부하는 엑셀: 파일은 사진과 같은 저장소(images.js)에 두고, 메모 항목에는
// files: [{ id, name, sheet, r1, r2, c1, c2 }] 로 보여 줄 시트와 범위(행·열, 1부터)만 둡니다.
// 읽기는 브라우저 안에서 (read-excel-file, .xlsx·.xlsm. .xlsm 의 매크로는 실행하지 않고 값만 읽음). 처음 열 때만 불러옴.

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const MAX_EXCEL_BYTES = 10 * 1024 * 1024

export const XLSM_TYPE = 'application/vnd.ms-excel.sheet.macroEnabled.12'
export const isExcelFile = (f) => !!f && (/\.xls[xm]$/i.test(f.name ?? '') || f.type === XLSX_TYPE || f.type === XLSM_TYPE)
// 저장할 때 붙일 파일 형식
export const excelType = (f) => (/\.xlsm$/i.test(f.name ?? '') || f.type === XLSM_TYPE ? XLSM_TYPE : XLSX_TYPE)
export const isOldExcel = (f) => !!f && /\.xls$/i.test(f.name ?? '')

export const newFileId = () => `xls${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// 메모의 첨부 파일 id 들 (안 쓰는 파일 정리에서 빼야 함)
export const memoFileIds = (m) => (Array.isArray(m?.files) ? m.files.map((f) => f.id) : [])

// 열 번호 ↔ 글자 (1 → A, 27 → AA)
export function colName(n) {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}
// "C" 또는 "3" → 3. 못 읽으면 null
export function parseCol(v) {
  const t = String(v ?? '').trim().toUpperCase()
  if (/^\d+$/.test(t)) return Number(t) || null
  if (!/^[A-Z]{1,3}$/.test(t)) return null
  return [...t].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
}

const cache = new Map() // 파일 id → Promise<[{ sheet, data }]>

// 엑셀 Blob → 시트들 [{ sheet: 이름, data: [[칸, ...], ...] }]
export function readWorkbook(id, blob) {
  if (!cache.has(id)) {
    const p = import('read-excel-file/browser').then(({ default: readExcelFile }) => readExcelFile(blob))
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return cache.get(id)
}

// 값이 있는 범위 (빈 앞줄·앞칸은 뺌) → { r1, r2, c1, c2 }
export function usedRange(data) {
  let r1 = 0, r2 = 0, c1 = 0, c2 = 0
  data.forEach((row, i) =>
    row.forEach((v, j) => {
      if (v == null || v === '') return
      if (!r1 || i + 1 < r1) r1 = i + 1
      if (i + 1 > r2) r2 = i + 1
      if (!c1 || j + 1 < c1) c1 = j + 1
      if (j + 1 > c2) c2 = j + 1
    }),
  )
  return r1 ? { r1, r2, c1, c2 } : { r1: 1, r2: 1, c1: 1, c2: 1 }
}

// 시트에서 범위만 잘라 글자로 → [[글자, ...], ...]
export function sliceRange(data, { r1, r2, c1, c2 }) {
  const out = []
  for (let r = r1; r <= r2; r++) {
    const row = data[r - 1] ?? []
    const line = []
    for (let c = c1; c <= c2; c++) line.push(cellText(row[c - 1]))
    out.push(line)
  }
  return out
}

export function cellText(v) {
  if (v == null) return ''
  if (v instanceof Date) return v.toLocaleDateString('ko-KR')
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

export const rangeLabel = (f) => `${colName(f.c1)}${f.r1}:${colName(f.c2)}${f.r2}`
