-- A materialization or manifest failure occurs before RUNNING and must still
-- release the active profile lease as a normal terminal failure.
create or replace function public.rx_cp_transition_task(p_agent_id text,p_task_id text,p_lease_id uuid,p_next text,p_result jsonb default null,p_error jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare item tasks; begin
  perform rx_cp_reconcile_expired_leases();
  select * into item from tasks where task_id=p_task_id and agent_id=p_agent_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if item.lease_id is distinct from p_lease_id or item.leased_by_agent_id<>p_agent_id then raise exception 'STALE_LEASE'; end if;
  if (item.status='CLAIMED' and p_next not in ('RUNNING','FAILED','CANCELLED')) or (item.status='RUNNING' and p_next not in ('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN')) then raise exception 'ILLEGAL_TRANSITION'; end if;
  update tasks set status=p_next, started_at=case when p_next='RUNNING' then coalesce(started_at,now()) else started_at end, completed_at=case when p_next in ('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN') then now() else completed_at end, result=coalesce(p_result,result),error=coalesce(p_error,error),lease_expires_at=case when p_next in ('CLAIMED','RUNNING') then lease_expires_at else null end where task_id=p_task_id returning * into item;
  perform rx_cp_event('TASK_'||p_next,p_agent_id,p_task_id); return jsonb_build_object('protocol_version',1,'task',to_jsonb(item));
end $$;
