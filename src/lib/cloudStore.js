// 로그인했을 때 쓰는 서버 저장소 (Supabase).
// - documents 표: 도면 이름·크기, 측정값(state), 마지막으로 연 시각
// - pdfs 보관함: PDF 파일. 경로는 "사용자id/파일이름의 해시.pdf" (자기 폴더만 읽고 쓸 수 있음)
// storage.js 의 localStore 와 같은 모양의 함수를 돌려줍니다.
import { cacheDelete, cacheGet, cachePrune, cachePut } from './storage'

export const BUCKET = 'pdfs'
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // Supabase 무료 플랜의 파일 하나 최대 크기
const MAX_RECENT = 50
const COLS = 'file_key, name, size, storage_path, has_file, state, last_opened'

const toRecord = (row) =>
  row && {
    id: row.file_key,
    name: row.name,
    size: row.size,
    path: row.storage_path,
    hasFile: row.has_file,
    state: row.state,
    lastOpened: Date.parse(row.last_opened),
  }

const check = ({ data, error }) => {
  if (error) throw error
  return data
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function createCloudStore(supabase, user) {
  const uid = user.id
  const table = () => supabase.from('documents')
  const bucket = () => supabase.storage.from(BUCKET)
  // 한글 파일 이름은 보관함 경로에 못 쓰므로 해시로 바꿈
  const pathFor = async (id) => `${uid}/${(await sha256Hex(id)).slice(0, 40)}.pdf`

  // 아직 끝나지 않은 서버 요청 (로그아웃 전에 기다림)
  const inflight = new Set()
  const track = (p) => {
    inflight.add(p)
    const done = () => inflight.delete(p)
    p.then(done, done)
    return p
  }

  async function findRow(id) {
    return toRecord(check(await table().select(COLS).eq('user_id', uid).eq('file_key', id).maybeSingle()))
  }

  async function upload(id, path, file) {
    if (file.size > MAX_UPLOAD_BYTES) {
      const e = new Error('file too large')
      e.code = 'too_large'
      throw e
    }
    check(await bucket().upload(path, file, { contentType: 'application/pdf', upsert: true }))
    check(await table().update({ has_file: true }).eq('user_id', uid).eq('file_key', id))
  }

  async function insertRow(fields) {
    const res = await table().insert({ user_id: uid, ...fields }).select(COLS).single()
    if (res.error?.code === '23505') return findRow(fields.file_key) // 같은 파일을 동시에 두 번 연 경우
    return toRecord(check(res))
  }

  return {
    kind: 'cloud',
    saveDelay: 700,
    user,

    // 파일을 열 때: 서버 목록에 올리고(처음이면 PDF 업로드), 저장된 측정값을 돌려줌.
    // 업로드는 기다리지 않고 upload 로 진행 상황을 넘겨줍니다.
    async rememberFile(id, file) {
      const now = new Date().toISOString()
      let rec = await findRow(id)
      if (rec) {
        rec = toRecord(
          check(await table().update({ last_opened: now }).eq('user_id', uid).eq('file_key', id).select(COLS).single()),
        )
      } else {
        rec = await insertRow({ file_key: id, name: file.name, size: file.size, storage_path: await pathFor(id), last_opened: now })
      }
      cachePut(rec.path, file).catch(() => {})
      return { ...rec, upload: rec.hasFile ? null : track(upload(id, rec.path, file)) }
    },

    async touchFile(id) {
      const rows = check(
        await table().update({ last_opened: new Date().toISOString() }).eq('user_id', uid).eq('file_key', id).select(COLS),
      )
      return toRecord(rows[0]) ?? null
    },

    // 이 기기에 받아 둔 사본이 있으면 그것을, 없으면 서버에서 받음
    async getFile(id) {
      const rec = await findRow(id)
      if (!rec) return null
      const cached = await cacheGet(rec.path).catch(() => null)
      if (cached) return cached
      if (!rec.hasFile) {
        const e = new Error('pdf not uploaded')
        e.code = 'no_file'
        throw e
      }
      const blob = check(await bucket().download(rec.path))
      cachePut(rec.path, blob).catch(() => {})
      return blob
    },

    saveState(id, state) {
      return track(
        table()
          .update({ state, updated_at: new Date().toISOString() })
          .eq('user_id', uid)
          .eq('file_key', id)
          .then(check),
      )
    },

    async listRecent() {
      const rows = check(
        await table().select(COLS).eq('user_id', uid).order('last_opened', { ascending: false }).limit(MAX_RECENT),
      )
      const list = rows.map(toRecord)
      cachePrune(new Set(list.map((r) => r.path))).catch(() => {})
      return list
    },

    async removeFile(id) {
      const rec = await findRow(id)
      if (!rec) return
      check(await bucket().remove([rec.path]))
      check(await table().delete().eq('user_id', uid).eq('file_key', id))
      cacheDelete(rec.path).catch(() => {})
    },

    // 브라우저에만 있던 도면을 서버로 옮기기. 서버에 이미 있으면 서버 쪽 측정값을 그대로 둠.
    async importLocal(doc, blob) {
      let rec = await findRow(doc.id)
      if (!rec) {
        rec = await insertRow({
          file_key: doc.id,
          name: doc.name,
          size: doc.size,
          storage_path: await pathFor(doc.id),
          state: doc.state ?? null,
          last_opened: new Date(doc.lastOpened || Date.now()).toISOString(),
        })
      }
      if (!rec.hasFile && blob) await upload(doc.id, rec.path, blob)
      if (blob) cachePut(rec.path, blob).catch(() => {})
    },

    // 보내는 중인 저장이 모두 끝날 때까지 (끝나자마자 이어 보내는 것까지)
    async whenIdle() {
      while (inflight.size) await Promise.allSettled([...inflight])
    },
  }
}
