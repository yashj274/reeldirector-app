-- ReelDirector: project records and private camera-frame storage.
-- Run once in the Supabase SQL Editor for the target project.

create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_data_id_matches_row check (data ->> 'id' = id::text),
  constraint projects_data_owner_matches_row check (data ->> 'user_id' = user_id::text)
);

create index if not exists projects_owner_created_at_idx
  on public.projects (user_id, created_at desc);

alter table public.projects enable row level security;

grant select, insert, update, delete on public.projects to authenticated;

drop policy if exists "Users manage their own projects" on public.projects;
create policy "Users manage their own projects"
  on public.projects
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and data ->> 'id' = id::text
    and data ->> 'user_id' = user_id::text
  );

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false)
on conflict (id) do update set public = false;

drop policy if exists "Users read their project media" on storage.objects;
create policy "Users read their project media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload their project media" on storage.objects;
create policy "Users upload their project media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update their project media" on storage.objects;
create policy "Users update their project media"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete their project media" on storage.objects;
create policy "Users delete their project media"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
