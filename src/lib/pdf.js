// legacy 빌드: 최신 문법 폴리필이 들어 있어 조금 오래된 브라우저(사파리 등)에서도 동작합니다.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// 파일은 서버로 올라가지 않고 브라우저 안에서만 읽습니다.
export function loadPdf(data) {
  return pdfjs.getDocument({ data }).promise
}
