import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// 앱으로 설치(PWA): scripts/sw.js 를 dist/sw.js 로 내보내며 이번 빌드의 파일 목록과 판 번호를 채워 넣음.
// 파일 이름에 해시가 붙어 있어서 목록이 바뀌면 판 번호도 바뀌고, 브라우저가 새 서비스 워커를 깔아 새 판을 받음.
function pwaServiceWorker() {
  const PUBLIC_FILES = ['manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png']
  return {
    name: 'pwa-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/') && !f.endsWith('.map'))
        .sort()
      const precache = ['./', ...PUBLIC_FILES, ...files]
      const template = readFileSync(new URL('./scripts/sw.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(template).update(precache.join('\n')).digest('hex').slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace("const VERSION = '__VERSION__'", `const VERSION = '${version}'`)
          .replace('const PRECACHE = __PRECACHE__', `const PRECACHE = ${JSON.stringify(precache)}`),
      })
    },
  }
}

// base: './' 로 두면 Vercel, GitHub Pages(하위 경로) 어디에 올려도 동작합니다.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), pwaServiceWorker()],
  build: {
    chunkSizeWarningLimit: 1500, // pdf.js 가 커서 경고 기준만 올림
    rolldownOptions: {
      output: {
        // 잘 안 바뀌는 라이브러리는 따로 묶어서, 앱을 고쳐 다시 배포해도 브라우저가 받아 둔 것을 그대로 씀
        // react-dom/server 는 PDF 저장 때만 쓰므로 react 묶음에서 빼서 첫 화면에 실리지 않게 함
        codeSplitting: {
          groups: [
            // vite 의 미리 받기 도우미가 pdfjs 묶음에 끼면 첫 화면이 pdf.js 를 통째로 받게 되므로 따로 둠
            { name: 'preload', test: /preload-helper/ },
            { name: 'pdfjs', test: /node_modules[\\/]pdfjs-dist[\\/](?!.*worker)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/](?!.*server)/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase/ },
          ],
        },
      },
    },
  },
  worker: { format: 'es' }, // OCR 조각 그리기 워커가 pdf.js 를 불러옴
})
