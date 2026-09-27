import { useRef } from 'react'

const STEPS = [
  { n: 1, title: 'PDF 도면 열기', text: '버튼을 누르거나 파일을 화면에 끌어다 놓으세요.' },
  { n: 2, title: '기준 길이 지정', text: '치수를 아는 선의 양 끝을 클릭하고 실제 길이를 입력합니다.' },
  { n: 3, title: '측정하기', text: '길이, 면적, 각도 도구로 원하는 곳을 클릭해 잽니다.' },
]

export default function EmptyState({ onOpenFile, onOpenSample, loading }) {
  const inputRef = useRef(null)
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-xl text-center">
        <div
          className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-12 transition hover:border-blue-400 hover:bg-blue-50/40"
          onClick={() => inputRef.current?.click()}
        >
          <svg viewBox="0 0 48 48" className="mx-auto h-14 w-14 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 4h17l9 9v31H12z" strokeLinejoin="round" />
            <path d="M29 4v9h9" strokeLinejoin="round" />
            <path d="M18 34h14M18 34v-4M32 34v-4" strokeLinecap="round" />
          </svg>
          <p className="mt-4 text-lg font-semibold">{loading ? 'PDF 여는 중…' : 'PDF 도면을 여기에 끌어다 놓거나 클릭해서 여세요'}</p>
          <p className="mt-1 text-sm text-slate-500">파일은 서버로 전송되지 않고 내 브라우저 안에서만 열립니다.</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              onOpenFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        <button onClick={onOpenSample} className="mt-4 text-sm font-medium text-blue-600 hover:underline">
          도면이 없다면? 샘플 평면도로 체험해 보기 →
        </button>

        <ol className="mt-10 grid gap-3 text-left sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                {s.n}
              </div>
              <div className="mt-2 font-semibold">{s.title}</div>
              <div className="mt-1 text-sm text-slate-500">{s.text}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
