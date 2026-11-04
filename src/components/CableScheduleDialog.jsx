import { useRef, useState } from 'react'
import { addCable, readCableFile, removeCable, updateCable, useCables } from '../lib/cableSchedule'

// 홈 "Cable schedule setting": cable schedule 엑셀을 여러 개 올려 두는 목록 (올리기·새 판으로 바꾸기·삭제).
// 따로 설정할 것은 없음: Equipment 카드의 Cable 단추가 모든 파일·시트·열에서 Tag. No 를 찾아 그 열로 거름.

const fmtDate = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function CableScheduleDialog({ store, onClose }) {
  const { items } = useCables()
  const inputRef = useRef(null)
  const replaceRef = useRef(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  const upload = async (files) => {
    if (!files.length) return
    setError('')
    setDone('')
    setBusy(true)
    const added = []
    for (const f of files) {
      try {
        const { item, blob } = await readCableFile(f)
        await addCable(store, item, blob)
        added.push(item)
      } catch (e) {
        console.warn('Cable schedule 올리기 실패', e)
        setError(`${f.name}: ${e?.message?.length < 120 ? e.message : '올리지 못했어요.'}`)
      }
    }
    setBusy(false)
    if (added.length) setDone(`${added.length}개를 올렸어요. Equipment 카드의 Cable 단추로 Tag. No 를 찾아 가져올 수 있어요.`)
  }

  // 같은 자리에 새 판 파일 (카드에 걸어 둔 필터는 그대로)
  const replace = async (id, file) => {
    if (!file) return
    setError('')
    setDone('')
    setBusy(true)
    try {
      const { item, blob } = await readCableFile(file)
      await updateCable(store, id, { name: item.name, sheet: item.sheet }, blob)
      setDone(`${item.name} 로 바꿨어요. 이 파일을 쓰는 카드에 바로 보여요.`)
    } catch (e) {
      console.warn('Cable schedule 바꾸기 실패', e)
      setError(`${file.name}: ${e?.message?.length < 120 ? e.message : '파일을 바꾸지 못했어요.'}`)
    } finally {
      setBusy(false)
    }
  }

  const dragProps = {
    onDragEnter: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(true)
    },
    onDragOver: (e) => {
      e.preventDefault()
      e.stopPropagation()
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
    },
    onDrop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      upload([...(e.dataTransfer.files ?? [])])
    },
  }

  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()} {...dragProps}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cable-title"
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-full w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl ${dragOver ? 'ring-4 ring-brand-300' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="cable-title" className="text-lg font-semibold text-ink-900">
              Cable schedule setting
            </h3>
            <p className="mt-1 text-sm text-pretty text-ink-500">
              Cable schedule 엑셀을 여러 개 올려 두세요. Equipment 카드의 Cable 단추를 누르면 올린 파일의 모든 시트·열에서 그 계기 Tag. No 를 찾아, 찾은 열로 걸러 엑셀 양식 그대로 보여요. 파일은 한 번씩만 저장돼요.
            </p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="-mt-1 -mr-1 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => inputRef.current?.click()} disabled={busy} className={`${btn} bg-brand-600 text-white hover:bg-brand-press`}>
            {busy ? '올리는 중…' : '엑셀 올리기'}
          </button>
          <span className="text-xs text-ink-400">.xlsx · .xlsm, 여러 개를 한 번에 골라도 되고 끌어다 놓아도 돼요.</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm"
            multiple
            className="hidden"
            onChange={(e) => {
              upload([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <input
            ref={replaceRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={(e) => {
              replace(replaceRef.current.dataset.id, e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        {error && <div className="mt-3 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-800">{error}</div>}
        {done && <div className="mt-3 rounded-lg bg-ok-50 px-3 py-2 text-sm text-ok-800">{done}</div>}

        <ul className="mt-4 divide-y divide-ink-100 rounded-xl ring-1 ring-ink-200">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-400">아직 올린 cable schedule 이 없어요.</li>}
          {items.map((it) => (
            <li key={it.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ok-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 11l5 6M14 11l-5 6" />
                </svg>
                <span className="min-w-0 truncate text-sm font-medium text-ink-800" title={it.name}>
                  {it.name}
                </span>
                <span className="text-xs text-ink-400">
                  {fmtDate(it.fv || it.at)}
                </span>
                <span className="ml-auto flex shrink-0 gap-1 text-xs">
                  <button
                    onClick={() => {
                      replaceRef.current.dataset.id = it.id
                      replaceRef.current.click()
                    }}
                    disabled={busy}
                    className="rounded px-2 py-0.5 text-ink-600 ring-1 ring-ink-200 hover:bg-ink-100"
                    title="새 판 파일로 바꾸기 (카드에 걸어 둔 필터는 그대로)"
                  >
                    파일 바꾸기
                  </button>
                  {confirmDel === it.id ? (
                    <>
                      <button onClick={() => (removeCable(store, it.id), setConfirmDel(null))} className="rounded bg-danger-600 px-2 py-0.5 font-medium text-white hover:bg-danger-700">
                        삭제
                      </button>
                      <button onClick={() => setConfirmDel(null)} className="rounded px-2 py-0.5 text-ink-500 hover:bg-ink-100">
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDel(it.id)}
                      className="rounded px-2 py-0.5 text-danger-600 hover:bg-danger-50"
                      title="목록에서 지우기 (이 파일을 가져온 카드에서는 안 보이게 돼요)"
                    >
                      삭제
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
