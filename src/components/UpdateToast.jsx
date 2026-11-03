import { useEffect, useState } from 'react'
import { onUpdateReady } from '../lib/pwa'

// 새로 배포된 판이 준비되면 화면 아래에 작은 안내. 저장 중일 수 있어 저절로 새로고침하지는 않음
export default function UpdateToast() {
  const [show, setShow] = useState(false)
  useEffect(() => onUpdateReady(() => setShow(true)), [])
  if (!show) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-surface py-2 pr-2 pl-4 text-sm text-ink-700 shadow-lg ring-1 ring-ink-200"
    >
      <span>앱 새 버전이 있어요</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-brand-press"
      >
        새로고침
      </button>
      <button
        type="button"
        aria-label="닫기"
        onClick={() => setShow(false)}
        className="rounded-lg px-2 py-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
      >
        ×
      </button>
    </div>
  )
}
