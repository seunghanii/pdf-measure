import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// base: './' 로 두면 Vercel, GitHub Pages(하위 경로) 어디에 올려도 동작합니다.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1500 }, // pdf.js 가 커서 경고 기준만 올림
})
