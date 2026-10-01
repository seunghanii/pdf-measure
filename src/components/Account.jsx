import { useEffect, useRef, useState } from 'react'
import { authErrorMessage, changePassword, sendPasswordReset, signIn, signUp } from '../lib/supabase'
import { localStore } from '../lib/storage'

const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200'

// 홈 화면의 로그인/회원가입 상자
export function AuthPanel() {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { kind: 'error' | 'info', text }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      if (mode === 'login') await signIn(email.trim(), password)
      else if (mode === 'signup') {
        const data = await signUp(email.trim(), password)
        if (!data.session)
          setMessage({ kind: 'info', text: '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 여기서 로그인하세요.' })
      } else {
        await sendPasswordReset(email.trim())
        setMessage({ kind: 'info', text: '비밀번호를 다시 정하는 링크를 메일로 보냈어요. 메일의 링크를 눌러 주세요.' })
      }
    } catch (err) {
      setMessage({ kind: 'error', text: authErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const tab = (id, label) => (
    <button
      type="button"
      onClick={() => {
        setMode(id)
        setMessage(null)
      }}
      className={`flex-1 rounded-md py-1.5 text-sm font-medium ${mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
    </button>
  )

  return (
    <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <CloudIcon className="mt-0.5 h-6 w-6 shrink-0 text-blue-600" />
        <div>
          <h2 className="font-semibold">로그인하면 도면과 측정값이 서버에 저장돼요</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            다른 컴퓨터나 브라우저에서도 같은 계정으로 로그인하면 그대로 이어서 볼 수 있어요.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3">
        {mode !== 'reset' && (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {tab('login', '로그인')}
            {tab('signup', '회원가입')}
          </div>
        )}
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
        {mode !== 'reset' && (
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? '비밀번호 (6자 이상)' : '비밀번호'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
        )}
        {message && (
          <p className={`rounded-md px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
            {message.text}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '잠시만요…' : mode === 'login' ? '로그인' : mode === 'signup' ? '가입하고 시작하기' : '재설정 메일 보내기'}
        </button>
        <div className="flex justify-between text-xs text-slate-500">
          {mode === 'reset' ? (
            <button type="button" className="hover:underline" onClick={() => setMode('login')}>
              ← 로그인으로 돌아가기
            </button>
          ) : (
            <button type="button" className="hover:underline" onClick={() => setMode('reset')}>
              비밀번호를 잊었어요
            </button>
          )}
          <span>로그인하지 않으면 이 브라우저에만 저장돼요</span>
        </div>
      </form>
    </section>
  )
}

// 홈 툴바 오른쪽: 로그인한 계정, 로그아웃
export function AccountMenu({ user, onLogout, onChangePassword }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  if (!user)
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-500" title="로그인하면 서버에 저장돼요">
        <span className="h-2 w-2 rounded-full bg-amber-400" />이 브라우저에만 저장 중
      </span>
    )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-64 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
        title="서버에 저장 중인 계정"
      >
        <CloudIcon className="h-4 w-4 shrink-0 text-blue-600" />
        <span className="truncate">{user.email}</span>
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          <button
            className="block w-full px-3 py-2 text-left hover:bg-slate-50"
            onClick={() => {
              setOpen(false)
              onChangePassword()
            }}
          >
            비밀번호 바꾸기
          </button>
          <button
            className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}

// 새 비밀번호 정하기 (메일의 재설정 링크로 들어왔거나, 계정 메뉴에서 바꿀 때)
export function PasswordDialog({ recovery, onClose }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await changePassword(password)
      setDone(true)
    } catch (err) {
      setMessage(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl"
      >
        <h2 className="text-lg font-bold">{recovery ? '새 비밀번호 정하기' : '비밀번호 바꾸기'}</h2>
        {done ? (
          <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">비밀번호를 바꿨어요.</p>
        ) : (
          <>
            <input
              autoFocus
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="새 비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`mt-4 ${inputCls}`}
            />
            {message && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            {done ? '닫기' : '취소'}
          </button>
          {!done && (
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? '바꾸는 중…' : '바꾸기'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// 로그인 전 이 브라우저에만 저장해 둔 도면을 서버로 옮기기
export function MigrationCard({ store, onDone }) {
  const [items, setItems] = useState([])
  const [progress, setProgress] = useState(null) // { done, failed, total, running }

  useEffect(() => {
    let alive = true
    localStore
      .listRecent()
      .then((list) => alive && setItems(list))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [store])

  if (!items.length && !progress) return null

  const run = async () => {
    const total = items.length
    let done = 0
    let failed = 0
    setProgress({ done, failed, total, running: true })
    for (const doc of items) {
      try {
        const blob = await localStore.getFile(doc.id)
        await store.importLocal(doc, blob)
        await localStore.removeFile(doc.id) // 서버에 옮긴 뒤 브라우저 사본은 지움
        done++
      } catch (e) {
        console.warn('옮기기 실패', doc.name, e)
        failed++
      }
      setProgress({ done, failed, total, running: true })
    }
    setProgress({ done, failed, total, running: false })
    const left = await localStore.listRecent().catch(() => [])
    setItems(left)
    onDone()
  }

  return (
    <section className="mb-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
      {progress && !progress.running ? (
        <p>
          서버로 {progress.done}개를 옮겼어요.
          {progress.failed > 0 && ` ${progress.failed}개는 옮기지 못해 이 브라우저에 그대로 두었어요 (50MB 넘는 파일이거나 연결 문제).`}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            로그인 전에 <b>이 브라우저에만</b> 저장한 도면이 {items.length}개 있어요. 서버로 옮기면 다른 컴퓨터에서도 보이고,
            이 브라우저의 사본은 지워져요.
          </p>
          <button
            onClick={run}
            disabled={progress?.running}
            className="rounded-md bg-amber-500 px-3 py-1.5 font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {progress?.running ? `옮기는 중 ${progress.done + progress.failed}/${progress.total}` : '서버로 옮기기'}
          </button>
        </div>
      )}
    </section>
  )
}

export function CloudIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M7 18a4 4 0 01-.5-8 6 6 0 0111.5 1.5A3.5 3.5 0 0117.5 18z" />
    </svg>
  )
}
