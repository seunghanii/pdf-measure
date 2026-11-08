import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialOrder } from '../lib/pageEdit'

// 왼쪽 위 페이지 탐색 창 (굿노트처럼 쪽 그림 목록)
// - 쪽을 누르면 그 쪽으로 이동, 지금 보는 쪽은 파랗게
// - 쪽마다 ⋯ 메뉴: 앞·뒤에 빈 페이지 넣기, 앞·뒤로 옮기기, 페이지 지우기 (지우기는 한 번 더 확인)
// - 마우스로 쪽을 끌어 순서 바꾸기, 맨 아래 '빈 페이지 추가'
// - '선택' 을 누르면 쪽을 여러 개 골라(전체 선택, Shift 로 범위) 한꺼번에 돌리기·지우기
// onEdit(order, { label, focus }): 새 쪽 순서로 PDF 를 바꿈 (lib/pageEdit.js). null 이면 보기만
const THUMB_W = 128 // 쪽 그림 너비 (CSS px)

// 쪽 그림 보관: PDFDocumentProxy → Map(쪽 번호 → canvas). 페이지를 바꾼 뒤 새 PDF 로 옮겨 다시 그리지 않음
const thumbs = new WeakMap()
const thumbsOf = (pdf) => {
  let m = thumbs.get(pdf)
  if (!m) thumbs.set(pdf, (m = new Map()))
  return m
}
// order: 새 쪽 목록 ({ src: 예전 쪽 }) → 예전 PDF 에서 그려 둔 그림을 새 PDF 쪽 번호로
export function carryThumbs(oldPdf, newPdf, order) {
  const from = thumbs.get(oldPdf)
  if (!from) return
  const to = thumbsOf(newPdf)
  order.forEach((e, i) => {
    // 돌린 쪽은 새로 그림
    const c = e.src && !e.rot && from.get(e.src)
    if (c) to.set(i + 1, c)
  })
}

// 한 번에 한 쪽씩 그림 (스크롤이 끊기지 않게)
let chain = Promise.resolve()
function renderThumb(pdf, page) {
  const map = thumbsOf(pdf)
  if (map.has(page)) return Promise.resolve(map.get(page))
  const job = chain.then(async () => {
    if (map.has(page)) return map.get(page)
    if (pdf.loadingTask?.destroyed) return null
    const p = await pdf.getPage(page)
    const base = p.getViewport({ scale: 1 })
    const scale = (THUMB_W * Math.min(2, window.devicePixelRatio || 1)) / base.width
    const vp = p.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(vp.width))
    canvas.height = Math.max(1, Math.round(vp.height))
    await p.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise
    map.set(page, canvas)
    return canvas
  })
  chain = job.catch(() => null)
  return job
}

const pageRatio = async (pdf, page) => {
  const vp = (await pdf.getPage(page)).getViewport({ scale: 1 })
  return { w: vp.width, h: vp.height }
}

// 돌린 뒤 창이 새로 그려져도 선택을 이어 감 (도면 id → 고른 쪽 번호들)
const selCarry = new Map()

// [1, 3, 5] → '1, 3, 5쪽', 많으면 '7개 쪽'
const pagesLabel = (list) => (list.length <= 3 ? `${list.join(', ')}쪽` : `${list.length}개 쪽`)

export default function PageNavigator({ docId, pdfDoc, pageNum, onGo, measurements, onEdit, busy, syncing, undoLabel, onUndo, onClose }) {
  const n = pdfDoc.numPages
  const listRef = useRef(null)
  const [menu, setMenu] = useState(null) // { page, confirm }
  // 선택 모드: null 이면 꺼짐, 켜지면 고른 쪽 번호 Set
  const [sel, setSel] = useState(() => {
    const c = selCarry.get(docId)
    selCarry.delete(docId)
    return c ? new Set(c.filter((p) => p <= n)) : null
  })
  const [askDelete, setAskDelete] = useState(false)
  const lastPick = useRef(null)
  const [drag, setDrag] = useState(null) // { page, to (0~n 사이 넣을 자리), x, y }
  const [ratios, setRatios] = useState({}) // 쪽 번호 → 세로/가로 (그림이 오기 전 자리 맞춤)

  // 쪽마다 항목 수 (지우기 확인에 보여 줌)
  const counts = useMemo(() => {
    const c = new Map()
    for (const m of measurements) c.set(m.page ?? 1, (c.get(m.page ?? 1) ?? 0) + 1)
    return c
  }, [measurements])

  // 쪽 비율: 앞 몇 쪽만 미리 (나머지는 그림이 오면 맞춰짐)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const out = {}
      for (let p = 1; p <= Math.min(n, 60); p++) {
        const s = await pageRatio(pdfDoc, p).catch(() => null)
        if (!alive) return
        if (s) out[p] = s.h / s.w
      }
      setRatios(out)
    })()
    return () => {
      alive = false
    }
  }, [pdfDoc, n])

  // 지금 쪽이 목록에서 보이게
  useEffect(() => {
    listRef.current?.querySelector(`[data-page="${pageNum}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [pageNum])

  // 메뉴 바깥을 누르거나 Esc 면 닫음
  useEffect(() => {
    if (!menu) return
    const close = (e) => {
      if (!e.target.closest?.('[data-page-menu]')) setMenu(null)
    }
    const key = (e) => e.key === 'Escape' && setMenu(null)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', key)
    }
  }, [menu])

  const editable = !!onEdit && !busy
  const selecting = !!sel && !!onEdit
  const picked = useMemo(() => (sel ? [...sel].sort((a, b) => a - b) : []), [sel])

  // Esc 로 선택 모드 끝내기 (메뉴가 열려 있으면 메뉴 먼저)
  useEffect(() => {
    if (!selecting || menu) return
    const key = (e) => {
      if (e.key !== 'Escape') return
      if (askDelete) setAskDelete(false)
      else setSel(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [selecting, menu, askDelete])

  const startSelect = () => {
    setMenu(null)
    setAskDelete(false)
    lastPick.current = null
    setSel(new Set())
  }
  const stopSelect = () => {
    setAskDelete(false)
    setSel(null)
  }
  const allPicked = n > 0 && picked.length === n
  const toggleAll = () => {
    setAskDelete(false)
    setSel(allPicked ? new Set() : new Set(Array.from({ length: n }, (_, i) => i + 1)))
  }
  // 누르면 고르기/빼기, Shift 를 누른 채면 마지막으로 누른 쪽부터 범위로 고르기
  const pick = useCallback((page, e) => {
    setAskDelete(false)
    setSel((s) => {
      const next = new Set(s ?? [])
      const from = lastPick.current
      if (e?.shiftKey && from && from !== page) {
        const [a, b] = from < page ? [from, page] : [page, from]
        for (let p = a; p <= b; p++) next.add(p)
      } else if (next.has(page)) next.delete(page)
      else next.add(page)
      return next
    })
    lastPick.current = page
  }, [])

  // ---- 편집 ----
  const insertBlank = async (at, near) => {
    // at: 넣을 자리 (0 = 맨 앞), near: 크기를 따라 할 쪽
    setMenu(null)
    const size = await pageRatio(pdfDoc, near)
    const order = initialOrder(n)
    order.splice(at, 0, { blank: size })
    const label = at === 0 ? '맨 앞에 빈 페이지 넣기' : `${at}쪽 뒤에 빈 페이지 넣기`
    onEdit(order, { label, focus: at + 1 })
  }
  const remove = (page) => {
    setMenu(null)
    const order = initialOrder(n).filter((e) => e.src !== page)
    onEdit(order, { label: `${page}쪽 지우기`, focus: Math.min(page, n - 1) })
  }
  // 쪽 돌리기 (rot: 90 = 오른쪽, 270 = 왼쪽). keepSel: 돌린 뒤에도 선택 모드 유지
  const rotate = (pages, rot, keepSel) => {
    setMenu(null)
    if (!pages.length) return
    const set = new Set(pages)
    const order = initialOrder(n).map((e) => (set.has(e.src) ? { ...e, rot } : e))
    if (keepSel) selCarry.set(docId, pages)
    const dir = rot === 270 ? '왼쪽' : rot === 180 ? '거꾸로' : '오른쪽'
    onEdit(order, { label: `${pagesLabel(pages)} ${dir}으로 돌리기` })
  }
  const removeMany = (pages) => {
    setAskDelete(false)
    if (!pages.length || pages.length >= n) return
    const set = new Set(pages)
    const order = initialOrder(n).filter((e) => !set.has(e.src))
    // 지운 뒤 갈 쪽: 처음 지운 쪽 자리 (그 앞에 남은 쪽 수 + 1)
    const before = pages[0] - 1
    setSel(null)
    onEdit(order, { label: `${pagesLabel(pages)} 지우기`, focus: Math.min(before + 1, order.length) })
  }
  const pickedCount = useMemo(() => picked.reduce((a, p) => a + (counts.get(p) ?? 0), 0), [picked, counts])

  // page 를 to 자리(0~n, 그 앞에 넣음)로
  const move = (page, to) => {
    setMenu(null)
    const order = initialOrder(n)
    const [e] = order.splice(page - 1, 1)
    const at = to > page - 1 ? to - 1 : to
    if (at === page - 1) return
    order.splice(at, 0, e)
    onEdit(order, { label: `${page}쪽을 ${at + 1}쪽으로 옮기기`, focus: at + 1 })
  }

  // ---- 마우스로 끌어 순서 바꾸기 (터치는 ⋯ 메뉴의 앞·뒤로 옮기기) ----
  const dragRef = useRef(null)
  const dropAt = (clientY) => {
    const items = [...(listRef.current?.querySelectorAll('[data-page]') ?? [])]
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return items.length
  }
  const onPointerDown = (e, page) => {
    if (!editable || selecting || e.pointerType === 'touch' || e.button !== 0) return
    if (e.target.closest('[data-page-menu]')) return
    dragRef.current = { page, x: e.clientX, y: e.clientY, on: false, id: e.pointerId }
  }
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.id) return
      if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return
      d.on = true
      e.preventDefault()
      setDrag({ page: d.page, to: dropAt(e.clientY), x: e.clientX, y: e.clientY })
      // 목록 끝 근처면 저절로 스크롤
      const el = listRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        if (e.clientY < r.top + 32) el.scrollTop -= 12
        else if (e.clientY > r.bottom - 32) el.scrollTop += 12
      }
    }
    const onUp = (e) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.id) return
      dragRef.current = null
      if (!d.on) return
      setDrag(null)
      const to = dropAt(e.clientY)
      if (to !== d.page - 1 && to !== d.page) move(d.page, to)
      // 끌기 끝에 생기는 click 은 이동으로 치지 않음
      const stop = (ev) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0)
    }
    const onCancel = () => {
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
    }
    // move 는 n·onEdit 만 씀
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, onEdit])

  const pages = useMemo(() => Array.from({ length: n }, (_, i) => i + 1), [n])

  return (
    <aside
      className="absolute inset-y-0 left-0 z-40 flex w-44 shrink-0 flex-col border-r border-ink-200 bg-surface shadow-xl md:relative md:shadow-none"
      aria-label="페이지 탐색"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-ink-200 pr-1 pl-3">
        <span className="text-sm font-semibold text-ink-800">페이지</span>
        <span className="text-xs text-ink-400 tabular-nums">{n}쪽</span>
        {onEdit && (
          <button
            onClick={selecting ? stopSelect : startSelect}
            disabled={!!busy}
            aria-pressed={selecting}
            aria-label={selecting ? '페이지 선택 끝내기' : '페이지 선택하기'}
            title={selecting ? '선택 끝내기 (Esc)' : '쪽을 골라 돌리기·지우기'}
            className={`ml-auto h-7 rounded-md px-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
              selecting ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-brand-700 hover:bg-brand-50'
            }`}
          >
            {selecting ? '완료' : '선택'}
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="페이지 탐색 닫기"
          title="페이지 탐색 닫기"
          className={`${onEdit ? '' : 'ml-auto '}flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6l-6 6 6 6M11 6l-6 6 6 6" />
          </svg>
        </button>
      </div>

      {syncing && (
        <div className={`flex shrink-0 items-center gap-1.5 border-b border-ink-200 px-3 py-1 text-[11px] ${syncing === 'retry' ? 'text-danger-600' : 'text-ink-500'}`} role="status">
          <span className={`h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] ${syncing === 'retry' ? 'border-danger-200 border-t-danger-600' : 'border-brand-200 border-t-brand-600'}`} aria-hidden="true" />
          {syncing === 'retry' ? '서버 연결이 안 돼 다시 시도 중…' : '서버에 저장 중… (계속 쓰셔도 돼요)'}
        </div>
      )}

      {selecting && (
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-1.5 text-xs">
          <button onClick={toggleAll} className="flex items-center gap-1.5 font-medium text-ink-700 hover:text-ink-900" aria-pressed={allPicked}>
            <CheckMark on={allPicked} partial={!allPicked && picked.length > 0} />
            전체 선택
          </button>
          <span className="ml-auto text-ink-500 tabular-nums">{picked.length}개</span>
        </div>
      )}

      {undoLabel && !busy && (
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <span className="min-w-0 flex-1 truncate" title={undoLabel}>
            {undoLabel}
          </span>
          <button onClick={onUndo} className="shrink-0 rounded-md bg-surface px-2 py-1 font-semibold text-brand-700 shadow-sm hover:bg-brand-100">
            되돌리기
          </button>
        </div>
      )}

      <div ref={listRef} className={`relative min-h-0 flex-1 overflow-y-auto px-3 py-3 ${drag ? 'cursor-grabbing select-none' : ''}`}>
        {pages.map((p, i) => (
          <div key={p} data-page={p} className="relative">
            {drag && drag.to === i && <DropLine />}
            <Thumb
              pdf={pdfDoc}
              page={p}
              ratio={ratios[p]}
              current={p === pageNum}
              dragging={drag?.page === p}
              onGo={onGo}
              onPointerDown={onPointerDown}
              picking={selecting}
              picked={selecting && sel.has(p)}
              onPick={pick}
              menuOpen={menu?.page === p}
              onMenu={editable && !selecting ? () => setMenu((m) => (m?.page === p ? null : { page: p })) : null}
            />
            {menu?.page === p && (
              <PageMenu
                page={p}
                n={n}
                count={counts.get(p) ?? 0}
                confirm={menu.confirm}
                onInsertBefore={() => insertBlank(p - 1, p)}
                onInsertAfter={() => insertBlank(p, p)}
                onMoveUp={() => move(p, p - 2)}
                onMoveDown={() => move(p, p + 1)}
                onRotateRight={() => rotate([p], 90)}
                onRotateLeft={() => rotate([p], 270)}
                onAskDelete={() => setMenu({ page: p, confirm: true })}
                onDelete={() => remove(p)}
                onCancel={() => setMenu(null)}
              />
            )}
          </div>
        ))}
        {drag && drag.to === n && <DropLine />}

        {onEdit && !selecting && (
          <button
            disabled={!editable}
            onClick={() => insertBlank(n, n)}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 py-3 text-xs font-medium text-ink-500 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            빈 페이지 추가
          </button>
        )}
      </div>

      {selecting ? (
        <SelectBar
          count={picked.length}
          n={n}
          items={pickedCount}
          disabled={!editable}
          asking={askDelete}
          onRotateLeft={() => rotate(picked, 270, true)}
          onRotateRight={() => rotate(picked, 90, true)}
          onAskDelete={() => setAskDelete(true)}
          onDelete={() => removeMany(picked)}
          onCancelDelete={() => setAskDelete(false)}
        />
      ) : (
        onEdit && <p className="shrink-0 border-t border-ink-200 px-3 py-2 text-[11px] leading-snug text-ink-400">끌어서 순서 바꾸기 · ⋯ 에서 추가·삭제 · 선택으로 여러 쪽</p>
      )}

      {busy && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/80 px-4 text-center text-xs text-ink-600 backdrop-blur-[1px]">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden="true" />
          {busy}
        </div>
      )}
    </aside>
  )
}

function CheckMark({ on, partial }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on || partial ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 bg-surface'}`}
      aria-hidden="true"
    >
      {on ? (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : partial ? (
        <span className="h-0.5 w-2 rounded-full bg-white" />
      ) : null}
    </span>
  )
}

const RotateIcon = ({ left }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={left ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </svg>
)

// 선택 모드 아래 단추: 왼쪽·오른쪽 돌리기, 지우기 (지우기는 한 번 더 확인)
function SelectBar({ count, n, items, disabled, asking, onRotateLeft, onRotateRight, onAskDelete, onDelete, onCancelDelete }) {
  const none = count === 0
  const all = count >= n
  if (asking) {
    return (
      <div className="shrink-0 border-t border-ink-200 px-3 py-2 text-xs text-ink-800">
        <p className="font-semibold">{count}개 쪽을 지울까요?</p>
        <p className="mt-1 leading-snug text-ink-500">
          {items ? `그 쪽의 항목 ${items}개는 휴지통으로 가요. ` : ''}지운 뒤 '되돌리기'로 바로 되살릴 수 있어요.
        </p>
        <div className="mt-2 flex gap-1.5">
          <button onClick={onDelete} disabled={disabled} className="flex-1 rounded-md bg-danger-600 py-1.5 font-semibold text-white hover:bg-danger-700 disabled:opacity-50">
            지우기
          </button>
          <button onClick={onCancelDelete} className="flex-1 rounded-md border border-ink-200 py-1.5 hover:bg-ink-50">
            취소
          </button>
        </div>
      </div>
    )
  }
  const btn = 'flex h-9 flex-1 flex-col items-center justify-center rounded-md text-[10px] leading-none font-medium transition-colors disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className="shrink-0 border-t border-ink-200 px-2 py-1.5">
      <div className="flex gap-1">
        <button onClick={onRotateLeft} disabled={none || disabled} className={`${btn} text-ink-700 hover:bg-ink-100`} title="고른 쪽을 왼쪽으로 90° 돌리기">
          <RotateIcon left />
          <span className="mt-0.5">왼쪽</span>
        </button>
        <button onClick={onRotateRight} disabled={none || disabled} className={`${btn} text-ink-700 hover:bg-ink-100`} title="고른 쪽을 오른쪽으로 90° 돌리기">
          <RotateIcon />
          <span className="mt-0.5">오른쪽</span>
        </button>
        <button
          onClick={onAskDelete}
          disabled={none || all || disabled}
          className={`${btn} text-danger-600 hover:bg-danger-50`}
          title={all ? '모든 쪽을 지울 수는 없어요 (한 쪽은 남겨야 해요)' : '고른 쪽 지우기'}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
          </svg>
          <span className="mt-0.5">삭제</span>
        </button>
      </div>
      {all && <p className="mt-1 text-center text-[10px] text-ink-400">모든 쪽은 지울 수 없어요</p>}
    </div>
  )
}

function DropLine() {
  return <div className="pointer-events-none absolute -top-[7px] right-0 left-0 z-10 h-[3px] rounded-full bg-brand-500" />
}

const Thumb = memo(function Thumb({ pdf, page, ratio, current, dragging, onGo, onPointerDown, picking, picked, onPick, menuOpen, onMenu }) {
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  const [shown, setShown] = useState(() => thumbs.get(pdf)?.get(page) ?? null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    setShown(thumbs.get(pdf)?.get(page) ?? null)
  }, [pdf, page])

  useEffect(() => {
    if (!visible || shown) return
    let alive = true
    renderThumb(pdf, page)
      .then((c) => alive && c && setShown(c))
      .catch((e) => console.warn('쪽 그림 실패', e))
    return () => {
      alive = false
    }
  }, [visible, shown, pdf, page])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !shown) return
    c.width = shown.width
    c.height = shown.height
    c.getContext('2d').drawImage(shown, 0, 0)
  }, [shown])

  const r = shown ? shown.height / shown.width : (ratio ?? 1.414)
  const go = useCallback((e) => (picking ? onPick(page, e) : onGo(page)), [picking, onPick, onGo, page])

  return (
    <div className={`group mb-4 ${dragging ? 'opacity-40' : ''}`} onPointerDown={(e) => onPointerDown(e, page)}>
      <div className="relative">
        <button
          ref={boxRef}
          onClick={go}
          aria-label={picking ? `${page}쪽 ${picked ? '선택 빼기' : '선택'}` : `${page}쪽으로 이동`}
          aria-current={current && !picking ? 'page' : undefined}
          aria-pressed={picking ? picked : undefined}
          className={`theme-light relative block w-full overflow-hidden rounded-md bg-white ring-offset-2 ring-offset-surface transition-shadow ${
            picking
              ? picked
                ? 'ring-2 ring-brand-500'
                : 'ring-1 ring-ink-200 hover:ring-ink-400'
              : current
                ? 'ring-2 ring-brand-500'
                : 'ring-1 ring-ink-200 hover:ring-ink-400'
          }`}
          style={{ aspectRatio: `1 / ${r}` }}
        >
          {shown ? <canvas ref={canvasRef} className="block h-full w-full" /> : <span className="block h-full w-full animate-pulse bg-ink-100" />}
          {picking && picked && <span className="pointer-events-none absolute inset-0 bg-brand-500/15" />}
        </button>
        {picking && (
          <span className="pointer-events-none absolute top-1 left-1">
            <CheckMark on={picked} />
          </span>
        )}
        {onMenu && (
          <button
            data-page-menu
            onClick={onMenu}
            aria-label={`${page}쪽 메뉴`}
            aria-expanded={menuOpen}
            title="페이지 추가·삭제·옮기기"
            className={`absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md border border-ink-200 bg-surface/95 text-ink-600 shadow-sm transition-opacity hover:text-ink-900 ${
              menuOpen || current ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        )}
      </div>
      <div className={`mt-1 text-center text-xs tabular-nums ${(picking ? picked : current) ? 'font-semibold text-brand-700' : 'text-ink-500'}`}>{page}</div>
    </div>
  )
})

function PageMenu({ page, n, count, confirm, onInsertBefore, onInsertAfter, onMoveUp, onMoveDown, onRotateRight, onRotateLeft, onAskDelete, onDelete, onCancel }) {
  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-50 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div data-page-menu className="absolute top-8 right-0 left-0 z-20 overflow-hidden rounded-lg border border-ink-200 bg-surface py-1 text-xs text-ink-800 shadow-xl">
      {confirm ? (
        <div className="px-3 py-2">
          <p className="font-semibold">{page}쪽을 지울까요?</p>
          <p className="mt-1 leading-snug text-ink-500">
            {count ? `이 쪽의 항목 ${count}개는 휴지통으로 가요. ` : ''}지운 뒤 '되돌리기'로 바로 되살릴 수 있어요.
          </p>
          <div className="mt-2 flex gap-1.5">
            <button onClick={onDelete} className="flex-1 rounded-md bg-danger-600 py-1.5 font-semibold text-white hover:bg-danger-700">
              지우기
            </button>
            <button onClick={onCancel} className="flex-1 rounded-md border border-ink-200 py-1.5 hover:bg-ink-50">
              취소
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className={item} onClick={onInsertBefore}>
            앞에 빈 페이지 넣기
          </button>
          <button className={item} onClick={onInsertAfter}>
            뒤에 빈 페이지 넣기
          </button>
          <div className="my-1 border-t border-ink-100" />
          <button className={item} onClick={onMoveUp} disabled={page === 1}>
            앞으로 옮기기
          </button>
          <button className={item} onClick={onMoveDown} disabled={page === n}>
            뒤로 옮기기
          </button>
          <div className="my-1 border-t border-ink-100" />
          <button className={item} onClick={onRotateRight}>
            <RotateIcon />
            오른쪽으로 돌리기
          </button>
          <button className={item} onClick={onRotateLeft}>
            <RotateIcon left />
            왼쪽으로 돌리기
          </button>
          <div className="my-1 border-t border-ink-100" />
          <button className={`${item} text-danger-600 hover:bg-danger-50`} onClick={onAskDelete} disabled={n <= 1} title={n <= 1 ? '마지막 한 쪽은 지울 수 없어요' : undefined}>
            페이지 지우기
          </button>
        </>
      )}
    </div>
  )
}
