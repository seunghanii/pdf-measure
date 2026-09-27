import { useState } from 'react'
import { UNITS, parseNumber } from '../lib/units'

export default function CalibrationDialog({ defaultUnit, onCancel, onConfirm }) {
  const [text, setText] = useState('')
  const [unit, setUnit] = useState(defaultUnit)
  const value = parseNumber(text)

  const submit = (e) => {
    e.preventDefault()
    if (value) onConfirm({ value, unit })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl"
      >
        <h2 className="text-lg font-bold">기준 길이 입력</h2>
        <p className="mt-1 text-sm text-slate-500">
          방금 그은 선의 <b>실제 길이</b>를 입력하세요. 도면에 적힌 치수(예: 5000)를 그대로 넣으면 됩니다.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            autoFocus
            inputMode="decimal"
            placeholder="예: 5000"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-lg outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-2"
          >
            {Object.keys(UNITS).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            취소
          </button>
          <button
            type="submit"
            disabled={!value}
            className="rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40"
          >
            기준으로 설정
          </button>
        </div>
      </form>
    </div>
  )
}
