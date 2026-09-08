-- Run with psql, as postgres, on the existing local stack. No reset.
-- The migration and the test event are rolled back even after a failed check
-- (ON_ERROR_STOP closes psql's connection with an uncommitted transaction).
\set ON_ERROR_STOP on
begin;
\ir ../migrations/202609080002_control_plane_privileges.sql

do $$
declare fn record; item record; function_count integer := 0; table_count integer := 0;
begin
  for fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and left(p.proname,6)='rx_cp_'
  loop
    function_count := function_count + 1;
    if has_function_privilege('anon',fn.oid,'EXECUTE')
       or has_function_privilege('authenticated',fn.oid,'EXECUTE')
       or not has_function_privilege('service_role',fn.oid,'EXECUTE') then
      raise exception 'Unexpected RPC privilege for %', fn.oid::regprocedure;
    end if;
  end loop;
  if function_count <> 19 then raise exception 'Expected 19 Protocol V1 RPCs, found %',function_count; end if;
  for item in select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in
      ('agents','profiles','agent_credentials','agent_enrollment_tokens','tasks','task_events','idempotency_requests')
  loop
    table_count := table_count + 1;
    if not item.relrowsecurity
       or has_table_privilege('anon',item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated',item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or not has_table_privilege('service_role',item.oid,'SELECT')
       or not has_table_privilege('service_role',item.oid,'INSERT')
       or not has_table_privilege('service_role',item.oid,'UPDATE')
       or not has_table_privilege('service_role',item.oid,'DELETE') then
      raise exception 'Unexpected table privilege/RLS for %',item.oid::regclass;
    end if;
  end loop;
  if table_count <> 7 then raise exception 'Expected seven control-plane tables'; end if;
  raise notice 'PASS: 19 RPCs and seven RLS tables are server-only';
end $$;

set local role anon;
do $$ begin
  begin
    perform public.rx_cp_event('HOSTED_ACL_DENIED');
    raise exception 'anon unexpectedly executed a privileged RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.rx_cp_create_enrollment_token('acl-test-not-a-secret','acl-test',now()+interval '1 minute');
    raise exception 'authenticated unexpectedly issued an enrollment token';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
select public.rx_cp_event('HOSTED_ACL_SMOKE');
do $$ begin
  if (select count(*) from public.task_events where event_type='HOSTED_ACL_SMOKE' and occurred_at=now()) <> 1 then
    raise exception 'Expected one service-role event';
  end if;
  raise notice 'PASS: anon/authenticated RPC calls denied; service-role RPC and table access succeeded';
end $$;
reset role;
rollback;
