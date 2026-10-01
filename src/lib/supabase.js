// 서버 저장(Supabase) 연결. 주소와 공개 키는 배포 환경 변수에서 읽습니다.
// 둘 중 하나라도 없으면 서버 기능은 꺼지고 지금처럼 브라우저에만 저장합니다.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

export const cloudConfigured = Boolean(url && key)

export const supabase = cloudConfigured ? createClient(url, key) : null

// 메일에 들어가는 링크가 돌아올 주소 (현재 앱 주소)
const appUrl = () => window.location.origin + window.location.pathname

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

// 가입 확인 메일을 켜 둔 프로젝트면 session 이 비어 있고 메일 확인이 필요합니다.
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } })
  if (error) throw error
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    // 확인 메일을 켠 상태에서 이미 가입된 이메일이면 오류 대신 빈 identities 가 옴
    const e = new Error('User already registered')
    e.code = 'user_already_exists'
    throw e
  }
  return data
}

// 이 브라우저에서만 로그아웃 (기본값은 모든 기기에서 로그아웃이라 다른 컴퓨터의 로그인도 끊김)
export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw error
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
  if (error) throw error
}

export async function changePassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

// Supabase 오류를 사용자에게 보여 줄 한국어 문장으로
export function authErrorMessage(e) {
  const code = e?.code ?? ''
  const msg = String(e?.message ?? e ?? '')
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 맞지 않아요.'
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return '이미 가입된 이메일이에요. 로그인해 주세요.'
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return '가입 확인 메일의 링크를 먼저 눌러 주세요.'
  if (code === 'weak_password' || /at least 6 characters/i.test(msg)) return '비밀번호는 6자 이상으로 정해 주세요.'
  if (code === 'same_password') return '지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.'
  if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) return '새 가입이 막혀 있어요. 관리자에게 계정을 만들어 달라고 하세요.'
  if (code === 'email_address_invalid' || /invalid format|is invalid/i.test(msg)) return '이메일 주소 형식을 확인해 주세요.'
  if (code === 'email_address_not_authorized' || /not authorized/i.test(msg))
    return '이 이메일로는 메일을 보낼 수 없어요. Supabase 기본 메일은 프로젝트 팀원 주소로만 보내져요.'
  if (code.startsWith('over_') || /rate limit/i.test(msg)) return '요청이 너무 잦아요. 잠시 뒤에 다시 해 주세요. (기본 메일은 시간당 2통까지)'
  return networkHint(e) ?? `처리하지 못했어요: ${msg}`
}

// 연결 자체가 안 될 때 (인터넷 끊김, 무료 프로젝트 일시 중지 등)
export function networkHint(e) {
  const msg = String(e?.message ?? e ?? '')
  if (e?.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed|fetch failed/i.test(msg))
    return '서버에 연결하지 못했어요. 인터넷 연결을 확인하고, 계속 안 되면 Supabase 프로젝트가 일시 중지됐는지 확인해 주세요.'
  return null
}
