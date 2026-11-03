// Inst list: 사용자가 올린 계기 목록 (Tag. No → Description, Type).
// Equipment 박스에 Tag. No 가 들어가면(직접 입력·박스 읽기·태그 찾기) 이 목록에서 찾아 Description 과 Type 을 채움.
// 저장 모양: { rows: [{ tag, desc, type }], name: 올린 파일 이름, at: 올린 시각(ms) }
// 로그인했으면 documents 특별한 줄 __inst_list__ (스키마 변경 없음), 아니면 이 브라우저. 올릴 때마다 전체를 바꿈.
// 화면 여러 곳(홈 설정 창, 도면 안 Equipment 칸)이 같은 목록을 보도록 모듈 하나에 들고 있음.
import { useSyncExternalStore } from 'react'

const KEY = 'pdf-measure:inst-list'
export const EMPTY_INST_LIST = { rows: [], name: '', at: 0 }
export const MAX_ROWS = 50000

// 비교용 열쇠: 기호·띄어쓰기 모두 뺌 ("FT-1001" = "FT 1001" = "ft1001")
export const listKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '')

const str = (v, n) => String(v ?? '').trim().slice(0, n)

export function normalizeInstList(l) {
  if (!l || !Array.isArray(l.rows)) return EMPTY_INST_LIST
  const rows = []
  for (const r of l.rows.slice(0, MAX_ROWS)) {
    const tag = str(r?.tag, 80).toUpperCase()
    if (!listKey(tag)) continue
    rows.push({ tag, desc: str(r?.desc, 300), type: str(r?.type, 20).toUpperCase() })
  }
  return { rows, name: str(l.name, 200), at: Number(l.at) || 0 }
}

const keyOf = (scope) => (scope ? `${KEY}:${scope}` : KEY)

export function loadLocalInstList(scope) {
  try {
    return normalizeInstList(JSON.parse(localStorage.getItem(keyOf(scope))))
  } catch {
    return EMPTY_INST_LIST
  }
}

export function saveLocalInstList(list, scope) {
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(list))
  } catch {
    // 저장소가 꽉 찼거나 못 쓰는 환경(시크릿 모드 등)
  }
}

export const newerInstList = (a, b) => (normalizeInstList(b).at > normalizeInstList(a).at ? normalizeInstList(b) : normalizeInstList(a))

// ---------- 지금 목록 (모듈 하나에 보관, 바뀌면 알림) ----------
let current = EMPTY_INST_LIST
let index = null // { exact: Map(열쇠 → 줄), keys: [[열쇠, 줄]] }
const listeners = new Set()

function setCurrent(list) {
  current = list
  index = null
  for (const fn of listeners) fn()
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getInstList = () => current
export const useInstList = () => useSyncExternalStore(subscribe, getInstList)

let loadedFrom = null
// 로그인 상태(store)가 바뀔 때마다 한 번 불러옴
export function loadInstList(store) {
  if (!store || loadedFrom === store) return
  loadedFrom = store
  setCurrent(EMPTY_INST_LIST)
  store
    .getInstList?.()
    .then((l) => loadedFrom === store && setCurrent(normalizeInstList(l)))
    .catch((e) => console.warn('Inst list 를 불러오지 못함', e))
}

// 새 목록으로 통째로 바꾸고 저장
export async function replaceInstList(store, list) {
  const next = normalizeInstList({ ...list, at: Date.now() })
  setCurrent(next)
  await store?.saveInstList?.(next)
  return next
}

function getIndex() {
  if (!index) {
    const exact = new Map()
    for (const r of current.rows) exact.set(listKey(r.tag), r)
    index = { exact, keys: [...exact] }
  }
  return index
}

// Tag. No → 목록 줄 (없으면 null)
// 정확히 같은 것 먼저. 없으면 번호 부분만 읽힌 경우("02GCX30CP001" → "PT-02GCX30CP001"):
// 목록 태그가 '영문 글자 + 이 번호' 이고 그런 줄이 하나뿐일 때 (번호 6글자 이상, 숫자로 시작)
export function lookupTag(tag) {
  const k = listKey(tag)
  if (!k || !current.rows.length) return null
  const { exact, keys } = getIndex()
  if (exact.has(k)) return exact.get(k)
  if (k.length < 6 || !/^\d/.test(k)) return null
  let found = null
  for (const [key, row] of keys) {
    if (key.endsWith(k) && /^[A-Z]+$/.test(key.slice(0, -k.length))) {
      if (found) return null
      found = row
    }
  }
  return found
}

// ---------- 파일 읽기 (CSV, 엑셀) ----------

// 글자 인코딩: UTF-8 이 아니면 한국어 윈도우 엑셀이 저장한 CSV(CP949)로 봄
function decode(buf) {
  const bytes = new Uint8Array(buf)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

// CSV 글 → [[칸, ...], ...] (따옴표로 묶은 칸, 칸 안 쉼표·줄바꿈, "" 지원). 구분자는 첫 줄로 짐작 (, ; 탭)
export function parseCsv(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length])
  const sep = counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts[0][0] : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// 제목 줄로 열 자리 찾기 (못 찾으면 A=Tag. No, B=Description, C=Type)
function columns(head) {
  const h = head.map((c) => String(c ?? '').toLowerCase().replace(/[^a-z가-힣]/g, ''))
  const find = (re, def) => {
    const i = h.findIndex((c) => re.test(c))
    return i >= 0 ? i : def
  }
  return { tag: find(/^(tag|tagno|tagnumber|태그)/, 0), desc: find(/^(desc|description|service|설명)/, 1), type: find(/^(type|kind|종류|타입)/, 2) }
}

// 표(2차원 배열, 1행은 제목) → { rows, skipped, dup }
export function rowsFromTable(table) {
  const [head = [], ...body] = table
  const col = columns(head)
  const byKey = new Map()
  let skipped = 0
  let dup = 0
  for (const r of body) {
    const tag = str(r[col.tag], 80).toUpperCase()
    if (!listKey(tag)) {
      if (r.some((c) => str(c, 1))) skipped++
      continue
    }
    const k = listKey(tag)
    if (byKey.has(k)) dup++ // 같은 Tag. No 가 또 나오면 아래 줄로
    byKey.set(k, { tag, desc: str(r[col.desc], 300), type: str(r[col.type], 20).toUpperCase() })
  }
  return { rows: [...byKey.values()], skipped, dup }
}

// 올린 파일 → { rows, skipped, dup }. CSV 가 기본, .xlsx/.xlsm 도 첫 번째 보이는 시트로 읽음
export async function readInstFile(file) {
  if (/\.xls[xm]$/i.test(file.name)) {
    const { parseXlsx } = await import('./xlsx')
    const sheets = await parseXlsx(file)
    const sheet = sheets.find((s) => !s.hidden) ?? sheets[0]
    return rowsFromTable(sheet?.data ?? [])
  }
  if (/\.xls$/i.test(file.name)) throw new Error('예전 엑셀(.xls)은 못 읽어요. CSV 로 저장해서 올려 주세요.')
  return rowsFromTable(parseCsv(decode(await file.arrayBuffer())))
}

// ---------- 내보내기 ----------
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function instListCsv(rows) {
  const lines = [['Tag. No', 'Description', 'Type'], ...rows.map((r) => [r.tag, r.desc, r.type])]
  return '﻿' + lines.map((l) => l.map((c) => csvCell(String(c ?? ''))).join(',')).join('\r\n') + '\r\n'
}

export function downloadCsv(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
