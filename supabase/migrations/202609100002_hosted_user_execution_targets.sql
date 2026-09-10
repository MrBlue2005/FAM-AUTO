-- Phase G3: explicit, service-role-only managed USER execution-target allowlist.
create table if not exists public.hosted_user_execution_targets (
  assignment_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hosted_users(user_id) on delete restrict,
  device_id text not null references public.agents(agent_id) on delete restrict,
  profile_id text not null references public.profiles(profile_id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id, profile_id)
);
create index if not exists hosted_user_execution_targets_user_idx on public.hosted_user_execution_targets(user_id, enabled, created_at desc);
alter table public.hosted_user_execution_targets enable row level security;
revoke all on table public.hosted_user_execution_targets from public, anon, authenticated;
grant select, insert, update, delete on table public.hosted_user_execution_targets to service_role;
