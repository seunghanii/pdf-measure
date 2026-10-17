// 도면에 넣는 사진. 사진 자체는 측정값(state)과 따로 저장해서, 자동 저장 때마다 큰 데이터를 다시 보내지 않게 합니다.
// - 브라우저 저장: IndexedDB 'images' (storage.js)
// - 서버 저장: documents 표의 특별한 줄 (cloudStore.js)
// 넣을 때 긴 변 MAX_SIDE px 로 줄이고 JPEG(투명한 부분이 있으면 PNG)로 바꿔 용량을 줄입니다.
import { useContext, createContext, useEffect, useState } from 'react'

const MAX_SIDE = 1800
const MAX_JPEG_BYTES = 900 * 1024
const MAX_PNG_BYTES = 1500 * 1024

export const newImageId = () => `img${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const isImageFile = (f) => f && /^image\//.test(f.type)

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진 변환 실패'))), type, quality))

// 파일(또는 붙여넣은 사진) → { blob, width, height } (줄인 크기, px)
export async function prepareImage(file) {
  const bmp = await createImageBitmap(file) // 휴대폰 사진의 회전 정보도 반영됨
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const width = Math.max(1, Math.round(bmp.width * k))
  const height = Math.max(1, Math.round(bmp.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, width, height)
  bmp.close?.()

  // 투명한 부분이 있는 사진(PNG 등)은 PNG 로, 나머지는 JPEG 로
  let blob = null
  if (file.type !== 'image/jpeg') {
    const data = ctx.getImageData(0, 0, width, height).data
    let alpha = false
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        alpha = true
        break
      }
    }
    if (alpha) {
      const png = await toBlob(canvas, 'image/png')
      if (png.size <= MAX_PNG_BYTES) blob = png
    }
  }
  if (!blob) {
    // JPEG 은 투명이 없으므로 흰 바탕 위에
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    blob = await toBlob(canvas, 'image/jpeg', 0.86)
    if (blob.size > MAX_JPEG_BYTES) blob = await toBlob(canvas, 'image/jpeg', 0.72)
  }
  canvas.width = canvas.height = 0
  return { blob, width, height }
}

// Blob ↔ base64 (서버 저장용)
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export function base64ToBlob(b64, type) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

// ---------- 화면에 보여 줄 주소 (한 번 불러오면 기억) ----------
// imageId → { blob, url } 또는 불러오는 중인 Promise
const cache = new Map()
const listeners = new Map()

export function rememberImage(imageId, blob) {
  cache.set(imageId, { blob, url: URL.createObjectURL(blob) })
  listeners.get(imageId)?.forEach((fn) => fn())
}

// 사진 Blob (없으면 저장소에서 불러옴). 못 찾으면 null
export async function getImageBlob(source, imageId) {
  const hit = cache.get(imageId)
  if (hit instanceof Promise) return (await hit)?.blob ?? null
  if (hit) return hit.blob
  const p = source.store
    .getImage(source.docId, imageId)
    .then((blob) => {
      if (!blob) {
        cache.delete(imageId)
        return null
      }
      const entry = { blob, url: URL.createObjectURL(blob) }
      cache.set(imageId, entry)
      return entry
    })
    .catch((e) => {
      console.warn('사진 불러오기 실패', e)
      cache.delete(imageId)
      return null
    })
  cache.set(imageId, p)
  const entry = await p
  listeners.get(imageId)?.forEach((fn) => fn())
  return entry?.blob ?? null
}

// 사진을 불러올 저장소 { store, docId } (Workspace 가 정해 줌)
export const ImageSource = createContext(null)

// 화면에 그릴 주소. 불러오는 동안은 null
export function useImageUrl(imageId) {
  const source = useContext(ImageSource)
  const read = () => {
    const hit = cache.get(imageId)
    return hit && !(hit instanceof Promise) ? hit.url : null
  }
  const [url, setUrl] = useState(read)
  useEffect(() => {
    const update = () => setUrl(read())
    if (!listeners.has(imageId)) listeners.set(imageId, new Set())
    listeners.get(imageId).add(update)
    if (!cache.has(imageId) && source) getImageBlob(source, imageId)
    update()
    return () => listeners.get(imageId)?.delete(update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, source])
  return url
}
