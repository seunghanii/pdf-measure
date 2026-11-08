// legacy 빌드: 최신 문법 폴리필이 들어 있어 조금 오래된 브라우저(사파리 등)에서도 동작합니다.
// pdf.js 는 크기가 커서 처음 PDF 를 열 때 불러옵니다 (홈 화면은 pdf.js 없이 빨리 뜨게).
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

let pdfjsPromise = null
export function getPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    },
    (e) => {
      // 한 번 못 불러왔다고(잠깐 인터넷 끊김 등) 새로고침 전까지 모든 PDF 가 안 열리지 않게, 다음엔 다시 불러옴
      pdfjsPromise = null
      throw e
    },
  )
  return pdfjsPromise
}

// PDF 자체가 망가졌거나 암호가 걸린 것 (다시 해도 안 됨)
const badPdf = (e) => /InvalidPDF|Password|MissingPDF|FormatError/i.test(`${e?.name} ${e?.message}`)

// 파일은 서버로 올라가지 않고 브라우저 안에서만 읽습니다.
// 아이패드 사파리는 메모리가 모자라면 pdf.js 일꾼(worker)을 멈추기도 해서, 실패하면 한 번 새로 시작해 다시 열어 봄.
// (pdf.js 가 넘긴 버퍼를 가져가 버리므로 다시 열 때 쓸 사본을 미리 둠)
export async function loadPdf(data) {
  const spare = data instanceof ArrayBuffer ? data.slice(0) : null
  try {
    const pdfjs = await getPdfjs()
    return await pdfjs.getDocument({ data }).promise
  } catch (e) {
    if (badPdf(e) || !spare) throw e
    console.warn('PDF 열기 실패, 한 번 더 시도', e)
    const pdfjs = await getPdfjs()
    return pdfjs.getDocument({ data: spare }).promise
  }
}

// 탭으로 열어 둔 도면의 PDF (관련 도면 미리보기가 같은 도면을 다시 열지 않고 그대로 씀)
const openDocs = new Map() // 도면 id → PDFDocumentProxy
export function setOpenPdf(id, pdfDoc) {
  if (pdfDoc) openDocs.set(id, pdfDoc)
  else openDocs.delete(id)
}
export function getOpenPdf(id) {
  const doc = openDocs.get(id)
  return doc && !doc.loadingTask?.destroyed ? doc : null
}
