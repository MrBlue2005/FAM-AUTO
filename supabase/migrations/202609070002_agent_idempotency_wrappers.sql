-- Each wrapper performs the business mutation and durable idempotency insert in one PostgreSQL transaction.
create or replace function public.rx_cp_idempotent_claim(p_agent_id text,p_request_id uuid,p_request_hash bytea,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior idempotency_requests; response jsonb; begin
  select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id for update;
  if found then if prior.operation<>'claim' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; return prior.response; end if;
  begin response:=rx_cp_claim_task(p_agent_id,p_lease_seconds); insert into idempotency_requests(agent_id,request_id,operation,request_hash,response) values(p_agent_id,p_request_id,'claim',p_request_hash,response);
  exception when unique_violation then select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id; if prior.operation<>'claim' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; response:=prior.response; end;
  return response; end $$;

create or replace function public.rx_cp_idempotent_heartbeat(p_agent_id text,p_request_id uuid,p_request_hash bytea,p_display_name text,p_agent_status text,p_agent_version text,p_profiles jsonb,p_active_task_ids jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior idempotency_requests; response jsonb; begin
 select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id for update;
 if found then if prior.operation<>'heartbeat' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; return prior.response; end if;
 begin response:=rx_cp_heartbeat(p_agent_id,p_display_name,p_agent_status,p_agent_version,p_profiles,p_active_task_ids); insert into idempotency_requests(agent_id,request_id,operation,request_hash,response) values(p_agent_id,p_request_id,'heartbeat',p_request_hash,response);
 exception when unique_violation then
   select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id;
   if prior.operation<>'heartbeat' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
   response:=prior.response;
 end; return response; end $$;

create or replace function public.rx_cp_idempotent_renew(p_agent_id text,p_request_id uuid,p_request_hash bytea,p_task_id text,p_lease_id uuid,p_lease_seconds integer,p_progress jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior idempotency_requests; response jsonb; begin
 select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id for update;
 if found then if prior.operation<>'renew' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; return prior.response; end if;
 begin response:=rx_cp_renew_lease(p_agent_id,p_task_id,p_lease_id,p_lease_seconds,p_progress); insert into idempotency_requests(agent_id,request_id,operation,request_hash,response) values(p_agent_id,p_request_id,'renew',p_request_hash,response);
 exception when unique_violation then
   select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id;
   if prior.operation<>'renew' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
   response:=prior.response;
 end; return response; end $$;

create or replace function public.rx_cp_idempotent_transition(p_agent_id text,p_request_id uuid,p_request_hash bytea,p_task_id text,p_lease_id uuid,p_next text,p_result jsonb,p_error jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior idempotency_requests; response jsonb; begin
 select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id for update;
 if found then if prior.operation<>('transition:'||p_next) or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; return prior.response; end if;
 begin response:=rx_cp_transition_task(p_agent_id,p_task_id,p_lease_id,p_next,p_result,p_error); insert into idempotency_requests(agent_id,request_id,operation,request_hash,response) values(p_agent_id,p_request_id,'transition:'||p_next,p_request_hash,response);
 exception when unique_violation then
   select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id;
   if prior.operation<>('transition:'||p_next) or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
   response:=prior.response;
 end; return response; end $$;

create or replace function public.rx_cp_idempotent_rotate_credential(p_agent_id text,p_request_id uuid,p_request_hash bytea,p_new_secret text,p_overlap_seconds integer default 900)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior idempotency_requests; response jsonb; begin
 select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id for update;
 if found then if prior.operation<>'credential-rotate' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if; return prior.response; end if;
 begin
   response:=rx_cp_rotate_credential(p_agent_id,p_new_secret,p_overlap_seconds);
   insert into idempotency_requests(agent_id,request_id,operation,request_hash,response) values(p_agent_id,p_request_id,'credential-rotate',p_request_hash,response);
 exception when unique_violation then
   select * into prior from idempotency_requests where agent_id=p_agent_id and request_id=p_request_id;
   if prior.operation<>'credential-rotate' or prior.request_hash<>p_request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT'; end if;
   response:=prior.response;
 end;
 return response;
end $$;

create or replace function public.rx_cp_purge_idempotency() returns integer language plpgsql security definer set search_path=public as $$ declare count_deleted integer; begin delete from idempotency_requests where expires_at<now(); get diagnostics count_deleted=row_count; return count_deleted; end $$;
