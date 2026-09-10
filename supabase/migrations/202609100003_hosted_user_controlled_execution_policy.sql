-- G4.1: explicit service-role-managed policy; existing users remain denied.
alter table public.hosted_users add column if not exists controlled_execution_enabled boolean not null default false;
alter table public.hosted_users enable row level security;
revoke all on table public.hosted_users from public, anon, authenticated;
grant select, insert, update, delete on table public.hosted_users to service_role;
