// 홈 오른쪽 아래 "최근 열어본 도면": 마지막으로 연 시각(last_opened) 순서로 10개.
// 목록(recent)은 저장소가 이미 연 시각 순서로 주므로 앞에서 10개만 자름.
// 서버 저장이면 연 시각도 서버에 있어 다른 컴퓨터에서 연 도면도 함께 보임.
import { useState } from 'react'
import { FolderIcon, timeAgo } from './Library'
import { colorHex, displayName, fileBase, folderPath } from '../lib/library'

const RECENT_COUNT = 10
const HIDDEN_KEY = 'pdf-measure:recent-hidden'

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

// 연 적이 있는 도면만 (연 시각이 없거나 0 인 줄은 빼고), 연 시각 순서로 앞에서 count 개
export function recentOpened(list, count = RECENT_COUNT) {
  return list
    .filter((d) => d.lastOpened > 0)
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .slice(0, count)
}

export default function RecentDocs({ list, library, openIds, onOpen }) {
  const [hidden, setHidden] = useState(loadHidden)
  const items = recentOpened(list)
  if (!items.length) return null

  const toggle = () => {
    setHidden((v) => {
      saveHidden(!v)
      return !v
    })
  }

  return (
    <section>
      <button
        onClick={toggle}
        aria-expanded={!hidden}
        className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 text-left text-xs font-semibold tracking-wide text-ink-500 hover:text-ink-800"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        최근 열어본 도면
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`ml-auto h-4 w-4 transition-transform ${hidden ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {!hidden && (
        <ul className="divide-y divide-ink-100 rounded-xl bg-surface shadow-sm max-h-80 overflow-y-auto overscroll-contain lg:max-h-[max(12rem,calc((100dvh-15rem)/2))]">
          {items.map((item) => {
            const alias = library.aliases?.[item.id]
            const path = folderPath(library, library.assign[item.id])
            const last = path[path.length - 1]
            const isOpen = openIds.includes(item.id)
            return (
              <li key={item.id}>
                <button
                  onClick={() => onOpen(item)}
                  title={item.name}
                  className="flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left hover:bg-brand-50/50"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-danger-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 2h9l5 5v15H6z" />
                    <path d="M15 2v5h5" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-800">{displayName(library, item.id, item.name)}</span>
                      {item.summary?.rev && (
                        <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-600">{item.summary.rev}</span>
                      )}
                      {isOpen && <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-700">열려 있음</span>}
                    </div>
                    {/* 폴더 경로와 원래 파일 이름은 각각 한 줄씩: 길면 잘리지 않고 다음 줄로 넘어감 */}
                    {last && (
                      <div className="flex min-w-0 items-start gap-1 text-xs text-ink-400">
                        <span className="mt-0.5 shrink-0" style={{ color: colorHex(last.color) }}>
                          <FolderIcon className="h-3 w-3" color="currentColor" />
                        </span>
                        <span className="min-w-0 [overflow-wrap:anywhere]">{path.map((f) => f.name).join(' › ')}</span>
                      </div>
                    )}
                    {alias && <div className="min-w-0 text-xs text-ink-400 [overflow-wrap:anywhere]">{fileBase(item.name)}</div>}
                  </div>
                  <span className="shrink-0 text-xs text-ink-400 tabular-nums">{timeAgo(item.lastOpened)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
