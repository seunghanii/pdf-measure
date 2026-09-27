import { useState } from 'react'
import { TYPE_INFO, describe } from '../lib/measure'
import { UNITS, parseNumber } from '../lib/units'

export default function Sidebar({
  calibration,
  mmPerPt,
  unit,
  setUnit,
  measurements,
  pageNum,
  selectedId,
  onSelect,
  onDelete,
  onRename,
  onClear,
  onStartCalibrate,
  onApplyRatio,
  onResetCalibration,
  fileName,
}) {
  const [ratioText, setRatioText] = useState('100')
  const [showRatio, setShowRatio] = useState(false)

  const exportCsv = () => {
    const rows = [['이름', '종류', '페이지', '값', '둘레']]
    for (const m of measurements) {
      const d = describe(m, mmPerPt, unit)
      rows.push([m.name, TYPE_INFO[m.type].name, m.page, d.main, d.sub?.replace('둘레 ', '') ?? ''])
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    // 엑셀에서 한글이 깨지지 않도록 BOM 추가
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${fileName.replace(/\.pdf$/i, '') || '측정'}_측정결과.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <aside className="flex max-h-[35vh] w-full shrink-0 flex-col border-t border-slate-200 bg-white md:max-h-none md:w-80 md:border-t-0 md:border-l">
      {/* 축척 */}
      <section className="border-b border-slate-200 p-4">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500">축척</h3>
        {mmPerPt ? (
          <div className="mt-2 rounded-lg bg-orange-50 p-3 ring-1 ring-orange-200">
            <div className="font-semibold text-orange-800">
              {calibration.mode === 'ratio' ? `도면 축척 1:${calibration.ratio.toLocaleString('ko-KR')}` : calibration.label}
            </div>
            <div className="mt-0.5 text-xs text-orange-700">
              {calibration.mode === 'line'
                ? `${calibration.page}페이지의 기준선 기준 · 선택 도구로 끝점을 옮겨 보정 가능`
                : 'PDF가 실제 용지 크기로 저장된 경우에만 정확합니다'}
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <button className="font-medium text-orange-700 hover:underline" onClick={onStartCalibrate}>
                다시 지정
              </button>
              <button className="text-slate-500 hover:underline" onClick={onResetCalibration}>
                해제
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="text-slate-600">
              먼저 <b className="text-orange-600">기준 길이</b> 도구로 치수를 아는 선을 그어 주세요.
            </p>
            <button
              className="mt-2 w-full rounded-md bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600"
              onClick={onStartCalibrate}
            >
              기준선 긋기
            </button>
            <button className="mt-2 text-xs text-slate-500 hover:underline" onClick={() => setShowRatio((v) => !v)}>
              또는 도면 축척(1:N)을 알고 있다면 →
            </button>
            {showRatio && (
              <form
                className="mt-2 flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  const n = parseNumber(ratioText)
                  if (n) onApplyRatio(n)
                }}
              >
                <span className="text-slate-600">1 :</span>
                <input
                  value={ratioText}
                  onChange={(e) => setRatioText(e.target.value)}
                  inputMode="decimal"
                  className="w-20 rounded border border-slate-300 px-2 py-1"
                />
                <button className="rounded bg-slate-700 px-2 py-1 text-xs text-white">적용</button>
              </form>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-slate-600">표시 단위</span>
          <div className="flex rounded-md bg-slate-100 p-0.5">
            {Object.keys(UNITS).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`rounded px-3 py-0.5 text-sm ${unit === u ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 측정 목록 */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-xs font-semibold tracking-wide text-slate-500">측정 목록 ({measurements.length})</h3>
          {measurements.length > 0 && (
            <div className="flex gap-3 text-xs">
              <button className="text-blue-600 hover:underline" onClick={exportCsv}>
                CSV 저장
              </button>
              <button
                className="text-red-500 hover:underline"
                onClick={() => window.confirm('모든 측정을 지울까요?') && onClear()}
              >
                전체 삭제
              </button>
            </div>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          {measurements.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-slate-400">아직 측정한 항목이 없습니다.</li>
          )}
          {measurements.map((m) => {
            const d = describe(m, mmPerPt, unit)
            const color = TYPE_INFO[m.type].color
            const selected = selectedId === m.id
            return (
              <li
                key={m.id}
                onClick={() => onSelect(m)}
                className={`group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 ${
                  selected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'
                }`}
              >
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <input
                      value={m.name}
                      onChange={(e) => onRename(m.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 truncate rounded bg-transparent px-1 text-sm text-slate-600 hover:bg-white focus:bg-white focus:outline focus:outline-blue-300"
                    />
                    {m.page !== pageNum && <span className="shrink-0 text-xs text-slate-400">{m.page}p</span>}
                  </div>
                  <div className="px-1 font-semibold tabular-nums" style={{ color: mmPerPt || m.type === 'angle' ? color : '#94a3b8' }}>
                    {d.main}
                  </div>
                  {d.sub && <div className="px-1 text-xs text-slate-500 tabular-nums">{d.sub}</div>}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(m.id)
                  }}
                  className="rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
                  title="삭제"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <details className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">사용 팁 · 단축키</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Ctrl + 마우스 휠: 확대/축소, 스페이스바 누른 채 드래그: 화면 이동</li>
          <li>Shift 누른 채 클릭: 수평/수직/45° 로 고정</li>
          <li>선택 도구(V)로 점을 끌어 위치 수정, Delete 로 삭제</li>
          <li>면적: 첫 점 클릭·더블클릭·Enter 로 완료, Backspace/우클릭으로 한 점 취소</li>
          <li>V 선택 · H 이동 · C 기준 · L 길이 · A 면적 · G 각도 · Ctrl+Z 되돌리기</li>
        </ul>
      </details>
    </aside>
  )
}
