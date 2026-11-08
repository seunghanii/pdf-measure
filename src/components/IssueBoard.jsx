// 홈 'Issue': 모든 도면에서 이슈 체크가 켜진 Equipment 를 모아 보여 줌 (도면 요약 summary.inst 의 issue·iss).
// 누르면 그 도면을 열고 그 박스로 가서 카드를 엶. 모든 이슈가 clear 되면 카드의 체크가 꺼져 여기서도 빠짐.
import { useMemo, useState } from 'react'
import { timeAgo } from './Library'
import { displayName } from '../lib/library'

const HIDDEN_KEY = 'pdf-measure:issues-hidden'
const SHOW_TEXTS = 2 // 줄마다 보이는 이슈 글 수

function loadHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}
function saveHidden(v) {
  try {
    if (v) localStorage.setItem(HIDDEN_KEY, '1')
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // 무시
  }
}

// [{ doc, row, last }] 가장 최근 이슈 순
function issueRows(list) {
  const out = []
  for (const doc of list ?? []) {
    for (const row of doc.summary?.inst ?? []) {
      if (!row.issue) continue
      const iss = Array.isArray(row.iss) ? row.iss : []
      out.push({ doc, row, iss, last: Math.max(0, ...iss.map((x) => x.at ?? 0)) })
    }
  }
  return out.sort((a, b) => b.last - a.last)
}

export default function IssueBoard({ list, library, onOpen }) {
  const [hidden, setHidden] = useState(loadHidden)
  const items = useMemo(() => issueRows(list), [list])
  if (!items.length) return null
  const openCount = items.reduce((n, x) => n + x.iss.length, 0)

  const toggle = () =>
    setHidden((v) => {
      saveHidden(!v)
      return !v
    })

  return (
    <section>
      <button
        onClick={toggle}
        aria-expanded={!hidden}
        className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 text-left text-xs font-semibold tracking-wide text-ink-500 hover:text-ink-800"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-danger-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l10 18H2z" />
          <path d="M12 10v5M12 18v.01" />
        </svg>
        Issue
        <span className="rounded-full bg-danger-600 px-1.5 text-[11px] font-semibold text-white tabular-nums" title={`Equipment ${items.length}개 · 열린 이슈 ${openCount}개`}>
          {items.length}
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`ml-auto h-4 w-4 transition-transform ${hidden ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {!hidden && (
        <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto overscroll-contain rounded-xl bg-surface shadow-sm ring-1 ring-danger-200 lg:max-h-[max(12rem,calc((100dvh-15rem)/2))]">
          {items.map(({ doc, row, iss, last }) => (
            <li key={`${doc.id}-${row.id}`}>
              <button
                onClick={() => onOpen(doc, row)}
                title="그 도면을 열고 이 Equipment 카드 열기"
                className="flex w-full min-w-0 flex-col gap-0.5 px-4 py-2 text-left hover:bg-danger-50/60"
              >
                <div className="flex w-full min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-danger-600" aria-hidden="true" />
                  <span className="shrink-0 text-sm font-semibold text-ink-800 tabular-nums">{row.tag || '(Tag. No 없음)'}</span>
                  {row.desc && <span className="min-w-0 truncate text-xs text-ink-500">{row.desc}</span>}
                  {last > 0 && <span className="ml-auto shrink-0 text-xs text-ink-400 tabular-nums">{timeAgo(last)}</span>}
                </div>
                {iss.length ? (
                  <ul className="w-full min-w-0 pl-4 text-xs text-ink-700">
                    {iss.slice(0, SHOW_TEXTS).map((x, i) => (
                      <li key={i} className="truncate" title={x.t}>
                        · {x.t}
                      </li>
                    ))}
                    {iss.length > SHOW_TEXTS && <li className="text-ink-400">외 {iss.length - SHOW_TEXTS}개</li>}
                  </ul>
                ) : (
                  <div className="pl-4 text-xs text-ink-400">이슈 글 없음</div>
                )}
                <div className="w-full min-w-0 truncate pl-4 text-[11px] text-ink-400">
                  {displayName(library, doc.id, doc.name)} · {row.page}쪽
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
