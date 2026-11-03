// 홈 오른쪽 위 "최근 수정": 모든 도면의 수정 기록(summary.activity)을 모아 시간 순으로.
// 누르면 그 도면을 열고 그 쪽·항목 자리로 이동 (홈 검색과 같은 이동). 지운 항목은 그 쪽으로만.
import { useMemo, useState } from 'react'
import { timeAgo } from './Library'
import { displayName } from '../lib/library'
import { ACTION_LABEL } from '../lib/activity'

// 상자 높이는 화면의 절반 정도(최근 열어본 도면과 반씩), 넘치는 기록은 상자 안에서 스크롤
const SHOW_COUNT = 40
const HIDDEN_KEY = 'pdf-measure:activity-hidden'

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

const ACTION_STYLE = {
  add: 'bg-ok-50 text-ok-700',
  edit: 'bg-brand-50 text-brand-700',
  del: 'bg-danger-50 text-danger-600',
}

// 모든 도면 기록을 [{ doc, ev }] 로 모아 최근 것부터
function collectActivity(list) {
  const rows = []
  for (const doc of list) for (const ev of doc.summary?.activity ?? []) rows.push({ doc, ev })
  return rows.sort((a, b) => b.ev.t - a.ev.t)
}

// 예전 기록의 종류 이름도 새 이름으로
const OLD_W = { '계기 카드': 'Equipment', '도면 연결': '링크' }

export default function RecentActivity({ list, library, onGo }) {
  const [hidden, setHidden] = useState(loadHidden)
  const rows = useMemo(() => collectActivity(list), [list])

  const toggle = () => {
    setHidden((v) => {
      saveHidden(!v)
      return !v
    })
  }
  const shown = rows.slice(0, SHOW_COUNT)

  return (
    <section>
      <button
        onClick={toggle}
        aria-expanded={!hidden}
        className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 text-left text-xs font-semibold tracking-wide text-ink-500 hover:text-ink-800"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
        최근 수정
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`ml-auto h-4 w-4 transition-transform ${hidden ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {!hidden &&
        (rows.length === 0 ? (
          <div className="rounded-xl bg-surface px-4 py-5 text-center text-sm text-pretty text-ink-400 shadow-xs ring-1 ring-ink-200">
            도면에 Equipment·박스·마크업을 넣거나 고치면 여기에 기록돼요.
          </div>
        ) : (
          <>
            <ul className="divide-y divide-ink-100 rounded-xl bg-surface shadow-sm max-h-80 overflow-y-auto overscroll-contain lg:max-h-[max(12rem,calc((100dvh-15rem)/2))]">
              {shown.map(({ doc, ev: raw }, i) => {
                const ev = OLD_W[raw.w] ? { ...raw, w: OLD_W[raw.w] } : raw
                const title = ev.cnt ? `${ev.w} ${ev.cnt}개` : ev.n || ev.w
                const sub = ev.cnt || !ev.n || ev.n.startsWith(ev.w) ? '' : ev.w // "사각형 1 · 사각형" 처럼 겹치면 뺌
                return (
                  <li key={`${doc.id}:${ev.t}:${ev.id ?? i}`}>
                    <button
                      onClick={() => onGo(doc, ev)}
                      title={`${displayName(library, doc.id, doc.name)} · ${ev.p}쪽 · ${new Date(ev.t).toLocaleString('ko-KR')}`}
                      className="flex w-full min-w-0 items-start gap-2.5 px-3 py-2 text-left hover:bg-brand-50/50"
                    >
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_STYLE[ev.a] ?? ACTION_STYLE.edit}`}>
                        {ACTION_LABEL[ev.a] ?? ev.a}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {ev.c && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ev.c }} aria-hidden="true" />}
                          <span className={`truncate text-sm font-medium ${ev.a === 'del' ? 'text-ink-500' : 'text-ink-800'}`}>{title}</span>
                          {sub && <span className="shrink-0 text-xs text-ink-400">{sub}</span>}
                        </span>
                        <span className="flex min-w-0 items-center gap-1 text-xs text-ink-400">
                          <span className="truncate">{displayName(library, doc.id, doc.name)}</span>
                          <span className="shrink-0 tabular-nums">· {ev.p}쪽</span>
                        </span>
                      </span>
                      <span className="mt-0.5 shrink-0 text-xs text-ink-400 tabular-nums">{timeAgo(ev.t)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ))}
    </section>
  )
}
