// 파일 이름에서 도면 번호만 뽑아 비교 (관련 도면 연결에서 중복·개정판 알아보기).
// 이름 전체가 아니라 앞쪽 번호 부분만 봄: 뒤에 붙은 도면 이름("_Hook-up Detail")과 rev 표시는 무시.
//   "JCP-I-1234-001 Rev.B.pdf"            → JCP-I-1234-001
//   "JCP-I-1234-001_RevC_Hook-up Detail.pdf" → JCP-I-1234-001
//   "JCP-I-1234-001-R01.pdf", "JCP-I-1234-001 (B).pdf" → JCP-I-1234-001
// 엉뚱한 도면과 맞추지 않게 숫자가 들어 있고 6글자 이상인 번호만 돌려줌 (아니면 null).

// rev 표시: Rev.B, REV C, Revision 2, rev_01 … (앞의 구분 기호까지)
const REV_WORD = /[\s_.-]*\(?\s*rev(?:ision)?\.?[\s_.-]*[a-z0-9]{1,3}\s*\)?(?![a-z0-9])/gi
// 괄호 안 짧은 판 표시: (B), (01), [C]
const REV_PAREN = /\s*[([]\s*[a-z0-9]{1,2}\s*[)\]]/gi
// 번호 끝의 R01 꼴 (-R01, .R2). 끝의 숫자만 있는 덩어리(-01)는 쪽/시트 번호일 수 있어 그대로 둠
const REV_TAIL = /[-.]r\d{1,3}$/i

export function drawingNo(name) {
  const base = String(name ?? '')
    .replace(/\.pdf$/i, '')
    .replace(REV_WORD, ' ')
    .replace(REV_PAREN, ' ')
    .trim()
  const m = base.match(/^[a-z0-9]+(?:[-.][a-z0-9]+)*/i)
  if (!m) return null
  const no = m[0].replace(REV_TAIL, '').toUpperCase()
  return no.length >= 6 && /\d/.test(no) ? no : null
}

// 올린 도면 목록(rows: { id, name })에서 같은 도면 번호인 것들 (except: 뺄 id)
export function sameNumberDocs(rows, fileName, except) {
  const no = drawingNo(fileName)
  if (!no) return []
  return rows.filter((r) => r.id !== except && drawingNo(r.name) === no)
}
