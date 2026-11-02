// 한글 2벌식 자판으로 친 글자를 영문 자판 글자로 되돌리기 ("ㄹㅅ" → "FT", "ㄹㅅ-1001" → "FT-1001")
// Tag. No 칸이 기본 영어 입력일 때 씀. 맥/윈도 모두 웹페이지가 입력기(한/영)를 바꿀 수 없어서,
// 한글 자판 상태로 쳐도 영문 자판으로 친 것처럼 바꿔 줌.

const KEY = {
  ㅂ: 'q', ㅈ: 'w', ㄷ: 'e', ㄱ: 'r', ㅅ: 't', ㅛ: 'y', ㅕ: 'u', ㅑ: 'i', ㅐ: 'o', ㅔ: 'p',
  ㅁ: 'a', ㄴ: 's', ㅇ: 'd', ㄹ: 'f', ㅎ: 'g', ㅗ: 'h', ㅓ: 'j', ㅏ: 'k', ㅣ: 'l',
  ㅋ: 'z', ㅌ: 'x', ㅊ: 'c', ㅍ: 'v', ㅠ: 'b', ㅜ: 'n', ㅡ: 'm',
  ㅃ: 'Q', ㅉ: 'W', ㄸ: 'E', ㄲ: 'R', ㅆ: 'T', ㅒ: 'O', ㅖ: 'P',
}
// 겹자모는 두 번 친 글자
const PAIR = {
  ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
  ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ',
}
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']

const jamoKeys = (j) => (PAIR[j] ? [...PAIR[j]].map((x) => KEY[x]).join('') : KEY[j] ?? j)

// 한글(완성 글자·자모)이 들어 있나
export const hasHangul = (s) => /[ᄀ-ᇿ㄰-㆏가-힣]/.test(String(s ?? ''))

export function hangulToKeys(s) {
  let out = ''
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0)
    if (c >= 0xac00 && c <= 0xd7a3) {
      const n = c - 0xac00
      out += jamoKeys(CHO[Math.floor(n / 588)]) + jamoKeys(JUNG[Math.floor((n % 588) / 28)]) + jamoKeys(JONG[n % 28])
    } else {
      out += jamoKeys(ch)
    }
  }
  return out
}

// 예전 값(before)에서 새로 친 부분만 영문 자판 글자로 (원래 있던 한글은 그대로)
// 돌려줌: { value, caret } caret 은 바뀐 부분 끝
export function convertTyped(before, after) {
  const a = String(before ?? '')
  const b = String(after ?? '')
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const mid = b.slice(p, b.length - s)
  if (!hasHangul(mid)) return { value: b, caret: b.length - s }
  const conv = hangulToKeys(mid)
  return { value: b.slice(0, p) + conv + b.slice(b.length - s), caret: p + conv.length }
}
