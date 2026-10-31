// 로그인했을 때 쓰는 서버 저장소 (Supabase).
// - documents 표: 도면 이름·크기, 측정값(state), 마지막으로 연 시각
// - pdfs 보관함: PDF 파일. 경로는 "사용자id/파일이름의 해시.pdf" (자기 폴더만 읽고 쓸 수 있음)
// storage.js 의 localStore 와 같은 모양의 함수를 돌려줍니다.
// 폴더 정보는 documents 표의 특별한 한 줄(file_key = LIBRARY_KEY)의 state 에 보관 (표를 새로 만들지 않으려고)
// 검색용 글자 색인도 도면마다 특별한 한 줄(file_key = "@text|" + 도면 id, size 0)에 보관.
// 도면에 넣은 사진은 pdfs 보관함의 "사용자id/img/사진 id" 에 파일로 두고, 사진마다 특별한 한 줄
// (file_key = "@img|" + 사진 id, name = 도면 id, state = { type, path })로 어느 도면 사진인지 기록.
// 보관함이 아직 사진을 받지 않게 설정돼 있으면(설정 SQL 을 다시 실행하기 전) 예전처럼 state 에 base64 로 넣고,
// 예전에 base64 로 넣은 사진은 열 때 보관함으로 옮겨 DB 공간을 비웁니다.
// 특별한 줄은 모두 size 가 0 이라 실제 도면(size > 0)과 구분됩니다.
import { cacheDelete, cacheGet, cachePrune, cachePut, summarize, SUMMARY_VERSION } from './storage'
import { normalizeLibrary } from './library'
import { base64ToBlob, blobToBase64 } from './images'

export const BUCKET = 'pdfs'
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // Supabase 무료 플랜의 파일 하나 최대 크기
const MAX_RECENT = 200
const LIBRARY_KEY = '__library__'
const TEXT_PREFIX = '@text|'
const IMAGE_PREFIX = '@img|'
const COLS = 'file_key, name, size, storage_path, has_file, state, last_opened'
// 홈 목록에는 측정값 전체 대신 요약(개수·축척)만 받음
const LIST_COLS = 'file_key, name, size, storage_path, has_file, last_opened, summary:state->summary'

const toRecord = (row) =>
  row && {
    id: row.file_key,
    name: row.name,
    size: row.size,
    path: row.storage_path,
    hasFile: row.has_file,
    state: row.state,
    summary: row.summary ?? (row.state !== undefined ? summarize(row.state) : undefined),
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

  async function findRow(id, cols = COLS) {
    return toRecord(check(await table().select(cols).eq('user_id', uid).eq('file_key', id).maybeSingle()))
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

  // 특별한 줄(사진·검색 색인·폴더 정보) 저장
  const upsertSpecial = (fileKey, name, state) =>
    table()
      .upsert(
        {
          user_id: uid,
          file_key: fileKey,
          name,
          size: 0,
          storage_path: '',
          state,
          last_opened: new Date(0).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,file_key' },
      )
      .then(check)

  const imagePath = (imageId) => `${uid}/img/${imageId}`

  // 사진 파일을 보관함에 올림. 보관함이 사진을 받지 않으면 false (이번 창에서는 다시 시도하지 않음)
  let bucketTakesImages = true
  async function uploadImage(imageId, blob) {
    if (!bucketTakesImages) return false
    const { error } = await bucket().upload(imagePath(imageId), blob, { contentType: blob.type || 'image/jpeg', upsert: true })
    if (!error) return true
    bucketTakesImages = false
    console.warn('사진을 보관함에 올리지 못해 DB 에 저장합니다', error)
    return false
  }

  async function putImage(docId, imageId, blob) {
    const state = (await uploadImage(imageId, blob))
      ? { type: blob.type, path: imagePath(imageId) }
      : { type: blob.type, data: await blobToBase64(blob) }
    await upsertSpecial(IMAGE_PREFIX + imageId, docId, state)
  }

  // 예전에 DB 에 base64 로 넣은 사진을 보관함으로 옮김 (실패해도 그대로 둠)
  async function moveImageToBucket(docId, imageId, blob) {
    if (!(await uploadImage(imageId, blob))) return
    await upsertSpecial(IMAGE_PREFIX + imageId, docId, { type: blob.type, path: imagePath(imageId) })
  }

  async function removeImageFiles(fileKeys) {
    const paths = fileKeys.map((k) => imagePath(k.slice(IMAGE_PREFIX.length)))
    if (paths.length) await bucket().remove(paths) // 보관함에 없는 사진(예전 방식)은 그냥 넘어감
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
      const rec = await findRow(id, 'file_key, storage_path, has_file')
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
          .update({ state: { ...state, summary: summarize(state) }, updated_at: new Date().toISOString() })
          .eq('user_id', uid)
          .eq('file_key', id)
          .then(check),
      )
    },

    async listRecent() {
      const rows = check(
        await table()
          .select(LIST_COLS)
          .eq('user_id', uid)
          .neq('file_key', LIBRARY_KEY)
          .gt('size', 0)
          .order('last_opened', { ascending: false })
          .limit(MAX_RECENT),
      )
      // 요약이 없거나 예전 모양(검색용 글 notes 없음, 판 v 가 낮음)인 도면만 측정값 전체를 받아 요약하고,
      // 요약을 서버에 한 번 고쳐 써 둠 (다음부터는 요약만 받음). 그사이 다른 저장이 있었으면 쓰지 않음
      const isOld = (r) => !Array.isArray(r.summary?.notes) || (r.summary?.v ?? 1) < SUMMARY_VERSION
      const old = rows.filter(isOld).map((r) => r.file_key)
      if (old.length) {
        const full = check(await table().select('file_key, state, updated_at').eq('user_id', uid).in('file_key', old))
        const byKey = new Map(full.map((r) => [r.file_key, r]))
        for (const r of rows) {
          if (!isOld(r) || !byKey.has(r.file_key)) continue
          const { state, updated_at } = byKey.get(r.file_key)
          r.summary = summarize(state)
          if (state)
            table()
              .update({ state: { ...state, summary: r.summary } })
              .eq('user_id', uid)
              .eq('file_key', r.file_key)
              .eq('updated_at', updated_at)
              .then(check)
              .catch((e) => console.warn(e))
        }
      }
      const list = rows.map(toRecord)
      cachePrune(new Set(list.map((r) => r.path))).catch(() => {})
      return list
    },

    renameFile(id, name) {
      return track(table().update({ name }).eq('user_id', uid).eq('file_key', id).then(check))
    },

    async getTextIndex(id) {
      const row = check(
        await table().select('state').eq('user_id', uid).eq('file_key', TEXT_PREFIX + id).maybeSingle(),
      )
      return row?.state ?? null
    },

    saveTextIndex(id, index) {
      return track(upsertSpecial(TEXT_PREFIX + id, '검색 색인', index))
    },

    // skip: 이미 받아 둔 색인의 도면 id (그 색인은 다시 받지 않고 index 를 비워서 돌려줌)
    async listTextIndexes(skip = new Set()) {
      const keys = check(
        await table().select('file_key').eq('user_id', uid).eq('size', 0).like('file_key', `${TEXT_PREFIX}%`),
      ).map((r) => r.file_key)
      const ids = keys.map((k) => k.slice(TEXT_PREFIX.length))
      const missing = keys.filter((k, i) => !skip.has(ids[i]))
      const fetched = new Map()
      for (let i = 0; i < missing.length; i += 50) {
        const rows = check(await table().select('file_key, state').eq('user_id', uid).in('file_key', missing.slice(i, i + 50)))
        for (const r of rows) fetched.set(r.file_key, r.state)
      }
      return keys.map((k, i) => ({ id: ids[i], index: skip.has(ids[i]) ? undefined : fetched.get(k) }))
    },

    saveImage(docId, imageId, blob) {
      return track(putImage(docId, imageId, blob))
    },

    async getImage(docId, imageId) {
      const row = check(
        await table().select('name, state').eq('user_id', uid).eq('file_key', IMAGE_PREFIX + imageId).maybeSingle(),
      )
      const st = row?.state
      if (st?.path) return check(await bucket().download(st.path))
      if (!st?.data) return null
      const blob = base64ToBlob(st.data, st.type || 'image/jpeg')
      track(moveImageToBucket(row.name, imageId, blob).catch((e) => console.warn('사진 옮기기 실패', e)))
      return blob
    },

    async listImageIds(docId) {
      const rows = check(
        await table().select('file_key').eq('user_id', uid).eq('size', 0).eq('name', docId).like('file_key', `${IMAGE_PREFIX}%`),
      )
      return rows.map((r) => r.file_key.slice(IMAGE_PREFIX.length))
    },

    removeImages(docId, ids) {
      if (!ids.length) return Promise.resolve()
      const keys = ids.map((id) => IMAGE_PREFIX + id)
      return track(
        (async () => {
          check(await table().delete().eq('user_id', uid).in('file_key', keys))
          await removeImageFiles(keys)
        })(),
      )
    },

    async getLibrary() {
      const row = check(await table().select('state').eq('user_id', uid).eq('file_key', LIBRARY_KEY).maybeSingle())
      return normalizeLibrary(row?.state)
    },

    saveLibrary(lib) {
      return track(upsertSpecial(LIBRARY_KEY, '폴더 정보', lib))
    },

    async removeFile(id) {
      const rec = await findRow(id)
      if (!rec) return
      check(await bucket().remove([rec.path]))
      check(await table().delete().eq('user_id', uid).in('file_key', [id, TEXT_PREFIX + id]))
      const images = check(await table().delete().eq('user_id', uid).eq('size', 0).eq('name', id).like('file_key', `${IMAGE_PREFIX}%`).select('file_key'))
      await removeImageFiles(images.map((r) => r.file_key))
      cacheDelete(rec.path).catch(() => {})
    },

    // 브라우저에만 있던 도면을 서버로 옮기기. 서버에 이미 있으면 서버 쪽 측정값을 그대로 둠.
    // images: 그 도면에 넣은 사진 [{ id, blob }]
    async importLocal(doc, blob, images = []) {
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
      for (const img of images) await putImage(doc.id, img.id, img.blob)
      if (!rec.hasFile && blob) await upload(doc.id, rec.path, blob)
      if (blob) cachePut(rec.path, blob).catch(() => {})
    },

    // 보내는 중인 저장이 모두 끝날 때까지 (끝나자마자 이어 보내는 것까지)
    async whenIdle() {
      while (inflight.size) await Promise.allSettled([...inflight])
    },
  }
}
