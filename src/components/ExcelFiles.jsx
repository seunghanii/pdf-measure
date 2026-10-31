import { useEffect, useState } from 'react'
import { colName, parseCol, rangeLabel, readWorkbook, sliceRange, usedRange } from '../lib/excel'

const MAX_ROWS = 300 // 메모장 표에 보여 줄 줄 수 (그 이상은 범위를 줄여 달라고 안내)
const MAX_COLS = 40

// 메모에 첨부한 엑셀들. 파일마다 시트·행·열 범위를 정해 그 부분을 표로 보여 줌
// loadBlob(id) → Blob | null
export default function ExcelFiles({ files, onChangeFiles, loadBlob }) {
  if (!files?.length) return null
  const update = (id, patch) => onChangeFiles(files.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const remove = (id) => onChangeFiles(files.filter((f) => f.id !== id))
  return (
    <div className="flex flex-col gap-2 px-3 pt-3">
      {files.map((f) => (
        <ExcelFile key={f.id} file={f} loadBlob={loadBlob} onUpdate={(p) => update(f.id, p)} onRemove={() => remove(f.id)} />
      ))}
    </div>
  )
}

function ExcelFile({ file, loadBlob, onUpdate, onRemove }) {
  const [sheets, setSheets] = useState(null) // null 불러오는 중 | [{ sheet, data }] | 'error'
  const [editing, setEditing] = useState(!file.sheet)
  const [blob, setBlob] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const b = await loadBlob(file.id)
        if (!b) throw new Error('no file')
        const wb = await readWorkbook(file.id, b)
        if (!alive) return
        setBlob(b)
        setSheets(wb)
      } catch (e) {
        console.warn('엑셀 읽기 실패', e)
        if (alive) setSheets('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [file.id, loadBlob])

  const ready = Array.isArray(sheets)
  const sheet = ready ? (sheets.find((s) => s.sheet === file.sheet) ?? sheets[0]) : null

  // 처음 첨부했을 때: 첫 시트의 값 있는 범위 전체
  useEffect(() => {
    if (ready && !file.sheet && sheets[0]) onUpdate({ sheet: sheets[0].sheet, ...usedRange(sheets[0].data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const range = file.sheet ? { r1: file.r1, r2: file.r2, c1: file.c1, c2: file.c2 } : sheet ? usedRange(sheet.data) : null
  const rows = sheet && range ? sliceRange(sheet.data, { ...range, r2: Math.min(range.r2, range.r1 + MAX_ROWS - 1), c2: Math.min(range.c2, range.c1 + MAX_COLS - 1) }) : []
  const cut = range && (range.r2 - range.r1 + 1 > MAX_ROWS || range.c2 - range.c1 + 1 > MAX_COLS)

  const download = () => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-ink-200">
      <div className="flex items-center gap-1.5 bg-ok-50 px-2 py-1 text-xs">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ok-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 11l5 6M14 11l-5 6" />
        </svg>
        <span className="min-w-0 truncate font-medium text-ink-800" title={file.name}>
          {file.name}
        </span>
        {file.sheet && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="shrink-0 rounded px-1.5 py-0.5 text-ink-600 tabular-nums ring-1 ring-ink-200 hover:bg-white"
            title="보여 줄 시트·행·열 바꾸기"
            aria-expanded={editing}
          >
            {file.sheet} · {rangeLabel(file)}
          </button>
        )}
        <button onClick={download} disabled={!blob} className="ml-auto shrink-0 rounded p-1 text-ink-500 hover:bg-white hover:text-ink-800 disabled:opacity-40" title="엑셀 파일 받기" aria-label="엑셀 파일 받기">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
        </button>
        <button onClick={onRemove} className="shrink-0 rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600" title="첨부 빼기" aria-label="첨부 빼기">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {sheets === null && <p className="px-3 py-3 text-xs text-ink-400">엑셀 읽는 중…</p>}
      {sheets === 'error' && <p className="px-3 py-3 text-xs text-danger-600">엑셀을 읽지 못했어요. .xlsx 파일인지 확인해 주세요.</p>}

      {ready && editing && sheet && range && (
        <RangeEditor key={`${sheet.sheet}|${rangeLabel(range)}`} sheets={sheets} sheet={sheet} range={range} onChange={onUpdate} onDone={() => setEditing(false)} />
      )}

      {ready && rows.length > 0 && (
        <div className="max-h-72 overflow-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-ink-50 text-[10px] text-ink-400">
                <th className="sticky left-0 bg-ink-50 px-1" />
                {rows[0].map((_, j) => (
                  <th key={j} className="border-l border-ink-100 px-1.5 py-0.5 font-normal">
                    {colName(range.c1 + j)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-ink-100">
                  <td className="sticky left-0 bg-ink-50 px-1 text-right text-[10px] text-ink-400 tabular-nums">{range.r1 + i}</td>
                  {row.map((v, j) => (
                    <td key={j} className="border-l border-ink-100 px-1.5 py-0.5 whitespace-nowrap text-ink-800">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {cut && (
            <p className="px-2 py-1 text-[11px] text-ink-400">
              범위가 커서 앞의 {MAX_ROWS}줄 · {MAX_COLS}칸만 보여요. 범위를 좁혀 주세요.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// 시트 고르기 + 행·열 범위 (열은 글자 A, B … 나 숫자 모두 됨). 범위가 바뀌면 key 로 새로 그려 칸 값을 맞춤
function RangeEditor({ sheets, sheet, range, onChange, onDone }) {
  const [form, setForm] = useState(() => toForm(range))

  const apply = () => {
    const r1 = Math.max(1, Math.round(Number(form.r1)) || 1)
    const r2 = Math.max(r1, Math.round(Number(form.r2)) || r1)
    const c1 = parseCol(form.c1) ?? range.c1
    const c2 = Math.max(c1, parseCol(form.c2) ?? range.c2)
    onChange({ sheet: sheet.sheet, r1, r2, c1, c2 })
  }
  const box = 'w-14 rounded border border-ink-300 px-1.5 py-0.5 text-center text-xs tabular-nums outline-none focus:border-brand-500'
  const input = (key) => (
    <input
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          apply()
        }
      }}
      onFocus={(e) => e.target.select()}
      className={box}
      aria-label={{ r1: '시작 행', r2: '끝 행', c1: '시작 열', c2: '끝 열' }[key]}
    />
  )

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-100 bg-white px-2 py-1.5 text-xs text-ink-600">
      <label className="flex items-center gap-1">
        시트
        <select
          value={sheet.sheet}
          onChange={(e) => {
            const s = sheets.find((x) => x.sheet === e.target.value)
            onChange({ sheet: s.sheet, ...usedRange(s.data) })
          }}
          className="max-w-36 rounded border border-ink-300 px-1 py-0.5 text-xs"
        >
          {sheets.map((s) => (
            <option key={s.sheet} value={s.sheet}>
              {s.sheet}
            </option>
          ))}
        </select>
      </label>
      <span className="flex items-center gap-1">
        행 {input('r1')} ~ {input('r2')}
      </span>
      <span className="flex items-center gap-1">
        열 {input('c1')} ~ {input('c2')}
      </span>
      <button onClick={() => onChange({ sheet: sheet.sheet, ...usedRange(sheet.data) })} className="rounded px-1.5 py-0.5 text-ink-500 hover:bg-ink-100" title="값이 있는 칸 전체">
        전체
      </button>
      <button onClick={onDone} className="ml-auto rounded bg-ink-800 px-2 py-0.5 font-medium text-white hover:bg-ink-700">
        완료
      </button>
    </div>
  )
}

const toForm = (r) => ({ r1: String(r.r1), r2: String(r.r2), c1: colName(r.c1), c2: colName(r.c2) })
