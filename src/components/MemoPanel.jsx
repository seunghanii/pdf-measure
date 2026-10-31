import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cachedImageUrl, getImageBlob, isImageFile, newImageId, prepareImage, rememberImage } from '../lib/images'
import { memoSummary, migrateMemo } from '../lib/memo'
import { setMemoDock, useMemoDock } from '../lib/memoDock'
import { htmlToMarkdown } from '../lib/memoMarkdown'
import MemoEditor, { MemoHelp } from './MemoEditor'
import PhotoViewer from './PhotoViewer'
import DocPreview from './DocPreview'
import { InstFields, RelatedDocs } from './InstCard'
import ExcelFiles from './ExcelFiles'
import { MAX_EXCEL_BYTES, XLSM_TYPE, XLSX_TYPE, excelType, isExcelFile, isOldExcel, newFileId } from '../lib/excel'
import { DEFAULT_STATUS, statusOf } from '../lib/instrument'

// 메모 사진은 자세히 볼 수 있게 도면 사진보다 크게 저장
const MEMO_PHOTO_SIDE = 2400

// 메모장 크기 (사용자가 끌어서 바꾼 크기, 이 브라우저에 기억)
const SIZE_KEY = 'pdf-measure:memo-size'
const MIN_W = 280
const MIN_H = 200
function loadSize() {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY))
    return s && s.w > 0 ? s : null
  } catch {
    return null
  }
}
// 아래에 길게 놓을 때의 높이 (따로 기억)
const BOTTOM_H_KEY = 'pdf-measure:memo-bottom-h'
const MIN_BOTTOM_H = 160
function loadBottomH() {
  try {
    const h = Number(localStorage.getItem(BOTTOM_H_KEY))
    return h > 0 ? h : null
  } catch {
    return null
  }
}

// 메모장. 도면 오른쪽 위(또는 아래에 길게, memoDock 설정)에 떠 있고, 글을 바로 쓰고 사진을 글 사이에 넣습니다.
// others: 같은 자리에 겹친 메모들 (누르면 그 메모로 바뀜)
export default function MemoPanel({ memo, others, onSwitch, onChange, onClose, onDelete, onOpenLink, onPickLink, store, docId, onNotice, kinds, onAddKind }) {
  // 예전(사진을 아래 칸에 모아 둔) 메모는 처음 열 때 사진을 글 끝으로 옮김
  const [migrated] = useState(() => migrateMemo(memo))
  const [initialText] = useState(() => migrated?.text ?? memo.text ?? '')
  const [viewing, setViewing] = useState(null) // 크게 보는 사진 { ids, index }
  const [previewing, setPreviewing] = useState(null) // 미리 보는 관련 도면 { id, name, page, role }
  const [busy, setBusy] = useState(0) // 사진 넣는 중
  const [size, setSize] = useState(loadSize) // { w, h } px, 없으면 기본 크기
  const [bottomH, setBottomH] = useState(loadBottomH) // 아래 자리 높이 px, 없으면 기본
  const dock = useMemoDock() // 'right' | 'bottom' (모든 메모 공통)
  const bottom = dock === 'bottom'
  const panelRef = useRef(null)
  const editorRef = useRef(null)
  const editorApi = useRef(null)
  const fileRef = useRef(null)
  const excelRef = useRef(null)
  const pending = useRef(false) // 아직 저장 안 된 고침이 있음
  const saveTimer = useRef(0)
  const lastEditor = useRef(null)

  // 글은 잠시 멈추면 저장 (글자마다 저장하면 도면 화면까지 매번 다시 그려짐). 닫을 때도 저장
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })
  const flush = () => {
    clearTimeout(saveTimer.current)
    // 닫힐 때는 editorRef 가 먼저 비워지므로 마지막으로 고친 글 상자를 기억해 둠
    const el = editorRef.current ?? lastEditor.current
    if (!pending.current || !el) return
    pending.current = false
    onChangeRef.current({ text: htmlToMarkdown(el) })
  }
  const onEdit = () => {
    lastEditor.current = editorRef.current
    pending.current = true
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 400)
  }
  useEffect(() => {
    if (migrated) onChangeRef.current(migrated)
    return () => flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 사진 불러오기 → 주소 (못 불러오면 null)
  const loadPhoto = async (id) => {
    try {
      if (!cachedImageUrl(id)) await getImageBlob({ store, docId }, id)
    } catch (e) {
      console.warn('메모 사진 불러오기 실패', e)
    }
    return cachedImageUrl(id) ?? null
  }

  // 사진 넣기 (도면 사진과 같은 방식으로 줄여서 따로 저장)
  const addImages = async (files) => {
    const list = files.filter(isImageFile)
    if (!list.length) return
    setBusy((n) => n + list.length)
    const added = []
    for (const file of list) {
      try {
        const img = await prepareImage(file, { maxSide: MEMO_PHOTO_SIDE })
        const imageId = newImageId()
        rememberImage(imageId, img.blob)
        store.saveImage(docId, imageId, img.blob).catch((e) => {
          console.warn('사진 저장 실패', e)
          onNotice('메모 사진을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 넣어 주세요.')
        })
        added.push(imageId)
      } catch (e) {
        console.warn('사진 읽기 실패', e)
        onNotice('이 사진 형식은 열 수 없어요. JPG나 PNG 사진을 넣어 주세요.')
      } finally {
        setBusy((n) => n - 1)
      }
    }
    // 글 사이 커서 자리에 넣음 (글과 함께 저장됨)
    if (added.length) editorApi.current?.insertPhotos(added)
  }

  // 엑셀 첨부: 파일은 사진 저장소에 그대로 두고, 메모에는 보여 줄 시트·범위만 (lib/excel.js)
  const filesRef = useRef(memo.files)
  useLayoutEffect(() => {
    filesRef.current = memo.files
  })
  const attachExcel = (list) => {
    const added = []
    for (const file of list) {
      if (isOldExcel(file)) {
        onNotice('예전 엑셀(.xls)은 읽을 수 없어요. 엑셀에서 .xlsx(또는 .xlsm)로 다시 저장해서 넣어 주세요.')
        continue
      }
      if (!isExcelFile(file)) continue
      if (file.size > MAX_EXCEL_BYTES) {
        onNotice(`"${file.name}" 은(는) 10MB 가 넘어 첨부할 수 없어요.`)
        continue
      }
      const id = newFileId()
      const blob = new Blob([file], { type: excelType(file) })
      rememberImage(id, blob) // 이번 창에서 바로 읽고, 정리 대상에서도 빠지게
      store.saveImage(docId, id, blob).catch((e) => {
        console.warn('엑셀 저장 실패', e)
        onNotice('엑셀 파일을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 넣어 주세요.')
      })
      added.push({ id, name: file.name })
    }
    if (added.length) onChange({ files: [...(filesRef.current ?? []), ...added] })
  }
  const loadBlob = useCallback((id) => getImageBlob({ store, docId }, id), [store, docId])

  // 왼쪽 변·아래 변·왼쪽 아래 모서리를 끌어 크기 조절 (메모장은 오른쪽 위에 붙어 있음)
  const startResize = (e, dir) => {
    e.preventDefault()
    const el = panelRef.current
    const parent = el?.parentElement
    if (!el || !parent) return
    const r = el.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }
    const maxW = pr.width - 24
    const maxH = pr.bottom - r.top - 12
    let next = { w: r.width, h: r.height }
    const move = (ev) => {
      next = {
        w: dir.includes('w') ? Math.min(maxW, Math.max(MIN_W, start.w + (start.x - ev.clientX))) : start.w,
        h: dir.includes('s') ? Math.min(maxH, Math.max(MIN_H, start.h + (ev.clientY - start.y))) : start.h,
      }
      setSize(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ w: Math.round(next.w), h: Math.round(next.h) }))
      } catch {
        // 저장 못 해도 이번에는 그 크기로 보임
      }
    }
    document.body.style.cursor = dir === 'sw' ? 'nesw-resize' : dir === 'w' ? 'ew-resize' : 'ns-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // 아래 자리: 위 변을 끌어 높이 조절
  const startResizeBottom = (e) => {
    e.preventDefault()
    const el = panelRef.current
    const parent = el?.parentElement
    if (!el || !parent) return
    const r = el.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    const startY = e.clientY
    const startH = r.height
    const maxH = pr.height - 24
    let next = startH
    const move = (ev) => {
      next = Math.min(maxH, Math.max(MIN_BOTTOM_H, startH + (startY - ev.clientY)))
      setBottomH(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      try {
        localStorage.setItem(BOTTOM_H_KEY, String(Math.round(next)))
      } catch {
        // 저장 못 해도 이번에는 그 높이로 보임
      }
    }
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const color = memo.color ?? '#f59e0b'
  // 계기 카드로 만들기 / 계기 정보 빼기 (빼도 글·사진·연결은 그대로)
  const toggleInst = () => {
    if (memo.inst) onChange({ inst: null })
    else onChange({ inst: { tag: '', kind: '', status: DEFAULT_STATUS }, color: statusOf(DEFAULT_STATUS).color })
  }
  const urls = viewing ? viewing.ids.map((id) => cachedImageUrl(id)) : []

  return (
    <div
      ref={panelRef}
      style={bottom ? { height: bottomH ?? undefined } : size ? { width: size.w, height: size.h } : undefined}
      className={`absolute z-20 flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl ${
        bottom
          ? `right-3 bottom-3 left-3 max-h-[calc(100%-1.5rem)] ${bottomH ? '' : 'h-[38%] min-h-[200px]'}`
          : `top-14 right-3 max-h-[calc(100%-4.25rem)] max-w-[calc(100%-1.5rem)] ${size ? '' : 'w-[400px]'}`
      }`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((it) => it.kind === 'file')) e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        const all = [...e.dataTransfer.files]
        const files = all.filter(isImageFile)
        const sheets = all.filter((f) => isExcelFile(f) || isOldExcel(f))
        e.stopPropagation()
        if (!files.length && !sheets.length) return
        e.preventDefault()
        if (files.length) addImages(files)
        if (sheets.length) attachExcel(sheets)
      }}
    >
      {/* 머리: 이름, 닫기 */}
      <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2" style={{ borderTop: `3px solid ${color}` }}>
        <input
          value={memo.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 rounded px-1 py-0.5 text-sm font-semibold text-ink-800 hover:bg-ink-50 focus:bg-white focus:outline focus:outline-brand-300"
          aria-label="메모 이름"
        />
        <button
          onClick={toggleInst}
          className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-medium ${memo.inst ? 'text-ink-400 hover:bg-ink-100 hover:text-ink-700' : 'text-brand-700 hover:bg-brand-50'}`}
          title={memo.inst ? '계기 정보 칸 빼기 (글·사진·연결은 남아요)' : '태그·종류·상태 칸이 있는 계기 카드로 만들기'}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8" />
            <path d="M4 12h16" />
          </svg>
          {memo.inst ? '' : '계기 카드'}
        </button>
        <button
          onClick={() => setMemoDock(bottom ? 'right' : 'bottom')}
          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          title={bottom ? '메모장을 오른쪽에 놓기 (모든 메모에 적용)' : '메모장을 아래에 길게 놓기 (모든 메모에 적용)'}
          aria-label={bottom ? '오른쪽에 놓기' : '아래에 놓기'}
        >
          {bottom ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M14 4v16" />
              <path d="M16.5 8h2M16.5 11h2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 14h18" />
              <path d="M7 17h6" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="닫기 (Esc)">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* 같은 자리에 겹친 메모 */}
      {others.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-ink-100 bg-ink-50 px-3 py-1.5 text-xs text-ink-500">
          <span className="mr-0.5">겹친 메모</span>
          {others.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                flush()
                onSwitch(o.id)
              }}
              title={memoSummary(o)}
              className={`max-w-32 truncate rounded-full px-2 py-0.5 ${o.id === memo.id ? 'bg-ink-800 text-white' : 'bg-white ring-1 ring-ink-200 hover:bg-ink-100'}`}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      {/* 계기 카드 칸 (계기 카드일 때만) */}
      {memo.inst && <InstFields memo={memo} onChange={onChange} kinds={kinds} onAddKind={onAddKind} />}

      {/* 관련 도면 (여러 개) */}
      <RelatedDocs memo={memo} onChange={onChange} onOpen={setPreviewing} onPick={onPickLink} />

      {/* 글과 사진 (같이 스크롤) */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ExcelFiles files={memo.files} onChangeFiles={(files) => onChange({ files })} loadBlob={loadBlob} />
        <div onBlur={flush}>
          <MemoEditor
            initial={initialText}
            editorRef={editorRef}
            apiRef={editorApi}
            onEdit={onEdit}
            onPasteFiles={addImages}
            loadPhoto={loadPhoto}
            onOpenPhoto={(ids, index) => setViewing({ ids, index })}
            autoFocus={!initialText}
          />
        </div>
        {busy > 0 && <div className="px-4 pb-3 text-xs text-ink-400">사진 넣는 중…</div>}
      </div>

      {/* 아래: 사진 넣기, 지우기 */}
      <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-1.5">
        <button
          onMouseDown={(e) => e.preventDefault() /* 글 속 커서 자리를 그대로 두어 그 자리에 넣음 */}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-600 ring-1 ring-ink-300 hover:bg-ink-100"
          title="사진 넣기 (복사한 사진은 Ctrl+V, 끌어다 놓기도 돼요)"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01" />
          </svg>
          사진 넣기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addImages([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <button
          onClick={() => excelRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-600 ring-1 ring-ink-300 hover:bg-ink-100"
          title="엑셀(.xlsx, .xlsm) 첨부. 시트와 행·열 범위를 정해 메모장에서 바로 볼 수 있어요 (끌어다 놓기도 돼요)"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 11l5 6M14 11l-5 6" />
          </svg>
          엑셀
        </button>
        <input
          ref={excelRef}
          type="file"
          accept={`.xlsx,.xlsm,.xls,${XLSX_TYPE},${XLSM_TYPE}`}
          multiple
          className="hidden"
          onChange={(e) => {
            attachExcel([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <MemoHelp />
        <button onClick={onDelete} className="ml-auto rounded px-2 py-0.5 text-xs text-danger-500 hover:bg-danger-50">
          메모 지우기
        </button>
      </div>

      {/* 크기 조절 손잡이. 오른쪽: 왼쪽 변, 아래 변, 왼쪽 아래 모서리 / 아래: 위 변 */}
      {bottom ? (
        <div onPointerDown={startResizeBottom} className="absolute top-0 right-0 left-0 h-1.5 cursor-ns-resize" title="끌어서 높이 조절" />
      ) : (
        <>
          <div onPointerDown={(e) => startResize(e, 'w')} className="absolute top-0 bottom-3 left-0 w-1.5 cursor-ew-resize" title="끌어서 너비 조절" />
          <div onPointerDown={(e) => startResize(e, 's')} className="absolute right-0 bottom-0 left-3 h-1.5 cursor-ns-resize" title="끌어서 높이 조절" />
          <div onPointerDown={(e) => startResize(e, 'sw')} className="absolute bottom-0 left-0 h-4 w-4 cursor-nesw-resize" title="끌어서 크기 조절">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 7l6 6M3 11l2 2" />
            </svg>
          </div>
        </>
      )}

      {viewing && (
        <PhotoViewer
          key={viewing.index}
          urls={urls}
          index={Math.min(viewing.index, urls.length - 1)}
          onIndex={(index) => setViewing((v) => ({ ...v, index }))}
          onClose={() => setViewing(null)}
        />
      )}
      {previewing && (
        <DocPreview
          store={store}
          link={previewing}
          onClose={() => setPreviewing(null)}
          onOpen={(link) => {
            setPreviewing(null)
            onOpenLink?.(link)
          }}
        />
      )}
    </div>
  )
}
