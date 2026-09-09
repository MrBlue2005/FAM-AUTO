-- Hosted B4 managed USER accounts. Bootstrap ADMIN stays environment-backed.
create table if not exists public.hosted_users (
  user_id uuid primary key default gen_random_uuid(),
  username text not null check (length(trim(username)) between 3 and 64),
  username_normalized text not null unique check (username_normalized = lower(trim(username))),
  password_scrypt text not null,
  role text not null default 'USER' check (role = 'USER'),
  enabled boolean not null default true,
  session_version integer not null default 1 check (session_version > 0),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hosted_users_enabled_idx on public.hosted_users(enabled, username_normalized);

alter table public.hosted_users enable row level security;
revoke all on table public.hosted_users from public, anon, authenticated;
grant select, insert, update, delete on table public.hosted_users to service_role;
