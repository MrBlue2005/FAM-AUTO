-- Hosted deployment: SECURITY DEFINER RPCs must not inherit PUBLIC EXECUTE.
-- This runs after every Protocol V1 function has been created/replaced.
-- Limit changes to RX objects; do not change unrelated schema privileges.
do $$
declare fn record; table_name text;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and left(p.proname,6)='rx_cp_'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
  foreach table_name in array array[
    'agents','agent_credentials','agent_enrollment_tokens','profiles',
    'tasks','task_events','idempotency_requests'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;
