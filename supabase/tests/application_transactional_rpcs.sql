-- Local synthetic validation for 202609080004. Run through the focused Node test.
\set ON_ERROR_STOP on
begin;

set local role service_role;
do $$
declare v_campaign jsonb; v_result jsonb; v_campaign_id uuid; v_post_id uuid; v_media_one uuid := '10000000-0000-0000-0000-000000000001'; v_media_two uuid := '10000000-0000-0000-0000-000000000002';
begin
  v_campaign := jsonb_build_object('legacy_id','rpc-fixture-campaign','kind','property','title','RPC fixture','active',true,'data',jsonb_build_object('fixture',true));
  v_result := public.rx_app_write_campaign_with_posts(v_campaign, jsonb_build_array(jsonb_build_object('day',1,'text','first','active',true)), 0, '20000000-0000-0000-0000-000000000001', repeat('a',64));
  if (v_result->'campaign'->>'revision')::integer <> 1 or jsonb_array_length(v_result->'posts') <> 1 then raise exception 'campaign RPC did not create atomic snapshot'; end if;
  if public.rx_app_write_campaign_with_posts(v_campaign, jsonb_build_array(jsonb_build_object('day',1,'text','first','active',true)), 0, '20000000-0000-0000-0000-000000000001', repeat('a',64)) is distinct from v_result then raise exception 'campaign retry was not idempotent'; end if;
  begin
    perform public.rx_app_write_campaign_with_posts(v_campaign, '[]'::jsonb, 0, '20000000-0000-0000-0000-000000000002', repeat('b',64));
    raise exception 'stale campaign revision unexpectedly succeeded';
  exception when serialization_failure then null;
  end;
  select campaign_id into v_campaign_id from public.app_campaigns where legacy_id = 'rpc-fixture-campaign' and kind = 'property';
  select post_id into v_post_id from public.app_campaign_posts where campaign_id = v_campaign_id and day = 1;
  insert into public.app_media_objects(media_id, object_key, sha256, byte_size, mime_type, original_name, state) values
    (v_media_one, 'fixtures/one.jpg', repeat('1',64), 1, 'image/jpeg', 'one.jpg', 'READY'),
    (v_media_two, 'fixtures/two.jpg', repeat('2',64), 1, 'image/jpeg', 'two.jpg', 'READY');
  v_result := public.rx_app_set_post_media(v_post_id, array[v_media_two, v_media_one], 1, '20000000-0000-0000-0000-000000000003', repeat('c',64));
  if (v_result->'post'->>'revision')::integer <> 2 or jsonb_array_length(v_result->'media_ids') <> 2 then raise exception 'post-media RPC did not replace ordered relations'; end if;
  if public.rx_app_set_post_media(v_post_id, array[v_media_two, v_media_one], 1, '20000000-0000-0000-0000-000000000003', repeat('c',64)) is distinct from v_result then raise exception 'post-media retry was not idempotent'; end if;
  begin
    perform public.rx_app_set_post_media(v_post_id, array[v_media_one], 1, '20000000-0000-0000-0000-000000000004', repeat('d',64));
    raise exception 'stale post revision unexpectedly succeeded';
  exception when serialization_failure then null;
  end;
  perform public.rx_app_write_schedule_with_campaigns(jsonb_build_object('legacy_id','rpc-fixture-schedule','name','RPC schedule','enabled',true,'schedule',jsonb_build_object('daysOfWeek',jsonb_build_array(1))), array[v_campaign_id], 0, '20000000-0000-0000-0000-000000000005', repeat('e',64));
  if (select count(*) from public.app_schedule_campaigns) <> 1 then raise exception 'schedule RPC did not create relationship'; end if;
  begin
    perform public.rx_app_write_schedule_with_campaigns(jsonb_build_object('legacy_id','rpc-fixture-rollback','name','must roll back','enabled',true,'schedule','{}'::jsonb), array['30000000-0000-0000-0000-000000000001'::uuid], 0, '20000000-0000-0000-0000-000000000006', repeat('f',64));
    raise exception 'deliberate second-stage FK failure unexpectedly succeeded';
  exception when foreign_key_violation then null;
  end;
  if exists (select 1 from public.app_schedules where legacy_id = 'rpc-fixture-rollback') or exists (select 1 from public.app_write_idempotency where request_id = '20000000-0000-0000-0000-000000000006') then
    raise exception 'failed multi-table schedule write left a durable partial mutation';
  end if;
end $$;

reset role;
do $$
declare fn record;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('rx_app_write_campaign_with_posts','rx_app_write_schedule_with_campaigns','rx_app_set_post_media') loop
    if has_function_privilege('public', fn.oid, 'EXECUTE') or has_function_privilege('anon', fn.oid, 'EXECUTE') or has_function_privilege('authenticated', fn.oid, 'EXECUTE') or not has_function_privilege('service_role', fn.oid, 'EXECUTE') then raise exception 'unexpected application RPC grants for %', fn.oid::regprocedure; end if;
  end loop;
end $$;
set local role anon;
do $$ begin begin perform public.rx_app_write_campaign_with_posts('{}','[]',0,'20000000-0000-0000-0000-000000000007',repeat('0',64)); raise exception 'anon unexpectedly executed application RPC'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role authenticated;
do $$ begin begin perform public.rx_app_write_campaign_with_posts('{}','[]',0,'20000000-0000-0000-0000-000000000008',repeat('0',64)); raise exception 'authenticated unexpectedly executed application RPC'; exception when insufficient_privilege then null; end; end $$;
reset role;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'rx_app_%' and pg_get_functiondef(p.oid) ~ 'agents|tasks|task_events|credentials') then
    raise exception 'application RPC unexpectedly references control-plane state';
  end if;
end $$;
rollback;
