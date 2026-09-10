-- Phase G5.1: durable, server-only safety state for a future live publisher.
-- This migration does not create a live task or grant live authority.

alter table public.tasks
  add column if not exists side_effect_state text not null default 'NOT_ATTEMPTED',
  add column if not exists side_effect_attempted_at timestamptz;

alter table public.tasks
  drop constraint if exists tasks_side_effect_state_check,
  add constraint tasks_side_effect_state_check
    check (side_effect_state in ('NOT_ATTEMPTED','ATTEMPT_STARTED','VERIFIED_SUCCESS'));

alter table public.hosted_users
  add column if not exists live_execution_enabled boolean not null default false;

-- New rows and state changes are monotonic.  The execution protocol, rather
-- than a browser or a mutable JSON progress object, is the only writer.
create or replace function public.rx_cp_enforce_side_effect_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.side_effect_state <> 'NOT_ATTEMPTED' then
    raise exception 'INVALID_SIDE_EFFECT_STATE';
  end if;
  if tg_op = 'UPDATE' and new.side_effect_state is distinct from old.side_effect_state
    and not ((old.side_effect_state = 'NOT_ATTEMPTED' and new.side_effect_state = 'ATTEMPT_STARTED')
      or (old.side_effect_state = 'ATTEMPT_STARTED' and new.side_effect_state = 'VERIFIED_SUCCESS')) then
    raise exception 'INVALID_SIDE_EFFECT_TRANSITION';
  end if;
  if new.side_effect_state = 'ATTEMPT_STARTED' and new.side_effect_attempted_at is null then
    raise exception 'SIDE_EFFECT_TIMESTAMP_REQUIRED';
  end if;
  return new;
end $$;

drop trigger if exists rx_cp_side_effect_state_guard on public.tasks;
create trigger rx_cp_side_effect_state_guard
before insert or update of side_effect_state, side_effect_attempted_at on public.tasks
for each row execute function public.rx_cp_enforce_side_effect_state();

create or replace function public.rx_cp_reconcile_expired_leases() returns void language plpgsql security definer set search_path = public as $$
declare item record;
begin
  for item in select * from tasks where status in ('CLAIMED','RUNNING') and lease_expires_at <= now() for update loop
    if item.side_effect_state = 'ATTEMPT_STARTED' then
      update tasks set status='OUTCOME_UNKNOWN', completed_at=now(), lease_expires_at=null,
        error=jsonb_build_object('code','SIDE_EFFECT_ATTEMPT_LEASE_EXPIRED') where task_id=item.task_id;
      perform rx_cp_event('TASK_OUTCOME_UNKNOWN', item.agent_id, item.task_id, jsonb_build_object('reason','side_effect_attempt_lease_expired'));
    elsif item.status = 'CLAIMED' and item.cancellation_requested_at is null then
      update tasks set status='QUEUED', lease_id=null, leased_by_agent_id=null, lease_expires_at=null where task_id=item.task_id;
      perform rx_cp_event('LEASE_EXPIRED_REQUEUED', item.agent_id, item.task_id);
    elsif item.status = 'CLAIMED' then
      update tasks set status='CANCELLED', completed_at=now(), lease_id=null, leased_by_agent_id=null, lease_expires_at=null,
        error=jsonb_build_object('code','CANCELLED_BEFORE_START') where task_id=item.task_id;
      perform rx_cp_event('LEASE_EXPIRED_CANCELLED', item.agent_id, item.task_id);
    else
      update tasks set status='OUTCOME_UNKNOWN', completed_at=now(), lease_id=null, leased_by_agent_id=null, lease_expires_at=null,
        error=jsonb_build_object('code','LEASE_EXPIRED_DURING_EXECUTION') where task_id=item.task_id;
      perform rx_cp_event('TASK_OUTCOME_UNKNOWN', item.agent_id, item.task_id, jsonb_build_object('reason','lease_expired'));
    end if;
  end loop;
end $$;

create or replace function public.rx_cp_claim_task(p_agent_id text, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare picked tasks; lease uuid := gen_random_uuid(); begin
  perform rx_cp_reconcile_expired_leases();
  loop
    select t.* into picked from tasks t join profiles p on p.profile_id=t.profile_id
      where t.agent_id=p_agent_id and p.agent_id=p_agent_id and t.status='QUEUED'
        and t.side_effect_state='NOT_ATTEMPTED' and t.cancellation_requested_at is null and t.scheduled_at<=now()
        and not exists (select 1 from tasks active where active.profile_id=t.profile_id and active.status in ('CLAIMED','RUNNING'))
      order by t.created_at for update skip locked limit 1;
    if not found then return jsonb_build_object('protocol_version',1,'task',null); end if;
    perform pg_advisory_xact_lock(hashtextextended(picked.profile_id,0));
    if exists(select 1 from tasks where profile_id=picked.profile_id and status in ('CLAIMED','RUNNING')) then continue; end if;
    begin
      update tasks set status='CLAIMED',claimed_at=now(),attempt=attempt+1,leased_by_agent_id=p_agent_id,lease_id=lease,lease_expires_at=now()+make_interval(secs=>greatest(30,p_lease_seconds)) where task_id=picked.task_id returning * into picked;
      perform rx_cp_event('TASK_CLAIMED',p_agent_id,picked.task_id,jsonb_build_object('profile_id',picked.profile_id));
      return jsonb_build_object('protocol_version',1,'task',to_jsonb(picked));
    exception when unique_violation then continue; end;
  end loop;
end $$;

create or replace function public.rx_cp_mark_side_effect_attempt_started(p_agent_id text,p_task_id text,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item tasks; begin
  perform rx_cp_reconcile_expired_leases();
  select * into item from tasks where task_id=p_task_id and agent_id=p_agent_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if item.task_type <> 'LIVE_CAMPAIGN_EXECUTION' then raise exception 'SIDE_EFFECT_NOT_SUPPORTED'; end if;
  if item.lease_id is distinct from p_lease_id or item.leased_by_agent_id<>p_agent_id or item.lease_expires_at<=now() then raise exception 'STALE_LEASE'; end if;
  if item.status <> 'RUNNING' or item.cancellation_requested_at is not null then raise exception 'ATTEMPT_NOT_ALLOWED'; end if;
  if item.side_effect_state = 'ATTEMPT_STARTED' then return jsonb_build_object('protocol_version',1,'already_marked',true,'side_effect_state','ATTEMPT_STARTED'); end if;
  if item.side_effect_state <> 'NOT_ATTEMPTED' then raise exception 'ILLEGAL_SIDE_EFFECT_STATE'; end if;
  update tasks set side_effect_state='ATTEMPT_STARTED',side_effect_attempted_at=now() where task_id=p_task_id returning * into item;
  perform rx_cp_event('TASK_SIDE_EFFECT_ATTEMPT_STARTED',p_agent_id,p_task_id,'{}'::jsonb);
  return jsonb_build_object('protocol_version',1,'already_marked',false,'side_effect_state','ATTEMPT_STARTED','attempted_at',item.side_effect_attempted_at);
end $$;

create or replace function public.rx_cp_mark_side_effect_verified_success(p_agent_id text,p_task_id text,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item tasks; begin
  perform rx_cp_reconcile_expired_leases();
  select * into item from tasks where task_id=p_task_id and agent_id=p_agent_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if item.task_type <> 'LIVE_CAMPAIGN_EXECUTION' or item.status <> 'RUNNING' then raise exception 'VERIFICATION_NOT_ALLOWED'; end if;
  if item.lease_id is distinct from p_lease_id or item.leased_by_agent_id<>p_agent_id or item.lease_expires_at<=now() then raise exception 'STALE_LEASE'; end if;
  if item.side_effect_state = 'VERIFIED_SUCCESS' then return jsonb_build_object('protocol_version',1,'already_verified',true); end if;
  if item.side_effect_state <> 'ATTEMPT_STARTED' then raise exception 'ATTEMPT_NOT_STARTED'; end if;
  update tasks set side_effect_state='VERIFIED_SUCCESS' where task_id=p_task_id;
  perform rx_cp_event('TASK_SIDE_EFFECT_VERIFIED_SUCCESS',p_agent_id,p_task_id,'{}'::jsonb);
  return jsonb_build_object('protocol_version',1,'already_verified',false,'side_effect_state','VERIFIED_SUCCESS');
end $$;

-- Restore first-terminal-result-wins while enforcing the live-only terminal rules.
create or replace function public.rx_cp_transition_task(p_agent_id text,p_task_id text,p_lease_id uuid,p_next text,p_result jsonb default null,p_error jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item tasks; begin
  perform rx_cp_reconcile_expired_leases();
  select * into item from tasks where task_id=p_task_id and agent_id=p_agent_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if item.lease_id is distinct from p_lease_id or item.leased_by_agent_id<>p_agent_id then raise exception 'STALE_LEASE'; end if;
  if item.status in ('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN') then
    if item.status=p_next then return jsonb_build_object('protocol_version',1,'task',to_jsonb(item)); end if;
    raise exception 'ILLEGAL_TRANSITION';
  end if;
  if item.task_type='LIVE_CAMPAIGN_EXECUTION' then
    if p_next='COMPLETED' and item.side_effect_state <> 'VERIFIED_SUCCESS' then raise exception 'LIVE_SUCCESS_NOT_VERIFIED'; end if;
    if item.side_effect_state='ATTEMPT_STARTED' and p_next in ('FAILED','CANCELLED') then p_next:='OUTCOME_UNKNOWN'; end if;
  end if;
  if (item.status='CLAIMED' and p_next not in ('RUNNING','FAILED','CANCELLED')) or (item.status='RUNNING' and p_next not in ('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN')) then raise exception 'ILLEGAL_TRANSITION'; end if;
  update tasks set status=p_next,started_at=case when p_next='RUNNING' then coalesce(started_at,now()) else started_at end,
    completed_at=case when p_next in ('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN') then now() else completed_at end,
    result=coalesce(p_result,result),error=coalesce(p_error,error),lease_expires_at=case when p_next in ('CLAIMED','RUNNING') then lease_expires_at else null end
    where task_id=p_task_id returning * into item;
  perform rx_cp_event('TASK_'||p_next,p_agent_id,p_task_id);
  return jsonb_build_object('protocol_version',1,'task',to_jsonb(item));
end $$;

create or replace function public.rx_cp_idempotent_mark_side_effect_attempt_started(p_agent_id text,p_request_id uuid,p_request_hash bytea,p_task_id text,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior idempotency_requests; response jsonb; begin
  select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id for update;
  if found then if prior.operation<>'side-effect-attempt-started' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; return prior.response; end if;
  response:=rx_cp_mark_side_effect_attempt_started(p_agent_id,p_task_id,p_lease_id);
  insert into idempotency_requests(agent_id,request_id,operation,request_hash,response) values(p_agent_id,p_request_id,'side-effect-attempt-started',p_request_hash,response);
  return response;
end $$;

create or replace function public.rx_cp_idempotent_mark_side_effect_verified_success(p_agent_id text,p_request_id uuid,p_request_hash bytea,p_task_id text,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior idempotency_requests; response jsonb; begin
  select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id for update;
  if found then if prior.operation<>'side-effect-verified-success' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; return prior.response; end if;
  response:=rx_cp_mark_side_effect_verified_success(p_agent_id,p_task_id,p_lease_id);
  insert into idempotency_requests(agent_id,request_id,operation,request_hash,response) values(p_agent_id,p_request_id,'side-effect-verified-success',p_request_hash,response);
  return response;
end $$;

revoke all on function public.rx_cp_enforce_side_effect_state() from public, anon, authenticated;
revoke all on function public.rx_cp_mark_side_effect_attempt_started(text,text,uuid) from public, anon, authenticated;
revoke all on function public.rx_cp_mark_side_effect_verified_success(text,text,uuid) from public, anon, authenticated;
revoke all on function public.rx_cp_idempotent_mark_side_effect_attempt_started(text,uuid,bytea,text,uuid) from public, anon, authenticated;
revoke all on function public.rx_cp_idempotent_mark_side_effect_verified_success(text,uuid,bytea,text,uuid) from public, anon, authenticated;
grant execute on function public.rx_cp_mark_side_effect_attempt_started(text,text,uuid) to service_role;
grant execute on function public.rx_cp_mark_side_effect_verified_success(text,text,uuid) to service_role;
grant execute on function public.rx_cp_idempotent_mark_side_effect_attempt_started(text,uuid,bytea,text,uuid) to service_role;
grant execute on function public.rx_cp_idempotent_mark_side_effect_verified_success(text,uuid,bytea,text,uuid) to service_role;
