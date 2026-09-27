// 샘플 평면도 PDF 생성 (A4 가로, 축척 1:50). 실행: node scripts/make-sample-pdf.mjs
import { writeFileSync } from 'node:fs'

const MM = 72 / 25.4
const S = (realMm) => (realMm / 50) * MM // 1:50 축척에서 실제 mm → pt
const ox = 90
const oy = 110
const P = (x, y) => [ox + S(x), oy + S(y)]

const cmds = []
const line = (a, b) => cmds.push(`${a[0].toFixed(2)} ${a[1].toFixed(2)} m ${b[0].toFixed(2)} ${b[1].toFixed(2)} l S`)
const text = (x, y, size, str) => cmds.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${str}) Tj ET`)

// 외벽 (오른쪽 위 모서리 2000 x 2000 모따기)
cmds.push('2.2 w 0 0 0 RG')
const outer = [P(0, 0), P(10000, 0), P(10000, 5000), P(8000, 7000), P(0, 7000)]
outer.forEach((p, i) => line(p, outer[(i + 1) % outer.length]))
// 칸막이벽 (문 개구부 900)
cmds.push('1.2 w')
line(P(6000, 0), P(6000, 3000))
line(P(6000, 3900), P(6000, 7000))
// 문 호
cmds.push('0.5 w')
line(P(6000, 3000), P(6900, 3000))

// 치수선
cmds.push('0.4 w 0.3 0.3 0.3 RG 0.2 0.2 0.2 rg')
const dimH = (x1, x2, y, label) => {
  line(P(x1, y), P(x2, y))
  line(P(x1, y - 250), P(x1, y + 250))
  line(P(x2, y - 250), P(x2, y + 250))
  const [cx, cy] = P((x1 + x2) / 2, y)
  text(cx - label.length * 2.6, cy + 4, 9, label)
}
const dimV = (y1, y2, x, label) => {
  line(P(x, y1), P(x, y2))
  line(P(x - 250, y1), P(x + 250, y1))
  line(P(x - 250, y2), P(x + 250, y2))
  const [cx, cy] = P(x, (y1 + y2) / 2)
  text(cx - 30, cy - 3, 9, label)
}
dimH(0, 10000, -1200, '10000')
dimH(0, 6000, 8000, '6000')
dimH(6000, 8000, 8000, '2000')
dimV(0, 7000, -1200, '7000')
dimV(0, 5000, 11200, '5000')

text(P(2300, 3400)[0], P(2300, 3400)[1], 11, 'LIVING')
text(P(7300, 2300)[0], P(7300, 2300)[1], 11, 'ROOM')
text(40, 12, 10, 'SAMPLE FLOOR PLAN   SCALE 1:50 (A4)   unit: mm')

const content = cmds.join('\n')
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
let pdf = '%PDF-1.4\n'
const offsets = []
objs.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
})
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
writeFileSync(new URL('../public/sample.pdf', import.meta.url), pdf)
console.log('public/sample.pdf 생성 완료')
