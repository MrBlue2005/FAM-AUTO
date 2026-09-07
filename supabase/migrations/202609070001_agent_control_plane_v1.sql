-- RX Agent Protocol v1 control plane. Service-role Edge Functions are the only API.
create extension if not exists pgcrypto;

create table if not exists public.agents (
  agent_id text primary key check (agent_id ~ '^agent_[A-Za-z0-9_-]+$'),
  display_name text not null,
  reported_status text not null default 'OFFLINE' check (reported_status in ('ONLINE','BUSY','DEGRADED','OFFLINE')),
  last_seen_at timestamptz,
  agent_version text,
  protocol_version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.agent_credentials (
  credential_id uuid primary key default gen_random_uuid(), agent_id text not null references public.agents(agent_id) on delete cascade,
  secret_hash text not null, created_at timestamptz not null default now(), retire_at timestamptz, revoked_at timestamptz, last_used_at timestamptz
);
create index if not exists agent_credentials_active_idx on public.agent_credentials(agent_id) where revoked_at is null;
create table if not exists public.agent_enrollment_tokens (
  enrollment_id uuid primary key default gen_random_uuid(), token_hash bytea not null unique, created_by text not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null, consumed_at timestamptz, consumed_by_agent_id text
);
create table if not exists public.profiles (
  profile_id text primary key check (profile_id ~ '^profile_[A-Za-z0-9_-]+$'), agent_id text not null references public.agents(agent_id),
  display_name text not null, status text not null check (status in ('READY','BUSY','UNAVAILABLE','ERROR','NEEDS_LOGIN')),
  last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists profiles_agent_idx on public.profiles(agent_id);
create table if not exists public.tasks (
  task_id text primary key, agent_id text not null references public.agents(agent_id), profile_id text not null references public.profiles(profile_id),
  task_type text not null, status text not null default 'QUEUED' check (status in ('QUEUED','CLAIMED','RUNNING','COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN')),
  payload jsonb not null, scheduled_at timestamptz not null default now(), created_at timestamptz not null default now(), claimed_at timestamptz,
  started_at timestamptz, completed_at timestamptz, attempt integer not null default 0 check (attempt >= 0), leased_by_agent_id text references public.agents(agent_id),
  lease_id uuid, lease_expires_at timestamptz, cancellation_requested_at timestamptz, progress jsonb, result jsonb, error jsonb,
  outcome_resolved_at timestamptz, outcome_resolver text, outcome_resolution text, outcome_note text,
  check ((status in ('CLAIMED','RUNNING')) = (lease_id is not null and leased_by_agent_id is not null and lease_expires_at is not null) or status not in ('CLAIMED','RUNNING'))
);
create index if not exists tasks_claim_idx on public.tasks(agent_id, status, scheduled_at);
-- The database, not a SELECT-before-UPDATE race, enforces one execution right per physical profile.
create unique index if not exists tasks_one_active_profile_idx on public.tasks(profile_id) where status in ('CLAIMED','RUNNING');
create table if not exists public.task_events (
  event_id uuid primary key default gen_random_uuid(), task_id text references public.tasks(task_id) on delete cascade,
  agent_id text references public.agents(agent_id), event_type text not null, occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb
);
create index if not exists task_events_task_idx on public.task_events(task_id, occurred_at);
create table if not exists public.idempotency_requests (
  agent_id text not null references public.agents(agent_id) on delete cascade, request_id uuid not null, operation text not null,
  request_hash bytea not null, response jsonb not null, created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '7 days',
  primary key (agent_id, request_id)
);

create or replace function public.rx_cp_event(p_type text, p_agent_id text default null, p_task_id text default null, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into task_events(event_type, agent_id, task_id, metadata) values (p_type, p_agent_id, p_task_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.rx_cp_reconcile_expired_leases() returns void language plpgsql security definer set search_path = public as $$
declare item record;
begin
  for item in select * from tasks where status in ('CLAIMED','RUNNING') and lease_expires_at <= now() for update loop
    if item.status = 'CLAIMED' and item.cancellation_requested_at is null then
      update tasks set status='QUEUED', lease_id=null, leased_by_agent_id=null, lease_expires_at=null where task_id=item.task_id;
      perform rx_cp_event('LEASE_EXPIRED_REQUEUED', item.agent_id, item.task_id);
    elsif item.status = 'CLAIMED' then
      update tasks set status='CANCELLED', completed_at=now(), lease_id=null, lease_expires_at=null, error=jsonb_build_object('code','CANCELLED_BEFORE_START') where task_id=item.task_id;
      perform rx_cp_event('LEASE_EXPIRED_CANCELLED', item.agent_id, item.task_id);
    else
      update tasks set status='OUTCOME_UNKNOWN', completed_at=now(), lease_id=null, lease_expires_at=null, error=jsonb_build_object('code','LEASE_EXPIRED_DURING_EXECUTION') where task_id=item.task_id;
      perform rx_cp_event('TASK_OUTCOME_UNKNOWN', item.agent_id, item.task_id, jsonb_build_object('reason','lease_expired'));
    end if;
  end loop;
end $$;

create or replace function public.rx_cp_authenticate_agent(p_agent_id text, p_secret text)
returns table(agent_id text, credential_id uuid) language plpgsql security definer set search_path = public as $$
declare matched agent_credentials; begin
  select * into matched from agent_credentials c where c.agent_id=p_agent_id and c.revoked_at is null and (c.retire_at is null or c.retire_at > now()) and crypt(p_secret, c.secret_hash)=c.secret_hash limit 1;
  if not found then raise exception 'UNAUTHORIZED_AGENT' using errcode='28000'; end if;
  update agent_credentials set last_used_at=now() where credential_id=matched.credential_id;
  return query select matched.agent_id, matched.credential_id;
end $$;

create or replace function public.rx_cp_enroll_agent(p_agent_id text, p_secret text, p_display_name text, p_token text, p_protocol_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare enrollment agent_enrollment_tokens; begin
  if p_protocol_version <> 1 then raise exception 'UNSUPPORTED_PROTOCOL'; end if;
  select * into enrollment from agent_enrollment_tokens where token_hash=digest(p_token,'sha256') and consumed_at is null and expires_at > now() for update;
  if not found then raise exception 'ENROLLMENT_DENIED' using errcode='28000'; end if;
  insert into agents(agent_id,display_name,protocol_version) values(p_agent_id,p_display_name,1) on conflict(agent_id) do nothing;
  if exists(select 1 from agent_credentials where agent_id=p_agent_id and revoked_at is null) then raise exception 'AGENT_ALREADY_ENROLLED'; end if;
  insert into agent_credentials(agent_id,secret_hash) values(p_agent_id,crypt(p_secret,gen_salt('bf',12)));
  update agent_enrollment_tokens set consumed_at=now(), consumed_by_agent_id=p_agent_id where enrollment_id=enrollment.enrollment_id;
  perform rx_cp_event('AGENT_ENROLLED',p_agent_id,null,jsonb_build_object('enrollment_id',enrollment.enrollment_id));
  return jsonb_build_object('protocol_version',1,'agent_id',p_agent_id,'enrolled',true);
end $$;

create or replace function public.rx_cp_heartbeat(p_agent_id text, p_display_name text, p_agent_status text, p_agent_version text, p_profiles jsonb, p_active_task_ids jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare profile jsonb; existing profiles; begin
  update agents set display_name=coalesce(p_display_name,display_name), reported_status=case when p_agent_status in ('ONLINE','BUSY','DEGRADED') then p_agent_status else 'ONLINE' end, agent_version=p_agent_version, protocol_version=1,last_seen_at=now(),updated_at=now() where agent_id=p_agent_id;
  if not found then raise exception 'UNAUTHORIZED_AGENT'; end if;
  for profile in select * from jsonb_array_elements(coalesce(p_profiles,'[]'::jsonb)) loop
    if profile ?| array['profilePath','profile_path','cookies','password','credentials','userDataDir','user_data_dir','sessionStorage','localStorage','indexedDB'] then raise exception 'SENSITIVE_FIELD_PROHIBITED'; end if;
    select * into existing from profiles where profile_id=profile->>'profile_id' for update;
    if found and existing.agent_id <> p_agent_id then raise exception 'PROFILE_OWNERSHIP_CONFLICT'; end if;
    insert into profiles(profile_id,agent_id,display_name,status,last_seen_at) values(profile->>'profile_id',p_agent_id,profile->>'display_name',profile->>'status',now())
      on conflict(profile_id) do update set display_name=excluded.display_name,status=excluded.status,last_seen_at=now(),updated_at=now();
  end loop;
  perform rx_cp_event('AGENT_HEARTBEAT',p_agent_id,null,jsonb_build_object('active_task_count',jsonb_array_length(coalesce(p_active_task_ids,'[]'::jsonb))));
  return jsonb_build_object('protocol_version',1,'agent_status','ONLINE','server_time',now());
end $$;

create or replace function public.rx_cp_claim_task(p_agent_id text, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare picked tasks; lease uuid := gen_random_uuid(); begin
  perform rx_cp_reconcile_expired_leases();
  loop
    select t.* into picked from tasks t join profiles p on p.profile_id=t.profile_id
      where t.agent_id=p_agent_id and p.agent_id=p_agent_id and t.status='QUEUED' and t.cancellation_requested_at is null and t.scheduled_at<=now()
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

create or replace function public.rx_cp_transition_task(p_agent_id text,p_task_id text,p_lease_id uuid,p_next text,p_result jsonb default null,p_error jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare item tasks; begin
  select * into item from tasks where task_id=p_task_id and agent_id=p_agent_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if item.lease_id is distinct from p_lease_id or item.leased_by_agent_id<>p_agent_id then raise exception 'STALE_LEASE'; end if;
  if (item.status='CLAIMED' and p_next not in ('RUNNING','CANCELLED')) or (item.status='RUNNING' and p_next not in ('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN')) then raise exception 'ILLEGAL_TRANSITION'; end if;
  update tasks set status=p_next, started_at=case when p_next='RUNNING' then coalesce(started_at,now()) else started_at end, completed_at=case when p_next in ('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN') then now() else completed_at end, result=coalesce(p_result,result),error=coalesce(p_error,error),lease_expires_at=case when p_next in ('CLAIMED','RUNNING') then lease_expires_at else null end where task_id=p_task_id returning * into item;
  perform rx_cp_event('TASK_'||p_next,p_agent_id,p_task_id); return jsonb_build_object('protocol_version',1,'task',to_jsonb(item));
end $$;

create or replace function public.rx_cp_renew_lease(p_agent_id text,p_task_id text,p_lease_id uuid,p_lease_seconds integer,p_progress jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare expiry timestamptz; begin
  perform rx_cp_reconcile_expired_leases();
  update tasks set lease_expires_at=now()+make_interval(secs=>greatest(30,p_lease_seconds)),progress=coalesce(p_progress,progress) where task_id=p_task_id and agent_id=p_agent_id and lease_id=p_lease_id and status in ('CLAIMED','RUNNING') returning lease_expires_at into expiry;
  if not found then raise exception 'STALE_LEASE'; end if; perform rx_cp_event('LEASE_RENEWED',p_agent_id,p_task_id); return jsonb_build_object('protocol_version',1,'lease_expires_at',expiry);
end $$;

create or replace function public.rx_cp_request_cancellation(p_task_id text,p_resolver text default 'operator') returns jsonb language plpgsql security definer set search_path=public as $$
declare item tasks; begin select * into item from tasks where task_id=p_task_id for update; if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if item.status='QUEUED' then update tasks set status='CANCELLED',completed_at=now(),error=jsonb_build_object('code','CANCELLED_BY_CONTROL_PLANE') where task_id=p_task_id returning * into item;
  elsif item.status in ('CLAIMED','RUNNING') then update tasks set cancellation_requested_at=coalesce(cancellation_requested_at,now()) where task_id=p_task_id returning * into item; end if;
  perform rx_cp_event('CANCELLATION_REQUESTED',item.agent_id,p_task_id,jsonb_build_object('resolver',p_resolver)); return to_jsonb(item); end $$;

create or replace function public.rx_cp_resolve_outcome(p_task_id text,p_action text,p_resolver text,p_note text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare item tasks; next_status text; begin select * into item from tasks where task_id=p_task_id for update; if not found or item.status<>'OUTCOME_UNKNOWN' then raise exception 'OUTCOME_NOT_RESOLVABLE'; end if;
  if p_action='MARK_AS_COMPLETED' then next_status='COMPLETED'; elsif p_action='MARK_AS_FAILED' then next_status='FAILED'; elsif p_action='REQUEUE' then next_status='QUEUED'; else raise exception 'INVALID_OUTCOME_RESOLUTION'; end if;
  update tasks set status=next_status,outcome_resolved_at=now(),outcome_resolver=p_resolver,outcome_resolution=p_action,outcome_note=p_note,completed_at=case when next_status='QUEUED' then null else now() end,lease_id=null,leased_by_agent_id=null,lease_expires_at=null where task_id=p_task_id returning * into item;
  perform rx_cp_event('OUTCOME_RESOLVED',item.agent_id,p_task_id,jsonb_build_object('action',p_action,'resolver',p_resolver)); return to_jsonb(item); end $$;

create or replace function public.rx_cp_rotate_credential(p_agent_id text,p_new_secret text,p_overlap_seconds integer default 900) returns jsonb language plpgsql security definer set search_path=public as $$
declare new_id uuid; begin
  if length(coalesce(p_new_secret,'')) < 32 then raise exception 'INVALID_CREDENTIAL'; end if;
  update agent_credentials set retire_at=now()+make_interval(secs=>greatest(60,p_overlap_seconds)) where agent_id=p_agent_id and revoked_at is null and retire_at is null;
  insert into agent_credentials(agent_id,secret_hash) values(p_agent_id,crypt(p_new_secret,gen_salt('bf',12))) returning credential_id into new_id;
  perform rx_cp_event('AGENT_CREDENTIAL_ROTATED',p_agent_id,null,jsonb_build_object('credential_id',new_id)); return jsonb_build_object('credential_id',new_id,'overlap_seconds',greatest(60,p_overlap_seconds)); end $$;

alter table public.agents enable row level security; alter table public.agent_credentials enable row level security; alter table public.agent_enrollment_tokens enable row level security; alter table public.profiles enable row level security; alter table public.tasks enable row level security; alter table public.task_events enable row level security; alter table public.idempotency_requests enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
