// 자동 저장 때 도면 상태 전체 대신 "바뀐 곳"만 서버로 보내기 위한 비교.
// 큰 도면은 상태가 1MB 를 넘는데, 박스 하나를 옮기거나 메모 한 줄을 고쳐도 통째로 올리고 있었음.
// diffState(전에 저장한 것, 지금 것) → 고칠 곳 목록 [{ o, p, v }] (서버 함수 public.jsonb_apply_ops 가 차례로 적용, supabase/schema.sql)
//   o: 's' 그 자리 값을 v 로 (없던 키면 새로 만듦) | 'd' 그 자리를 지움 | 'i' 배열의 그 번호 앞에 v 를 끼움(끝을 넘으면 맨 뒤에)
//   p: 자리 (키·배열 번호를 글자로 늘어놓은 것, 예: ['measurements', '12', 'points'])
// 두 값은 JSON 으로 한 번 바꿨다 되돌린 것이어야 함 (undefined·NaN 이 없는, 서버에 들어가는 모양 그대로).

const kind = (v) => (Array.isArray(v) ? 'a' : v && typeof v === 'object' ? 'o' : 'p')

export function sameJson(a, b) {
  if (a === b) return true
  const k = kind(a)
  if (k !== kind(b) || k === 'p') return false
  if (k === 'a') {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return false
    return true
  }
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (!(key in b) || !sameJson(a[key], b[key])) return false
  return true
}

function walk(a, b, path, ops) {
  if (a === b) return
  const k = kind(a)
  if (k !== kind(b) || k === 'p') {
    ops.push({ o: 's', p: path, v: b })
    return
  }
  if (k === 'o') {
    for (const key of Object.keys(a)) if (!(key in b)) ops.push({ o: 'd', p: [...path, key] })
    for (const key of Object.keys(b)) {
      if (key in a) walk(a[key], b[key], [...path, key], ops)
      else ops.push({ o: 's', p: [...path, key], v: b[key] })
    }
    return
  }
  // 배열: 앞·뒤에서 같은 부분은 건너뛰고 가운데만 (항목 하나를 넣거나 빼도 나머지는 보내지 않음)
  let pre = 0
  while (pre < a.length && pre < b.length && sameJson(a[pre], b[pre])) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && sameJson(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++
  const ma = a.length - pre - suf
  const mb = b.length - pre - suf
  const common = Math.min(ma, mb)
  for (let i = 0; i < common; i++) walk(a[pre + i], b[pre + i], [...path, String(pre + i)], ops)
  for (let i = ma - 1; i >= common; i--) ops.push({ o: 'd', p: [...path, String(pre + i)] }) // 뒤에서부터 지워야 번호가 안 밀림
  for (let i = common; i < mb; i++) ops.push({ o: 'i', p: [...path, String(pre + i)], v: b[pre + i] })
}

export function diffState(prev, next) {
  const ops = []
  walk(prev, next, [], ops)
  // 맨 위가 통째로 바뀌는 경우(p 가 빈 자리)는 고칠 곳으로 나타낼 수 없음 → null (통째로 저장)
  return ops.some((op) => op.p.length === 0) ? null : ops
}
