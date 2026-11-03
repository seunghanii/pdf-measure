// 로그인했을 때 쓰는 서버 저장소 (Supabase).
// - documents 표: 도면 이름·크기, 측정값(state), 마지막으로 연 시각
// - pdfs 보관함: PDF 파일. 경로는 "사용자id/파일이름의 해시.pdf" (자기 폴더만 읽고 쓸 수 있음)
// storage.js 의 localStore 와 같은 모양의 함수를 돌려줍니다.
// 폴더 정보는 documents 표의 특별한 한 줄(file_key = LIBRARY_KEY)의 state 에 보관 (표를 새로 만들지 않으려고)
// 검색용 글자 색인도 도면마다 특별한 한 줄(file_key = "@text|" + 도면 id, size 0)에 보관.
// 도면에 넣은 사진은 pdfs 보관함의 "사용자id/img/사진 id" 에 파일로 두고, 사진마다 특별한 한 줄
// (file_key = "@img|" + 사진 id, name = 도면 id, state = { type, path })로 어느 도면 사진인지 기록.
// 메모에 첨부한 엑셀도 같은 방식("사용자id/img/파일 id").
// 보관함이 아직 그 종류를 받지 않게 설정돼 있으면(설정 SQL 을 다시 실행하기 전) 예전처럼 state 에 base64 로 넣고,
// 예전에 base64 로 넣은 사진·엑셀은 열 때 보관함으로 옮겨 DB 공간을 비웁니다.
// 개정판으로 바꾼 도면의 예전 판 PDF 는 "사용자id/rev/파일이름의 해시/판 key.pdf" (lib/revision.js).
// 홈 메모장 글도 특별한 한 줄(file_key = NOTE_KEY)의 state 에 { text, at } 로 보관. 달력 일정은 CAL_KEY 줄에 { events, at }.
// 특별한 줄은 모두 size 가 0 이라 실제 도면(size > 0)과 구분됩니다.
import { cacheDelete, cacheGet, cachePrune, cachePut, summarize, SUMMARY_VERSION } from './storage'
import { normalizeLibrary } from './library'
import { loadLocalNote, newerNote, normalizeNote, saveLocalNote } from './homeNote'
import { loadLocalCal, newerCal, normalizeCal, saveLocalCal } from './calEvents'
import { loadLocalInstList, newerInstList, normalizeInstList, saveLocalInstList } from './instList'
import { base64ToBlob, blobToBase64 } from './images'

export const BUCKET = 'pdfs'
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // Supabase 무료 플랜의 파일 하나 최대 크기
const MAX_RECENT = 200
const LIBRARY_KEY = '__library__'
const NOTE_KEY = '__home_note__' // 홈 메모장 (lib/homeNote.js)
const CAL_KEY = '__calendar__' // 달력 일정 (lib/calEvents.js)
const INST_LIST_KEY = '__inst_list__' // Inst list: 올린 계기 목록 (lib/instList.js)
const TEXT_PREFIX = '@text|'
const IMAGE_PREFIX = '@img|'
const COLS = 'file_key, name, size, storage_path, has_file, state, last_opened, updated_at'
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
    updatedAt: row.updated_at ?? null, // 마지막 저장 시각 (여러 기기에서 고칠 때 덮어쓰기 막기)
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
  const revDir = async (id) => `${uid}/rev/${(await sha256Hex(id)).slice(0, 40)}`
  const revPath = async (id, key) => `${await revDir(id)}/${key}.pdf`

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

  // 사진·첨부 파일(엑셀)을 보관함에 올림. 보관함이 그 종류를 받지 않으면 false
  // (이번 창에서는 그 종류만 다시 시도하지 않음. 엑셀이 막혀도 사진은 계속 보관함에)
  const bucketTakes = { image: true, file: true }
  const kindOf = (blob) => (/^image\//.test(blob.type) ? 'image' : 'file')
  async function uploadImage(imageId, blob) {
    const kind = kindOf(blob)
    if (!bucketTakes[kind]) return false
    const { error } = await bucket().upload(imagePath(imageId), blob, {
      contentType: blob.type || 'application/octet-stream',
      upsert: true,
    })
    if (!error) return true
    bucketTakes[kind] = false
    console.warn('파일을 보관함에 올리지 못해 DB 에 저장합니다', error)
    return false
  }

  async function putImage(docId, imageId, blob) {
    const state = (await uploadImage(imageId, blob))
      ? { type: blob.type, path: imagePath(imageId) }
      : { type: blob.type, data: await blobToBase64(blob) }
    await upsertSpecial(IMAGE_PREFIX + imageId, docId, state)
  }

  // 예전에 DB 에 base64 로 넣은 사진·엑셀을 보관함으로 옮김 (실패해도 그대로 둠)
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

  // 도면 목록은 잠깐 기억해 두고 홈·계기 목록(모든 도면)·관련 도면 연결 창이 같이 씀.
  // 이 창에서 저장·이름 바꾸기를 하면 기억한 목록도 바로 고치고, 파일을 열거나 지우면 다음에 새로 받음.
  // 다른 기기에서 바꾼 것은 RECENT_TTL 이 지나면 반영
  const RECENT_TTL = 60_000
  let recent = null // { at, promise }
  const forgetRecent = () => {
    recent = null
  }
  const patchRecent = (fn) => {
    if (recent) recent.promise = recent.promise.then(fn)
  }

  async function fetchRecent() {
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
  }

  let libChain = Promise.resolve() // 폴더 정보 바꾸기 차례

  return {
    kind: 'cloud',
    saveDelay: 1500, // 서버 저장은 연달아 고치는 동안 모아서 한 번에 (창을 닫을 때는 바로 저장)
    user,

    // 파일을 열 때: 서버 목록에 올리고(처음이면 PDF 업로드), 저장된 측정값을 돌려줌.
    // 업로드는 기다리지 않고 upload 로 진행 상황을 넘겨줍니다.
    async rememberFile(id, file) {
      forgetRecent()
      const now = new Date().toISOString()
      let rec = await findRow(id)
      if (rec) {
        rec = toRecord(
          check(await table().update({ last_opened: now }).eq('user_id', uid).eq('file_key', id).select(COLS).single()),
        )
      } else {
        rec = await insertRow({ file_key: id, name: file.name, size: file.size, storage_path: await pathFor(id), last_opened: now })
      }
      forgetRecent() // 그사이 받은 목록이 있었으면 순서가 옛것이라 버림
      cachePut(rec.path, file).catch(() => {})
      return { ...rec, upload: rec.hasFile ? null : track(upload(id, rec.path, file)) }
    },

    async touchFile(id) {
      forgetRecent()
      const rows = check(
        await table().update({ last_opened: new Date().toISOString() }).eq('user_id', uid).eq('file_key', id).select(COLS),
      )
      forgetRecent()
      return toRecord(rows[0]) ?? null
    },

    // 이 기기에 받아 둔 사본이 있으면 그것을, 없으면 서버에서 받음
    async getFile(id) {
      const rec = await findRow(id, 'file_key, storage_path, has_file, size')
      if (!rec) return null
      const cached = await cacheGet(rec.path).catch(() => null)
      // 다른 기기에서 개정판으로 바꿨으면 받아 둔 사본은 예전 판 (크기로 알아봄)
      if (cached && (!rec.size || cached.size === rec.size)) return cached
      if (!rec.hasFile) {
        const e = new Error('pdf not uploaded')
        e.code = 'no_file'
        throw e
      }
      const blob = check(await bucket().download(rec.path))
      cachePut(rec.path, blob).catch(() => {})
      return blob
    },

    // expect: 이 창이 마지막으로 본 저장 시각 (updatedAt). 주면 서버가 그대로일 때만 저장하고,
    // 그사이 다른 기기(창)가 저장했으면 code 'conflict' 오류 → 받는 쪽이 합쳐서 다시 저장 (lib/autosave.js)
    // 돌려주는 값: 새 저장 시각
    saveState(id, state, { expect } = {}) {
      const summary = summarize(state)
      const at = new Date().toISOString()
      return track(
        (async () => {
          let q = table().update({ state: { ...state, summary }, updated_at: at }).eq('user_id', uid).eq('file_key', id)
          if (expect !== undefined) q = expect === null ? q.is('updated_at', null) : q.eq('updated_at', expect)
          const rows = check(await q.select('file_key'))
          if (expect !== undefined && !rows.length) {
            const e = new Error('state changed elsewhere')
            e.code = 'conflict'
            throw e
          }
          patchRecent((list) => list.map((r) => (r.id === id ? { ...r, summary } : r)))
          return at
        })(),
      )
    },

    // 서버에 저장된 도면 상태 { state, updatedAt, size } (다른 기기에서 고쳤는지 볼 때)
    async getState(id) {
      const row = check(await table().select('state, updated_at, size').eq('user_id', uid).eq('file_key', id).maybeSingle())
      return row && { state: row.state, updatedAt: row.updated_at ?? null, size: row.size }
    },
    async peekState(id) {
      const row = check(await table().select('updated_at, size').eq('user_id', uid).eq('file_key', id).maybeSingle())
      return row && { updatedAt: row.updated_at ?? null, size: row.size }
    },

    // 돌려주는 배열은 매번 새로 (받는 쪽이 정렬해도 기억한 목록은 그대로)
    async listRecent() {
      if (!recent || Date.now() - recent.at > RECENT_TTL) {
        const entry = { at: Date.now(), promise: fetchRecent() }
        entry.promise.catch(() => {
          if (recent === entry) recent = null
        })
        recent = entry
      }
      return [...(await recent.promise)]
    },

    renameFile(id, name) {
      patchRecent((list) => list.map((r) => (r.id === id ? { ...r, name } : r)))
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

    // 폴더 정보 바꾸기: 서버의 지금 폴더 정보를 받아 change 를 적용하고, 그사이 다른 기기가 저장했으면 다시 받아 적용.
    // (오래 켜 둔 창이 다른 기기에서 바꾼 폴더·별명을 덮어쓰지 않게) 바꾼 결과를 돌려줌. 한 번에 하나씩 차례로
    updateLibrary(change) {
      const run = async () => {
        for (let i = 0; i < 4; i++) {
          const row = check(await table().select('state, updated_at').eq('user_id', uid).eq('file_key', LIBRARY_KEY).maybeSingle())
          const lib = change(normalizeLibrary(row?.state))
          if (!row) {
            await upsertSpecial(LIBRARY_KEY, '폴더 정보', lib)
            return lib
          }
          const rows = check(
            await table()
              .update({ state: lib, updated_at: new Date().toISOString() })
              .eq('user_id', uid)
              .eq('file_key', LIBRARY_KEY)
              .eq('updated_at', row.updated_at)
              .select('file_key'),
          )
          if (rows.length) return lib
        }
        throw new Error('폴더 정보가 계속 바뀌어 저장하지 못함')
      }
      const p = libChain.then(run, run)
      libChain = p.catch(() => {})
      return track(p)
    },

    // 홈 메모장: 서버 글과 이 브라우저 사본 중 나중에 고친 것 (사본이 더 새로우면 = 못 올린 글, 다시 올림)
    async getHomeNote() {
      const local = loadLocalNote(uid)
      const row = check(await table().select('state').eq('user_id', uid).eq('file_key', NOTE_KEY).maybeSingle())
      const server = normalizeNote(row?.state)
      const note = newerNote(server, local)
      if (note !== server && note.at) track(upsertSpecial(NOTE_KEY, '홈 메모장', note)).catch((e) => console.warn('메모장 다시 올리기 실패', e))
      else saveLocalNote(server, uid)
      return note
    },

    saveHomeNote(note) {
      saveLocalNote(note, uid)
      return track(upsertSpecial(NOTE_KEY, '홈 메모장', note))
    },

    // 달력 일정: 메모장과 같은 방식 (서버와 이 브라우저 사본 중 나중에 고친 것)
    async getCalendar() {
      const local = loadLocalCal(uid)
      const row = check(await table().select('state').eq('user_id', uid).eq('file_key', CAL_KEY).maybeSingle())
      const server = normalizeCal(row?.state)
      const cal = newerCal(server, local)
      if (cal !== server && cal.at) track(upsertSpecial(CAL_KEY, '달력 일정', cal)).catch((e) => console.warn('일정 다시 올리기 실패', e))
      else saveLocalCal(server, uid)
      return cal
    },

    saveCalendar(cal) {
      saveLocalCal(cal, uid)
      return track(upsertSpecial(CAL_KEY, '달력 일정', cal))
    },

    // Inst list: 달력과 같은 방식 (서버와 이 브라우저 사본 중 나중에 올린 것)
    async getInstList() {
      const local = loadLocalInstList(uid)
      const row = check(await table().select('state').eq('user_id', uid).eq('file_key', INST_LIST_KEY).maybeSingle())
      const server = normalizeInstList(row?.state)
      const list = newerInstList(server, local)
      if (list !== server && list.at) track(upsertSpecial(INST_LIST_KEY, 'Inst list', list)).catch((e) => console.warn('Inst list 다시 올리기 실패', e))
      else saveLocalInstList(server, uid)
      return list
    },

    saveInstList(list) {
      saveLocalInstList(list, uid)
      return track(upsertSpecial(INST_LIST_KEY, 'Inst list', list))
    },

    // 개정판으로 바꾸기: 같은 자리(경로)에 새 PDF 를 덮어 올림. keepKey 가 있으면 지금 PDF 를 예전 판 자리에 복사해 둠.
    // 돌려주는 값 { kept }: 예전 판 PDF 를 보관했는지 (서버에 없고 이 기기에도 사본이 없으면 못 함)
    async replaceFile(id, file, { keepKey } = {}) {
      if (file.size > MAX_UPLOAD_BYTES) {
        const e = new Error('file too large')
        e.code = 'too_large'
        throw e
      }
      forgetRecent()
      const rec = await findRow(id, 'file_key, storage_path, has_file')
      if (!rec) throw new Error('missing doc')
      let kept = false
      if (keepKey) {
        const dest = await revPath(id, keepKey)
        if (rec.hasFile) {
          const { error } = await bucket().copy(rec.path, dest)
          if (error) console.warn('예전 판 복사 실패', error)
          else kept = true
        }
        if (!kept) {
          const old = await cacheGet(rec.path).catch(() => null)
          if (old) {
            const { error } = await bucket().upload(dest, old, { contentType: 'application/pdf', upsert: true })
            if (error) console.warn('예전 판 보관 실패', error)
            else kept = true
          }
        }
      }
      await track(
        (async () => {
          check(await bucket().upload(rec.path, file, { contentType: 'application/pdf', upsert: true }))
          check(await table().update({ has_file: true, name: file.name, size: file.size }).eq('user_id', uid).eq('file_key', id))
        })(),
      )
      await cachePut(rec.path, file).catch(() => {})
      forgetRecent()
      return { kept }
    },

    async getRevisionFile(id, key) {
      const path = await revPath(id, key)
      const cached = await cacheGet(path).catch(() => null)
      if (cached) return cached
      const blob = check(await bucket().download(path))
      cachePut(path, blob).catch(() => {})
      return blob
    },

    async removeRevisionFile(id, key) {
      const path = await revPath(id, key)
      await track(bucket().remove([path]).then(check))
      cacheDelete(path).catch(() => {})
    },

    async removeFile(id) {
      forgetRecent()
      const rec = await findRow(id)
      if (!rec) return
      check(await bucket().remove([rec.path]))
      // 예전 판 PDF 들
      const dir = await revDir(id)
      const revs = (await bucket().list(dir, { limit: 1000 })).data ?? []
      if (revs.length) await bucket().remove(revs.map((f) => `${dir}/${f.name}`))
      check(await table().delete().eq('user_id', uid).in('file_key', [id, TEXT_PREFIX + id]))
      const images = check(await table().delete().eq('user_id', uid).eq('size', 0).eq('name', id).like('file_key', `${IMAGE_PREFIX}%`).select('file_key'))
      await removeImageFiles(images.map((r) => r.file_key))
      cacheDelete(rec.path).catch(() => {})
    },

    // 브라우저에만 있던 도면을 서버로 옮기기. 서버에 이미 있으면 서버 쪽 측정값을 그대로 둠.
    // images: 그 도면에 넣은 사진 [{ id, blob }]
    // revs: 예전 판 PDF [{ key, blob }]
    async importLocal(doc, blob, images = [], revs = []) {
      forgetRecent()
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
      for (const r of revs)
        check(await bucket().upload(await revPath(doc.id, r.key), r.blob, { contentType: 'application/pdf', upsert: true }))
      if (!rec.hasFile && blob) await upload(doc.id, rec.path, blob)
      if (blob) cachePut(rec.path, blob).catch(() => {})
    },

    // 보내는 중인 저장이 모두 끝날 때까지 (끝나자마자 이어 보내는 것까지)
    async whenIdle() {
      while (inflight.size) await Promise.allSettled([...inflight])
    },
  }
}
