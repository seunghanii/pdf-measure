-- PDF 도면 측정기: Supabase 서버 설정
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 내용을 통째로 붙여넣고 Run 을 누르세요.
-- 여러 번 실행해도 괜찮습니다 (이미 있는 것은 그대로 두고 규칙만 다시 만듭니다).

-- 1) 도면 목록과 측정값 -------------------------------------------------------
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_key     text not null,                 -- "파일이름|크기" (같은 파일이면 같은 도면)
  name         text not null,
  size         bigint not null,
  storage_path text not null,                 -- pdfs 보관함 안의 PDF 경로
  has_file     boolean not null default false,-- PDF 업로드가 끝났는지
  state        jsonb,                         -- 측정값, 마크업, 축척, 단위 등
  last_opened  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, file_key)
);

create index if not exists documents_user_recent on public.documents (user_id, last_opened desc);

-- 로그인한 사람은 자기 도면만 보고 고칠 수 있음
alter table public.documents enable row level security;

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_insert_own" on public.documents;
drop policy if exists "documents_update_own" on public.documents;
drop policy if exists "documents_delete_own" on public.documents;

create policy "documents_select_own" on public.documents
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "documents_insert_own" on public.documents
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "documents_update_own" on public.documents
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "documents_delete_own" on public.documents
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.documents to authenticated;

-- 2) PDF·사진 파일 보관함 (비공개, 파일 하나 50MB 까지) -------------------------
-- 사진은 "사용자id/img/사진id" 에 둡니다 (도면에 넣은 사진, 메모 사진)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12']) -- 브라우저는 파일 형식을 소문자로 보냄
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 각자 "사용자id/" 폴더 안의 파일만 올리고, 받고, 덮어쓰고, 지울 수 있음
drop policy if exists "pdfs_select_own" on storage.objects;
drop policy if exists "pdfs_insert_own" on storage.objects;
drop policy if exists "pdfs_update_own" on storage.objects;
drop policy if exists "pdfs_delete_own" on storage.objects;

create policy "pdfs_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "pdfs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "pdfs_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "pdfs_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- 3) 자동 저장: 바뀐 곳만 고치기 ------------------------------------------------
-- 큰 도면은 상태(state)가 1MB 를 넘어서, 박스 하나만 옮겨도 통째로 올리면 느림.
-- 앱이 "고칠 곳 목록"만 보내면(src/lib/statePatch.js) 서버가 저장된 상태에 그대로 적용함.
-- 이 함수들이 없어도 앱은 예전처럼 통째로 저장함.

-- 고칠 곳 목록을 차례로 적용. ops: [{ "o": "s"|"d"|"i", "p": ["키", "번호", ...], "v": 값 }]
create or replace function public.jsonb_apply_ops(s jsonb, ops jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  op jsonb;
  path text[];
begin
  for op in select value from jsonb_array_elements(ops) loop
    path := array(select jsonb_array_elements_text(op -> 'p'));
    if op ->> 'o' = 's' then
      s := jsonb_set(s, path, coalesce(op -> 'v', 'null'::jsonb), true);
    elsif op ->> 'o' = 'd' then
      s := s #- path;
    elsif op ->> 'o' = 'i' then
      s := jsonb_insert(s, path, coalesce(op -> 'v', 'null'::jsonb), false);
    else
      raise exception 'unknown op %', op ->> 'o';
    end if;
  end loop;
  return s;
end;
$$;

-- 내 도면 하나의 상태를 고침. 서버의 저장 시각이 p_expect 와 같을 때만(다른 기기가 그사이 저장하지 않았을 때만) 고치고
-- 새 저장 시각을 돌려줌. 다르면 아무것도 하지 않고 null (앱이 서버 것을 받아 합친 뒤 다시 저장).
create or replace function public.patch_document_state(p_file_key text, p_expect timestamptz, p_at timestamptz, p_ops jsonb)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur jsonb;
begin
  select state into cur from public.documents
    where user_id = (select auth.uid()) and file_key = p_file_key and updated_at = p_expect
    for update;
  if not found or cur is null then
    return null;
  end if;
  update public.documents
    set state = public.jsonb_apply_ops(cur, p_ops), updated_at = p_at
    where user_id = (select auth.uid()) and file_key = p_file_key;
  return p_at;
end;
$$;

revoke all on function public.jsonb_apply_ops(jsonb, jsonb) from public, anon;
revoke all on function public.patch_document_state(text, timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.jsonb_apply_ops(jsonb, jsonb) to authenticated;
grant execute on function public.patch_document_state(text, timestamptz, timestamptz, jsonb) to authenticated;
