-- Durable FFmpeg jobs. Only the backend service role can access this queue.
begin;
create table if not exists public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  phase text not null default 'Waiting for the renderer',
  progress integer not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0,
  worker_id uuid,
  heartbeat_at timestamptz,
  available_at timestamptz not null default now(),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists render_jobs_active_project on public.render_jobs(project_id)
  where status in ('queued', 'running');
create index if not exists render_jobs_queue on public.render_jobs(status, available_at, created_at);
alter table public.render_jobs enable row level security;
revoke all on public.render_jobs from public, anon, authenticated;
grant all on public.render_jobs to service_role;

create or replace function public.enqueue_render_job(p_project_id uuid, p_user_id uuid, p_fingerprint text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare job public.render_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('reeldirector-render-queue', 0));
  if not exists(select 1 from public.projects where id = p_project_id and user_id = p_user_id) then
    raise exception 'Project not found';
  end if;
  select * into job from public.render_jobs where project_id = p_project_id and status in ('queued', 'running');
  if found then
    if job.fingerprint <> p_fingerprint then
      raise exception 'An export with different edits is already running. Wait for it to finish.';
    end if;
    return to_jsonb(job);
  end if;
  select * into job from public.render_jobs where project_id = p_project_id
    and fingerprint = p_fingerprint and status = 'completed'
    and result ->> 'storage_path' = (select data #>> '{export,storage_path}' from public.projects where id = p_project_id)
    and updated_at > now() - interval '7 days' order by created_at desc limit 1;
  if found then return to_jsonb(job); end if;
  if (select count(*) from public.render_jobs where user_id = p_user_id and status in ('queued', 'running')) >= 2 then
    raise exception 'You already have two exports in progress. Please wait for one to finish.';
  end if;
  if (select count(*) from public.render_jobs where status in ('queued', 'running')) >= 100 then
    raise exception 'The export queue is full. Please try again shortly.';
  end if;
  insert into public.render_jobs(project_id, user_id, fingerprint, payload)
    values(p_project_id, p_user_id, p_fingerprint, p_payload) returning * into job;
  -- Keep finished job metadata for a week; finished videos stay in project storage.
  delete from public.render_jobs where status in ('completed', 'failed') and updated_at < now() - interval '7 days';
  return to_jsonb(job);
end;
$$;

create or replace function public.claim_render_job(p_worker_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare job public.render_jobs;
begin
  update public.render_jobs set status = 'failed', error = 'The renderer stopped repeatedly. Please retry Export.',
    phase = 'Export interrupted', updated_at = now()
    where status = 'running' and heartbeat_at < now() - interval '90 seconds' and attempts >= 3;
  select * into job from public.render_jobs
    where (status = 'queued' and available_at <= now())
       or (status = 'running' and heartbeat_at < now() - interval '90 seconds' and attempts < 3)
    order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update public.render_jobs set status = 'running', worker_id = p_worker_id,
    heartbeat_at = now(), attempts = attempts + 1, phase = 'Preparing your clips', progress = 2,
    error = null, updated_at = now() where id = job.id returning * into job;
  return to_jsonb(job);
end;
$$;

create or replace function public.finish_render_job(p_job_id uuid, p_worker_id uuid, p_result jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare job public.render_jobs;
begin
  select * into job from public.render_jobs where id = p_job_id and worker_id = p_worker_id
    and status = 'running' for update;
  if not found then return false; end if;
  -- Merge only export fields: editing a project while it renders must not lose edits.
  update public.projects set data = data || jsonb_build_object('status', 'exported', 'export', p_result,
    'export_url', p_result ->> 'url', 'thumbnail_url', p_result ->> 'thumbnail_url', 'updated_at', now()),
    updated_at = now() where id = job.project_id and user_id = job.user_id;
  update public.render_jobs set status = 'completed', result = p_result, progress = 100,
    phase = 'Your reel is ready', updated_at = now() where id = job.id;
  return true;
end;
$$;

revoke all on function public.enqueue_render_job(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_render_job(uuid) from public, anon, authenticated;
revoke all on function public.finish_render_job(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_render_job(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.claim_render_job(uuid) to service_role;
grant execute on function public.finish_render_job(uuid, uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
