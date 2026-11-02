// 도면 항목(측정·마크업·사진·메모·계기 카드) 복사·붙여넣기 (Ctrl/Cmd+C, X, V)
// - 복사한 항목은 이 앱 안(모든 탭 공통)에 보관하고, 시스템 클립보드에는 표시 글 한 줄만 넣습니다.
//   붙여넣을 때 시스템 클립보드 글에 그 표시(token)가 그대로 있을 때만 항목을 붙여넣으므로,
//   그 뒤에 다른 곳에서 사진·엑셀·글을 복사했다면 그것이 우선입니다 (도면에 사진 붙여넣기는 그대로).
// - 메모는 글·사진·엑셀 첨부·계기 정보·관련 도면까지 통째로 복사됩니다.
//   같은 도면 안에서는 사진·엑셀 파일을 함께 쓰고, 다른 도면에 붙이면 파일을 새 id 로 복사합니다
//   (사진 저장소는 사진 id 하나에 도면 하나라서, 같은 id 를 두 도면이 쓰면 한쪽 정리 때 지워질 수 있음).
import { TYPE_INFO } from './measure'
import { getImageBlob, newImageId, rememberImage } from './images'
import { memoPhotoIds } from './memo'
import { memoFileIds, newFileId } from './excel'
import { memoLinkPhotoIds } from './instrument'
import { withCategory } from './categories'

export const PASTE_STEP = 12 // 제자리에 붙여넣을 때마다 비켜 놓는 거리 (pt)

let clip = null // { token, items, categories, source: { store, docId }, last: { docId, page, box }, cursor }

const newToken = () => `jcp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export const clipboardMarker = (c) => `[JCP 도면 관리] 항목 ${c.items.length}개 복사 (${c.token})`

// spot: 복사할 때 마우스 자리 (그대로 붙여넣으면 원래 자리 옆에 놓으려고)
export function copyItems(items, { categories, store, docId, spot }) {
  const usedCats = new Set(items.map((m) => m.cat).filter(Boolean))
  const pages = new Set(items.map((m) => m.page))
  clip = {
    token: newToken(),
    items: structuredClone(items),
    categories: categories.filter((c) => usedCats.has(c.id)),
    source: { store, docId },
    last: pages.size === 1 ? { docId, page: items[0].page, box: boxOf(items) } : null,
    cursor: spot?.pointer ? { docId, page: spot.page, x: spot.x, y: spot.y } : null,
  }
  return clip
}

// 붙여넣을 글(시스템 클립보드) 이 우리가 복사할 때 넣은 표시를 담고 있으면 그 복사본
export function clipFor(text) {
  return clip && typeof text === 'string' && text.includes(clip.token) ? clip : null
}
export const currentClip = () => clip

function boxOf(items) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const m of items)
    for (const p of m.points ?? []) {
      x1 = Math.min(x1, p.x)
      y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x)
      y2 = Math.max(y2, p.y)
    }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

// 어디에 붙일지: 한 페이지 항목이면 { page, dx, dy } 하나로 옮기고, 여러 페이지면 원래 페이지 그대로 비켜 놓기
// spot: 뷰어가 알려 준 자리 { page, x, y, pointer (마우스가 도면 위), pageW, pageH }
function placement(c, docId, spot, numPages) {
  const box = boxOf(c.items)
  const multi = new Set(c.items.map((m) => m.page)).size > 1
  if (multi) {
    const step = c.last?.docId === docId ? (c.last.n ?? 0) + 1 : c.source.docId === docId ? 1 : 0
    return { multi: true, step, dx: step * PASTE_STEP, dy: step * PASTE_STEP, box }
  }
  const last = c.last
  const still = spot?.pointer && c.cursor && c.cursor.docId === docId && c.cursor.page === spot.page && Math.hypot(c.cursor.x - spot.x, c.cursor.y - spot.y) < 1
  let page
  let target // 붙인 묶음의 왼쪽 위 (pt)
  if (spot?.pointer && !still) {
    // 마우스 자리를 가운데로
    page = spot.page
    target = { x: spot.x - box.w / 2, y: spot.y - box.h / 2 }
  } else if (last && last.docId === docId && (!spot || spot.pointer || spot.page === last.page)) {
    // 마우스를 안 움직였거나 도면 밖: 마지막 자리에서 조금 비켜서
    page = last.page
    target = { x: last.box.x + PASTE_STEP, y: last.box.y + PASTE_STEP }
  } else if (spot) {
    // 다른 도면·다른 페이지를 보고 있으면 화면 가운데
    page = spot.page
    target = { x: spot.x - box.w / 2, y: spot.y - box.h / 2 }
  } else {
    page = Math.min(c.items[0].page, numPages)
    target = { x: box.x + PASTE_STEP, y: box.y + PASTE_STEP }
  }
  // 페이지 밖으로 나가지 않게
  if (spot?.pageW && page === spot.page) {
    target.x = Math.max(0, Math.min(target.x, spot.pageW - box.w))
    target.y = Math.max(0, Math.min(target.y, spot.pageH - box.h))
  }
  return { multi: false, page, dx: target.x - box.x, dy: target.y - box.y, box }
}

// 기본 이름("길이 3", "원 2" …)이면 새 번호로, 직접 지은 이름(태그 등)은 그대로
function renamed(m, counters) {
  const kind = m.type === 'rect' && m.shape === 'ellipse' ? 'ellipse' : m.type
  const base = kind === 'ellipse' ? '원' : TYPE_INFO[m.type]?.name
  if (!base || !new RegExp(`^${base} \\d+$`).test(m.name ?? '')) return m.name
  counters[kind] = (counters[kind] ?? 0) + 1
  return `${base} ${counters[kind]}`
}

// 다른 도면에 붙일 때 사진·엑셀 파일을 새 id 로 복사. old id → new id
async function copyAssets(items, source, store, docId) {
  const ids = new Set()
  for (const m of items) {
    if (m.type === 'image' && m.imageId) ids.add(m.imageId)
    if (m.type === 'memo') {
      memoPhotoIds(m).forEach((id) => ids.add(id))
      memoFileIds(m).forEach((id) => ids.add(id))
      memoLinkPhotoIds(m).forEach((id) => ids.add(id))
    }
  }
  const map = new Map()
  let failed = 0
  await Promise.all(
    [...ids].map(async (id) => {
      const blob = await getImageBlob(source, id)
      if (!blob) {
        failed++
        return
      }
      const fresh = id.startsWith('xls') ? newFileId() : newImageId()
      rememberImage(fresh, blob)
      map.set(id, fresh)
      await store.saveImage(docId, fresh, blob).catch((e) => {
        console.warn('붙여넣은 파일 저장 실패', e)
        failed++
      })
    }),
  )
  return { map, failed }
}

function withAssets(m, map) {
  if (!map.size) return m
  const swap = (id) => map.get(id) ?? id
  if (m.type === 'image') return { ...m, imageId: swap(m.imageId) }
  if (m.type !== 'memo') return m
  let text = m.text
  if (typeof text === 'string') for (const [a, b] of map) text = text.split(`(img:${a})`).join(`(img:${b})`)
  return {
    ...m,
    text,
    ...(m.images ? { images: m.images.map(swap) } : {}),
    ...(Array.isArray(m.files) ? { files: m.files.map((f) => ({ ...f, id: swap(f.id) })) } : {}),
    ...(Array.isArray(m.links) ? { links: m.links.map((l) => (l.photo ? { ...l, photo: swap(l.photo) } : l)) } : {}),
  }
}

// 붙여넣을 항목 만들기. 이 도면에 없는 분류는 addCategory(name, color) 로 만들어 붙임
// → { items, failed } (failed: 복사 못 한 사진·파일 수)
export async function pasteItems(c, { docId, store, spot, numPages, counters, categories, addCategory, newId }) {
  const sameDoc = c.source.docId === docId
  const pos = placement(c, docId, spot, numPages)
  const { map, failed } = sameDoc ? { map: new Map(), failed: 0 } : await copyAssets(c.items, c.source, store, docId)

  // 분류: 같은 도면은 그대로(지워진 분류면 뗌), 다른 도면은 이름이 같은 분류 → 없으면 새로
  const catFor = new Map()
  const resolveCat = (id) => {
    if (catFor.has(id)) return catFor.get(id)
    let cat = categories.find((x) => x.id === id) ?? null
    if (!sameDoc || !cat) {
      const src = c.categories.find((x) => x.id === id)
      cat = src ? (categories.find((x) => x.name === src.name) ?? addCategory(src.name, src.color)) : null
    }
    catFor.set(id, cat)
    return cat
  }

  const items = c.items.map((orig, i) => {
    let m = withAssets(structuredClone(orig), map)
    m.id = `${newId()}${i}`
    m.name = renamed(m, counters)
    m.page = pos.multi ? Math.min(m.page, numPages) : pos.page
    m.points = (m.points ?? []).map((p) => ({ ...p, x: p.x + pos.dx, y: p.y + pos.dy }))
    delete m.hidden
    if (m.cat) m = withCategory(m, resolveCat(m.cat))
    return m
  })

  // 다음 붙여넣기 자리 (같은 자리면 또 비켜서)
  const box = boxOf(items)
  c.last = pos.multi ? { docId, n: pos.step } : { docId, page: pos.page, box }
  c.cursor = spot?.pointer ? { docId, page: spot.page, x: spot.x, y: spot.y } : null
  return { items, failed }
}
