-- Phase G5.5B: explicit, service-role-only managed USER campaign allowlist.
create table if not exists public.hosted_user_campaign_visibility (
  user_id uuid not null references public.hosted_users(user_id) on delete restrict,
  campaign_id uuid not null references public.app_campaigns(campaign_id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

create index if not exists hosted_user_campaign_visibility_user_idx
  on public.hosted_user_campaign_visibility(user_id, enabled, created_at desc);

alter table public.hosted_user_campaign_visibility enable row level security;
revoke all on table public.hosted_user_campaign_visibility from public, anon, authenticated;
grant select, insert, update, delete on table public.hosted_user_campaign_visibility to service_role;
