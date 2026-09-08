-- Phase 4B-A application-data foundation. Protocol V1 control-plane tables stay untouched.
create extension if not exists pgcrypto;

create table if not exists public.app_campaign_folders (
  folder_id uuid primary key default gen_random_uuid(), legacy_id text not null unique,
  name text not null check (length(trim(name)) between 1 and 160),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists app_campaign_folders_name_ci_idx on public.app_campaign_folders (lower(name));
create table if not exists public.app_schedule_folders (
  folder_id uuid primary key default gen_random_uuid(), legacy_id text not null unique,
  name text not null check (length(trim(name)) between 1 and 160),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists app_schedule_folders_name_ci_idx on public.app_schedule_folders (lower(name));

create table if not exists public.app_campaigns (
  campaign_id uuid primary key default gen_random_uuid(), legacy_id text not null,
  kind text not null check (kind in ('property', 'job')), title text not null, active boolean not null default true,
  folder_id uuid references public.app_campaign_folders(folder_id) on delete set null,
  profile_id text references public.profiles(profile_id) on delete restrict,
  data jsonb not null default '{}'::jsonb, revision integer not null default 1 check (revision > 0), archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (kind, legacy_id)
);
create index if not exists app_campaigns_profile_idx on public.app_campaigns(profile_id) where archived_at is null;
create index if not exists app_campaigns_folder_idx on public.app_campaigns(folder_id) where archived_at is null;
create table if not exists public.app_campaign_posts (
  post_id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.app_campaigns(campaign_id) on delete cascade,
  day integer not null check (day between 1 and 366), text text not null, active boolean not null default true,
  data jsonb not null default '{}'::jsonb, revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (campaign_id, day)
);
create index if not exists app_campaign_posts_campaign_idx on public.app_campaign_posts(campaign_id, day);

-- Object identity fields are write-once: replacement content always uses a new row/key.
create table if not exists public.app_media_objects (
  media_id uuid primary key default gen_random_uuid(), bucket text not null default 'fam-app-media' check (bucket = 'fam-app-media'),
  object_key text not null check (length(object_key) between 1 and 1024), sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0), mime_type text not null check (length(mime_type) between 3 and 255),
  original_name text not null check (length(original_name) between 1 and 512),
  state text not null default 'STAGED' check (state in ('STAGED', 'READY', 'QUARANTINED', 'DELETED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (bucket, object_key)
);
create index if not exists app_media_objects_sha256_idx on public.app_media_objects(sha256) where state <> 'DELETED';
create or replace function public.rx_app_media_object_immutable() returns trigger language plpgsql set search_path = public as $$
begin
  if new.bucket is distinct from old.bucket or new.object_key is distinct from old.object_key or new.sha256 is distinct from old.sha256
    or new.byte_size is distinct from old.byte_size or new.mime_type is distinct from old.mime_type or new.original_name is distinct from old.original_name then
    raise exception 'APP_MEDIA_OBJECT_IMMUTABLE';
  end if;
  new.updated_at = now(); return new;
end $$;
drop trigger if exists app_media_objects_immutable on public.app_media_objects;
create trigger app_media_objects_immutable before update on public.app_media_objects for each row execute function public.rx_app_media_object_immutable();
create table if not exists public.app_post_media (
  post_id uuid not null references public.app_campaign_posts(post_id) on delete cascade,
  media_id uuid not null references public.app_media_objects(media_id) on delete restrict, ordinal integer not null check (ordinal >= 0),
  created_at timestamptz not null default now(), primary key (post_id, media_id), unique (post_id, ordinal)
);

create table if not exists public.app_targets (
  target_id uuid primary key default gen_random_uuid(), legacy_id text not null unique, external_id text, display_name text not null,
  target_url text not null, category text not null default 'Romania', active boolean not null default true,
  data jsonb not null default '{}'::jsonb, revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists app_targets_category_idx on public.app_targets(category) where active;
create unique index if not exists app_targets_external_id_idx on public.app_targets(external_id) where external_id is not null;
create table if not exists public.app_schedules (
  schedule_id uuid primary key default gen_random_uuid(), legacy_id text not null unique, name text not null, enabled boolean not null default true,
  folder_id uuid references public.app_schedule_folders(folder_id) on delete set null,
  profile_id text references public.profiles(profile_id) on delete restrict, schedule jsonb not null,
  revision integer not null default 1 check (revision > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists app_schedules_profile_idx on public.app_schedules(profile_id) where enabled;
create table if not exists public.app_schedule_campaigns (
  schedule_id uuid not null references public.app_schedules(schedule_id) on delete cascade,
  campaign_id uuid not null references public.app_campaigns(campaign_id) on delete restrict, ordinal integer not null check (ordinal >= 0),
  created_at timestamptz not null default now(), primary key (schedule_id, campaign_id), unique (schedule_id, ordinal)
);
create table if not exists public.app_execution_runs (
  execution_run_id uuid primary key default gen_random_uuid(), legacy_id text unique,
  source_schedule_id uuid references public.app_schedules(schedule_id) on delete set null,
  agent_id text references public.agents(agent_id) on delete restrict, profile_id text references public.profiles(profile_id) on delete restrict,
  status text not null, mode text not null check (mode in ('test', 'dry_run', 'live')),
  config_snapshot jsonb not null default '{}'::jsonb, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists app_execution_runs_status_idx on public.app_execution_runs(status, created_at desc);
-- Historical imports may have no Protocol V1 task; new cloud results use the constrained task_id link.
create table if not exists public.app_posting_results (
  posting_result_id uuid primary key default gen_random_uuid(),
  execution_run_id uuid references public.app_execution_runs(execution_run_id) on delete set null,
  task_id text unique references public.tasks(task_id) on delete restrict,
  campaign_id uuid references public.app_campaigns(campaign_id) on delete restrict,
  target_id uuid references public.app_targets(target_id) on delete restrict,
  status text not null, result jsonb, error jsonb, occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index if not exists app_posting_results_campaign_idx on public.app_posting_results(campaign_id, occurred_at desc);
create index if not exists app_posting_results_target_idx on public.app_posting_results(target_id, occurred_at desc);

-- Private metadata only: migrations never upload an object or issue a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fam-app-media', 'fam-app-media', false, 524288000, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.app_campaign_folders enable row level security;
alter table public.app_schedule_folders enable row level security;
alter table public.app_campaigns enable row level security;
alter table public.app_campaign_posts enable row level security;
alter table public.app_media_objects enable row level security;
alter table public.app_post_media enable row level security;
alter table public.app_targets enable row level security;
alter table public.app_schedules enable row level security;
alter table public.app_schedule_campaigns enable row level security;
alter table public.app_execution_runs enable row level security;
alter table public.app_posting_results enable row level security;
revoke all on table public.app_campaign_folders, public.app_schedule_folders, public.app_campaigns, public.app_campaign_posts, public.app_media_objects, public.app_post_media, public.app_targets, public.app_schedules, public.app_schedule_campaigns, public.app_execution_runs, public.app_posting_results from anon, authenticated;
grant all on table public.app_campaign_folders, public.app_schedule_folders, public.app_campaigns, public.app_campaign_posts, public.app_media_objects, public.app_post_media, public.app_targets, public.app_schedules, public.app_schedule_campaigns, public.app_execution_runs, public.app_posting_results to service_role;
-- This dedicated project has no browser-facing Storage buckets. Signed URLs in a later server path need no direct table grants.
revoke all on table storage.objects, storage.buckets from anon, authenticated;
grant select, insert, update, delete on table storage.objects, storage.buckets to service_role;
drop policy if exists app_media_service_role_objects on storage.objects;
create policy app_media_service_role_objects on storage.objects for all to service_role using (bucket_id = 'fam-app-media') with check (bucket_id = 'fam-app-media');
drop policy if exists app_media_service_role_buckets on storage.buckets;
create policy app_media_service_role_buckets on storage.buckets for all to service_role using (id = 'fam-app-media') with check (id = 'fam-app-media');
