// legacy 빌드: 최신 문법 폴리필이 들어 있어 조금 오래된 브라우저(사파리 등)에서도 동작합니다.
// pdf.js 는 크기가 커서 처음 PDF 를 열 때 불러옵니다 (홈 화면은 pdf.js 없이 빨리 뜨게).
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

let pdfjsPromise = null
export function getPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })
  return pdfjsPromise
}

// 파일은 서버로 올라가지 않고 브라우저 안에서만 읽습니다.
export async function loadPdf(data) {
  const pdfjs = await getPdfjs()
  return pdfjs.getDocument({ data }).promise
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
