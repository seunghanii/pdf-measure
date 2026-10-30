import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TYPE_INFO, describe } from '../lib/measure'
import { UNITS, calibrationInput, parseNumber } from '../lib/units'
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
  onEditCalibration,
  onApplyRatio,
  onResetCalibration,
  fileName,
  top, // 맨 위 (도면 안 검색 창)
}) {
  const [ratioText, setRatioText] = useState('100')
  const [showRatio, setShowRatio] = useState(false)
  // 축척 설정 창: 축척이 정해져 있으면 기본으로 접어 두고, 머리줄 버튼으로 열고 닫음
  const [scaleOpen, setScaleOpen] = useState(false)
  const scaleShown = !mmPerPt || scaleOpen

  const measures = useMemo(() => measurements.filter((m) => !isMarkup(m.type)), [measurements])
  const markups = useMemo(() => measurements.filter((m) => isMarkup(m.type)), [measurements])

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

  // 목록 줄마다 넘기는 함수는 늘 같은 것으로 (부모가 다시 그려져도 바뀌지 않은 줄은 다시 그리지 않게)
  const handlers = useRef(null)
  useLayoutEffect(() => {
    handlers.current = { onSelect, onDelete, onToggleHidden, onRename }
  })
  const rowActions = useMemo(
    () => ({
      onSelect: (m, additive) => handlers.current.onSelect(m, additive),
      onDelete: (id) => handlers.current.onDelete(id),
      onToggleHidden: (id) => handlers.current.onToggleHidden(id),
      onRename: (id, name) => handlers.current.onRename(id, name),
    }),
    [],
  )
  const rowProps = { mmPerPt, unit, pageNum, selectedIds, onSetAllHidden, rowActions }

  return (
    <aside className="flex max-h-[35vh] w-full shrink-0 flex-col border-t border-ink-200 bg-white md:max-h-none md:w-80 md:border-t-0 md:border-l">
      {top}
      {/* 축척 */}
      <section className="border-b border-ink-200 p-4">
        {mmPerPt ? (
          <button
            onClick={() => setScaleOpen((v) => !v)}
            aria-expanded={scaleOpen}
            title={scaleOpen ? '축척 설정 접기' : '축척 설정 펼치기'}
            className="-mx-2 -my-1 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-ink-50"
          >
            <h3 className="text-xs font-semibold tracking-wide text-ink-500">축척</h3>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ref-700 tabular-nums">
              {calibration.mode === 'ratio'
                ? `1 : ${calibration.ratio}`
                : `기준 ${calibrationInput(calibration).value} ${calibrationInput(calibration).unit}`}
              <span className="ml-1.5 font-normal text-ink-400">· {unit}</span>
            </span>
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${scaleOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : (
          <h3 className="text-xs font-semibold tracking-wide text-ink-500">축척</h3>
        )}
        {!scaleShown ? null : mmPerPt ? (
          <div className="mt-2 rounded-lg bg-ref-50 p-3 ring-1 ring-ref-200">
            <div className="flex items-center justify-between gap-2">
              {calibration.mode === 'ratio' ? (
                <ValueEditor
                  key={calibration.ratio}
                  prefix="도면 축척 1 :"
                  value={calibration.ratio}
                  onCommit={(value) => onApplyRatio(value)}
                />
              ) : (
                <ValueEditor
                  key={`${calibrationInput(calibration).value}|${calibrationInput(calibration).unit}`}
                  prefix="기준"
                  value={calibrationInput(calibration).value}
                  unit={calibrationInput(calibration).unit}
                  onCommit={(value, u) => onEditCalibration({ value, unit: u })}
                />
              )}
              {calibration.mode === 'line' && (
                <EyeButton hidden={calibration.hidden} onClick={() => onToggleHidden('calibration')} label="기준선" />
              )}
            </div>
            <div className="mt-0.5 text-xs text-ref-700">
              {calibration.mode === 'line'
                ? `${calibration.page}페이지 기준선 · 숫자만 고치면 선은 그대로 두고 모든 값이 다시 계산돼요`
                : '숫자를 고치면 바로 다시 계산돼요. PDF가 실제 용지 크기로 저장된 경우에만 정확합니다'}
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <button className="font-medium text-ref-700 hover:underline" onClick={onStartCalibrate}>
                선 다시 긋기
              </button>
              <button className="text-ink-500 hover:underline" onClick={onResetCalibration}>
                해제
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 rounded-lg bg-ink-50 p-3 text-sm">
            <p className="text-ink-600">
              먼저 <b className="text-ref-600">기준 길이</b> 도구로 치수를 아는 선을 그어 주세요.
            </p>
            <button
              className="mt-2 w-full rounded-md bg-ref-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-ref-600"
              onClick={onStartCalibrate}
            >
              기준선 긋기
            </button>
            <button className="mt-2 text-xs text-ink-500 hover:underline" onClick={() => setShowRatio((v) => !v)}>
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
                <span className="text-ink-600">1 :</span>
                <input
                  value={ratioText}
                  onChange={(e) => setRatioText(e.target.value)}
                  inputMode="decimal"
                  className="w-20 rounded border border-ink-300 px-2 py-1"
                />
                <button className="rounded bg-ink-700 px-2 py-1 text-xs text-white">적용</button>
              </form>
            )}
          </div>
        )}

        {scaleShown && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-ink-600">표시 단위</span>
            <div className="flex rounded-md bg-ink-100 p-0.5">
              {Object.keys(UNITS).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`rounded px-3 py-0.5 text-sm ${unit === u ? 'bg-white font-semibold shadow-sm' : 'text-ink-500'}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 측정 목록 · 마크업 목록 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <ItemSection
          title="측정 목록"
          items={measures}
          empty="아직 측정한 항목이 없습니다."
          actions={
            <>
              <button className="text-brand-600 hover:underline" onClick={exportCsv}>
                CSV 저장
              </button>
              <button
                className="text-danger-500 hover:underline"
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
              className="text-danger-500 hover:underline"
              onClick={() => window.confirm('모든 마크업을 지울까요?') && onClear('markup')}
            >
              전체 삭제
            </button>
          }
          group="markup"
          {...rowProps}
        />
      </div>

      <details className="border-t border-ink-200 px-4 py-3 text-xs text-ink-500">
        <summary className="cursor-pointer font-medium text-ink-600">사용 팁 · 단축키</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Ctrl + 마우스 휠: 확대/축소, 스페이스바 누른 채 드래그: 화면 이동</li>
          <li>Shift 누른 채 클릭: 수평/수직/45° 로 고정 (자석이 켜져 있으면 그 방향의 선에 붙음)</li>
          <li>자석(S 키로 켜고 끄기): 도면 선의 끝점·교차점·선 위와 이미 찍은 점에 커서가 붙어요. 스캔한 이미지 도면은 선이 없어서 찍은 점에만 붙어요</li>
          <li>기준 길이 숫자는 오른쪽 축척 칸에서 바로 고치거나, 선택 도구로 기준선을 더블클릭해서 고쳐요</li>
          <li>선택 도구로 점이나 도형을 끌어 옮기고, Delete 로 삭제</li>
          <li>선택 도구로 빈 곳을 끌면 상자 안의 항목을 한꺼번에 선택, Shift/Ctrl+클릭으로 하나씩 더하거나 빼기, Ctrl+A 전체 선택</li>
          <li>텍스트: 클릭한 곳에 입력, Enter 완료 · Shift+Enter 줄바꿈, 선택 도구로 더블클릭하면 고치기</li>
          <li>형광펜·펜·사각형·화살표: 누른 채 끌어서 그리기</li>
          <li>사진: 사진 버튼(I 키)으로 고르거나, 복사한 사진을 Ctrl+V 로 붙여넣거나, 사진 파일을 도면에 끌어다 놓기. 모서리를 끌면 비율 유지(Shift: 자유롭게), 더블클릭하면 자르기</li>
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

// 축척 칸의 숫자 입력: Enter 나 다른 곳 클릭으로 적용, Esc 로 취소
function ValueEditor({ prefix, value, unit, onCommit }) {
  const [text, setText] = useState(String(value))
  const [u, setU] = useState(unit)
  const commit = (nextUnit = u) => {
    const n = parseNumber(text)
    if (!n) {
      setText(String(value))
      return
    }
    if (n !== value || nextUnit !== unit) onCommit(n, nextUnit)
  }
  return (
    <form
      className="flex min-w-0 items-center gap-1 font-semibold text-ref-800"
      onSubmit={(e) => {
        e.preventDefault()
        commit()
        e.currentTarget.querySelector('input')?.blur()
      }}
    >
      <span className="shrink-0">{prefix}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setText(String(value))
        }}
        onFocus={(e) => e.target.select()}
        inputMode="decimal"
        title="숫자를 고치고 Enter"
        className="w-24 min-w-0 rounded border border-ref-300 bg-white px-1.5 py-0.5 tabular-nums outline-none focus:border-ref-500 focus:ring-2 focus:ring-ref-200"
      />
      {unit && (
        <select
          value={u}
          onChange={(e) => {
            setU(e.target.value)
            commit(e.target.value)
          }}
          className="rounded border border-ref-300 bg-white px-1 py-0.5 text-sm"
        >
          {Object.keys(UNITS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      )}
    </form>
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
      className={`shrink-0 rounded p-1 hover:bg-ink-100 ${hidden ? 'text-ink-400' : 'text-ink-500 hover:text-ink-800'}`}
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

function ItemSection({ title, items, empty, actions, group, mmPerPt, unit, pageNum, selectedIds, onSetAllHidden, rowActions }) {
  const allHidden = items.length > 0 && items.every((m) => m.hidden)
  return (
    <section className="border-b border-ink-100 last:border-b-0">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-xs font-semibold tracking-wide text-ink-500">
          {title} ({items.length})
        </h3>
        {items.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <button
              className="text-ink-500 hover:underline"
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
        {items.length === 0 && <li className="px-2 py-3 text-center text-sm text-ink-400">{empty}</li>}
        {items.map((m) => (
          <ItemRow key={m.id} m={m} mmPerPt={mmPerPt} unit={unit} otherPage={m.page !== pageNum} selected={selectedIds.includes(m.id)} actions={rowActions} />
        ))}
      </ul>
    </section>
  )
}

// 측정·마크업 목록 한 줄. 값이 그대로면 다시 그리지 않음 (끌어서 옮기는 동안 목록 전체가 다시 그려지지 않게)
const ItemRow = memo(function ItemRow({ m, mmPerPt, unit, otherPage, selected, actions }) {
  const { onSelect, onDelete, onToggleHidden, onRename } = actions
  const d = describe(m, mmPerPt, unit)
  const color = m.color ?? TYPE_INFO[m.type].color
  const markup = isMarkup(m.type)
  return (
    <li
      onClick={(e) => onSelect(m, e.shiftKey || e.ctrlKey || e.metaKey)}
      className={`group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 ${
        selected ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-ink-50'
      } ${m.hidden ? 'opacity-50' : ''}`}
    >
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <input
            value={m.name}
            onChange={(e) => onRename(m.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate rounded bg-transparent px-1 text-sm text-ink-600 hover:bg-white focus:bg-white focus:outline focus:outline-brand-300"
          />
          {otherPage && <span className="shrink-0 text-xs text-ink-400">{m.page}p</span>}
        </div>
        {markup ? (
          d.main && <div className="truncate px-1 text-sm text-ink-700">{d.main}</div>
        ) : (
          <div className="px-1 font-semibold tabular-nums" style={{ color: mmPerPt || m.type === 'angle' ? color : '#94a3b8' }}>
            {d.main}
          </div>
        )}
        {d.sub && <div className="px-1 text-xs text-ink-500 tabular-nums">{d.sub}</div>}
      </div>
      <EyeButton hidden={m.hidden} onClick={() => onToggleHidden(m.id)} label={m.name} />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(m.id)
        }}
        className="rounded p-1 text-ink-300 opacity-0 group-hover:opacity-100 hover:bg-danger-50 hover:text-danger-500"
        title="삭제"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  )
})
