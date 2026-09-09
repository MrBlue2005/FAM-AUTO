-- Phase G1: durable, write-once hosted managed-user ownership for control-plane tasks.
-- Existing rows deliberately remain NULL: they are legacy/system/bootstrap tasks.
alter table public.tasks
  add column if not exists owner_user_id uuid references public.hosted_users(user_id) on delete restrict;

create index if not exists tasks_owner_history_idx
  on public.tasks(owner_user_id, created_at desc)
  where owner_user_id is not null;

create or replace function public.rx_cp_task_owner_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.owner_user_id is distinct from new.owner_user_id then
    raise exception 'TASK_OWNER_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists rx_cp_task_owner_immutable on public.tasks;
create trigger rx_cp_task_owner_immutable
before update on public.tasks
for each row execute function public.rx_cp_task_owner_immutable();

revoke all on function public.rx_cp_task_owner_immutable() from public, anon, authenticated;
grant execute on function public.rx_cp_task_owner_immutable() to service_role;
