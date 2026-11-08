// Equipment 이슈: 카드마다 이슈를 적고, 하나씩 clear 로 표시.
// inst.issue: 이슈 체크 (켜져 있으면 홈 'Issue' 칸과 도면 박스에 표시)
// inst.issues: [{ id, text, at: 적은 시각(ms), clear: clear 한 시각(ms) | null }]
// - 이슈를 더하면 체크가 켜지고, 모든 이슈가 clear 되면 체크가 꺼짐
// - 이슈 글은 지우지 않음 (clear 한 것도 '이슈 기록'으로 남아 날짜와 함께 보임)

export const issueList = (inst) => (Array.isArray(inst?.issues) ? inst.issues.filter((x) => x && typeof x.text === 'string') : [])
export const openIssues = (inst) => issueList(inst).filter((x) => !x.clear)
export const clearedIssues = (inst) => issueList(inst).filter((x) => x.clear)
export const hasIssue = (inst) => !!inst?.issue

const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// 체크 켜기·끄기. 끄면 남은 이슈를 모두 clear 로 (글은 기록으로 남음)
export function setIssueFlag(inst, on, now = Date.now()) {
  if (on) return { ...inst, issue: true }
  return { ...inst, issue: false, issues: issueList(inst).map((x) => (x.clear ? x : { ...x, clear: now })) }
}

export function addIssue(inst, text, now = Date.now()) {
  const t = String(text ?? '').trim()
  if (!t) return inst
  return { ...inst, issue: true, issues: [...issueList(inst), { id: newId(), text: t, at: now, clear: null }] }
}

export function editIssue(inst, id, text) {
  return { ...inst, issues: issueList(inst).map((x) => (x.id === id ? { ...x, text } : x)) }
}

// clear 표시·풀기. 모두 clear 되면 체크도 꺼지고, 다시 풀면 켜짐
export function clearIssue(inst, id, clear, now = Date.now()) {
  const issues = issueList(inst).map((x) => (x.id === id ? { ...x, clear: clear ? now : null } : x))
  const open = issues.some((x) => !x.clear)
  return { ...inst, issues, issue: open ? true : issues.length ? false : !!inst.issue }
}

// 날짜 표시 2026.11.08
export function fmtIssueDay(t) {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

// 홈 요약에 넣을 값: 체크가 켜진 카드만, 열린 이슈 글 (길면 자름)
const SUMMARY_TEXT = 140
export function issueSummary(inst) {
  if (!hasIssue(inst)) return null
  return openIssues(inst).map((x) => ({ t: x.text.slice(0, SUMMARY_TEXT), at: x.at }))
}
