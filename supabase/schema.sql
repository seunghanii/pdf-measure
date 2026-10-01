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

-- 2) PDF 파일 보관함 (비공개, 파일 하나 50MB 까지) ------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 52428800, array['application/pdf'])
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
