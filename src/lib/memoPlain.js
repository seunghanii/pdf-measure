// 메모 글(마크다운)에서 기호를 뺀 읽을 글. 검색·목록 요약용이라 도면 화면과 같은 첫 묶음에 들어가서 작게 따로 둡니다.
// 마크다운 ↔ 메모장 화면 변환은 lib/memoMarkdown.js (메모장을 열 때만 불러옴)

export const RULE = /^ {0,3}([-*_])( *\1){2,} *$/
export const TABLE_ROW = /^\s*\|.*\|\s*$/
export const TABLE_SEP = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/

// 표 한 줄 → 칸 글들 (\| 는 칸 나누기가 아님)
export const cellsOf = (line) => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (t[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += t[i]
  }
  cells.push(cur.trim())
  return cells
}

// 마크다운 기호를 뺀 읽을 글 (한 줄씩)
export function markdownPlainLines(md) {
  const out = []
  for (const line of String(md ?? '').split('\n')) {
    if (TABLE_SEP.test(line) || RULE.test(line) || /^\s*!\[[^\]]*\]\(img:[^)]*\)\s*$/.test(line)) continue
    let s = line
    if (TABLE_ROW.test(s))
      s = cellsOf(s)
        .filter(Boolean)
        .join(' ')
    s = s
      .replace(/^(#{1,6} |[-*+] \[[ xX]\] ?|[-*+] |\d+[.)] |> ?)/, '')
      .replace(/<br>/g, ' ')
      .replace(/\*\*|~~|(?<!\\)\*/g, '')
      .replace(/\\([\\*~`|#>\-+_[\]])/g, '$1')
    out.push(s)
  }
  return out
}
