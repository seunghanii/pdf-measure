import { renderToStaticMarkup } from 'react-dom/server'
import { PDFDocument, clip, concatTransformationMatrix, drawObject, endPath, popGraphicsState, pushGraphicsState, rectangle } from 'pdf-lib'
import MeasurementShape from '../components/MeasurementShape'
import { FONT_FAMILY, cropOf, fullImageRect, rectOf } from './markup'

const MAX_PIXELS = 16_000_000

// 원본 PDF 위에 마크업과 측정(화면에 보이는 것만)을 그려 넣은 새 PDF 를 만듭니다.
// 각 페이지의 그림은 투명 PNG 한 장으로 얹기 때문에 원본 도면은 벡터 그대로 유지되고 한글도 깨지지 않습니다.
// 사진은 원래 화질 그대로 따로 넣고(잘라 낸 부분 밖은 가림), 테두리와 다른 마크업은 그 위 PNG 에 그립니다.
// getImage: (imageId) => Promise<Blob | null>
export async function exportPdfWithMarkups({ pdfDoc, items, calibration, mmPerPt, unit, getImage }) {
  const original = await pdfDoc.getData()
  const out = await PDFDocument.load(original, { ignoreEncryption: true })
  const pages = out.getPages()
  const embedded = new Map() // imageId → 넣어 둔 사진 (같은 사진은 한 번만)
  const embedImage = async (imageId) => {
    if (!embedded.has(imageId)) {
      const blob = getImage ? await getImage(imageId) : null
      let img = null
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        img = blob.type === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes)
      }
      embedded.set(imageId, img)
    }
    return embedded.get(imageId)
  }

  for (let i = 0; i < pdfDoc.numPages; i++) {
    const pageNo = i + 1
    const pageItems = items.filter((m) => m.page === pageNo && !m.hidden)
    const cal = calibration?.mode === 'line' && !calibration.hidden && calibration.page === pageNo ? calibration : null
    if (!pageItems.length && !cal) continue

    const srcPage = await pdfDoc.getPage(pageNo)
    const viewport = srcPage.getViewport({ scale: 1 })
    const { width: W, height: H } = viewport
    const scale = Math.min(4, Math.sqrt(MAX_PIXELS / (W * H)))

    // 화면(뷰포트) 기준 모서리를 PDF 좌표로 바꿔서 회전·여백이 있는 페이지도 정확히 겹치게 함
    const [blx, bly] = viewport.convertToPdfPoint(0, H)
    const [brx, bry] = viewport.convertToPdfPoint(W, H)
    const [tlx, tly] = viewport.convertToPdfPoint(0, 0)
    const page = pages[i]
    page.node.normalize()
    // 0~1 단위 사각형 → 페이지 위 화면 영역
    const toPage = concatTransformationMatrix(brx - blx, bry - bly, tlx - blx, tly - bly, blx, bly)

    // 사진: 화면 좌표(pt, 아래로 갈수록 y 증가)로 바꾼 뒤, 보이는 부분만 남기고 원본 자리에 그림
    for (const m of pageItems) {
      if (m.type !== 'image') continue
      const img = await embedImage(m.imageId)
      if (!img) continue
      const r = rectOf(m.points[0], m.points[1] ?? m.points[0])
      const f = fullImageRect(r, cropOf(m))
      const name = page.node.newXObject('MeasurePhoto', img.ref)
      page.pushOperators(
        pushGraphicsState(),
        toPage,
        concatTransformationMatrix(1 / W, 0, 0, -1 / H, 0, 1),
        rectangle(r.x, r.y, r.w, r.h),
        clip(),
        endPath(),
        concatTransformationMatrix(f.w, 0, 0, -f.h, f.x, f.y + f.h),
        drawObject(name),
        popGraphicsState(),
      )
    }

    const markup = renderToStaticMarkup(
      <svg xmlns="http://www.w3.org/2000/svg" width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT_FAMILY}>
        {cal && (
          <MeasurementShape m={{ id: 'calibration', type: 'calibrate', points: cal.points, label: cal.label }} zoom={1} />
        )}
        {pageItems.map((m) => (
          <MeasurementShape key={m.id} m={m} zoom={1} mmPerPt={mmPerPt} unit={unit} exporting />
        ))}
      </svg>,
    )
    const png = await svgToPng(markup, Math.round(W * scale), Math.round(H * scale))
    const image = await out.embedPng(png)
    const name = page.node.newXObject('MeasureOverlay', image.ref)
    page.pushOperators(
      pushGraphicsState(),
      toPage,
      drawObject(name),
      popGraphicsState(),
    )
  }

  return out.save()
}

function svgToPng(svgText, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('이미지 변환 실패'))
        resolve(new Uint8Array(await blob.arrayBuffer()))
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 변환 실패'))
    }
    img.src = url
  })
}

// 브라우저 기본 다운로드 (보통 "다운로드" 폴더에 저장됨)
export function downloadBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
