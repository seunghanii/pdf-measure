import { useEffect, useRef, useState } from 'react'
import { loadPdf } from '../lib/pdf'
import { MAX_UPLOAD_BYTES } from '../lib/cloudStore'
import { nextRevLabel, pageSizes, revisionReport } from '../lib/revision'

const isPdf = (f) => f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
const dateText = (at) => (at ? new Date(at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '')
const pct = (k) => `${Math.round(k * 100)}%`

// 도면 개정판으로 바꾸기 창.
// 1) 판 목록: 지금 판, 예전 판(내려받기·되돌리기·지우기), 새 개정판 PDF 고르기(끌어놓기 가능)
// 2) 확인: 쪽 수·크기 변화, 없어지는 쪽의 항목, 축척 확인 안내 → 바꾸기
export default function RevisionDialog({ pdfDoc, store, docId, current, revisions, items, calibrated, calPage, onCancel, onApply, onRemoveRev }) {
  const [pick, setPick] = useState(null) // { file, fromRev, newPdf, oldSizes, newSizes, report, label, fit } | { loading } | { error }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dropping, setDropping] = useState(false)
  const [revBusy, setRevBusy] = useState(null) // 내려받거나 되돌리는 중인 판 key
  const fileRef = useRef(null)
  const pickRef = useRef(null)
  useEffect(() => {
    pickRef.current = pick
  }, [pick])
  // 창을 닫거나 다른 파일을 고르면, 바꾸지 않은 새 PDF 는 닫음 (바꾼 것은 탭이 씀)
  const applied = useRef(false)
  useEffect(
    () => () => {
      if (!applied.current) pickRef.current?.newPdf?.loadingTask?.destroy()
    },
    [],
  )

  const choose = async (file, fromRev = null) => {
    setError('')
    if (!isPdf(file)) return setError('PDF 파일을 골라 주세요.')
    if (`${file.name}|${file.size}` === `${current.name}|${current.size}` && !fromRev)
      return setError('지금 판과 같은 파일이에요. 새 개정판 PDF 를 골라 주세요.')
    if (store.kind === 'cloud' && file.size > MAX_UPLOAD_BYTES)
      return setError('50MB 가 넘는 PDF 는 서버에 올릴 수 없어 개정판으로 바꿀 수 없어요.')
    pick?.newPdf?.loadingTask?.destroy()
    setPick({ loading: true })
    try {
      const newPdf = await loadPdf(await file.arrayBuffer())
      const [oldSizes, newSizes] = await Promise.all([pageSizes(pdfDoc), pageSizes(newPdf)])
      const report = revisionReport(oldSizes, newSizes, items)
      setPick({
        file,
        fromRev,
        newPdf,
        oldSizes,
        newSizes,
        report,
        label: fromRev?.label ?? nextRevLabel(current.label === '처음 판' ? null : current, revisions),
        fit: true,
      })
    } catch (e) {
      console.warn(e)
      setPick(null)
      setError(`"${file.name}" 을(를) 열 수 없어요. 암호가 걸려 있거나 손상된 PDF 인지 확인해 주세요.`)
    }
  }

  const apply = async () => {
    if (!pick?.newPdf || busy) return
    setBusy(true)
    setError('')
    try {
      applied.current = true
      await onApply({ ...pick, label: pick.label.trim() || nextRevLabel(null, revisions) })
    } catch (e) {
      applied.current = false
      console.warn(e)
      setError(
        e?.code === 'too_large'
          ? '50MB 가 넘는 PDF 는 서버에 올릴 수 없어요.'
          : '바꾸지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요. (도면은 예전 그대로예요)',
      )
      setBusy(false)
    }
  }

  const getRevFile = async (r) => {
    const blob = await store.getRevisionFile(docId, r.key)
    if (!blob) throw new Error('no file')
    return new File([blob], r.name, { type: 'application/pdf' })
  }

  const download = async (r) => {
    setRevBusy(r.key)
    setError('')
    try {
      const file = await getRevFile(r)
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = r.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      console.warn(e)
      setError('예전 판 PDF 를 받지 못했어요.')
    } finally {
      setRevBusy(null)
    }
  }

  const restore = async (r) => {
    setRevBusy(r.key)
    setError('')
    try {
      await choose(await getRevFile(r), r)
    } catch (e) {
      console.warn(e)
      setError('예전 판 PDF 를 받지 못했어요.')
    } finally {
      setRevBusy(null)
    }
  }

  // 이 창 위로 끌어 온 파일은 여기서만 받음 (앱 전체 "PDF 열기"·도면에 사진 넣기로 넘어가지 않게)
  const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  const dropProps = {
    onDragEnter: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
    },
    onDragOver: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = busy ? 'none' : 'copy'
      if (!busy && !pick) setDropping(true)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false)
    },
    onDrop: (e) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDropping(false)
      if (busy) return
      const files = [...e.dataTransfer.files]
      choose(files.find(isPdf) ?? files[0])
    },
  }

  const r = pick?.report

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => !busy && onCancel()} {...dropProps}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-lg font-bold text-ink-900">{pick?.newPdf ? '개정판으로 바꾸기' : '도면 개정'}</h2>
          <p className="mt-1 text-sm text-ink-500">
            PDF 만 새 판으로 바꾸고 마크업·측정·메모·계기 카드·별명·폴더·연결은 그대로 둬요.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!pick?.newPdf ? (
            <>
              <div className="rounded-lg border border-ink-200 px-3 py-2.5">
                <div className="text-xs text-ink-500">지금 판</div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-xs font-semibold text-brand-700">{current.label}</span>
                  <span className="truncate text-sm text-ink-800" title={current.name}>
                    {current.name}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-ink-400">{dateText(current.at)}</span>
                </div>
              </div>

              <button
                type="button"
                disabled={pick?.loading}
                onClick={() => fileRef.current?.click()}
                className={`mt-3 flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors ${
                  dropping ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:border-brand-400 hover:bg-brand-50/50'
                }`}
              >
                {pick?.loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />새 PDF 살펴보는 중…
                  </span>
                ) : (
                  <>
                    <span className="font-semibold text-brand-700">새 개정판 PDF 고르기</span>
                    <span className="mt-1 text-xs text-ink-500">또는 PDF 를 여기에 끌어다 놓으세요</span>
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) choose(f)
                }}
              />

              {revisions.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 text-xs font-semibold text-ink-500">예전 판</div>
                  <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                    {revisions.map((rv) => (
                      <li key={rv.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-600">{rv.label}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-ink-700" title={rv.name}>
                            {rv.name}
                          </div>
                          <div className="text-xs text-ink-400">
                            {rv.replacedAt ? `${dateText(rv.replacedAt)} 에 바뀜` : ''}
                            {!rv.file && ' · PDF 는 보관하지 못했어요'}
                          </div>
                        </div>
                        {rv.file && (
                          <>
                            <button
                              type="button"
                              disabled={!!revBusy}
                              onClick={() => download(rv)}
                              className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-600 hover:bg-ink-100 disabled:opacity-40"
                              title="이 판 PDF 내려받기"
                            >
                              {revBusy === rv.key ? '…' : '받기'}
                            </button>
                            <button
                              type="button"
                              disabled={!!revBusy}
                              onClick={() => restore(rv)}
                              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                              title="이 판으로 되돌리기 (지금 판은 예전 판 목록에 남아요)"
                            >
                              되돌리기
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={!!revBusy}
                          onClick={() => {
                            if (window.confirm(`"${rv.label}" 판을 목록에서 지울까요? 보관한 PDF 도 지워져요.`)) onRemoveRev(rv)
                          }}
                          className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-40"
                          title="이 판 지우기"
                        >
                          지우기
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm text-ink-700">
                <span className="text-ink-500">새 판 파일</span>
                <div className="truncate font-medium" title={pick.file.name}>
                  {pick.file.name}
                </div>
              </div>
              <label className="mt-3 block text-sm">
                <span className="text-ink-500">판 이름</span>
                <input
                  autoFocus
                  value={pick.label}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setPick((p) => ({ ...p, label: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && apply()}
                  placeholder="예: Rev.B"
                  className="mt-1 w-full rounded-md border border-ink-300 px-3 py-1.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </label>

              <ul className="mt-4 space-y-2 text-sm">
                <Check ok>
                  쪽 수 {r.oldPages}
                  {r.oldPages !== r.newPages ? ` → ${r.newPages}` : ' (같음)'}
                </Check>
                {r.scaled.length > 0 && (
                  <li className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-warn-800">
                    <div className="font-medium">
                      쪽 크기가 바뀌었어요 ({r.scaled.map((p) => `${p.page}쪽 ${pct(p.k)}`).join(', ')})
                    </div>
                    <label className="mt-1.5 flex items-start gap-2">
                      <input type="radio" className="mt-1" checked={pick.fit} onChange={() => setPick((p) => ({ ...p, fit: true }))} />
                      <span>
                        새 크기에 맞춰 마크업 자리와 축척도 같이 맞추기 <span className="text-xs text-warn-700">(추천: 같은 도면을 다른 종이 크기로 낸 경우)</span>
                      </span>
                    </label>
                    <label className="mt-1 flex items-start gap-2">
                      <input type="radio" className="mt-1" checked={!pick.fit} onChange={() => setPick((p) => ({ ...p, fit: false }))} />
                      <span>자리 그대로 두기</span>
                    </label>
                  </li>
                )}
                {r.reshaped.length > 0 && (
                  <Check>
                    {r.reshaped.map((p) => p.page).join(', ')}쪽은 가로세로 비율이 달라져서 마크업을 그 자리에 그대로 둬요. 바꾼 뒤 위치를 확인해 주세요.
                  </Check>
                )}
                {r.goneCount > 0 && (
                  <Check>
                    새 판에는 {r.goneFrom}쪽부터 없어서, 그 쪽에 있던 항목 {r.goneCount}개는 도면에 보이지 않게 돼요. 지우지 않고 보관해 두니 예전
                    판으로 되돌리면 다시 보여요.
                  </Check>
                )}
                {calibrated && (
                  <Check>
                    축척(기준 길이)은 이어져요. 새 판에서 기준 길이가 맞는지 한 번 확인해 주세요.
                    {calPage > r.newPages && ` 기준선이 있던 ${calPage}쪽은 새 판에 없어서 기준선은 보이지 않지만 축척 값은 그대로 써요.`}
                  </Check>
                )}
                <Check ok>지금 판은 예전 판 목록에 보관돼요. 검색 글자(OCR)는 새 판으로 다시 만들어요.</Check>
              </ul>
            </>
          )}
          {error && <p className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3">
          {pick?.newPdf ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  pick.newPdf.loadingTask?.destroy()
                  setPick(null)
                  setError('')
                }}
                className="rounded-md px-4 py-2 text-sm text-ink-600 hover:bg-ink-100 disabled:opacity-40"
              >
                뒤로
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={apply}
                className="flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {busy ? '바꾸는 중…' : pick.fromRev ? '이 판으로 되돌리기' : '개정판으로 바꾸기'}
              </button>
            </>
          ) : (
            <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-ink-600 hover:bg-ink-100">
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Check({ ok, children }) {
  return (
    <li className="flex items-start gap-2 text-ink-700">
      <span className={`mt-0.5 shrink-0 text-xs ${ok ? 'text-ok-600' : 'text-warn-600'}`}>{ok ? '✓' : '!'}</span>
      <span>{children}</span>
    </li>
  )
}
