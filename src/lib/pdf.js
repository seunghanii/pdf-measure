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
