// 브라우저 OCR(tesseract.js)에 필요한 파일을 public/ocr 로 복사합니다.
// 외부 CDN 대신 우리 사이트에서 받게 해서, CDN 이 막힌 회사 망에서도 동작하게 합니다.
// npm run dev / build 전에 자동으로 실행됩니다 (package.json 의 predev, prebuild).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = (p) => join(root, 'node_modules', p)
const out = join(root, 'public', 'ocr')

const files = [
  [nm('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
  // 브라우저 기능에 따라 셋 중 하나를 받음
  [nm('tesseract.js-core/tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [nm('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  // 한국어·영어 글자 모양 데이터 (가벼운 best_int 판)
  [nm('@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz'), 'kor.traineddata.gz'],
  [nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
]

mkdirSync(out, { recursive: true })
for (const [from, name] of files) {
  const to = join(out, name)
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue
  copyFileSync(from, to)
}
