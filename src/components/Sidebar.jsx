import { useState } from 'react'
import { TYPE_INFO, describe } from '../lib/measure'
import { UNITS, parseNumber } from '../lib/units'
import { isMarkup } from '../lib/markup'

export default function Sidebar({
  calibration,
  mmPerPt,
  unit,
  setUnit,
  measurements,
  pageNum,
  selectedIds,
  onSelect,
  onDelete,
  onToggleHidden,
  onSetAllHidden,
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
    for (const m of measures) {
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

  const measures = measurements.filter((m) => !isMarkup(m.type))
  const markups = measurements.filter((m) => isMarkup(m.type))
  const rowProps = { mmPerPt, unit, pageNum, selectedIds, onSelect, onDelete, onToggleHidden, onSetAllHidden, onRename }

  return (
    <aside className="flex max-h-[35vh] w-full shrink-0 flex-col border-t border-slate-200 bg-white md:max-h-none md:w-80 md:border-t-0 md:border-l">
      {/* 축척 */}
      <section className="border-b border-slate-200 p-4">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500">축척</h3>
        {mmPerPt ? (
          <div className="mt-2 rounded-lg bg-orange-50 p-3 ring-1 ring-orange-200">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-orange-800">
                {calibration.mode === 'ratio' ? `도면 축척 1:${calibration.ratio.toLocaleString('ko-KR')}` : calibration.label}
              </div>
              {calibration.mode === 'line' && (
                <EyeButton hidden={calibration.hidden} onClick={() => onToggleHidden('calibration')} label="기준선" />
              )}
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

      {/* 측정 목록 · 마크업 목록 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <ItemSection
          title="측정 목록"
          items={measures}
          empty="아직 측정한 항목이 없습니다."
          actions={
            <>
              <button className="text-blue-600 hover:underline" onClick={exportCsv}>
                CSV 저장
              </button>
              <button
                className="text-red-500 hover:underline"
                onClick={() => window.confirm('모든 측정을 지울까요?') && onClear('measure')}
              >
                전체 삭제
              </button>
            </>
          }
          group="measure"
          {...rowProps}
        />
        <ItemSection
          title="마크업"
          items={markups}
          empty="형광펜, 텍스트, 펜, 사각형, 화살표 도구로 표시를 남겨 보세요."
          actions={
            <button
              className="text-red-500 hover:underline"
              onClick={() => window.confirm('모든 마크업을 지울까요?') && onClear('markup')}
            >
              전체 삭제
            </button>
          }
          group="markup"
          {...rowProps}
        />
      </div>

      <details className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">사용 팁 · 단축키</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Ctrl + 마우스 휠: 확대/축소, 스페이스바 누른 채 드래그: 화면 이동</li>
          <li>Shift 누른 채 클릭: 수평/수직/45° 로 고정</li>
          <li>선택 도구로 점이나 도형을 끌어 옮기고, Delete 로 삭제</li>
          <li>선택 도구로 빈 곳을 끌면 상자 안의 항목을 한꺼번에 선택, Shift/Ctrl+클릭으로 하나씩 더하거나 빼기, Ctrl+A 전체 선택</li>
          <li>텍스트: 클릭한 곳에 입력, Enter 완료 · Shift+Enter 줄바꿈, 선택 도구로 더블클릭하면 고치기</li>
          <li>형광펜·펜·사각형·화살표: 누른 채 끌어서 그리기</li>
          <li>길이: 점을 이어 찍으면 총 길이, 마지막 점 다시 클릭·더블클릭·Enter 로 완료</li>
          <li>면적: 첫 점 클릭·더블클릭·Enter 로 완료, Backspace/우클릭으로 한 점 취소</li>
          <li>눈 아이콘: 도면 위에서 숨기기/보이기 (값은 그대로 남아요)</li>
          <li>여러 페이지는 위아래로 스크롤, PageUp/PageDown 으로 페이지 이동</li>
          <li>
            숫자 키로 도구 바꾸기: 1 선택 · 2 이동 · 3 기준 · 4 길이 · 5 면적 · 6 각도 · 7 형광펜 · 8 텍스트 · 9 펜 · 0
            사각형 · W 화살표
          </li>
          <li>Ctrl+S PDF 저장 · Ctrl+Z 되돌리기 · Ctrl+0 화면에 맞춤</li>
        </ul>
      </details>
    </aside>
  )
}

// 눈 아이콘: 도면 위에서 숨기기/보이기
function EyeButton({ hidden, onClick, label }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={hidden ? `${label} 보이기` : `${label} 숨기기`}
      aria-pressed={!!hidden}
      className={`shrink-0 rounded p-1 hover:bg-slate-100 ${hidden ? 'text-slate-400' : 'text-slate-500 hover:text-slate-800'}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {hidden ? (
          <>
            <path d="M3 3l18 18" />
            <path d="M10.6 5.1A10 10 0 0112 5c5 0 9 4.5 10 7a13 13 0 01-2.9 4.1M6.1 6.1C3.9 7.6 2.5 9.7 2 12c1 2.5 5 7 10 7a9.6 9.6 0 004.4-1.1" />
            <path d="M9.9 9.9a3 3 0 004.2 4.2" />
          </>
        ) : (
          <>
            <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  )
}

function ItemSection({ title, items, empty, actions, group, mmPerPt, unit, pageNum, selectedIds, onSelect, onDelete, onToggleHidden, onSetAllHidden, onRename }) {
  const allHidden = items.length > 0 && items.every((m) => m.hidden)
  return (
    <section className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500">
          {title} ({items.length})
        </h3>
        {items.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <button
              className="text-slate-500 hover:underline"
              onClick={() => onSetAllHidden(!allHidden, group)}
              title={allHidden ? '모두 화면에 보이기' : '모두 화면에서 숨기기'}
            >
              {allHidden ? '모두 보이기' : '모두 숨기기'}
            </button>
            {actions}
          </div>
        )}
      </div>
      <ul className="px-2 pb-3">
        {items.length === 0 && <li className="px-2 py-3 text-center text-sm text-slate-400">{empty}</li>}
        {items.map((m) => {
          const d = describe(m, mmPerPt, unit)
          const color = m.color ?? TYPE_INFO[m.type].color
          const selected = selectedIds.includes(m.id)
          const markup = isMarkup(m.type)
          return (
            <li
              key={m.id}
              onClick={(e) => onSelect(m, e.shiftKey || e.ctrlKey || e.metaKey)}
              className={`group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 ${
                selected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'
              } ${m.hidden ? 'opacity-50' : ''}`}
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
                {markup ? (
                  d.main && <div className="truncate px-1 text-sm text-slate-700">{d.main}</div>
                ) : (
                  <div className="px-1 font-semibold tabular-nums" style={{ color: mmPerPt || m.type === 'angle' ? color : '#94a3b8' }}>
                    {d.main}
                  </div>
                )}
                {d.sub && <div className="px-1 text-xs text-slate-500 tabular-nums">{d.sub}</div>}
              </div>
              <EyeButton hidden={m.hidden} onClick={() => onToggleHidden(m.id)} label={m.name} />
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
  )
}
