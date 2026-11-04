// Cable schedule: 엑셀 파일 여러 개(보통 10개쯤)를 올려 두고, Equipment 카드에서 알맞은 것을 골라 가져오면
// 그 계기 Tag. No 가 들어 있는 줄만 보여 줌. 파일은 한 번씩만 저장(사진·첨부와 같은 보관함, 주인 문서 id 는 SHARED_DOC)하고
// 카드에는 어느 파일인지와 필터 설정만 남김.
// 목록 모양: { items: [{ id(파일 id), name, sheet, top: 제목 시작 줄, head: 제목 끝 줄, cols: [태그 열 번호], at }], at }
// 로그인했으면 documents 특별한 줄 __cable_schedule__ (스키마 변경 없음) + 이 브라우저 사본, 아니면 이 브라우저.
// 카드 쪽 저장: memo.cables = [{ id: 목록 파일 id, all: true(태그로 거르지 않음) | 없음, picks: { 열 번호: [보일 값, ...] } }]
import { useSyncExternalStore } from 'react'
import { getInstList, listKey } from './instList'
import { excelType, isExcelFile, isOldExcel, newFileId, readWorkbook } from './excel'

const KEY = 'pdf-measure:cable-schedules'
export const SHARED_DOC = '__cable__' // 파일 보관함에서 이 파일들의 주인 (도면 지우기 정리에 안 걸림)
export const EMPTY_CABLES = { items: [], at: 0 }
export const MAX_CABLES = 50

export function normalizeItem(c) {
  if (!c || typeof c.id !== 'string' || !c.id) return null
  const head = Math.max(1, Math.round(Number(c.head)) || 1)
  const top = Math.max(1, Math.min(head, Math.round(Number(c.top)) || head))
  const cols = Array.isArray(c.cols) ? [...new Set(c.cols.map((x) => Math.round(Number(x))).filter((x) => x >= 1 && x <= 16384))].sort((a, b) => a - b) : []
  return { id: c.id.slice(0, 80), name: String(c.name ?? '').slice(0, 200), sheet: String(c.sheet ?? '').slice(0, 100), top, head, cols, at: Number(c.at) || 0, fv: Number(c.fv) || 0 }
}
export function normalizeCables(l) {
  if (!l || !Array.isArray(l.items)) return EMPTY_CABLES
  return { items: l.items.map(normalizeItem).filter(Boolean).slice(0, MAX_CABLES), at: Number(l.at) || 0 }
}

const keyOf = (scope) => (scope ? `${KEY}:${scope}` : KEY)
export function loadLocalCables(scope) {
  try {
    return normalizeCables(JSON.parse(localStorage.getItem(keyOf(scope))))
  } catch {
    return EMPTY_CABLES
  }
}
export function saveLocalCables(l, scope) {
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(l))
  } catch {
    // 저장소가 꽉 찼거나 못 쓰는 환경
  }
}
export const newerCables = (a, b) => (normalizeCables(b).at > normalizeCables(a).at ? normalizeCables(b) : normalizeCables(a))

// ---------- 지금 목록 (모듈 하나에 보관, 바뀌면 알림) ----------
let current = EMPTY_CABLES
let store0 = null
const listeners = new Set()
function setCurrent(c) {
  current = c
  for (const fn of listeners) fn()
}
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getCables = () => current
export const useCables = () => useSyncExternalStore(subscribe, getCables)
export const cableById = (id) => current.items.find((x) => x.id === id) ?? null

export function loadCables(store) {
  if (!store || store0 === store) return
  store0 = store
  setCurrent(EMPTY_CABLES)
  store
    .getCableSchedules?.()
    .then((c) => store0 === store && setCurrent(normalizeCables(c)))
    .catch((e) => console.warn('Cable schedule 목록을 불러오지 못함', e))
}

async function saveList(store, items) {
  const next = normalizeCables({ items, at: Date.now() })
  setCurrent(next)
  await store?.saveCableSchedules?.(next)
  return next
}

// 새 파일 올리기: 보관함에 저장하고 목록 끝에 더함 (설정은 짐작한 값)
export async function addCable(store, item, blob) {
  rememberCableBlob(item.id, blob)
  await store.saveImage(SHARED_DOC, item.id, blob)
  await saveList(store, [...current.items, { ...item, at: Date.now() }])
  return item
}
// 설정 고치기 (같은 id). blob 이 있으면 파일도 바꿈 (새 판: 카드 필터는 그대로 새 파일에 맞춰짐)
export async function updateCable(store, id, patch, blob) {
  if (blob) {
    blobs.delete(id)
    await store.saveImage(SHARED_DOC, id, blob)
    rememberCableBlob(id, blob)
  }
  await saveList(
    store,
    current.items.map((x) => (x.id === id ? { ...x, ...patch, id, at: Date.now(), ...(blob ? { fv: Date.now() } : {}) } : x)),
  )
}
export async function removeCable(store, id) {
  await saveList(
    store,
    current.items.filter((x) => x.id !== id),
  )
  blobs.delete(id)
  store.removeImages?.(SHARED_DOC, [id])?.catch?.((e) => console.warn('Cable schedule 파일 지우기 실패', e))
}

// 파일 받기 (같은 파일은 한 번만 내려받음)
const blobs = new Map()
export function cableBlob(store, id) {
  if (!blobs.has(id)) {
    const p = store.getImage(SHARED_DOC, id)
    p.then((b) => !b && blobs.delete(id)).catch(() => blobs.delete(id))
    blobs.set(id, p)
  }
  return blobs.get(id)
}
export function rememberCableBlob(id, blob) {
  blobs.set(id, Promise.resolve(blob))
}
// 엑셀 읽기 캐시 열쇠: 같은 id 라도 파일을 바꾸면(fv) 새로 읽게
export const workbookKey = (item) => `${item.id}@${item.fv || 0}`

// ---------- 시트 짐작 ----------
const textAt = (sheet, r, c) => sheet.cells.get(`${r},${c}`)?.text ?? ''

// 제목 줄: 앞쪽 30줄 중 글(숫자 아님)이 든 칸이 가장 많은 줄. 그 위 줄도 제목이면(병합된 큰 제목) 시작 줄로
export function guessHeader(sheet) {
  const { r1, r2, c1, c2 } = sheet.used
  let best = r1
  let bestN = -1
  for (let r = r1; r <= Math.min(r2, r1 + 29); r++) {
    let n = 0
    for (let c = c1; c <= c2; c++) {
      const t = textAt(sheet, r, c).trim()
      if (t && !sheet.cells.get(`${r},${c}`)?.num) n++
    }
    if (n > bestN) {
      best = r
      bestN = n
    }
  }
  // 바로 위 줄과 병합으로 이어진 제목 (예: "FROM" 아래 "Tag / Location")
  let top = best
  for (const m of sheet.merges) if (m.r2 >= best - 1 && m.r2 <= best && m.r1 < top && m.r1 >= best - 3 && m.c2 > m.c1) top = m.r1
  return { top, head: best }
}

// 태그처럼 보이는 글 (KKS 00AAA00AA000 이나 PT-1001 같은 ISA 태그)
const TAGGISH = /^(\d{1,2}[A-Z]{3}\d{2}[A-Z]{2}\d{3}|[A-Z]{1,5}\d{3,6}[A-Z]?)/
const HEAD_WORD = /tag|from|to\b|instrument|equip|device|loop/i

// 태그 열: Inst list 태그나 태그 모양 값이 많은 열 (+ 제목에 tag/from/to)
export function guessTagCols(sheet, head) {
  const { r2, c1, c2 } = sheet.used
  const list = getInstList().rows
  const keys = new Set(list.map((x) => listKey(x.tag)))
  const out = []
  const last = Math.min(r2, head + 400)
  for (let c = c1; c <= c2; c++) {
    let n = 0
    let hits = 0
    for (let r = head + 1; r <= last; r++) {
      const k = listKey(textAt(sheet, r, c))
      if (!k) continue
      n++
      if (keys.has(k) || TAGGISH.test(k)) hits++
    }
    const title = textAt(sheet, head, c)
    // 케이블 번호·규격 열은 태그 모양이어도 뺌 (제목에 tag 가 함께 있으면 둠)
    if (/cable|케이블|size|core|length/i.test(title) && !/tag/i.test(title)) continue
    if ((n && hits / n >= 0.5) || (HEAD_WORD.test(title) && n && hits / n >= 0.2)) out.push(c)
  }
  return out
}

// 칸 글이 이 계기 태그와 맞는지: 칸이 태그를 품거나(예: "PT-10LBA10CP001-1"), 칸이 태그 안에 든 6글자 이상 번호
// 끝에 영문 한 글자가 붙은 태그는 다른 계기라(02GBK02CL001 ≠ 02GBK02CL001A ≠ 02GBK02CL001B) 서로 맞추지 않음
const SUFFIX_AFTER = /^[A-Z](?![A-Z])/ // 숫자로 끝난 태그 바로 뒤에 붙은 영문 한 글자
function holds(hay, needle) {
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!/\d$/.test(needle) || !SUFFIX_AFTER.test(hay.slice(i + needle.length))) return true
  }
  return false
}
export function tagMatches(cellText, tag) {
  const a = listKey(cellText)
  const b = listKey(tag)
  if (!a || !b) return false
  return holds(a, b) || (a.length >= 6 && holds(b, a))
}

// 이 계기 줄 번호들 (제목 아래 ~ 끝)
export function rowsForTag(sheet, cfg, tag) {
  const out = new Set()
  if (!tag || !cfg.cols.length) return out
  for (let r = cfg.head + 1; r <= sheet.used.r2; r++) {
    for (const c of cfg.cols) {
      if (tagMatches(textAt(sheet, r, c), tag)) {
        out.add(r)
        break
      }
    }
  }
  return out
}

export const findSheet = (sheets, name) => sheets.find((s) => s.sheet === name) ?? sheets.find((s) => !s.hidden) ?? sheets[0]

// 올린 파일 → 목록에 넣을 항목(설정은 짐작) + 저장할 Blob
export async function readCableFile(file) {
  if (isOldExcel(file)) throw new Error('예전 엑셀(.xls)은 읽을 수 없어요. 엑셀에서 .xlsx 로 다시 저장해 올려 주세요.')
  if (!isExcelFile(file)) throw new Error('.xlsx 나 .xlsm 엑셀 파일을 올려 주세요.')
  if (file.size > MAX_CABLE_BYTES) throw new Error(`20MB 가 넘는 파일은 올릴 수 없어요: ${file.name}`)
  const id = newFileId()
  const blob = new Blob([file], { type: excelType(file) })
  const sheets = await readWorkbook(`${id}@0`, blob)
  const s = findSheet(sheets, null)
  const { top, head } = guessHeader(s)
  return { item: { id, name: file.name, sheet: s.sheet, top, head, cols: guessTagCols(s, head) }, blob, sheets }
}
export const MAX_CABLE_BYTES = 20 * 1024 * 1024

// 목록 항목의 시트들 (내려받고 읽기, 한 번만)
export async function cableSheets(store, item) {
  const blob = await cableBlob(store, item.id)
  if (!blob) throw new Error('no file')
  return readWorkbook(workbookKey(item), blob)
}
