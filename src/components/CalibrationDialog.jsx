import { useState } from 'react'
import { UNITS, parseNumber } from '../lib/units'

// initial: 이미 그은 기준선의 숫자를 고칠 때 { value, unit }
export default function CalibrationDialog({ defaultUnit, initial, onCancel, onConfirm }) {
  const [text, setText] = useState(initial ? String(initial.value) : '')
  const [unit, setUnit] = useState(initial?.unit ?? defaultUnit)
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
        <h2 className="text-lg font-bold">{initial ? '기준 길이 수정' : '기준 길이 입력'}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {initial ? '기준선' : '방금 그은 선'}의 <b>실제 길이</b>를 입력하세요. 도면에 적힌 치수(예: 5000)를 그대로 넣으면 됩니다.
          {initial && ' 선은 그대로 두고 모든 측정값이 다시 계산돼요.'}
        </p>
        <div className="mt-4 flex gap-2">
          <input
            autoFocus
            onFocus={(e) => e.target.select()}
            inputMode="decimal"
            placeholder="예: 5000"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-ink-300 px-3 py-2 text-lg outline-none focus:border-ref-500 focus:ring-2 focus:ring-ref-200"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="rounded-md border border-ink-300 px-2 py-2"
          >
            {Object.keys(UNITS).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-ink-600 hover:bg-ink-100">
            취소
          </button>
          <button
            type="submit"
            disabled={!value}
            className="rounded-md bg-ref-500 px-4 py-2 text-sm font-semibold text-white hover:bg-ref-600 disabled:opacity-40"
          >
            {initial ? '수정' : '기준으로 설정'}
          </button>
        </div>
      </form>
    </div>
  )
}
