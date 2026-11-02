// 클립보드·끌어놓기에서 "그림" 꺼내기
// 엑셀 "그림으로 복사"(화면에 표시된 대로 / 그림 형식)는 비트맵이 아니라 벡터 그림으로 복사돼서
// 브라우저에 PNG 대신 PDF(맥), 형식 없는 파일, HTML 안 <img> 등으로 올 수 있습니다.
// 여기서 그런 것들을 모두 모아, 사진 넣기(prepareImage)가 읽을 수 있는 그림 파일로 바꿉니다.

const PDF_SIDE = 2400 // PDF 그림을 사진으로 바꿀 때 긴 변 px

// 파일 앞 몇 바이트로 실제 형식 알아내기 (형식이 비어 오는 경우가 있음)
async function sniff(blob) {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const s = String.fromCharCode(...b)
  if (s.startsWith('%PDF')) return 'application/pdf'
  if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (s.startsWith('GIF8')) return 'image/gif'
  if (s.startsWith('II*\0') || s.startsWith('MM\0*')) return 'image/tiff'
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp'
  if (s.startsWith('BM')) return 'image/bmp'
  if (/^\s*<(\?xml|svg)/i.test(s)) return 'image/svg+xml'
  return blob.type || ''
}

const isPictureType = (t) => !t || /^image\//.test(t) || t === 'application/pdf'

// 붙여넣기 이벤트에서 바로(동기로) 꺼낼 수 있는 그림 후보: 파일 + HTML 안 data: 그림
// (이벤트가 끝나면 clipboardData 를 못 읽으므로 여기서 먼저 꺼내 둠)
export function clipPictureCandidates(cd) {
  const out = []
  const seen = new Set()
  const add = (f) => {
    if (!f || seen.has(f) || !isPictureType(f.type) || !f.size) return
    seen.add(f)
    out.push(f)
  }
  for (const f of cd.files ?? []) add(f)
  for (const it of cd.items ?? []) if (it.kind === 'file') add(it.getAsFile())
  // 같은 그림이 files 와 items 로 두 번 오는 경우가 많음 → 크기·형식이 같으면 하나만
  const uniq = []
  for (const f of out) if (!uniq.some((u) => u.size === f.size && u.type === f.type)) uniq.push(f)
  if (uniq.length) return uniq

  const html = cd.getData?.('text/html') || ''
  if (/<img/i.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    // 글 없이 그림만 있는 HTML 일 때만 (웹 글을 복사한 경우는 기존처럼 글로)
    if (!doc.body.textContent.trim()) {
      for (const img of doc.body.querySelectorAll('img')) {
        const blob = dataUrlBlob(img.getAttribute('src') || '')
        if (blob) uniq.push(blob)
      }
    }
  }
  return uniq
}

// HTML 안 그림 중 data: 가 아닌 주소 (blob:, https:) — 비동기로 받아 봄
export function clipPictureUrls(cd) {
  const html = cd.getData?.('text/html') || ''
  if (!/<img/i.test(html)) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.body.textContent.trim()) return []
  return [...doc.body.querySelectorAll('img')].map((img) => img.getAttribute('src') || '').filter((s) => /^(blob|https?):/i.test(s))
}

function dataUrlBlob(src) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(src)
  if (!m) return null
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return new Blob([bytes], { type: m[1] || '' })
  } catch {
    return null
  }
}

export async function fetchPictures(urls) {
  const out = []
  for (const u of urls) {
    try {
      const r = await fetch(u)
      if (r.ok) out.push(await r.blob())
    } catch {
      /* 다른 사이트 그림은 못 받을 수 있음 */
    }
  }
  return out
}

// 붙여넣기 이벤트에 아무것도 없을 때: 시스템 클립보드를 직접 읽어 봄 (브라우저가 허락을 물을 수 있음)
export async function readClipboardPictures() {
  if (!navigator.clipboard?.read) return { blobs: [], types: [] }
  const blobs = []
  const types = []
  try {
    for (const item of await navigator.clipboard.read()) {
      types.push(...item.types)
      const t = item.types.find((x) => /^image\//.test(x)) || item.types.find((x) => x === 'application/pdf')
      if (t) blobs.push(await item.getType(t))
    }
  } catch {
    /* 허락 안 함 또는 지원 안 함 */
  }
  return { blobs, types }
}

// 그림 후보 → 사진 넣기가 읽을 수 있는 그림 파일 (못 읽으면 오류)
export async function toPictureFile(blob) {
  const type = await sniff(blob)
  if (type === 'application/pdf') return pdfToPng(blob)
  const typed = type && type !== blob.type ? new Blob([blob], { type }) : blob
  if (type === 'image/svg+xml') return svgToPng(typed)
  // 브라우저가 바로 읽을 수 있는지 확인 (크롬은 TIFF 를 못 읽음)
  try {
    const bmp = await createImageBitmap(typed)
    bmp.close?.()
    return asFile(typed, type || 'image/png')
  } catch {
    return imgToPng(typed)
  }
}

const asFile = (blob, type) => (blob instanceof File && blob.type === type ? blob : new File([blob], 'clipboard', { type }))

const canvasPng = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(new File([b], 'clipboard.png', { type: 'image/png' })) : reject(new Error('그림 변환 실패'))), 'image/png'),
  )

// <img> 로 읽어 보기 (사파리는 TIFF·PDF 도 <img> 로 그릴 수 있음)
function imgToPng(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || 1200
      const h = img.naturalHeight || 900
      const k = Math.max(1, Math.min(3, PDF_SIDE / Math.max(w, h))) // 벡터 그림은 크게 그려 선명하게
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * k)
      canvas.height = Math.round(h * k)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvasPng(canvas).then(resolve, reject)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('그림 형식을 읽지 못함'))
    }
    img.src = url
  })
}

const svgToPng = imgToPng

// PDF 그림(맥 엑셀 "그림으로 복사") → 첫 쪽을 PNG 로, 흰 바탕
async function pdfToPng(blob) {
  const { loadPdf } = await import('./pdf')
  const pdf = await loadPdf(new Uint8Array(await blob.arrayBuffer()))
  try {
    const page = await pdf.getPage(1)
    const vp1 = page.getViewport({ scale: 1 })
    const scale = Math.min(6, PDF_SIDE / Math.max(vp1.width, vp1.height))
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(vp.width))
    canvas.height = Math.max(1, Math.round(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    return canvasPng(canvas)
  } finally {
    pdf.destroy?.()
  }
}
