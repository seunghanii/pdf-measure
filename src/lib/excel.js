// 메모(계기 카드)에 첨부하는 엑셀: 파일은 사진과 같은 저장소(images.js)에 두고, 메모 항목에는
// files: [{ id, name, sheet, r1, r2, c1, c2, cw? }] 로 보여 줄 시트와 범위(행·열, 1부터), 사용자가 바꾼 열 너비 cw { 시트: { 열: px } } 만 둡니다.
// 읽기는 브라우저 안에서 (lib/xlsx.js, .xlsx·.xlsm. 값과 함께 열 너비·병합·테두리·색·글꼴·표시 형식도 읽음.
// .xlsm 의 매크로는 실행하지 않음). 처음 열 때만 불러옴.

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

const cache = new Map() // 파일 id → Promise<시트들>

// 엑셀 Blob → 시트들 [{ sheet: 이름, data: [[보이는 글자, ...], ...], used, cells, merges, colW, rowH, styles … }]
export function readWorkbook(id, blob) {
  if (!cache.has(id)) {
    const p = import('./xlsx').then(({ parseXlsx }) => parseXlsx(blob))
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return cache.get(id)
}

// 값이나 양식(테두리·채우기·병합)이 있는 범위 → { r1, r2, c1, c2 }
export const usedRange = (sheet) => ({ ...(sheet?.used ?? { r1: 1, r2: 1, c1: 1, c2: 1 }) })

export const rangeLabel = (f) => `${colName(f.c1)}${f.r1}:${colName(f.c2)}${f.r2}`
