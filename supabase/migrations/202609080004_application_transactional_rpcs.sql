-- Phase 4B-B: server-only transactions for the three application writes that span tables.
-- This is deliberately separate from Protocol V1/control-plane state.

create table if not exists public.app_write_idempotency (
  operation text not null check (operation in ('campaign_with_posts', 'schedule_with_campaigns', 'post_media_set')),
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (operation, request_id)
);
alter table public.app_write_idempotency enable row level security;
revoke all on table public.app_write_idempotency from public, anon, authenticated;
grant select, insert, update, delete on table public.app_write_idempotency to service_role;

create or replace function public.rx_app_write_campaign_with_posts(
  p_campaign jsonb, p_posts jsonb, p_expected_revision integer, p_request_id uuid, p_request_hash text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_campaign public.app_campaigns%rowtype; v_response jsonb; v_saved_hash text;
begin
  if jsonb_typeof(p_campaign) <> 'object' or jsonb_typeof(p_posts) <> 'array' then raise exception 'APP_INVALID_INPUT'; end if;
  insert into public.app_write_idempotency(operation, request_id, request_hash)
  values ('campaign_with_posts', p_request_id, p_request_hash) on conflict do nothing returning response into v_response;
  if not found then
    select request_hash, response into v_saved_hash, v_response from public.app_write_idempotency where operation = 'campaign_with_posts' and request_id = p_request_id;
    if v_saved_hash is distinct from p_request_hash then raise exception 'APP_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505'; end if;
    if v_response is null then raise exception 'APP_IDEMPOTENCY_IN_PROGRESS' using errcode = '55P03'; end if;
    return v_response;
  end if;
  select * into v_campaign from public.app_campaigns
    where kind = p_campaign->>'kind' and legacy_id = p_campaign->>'legacy_id' for update;
  if found then
    if v_campaign.revision <> p_expected_revision then raise exception 'APP_REVISION_CONFLICT' using errcode = '40001'; end if;
    update public.app_campaigns set title = p_campaign->>'title', active = coalesce((p_campaign->>'active')::boolean, true),
      folder_id = nullif(p_campaign->>'folder_id','')::uuid, profile_id = nullif(p_campaign->>'profile_id',''),
      data = coalesce(p_campaign->'data','{}'::jsonb), archived_at = nullif(p_campaign->>'archived_at','')::timestamptz,
      revision = revision + 1, updated_at = now() where campaign_id = v_campaign.campaign_id returning * into v_campaign;
  else
    if p_expected_revision <> 0 then raise exception 'APP_REVISION_CONFLICT' using errcode = '40001'; end if;
    insert into public.app_campaigns(legacy_id, kind, title, active, folder_id, profile_id, data, archived_at)
    values (p_campaign->>'legacy_id', p_campaign->>'kind', p_campaign->>'title', coalesce((p_campaign->>'active')::boolean, true),
      nullif(p_campaign->>'folder_id','')::uuid, nullif(p_campaign->>'profile_id',''), coalesce(p_campaign->'data','{}'::jsonb), nullif(p_campaign->>'archived_at','')::timestamptz)
    returning * into v_campaign;
  end if;
  -- A complete post snapshot is intentionally applied as a set; retained days keep their post identity/media.
  delete from public.app_campaign_posts p where p.campaign_id = v_campaign.campaign_id and not exists
    (select 1 from jsonb_array_elements(p_posts) item where (item->>'day')::integer = p.day);
  insert into public.app_campaign_posts(campaign_id, day, text, active, data)
    select v_campaign.campaign_id, (item->>'day')::integer, item->>'text', coalesce((item->>'active')::boolean, true), coalesce(item->'data','{}'::jsonb)
    from jsonb_array_elements(p_posts) item
  on conflict (campaign_id, day) do update set text = excluded.text, active = excluded.active, data = excluded.data,
    revision = case when (public.app_campaign_posts.text, public.app_campaign_posts.active, public.app_campaign_posts.data)
                    is distinct from (excluded.text, excluded.active, excluded.data) then public.app_campaign_posts.revision + 1 else public.app_campaign_posts.revision end,
    updated_at = now();
  select jsonb_build_object('campaign', to_jsonb(v_campaign), 'posts', coalesce(jsonb_agg(to_jsonb(p) order by p.day), '[]'::jsonb))
    into v_response from public.app_campaign_posts p where p.campaign_id = v_campaign.campaign_id;
  update public.app_write_idempotency set response = v_response where operation = 'campaign_with_posts' and request_id = p_request_id;
  return v_response;
end $$;

create or replace function public.rx_app_write_schedule_with_campaigns(
  p_schedule jsonb, p_campaign_ids uuid[], p_expected_revision integer, p_request_id uuid, p_request_hash text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_schedule public.app_schedules%rowtype; v_response jsonb; v_saved_hash text;
begin
  if jsonb_typeof(p_schedule) <> 'object' then raise exception 'APP_INVALID_INPUT'; end if;
  insert into public.app_write_idempotency(operation, request_id, request_hash) values ('schedule_with_campaigns', p_request_id, p_request_hash)
    on conflict do nothing returning response into v_response;
  if not found then
    select request_hash, response into v_saved_hash, v_response from public.app_write_idempotency where operation = 'schedule_with_campaigns' and request_id = p_request_id;
    if v_saved_hash is distinct from p_request_hash then raise exception 'APP_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505'; end if;
    if v_response is null then raise exception 'APP_IDEMPOTENCY_IN_PROGRESS' using errcode = '55P03'; end if;
    return v_response;
  end if;
  select * into v_schedule from public.app_schedules where legacy_id = p_schedule->>'legacy_id' for update;
  if found then
    if v_schedule.revision <> p_expected_revision then raise exception 'APP_REVISION_CONFLICT' using errcode = '40001'; end if;
    update public.app_schedules set name = p_schedule->>'name', enabled = coalesce((p_schedule->>'enabled')::boolean, true),
      folder_id = nullif(p_schedule->>'folder_id','')::uuid, profile_id = nullif(p_schedule->>'profile_id',''), schedule = p_schedule->'schedule',
      revision = revision + 1, updated_at = now() where schedule_id = v_schedule.schedule_id returning * into v_schedule;
  else
    if p_expected_revision <> 0 then raise exception 'APP_REVISION_CONFLICT' using errcode = '40001'; end if;
    insert into public.app_schedules(legacy_id, name, enabled, folder_id, profile_id, schedule)
      values (p_schedule->>'legacy_id', p_schedule->>'name', coalesce((p_schedule->>'enabled')::boolean, true),
        nullif(p_schedule->>'folder_id','')::uuid, nullif(p_schedule->>'profile_id',''), p_schedule->'schedule') returning * into v_schedule;
  end if;
  delete from public.app_schedule_campaigns where schedule_id = v_schedule.schedule_id;
  insert into public.app_schedule_campaigns(schedule_id, campaign_id, ordinal)
    select v_schedule.schedule_id, campaign_id, ordinal - 1 from unnest(coalesce(p_campaign_ids, array[]::uuid[])) with ordinality as links(campaign_id, ordinal);
  select jsonb_build_object('schedule', to_jsonb(v_schedule), 'campaign_ids', coalesce(jsonb_agg(link.campaign_id order by link.ordinal), '[]'::jsonb))
    into v_response from public.app_schedule_campaigns link where link.schedule_id = v_schedule.schedule_id;
  update public.app_write_idempotency set response = v_response where operation = 'schedule_with_campaigns' and request_id = p_request_id;
  return v_response;
end $$;

create or replace function public.rx_app_set_post_media(
  p_post_id uuid, p_media_ids uuid[], p_expected_revision integer, p_request_id uuid, p_request_hash text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_post public.app_campaign_posts%rowtype; v_response jsonb; v_saved_hash text; v_ready_count integer;
begin
  insert into public.app_write_idempotency(operation, request_id, request_hash) values ('post_media_set', p_request_id, p_request_hash)
    on conflict do nothing returning response into v_response;
  if not found then
    select request_hash, response into v_saved_hash, v_response from public.app_write_idempotency where operation = 'post_media_set' and request_id = p_request_id;
    if v_saved_hash is distinct from p_request_hash then raise exception 'APP_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505'; end if;
    if v_response is null then raise exception 'APP_IDEMPOTENCY_IN_PROGRESS' using errcode = '55P03'; end if;
    return v_response;
  end if;
  select * into v_post from public.app_campaign_posts where post_id = p_post_id for update;
  if not found or v_post.revision <> p_expected_revision then raise exception 'APP_REVISION_CONFLICT' using errcode = '40001'; end if;
  select count(*) into v_ready_count from public.app_media_objects where media_id = any(coalesce(p_media_ids, array[]::uuid[])) and state = 'READY';
  if v_ready_count <> cardinality(coalesce(p_media_ids, array[]::uuid[])) then raise exception 'APP_MEDIA_NOT_READY'; end if;
  update public.app_campaign_posts set revision = revision + 1, updated_at = now() where post_id = p_post_id returning * into v_post;
  delete from public.app_post_media where post_id = p_post_id;
  insert into public.app_post_media(post_id, media_id, ordinal)
    select p_post_id, media_id, ordinal - 1 from unnest(coalesce(p_media_ids, array[]::uuid[])) with ordinality as links(media_id, ordinal);
  select jsonb_build_object('post', to_jsonb(v_post), 'media_ids', coalesce(jsonb_agg(link.media_id order by link.ordinal), '[]'::jsonb))
    into v_response from public.app_post_media link where link.post_id = p_post_id;
  update public.app_write_idempotency set response = v_response where operation = 'post_media_set' and request_id = p_request_id;
  return v_response;
end $$;

revoke all on function public.rx_app_write_campaign_with_posts(jsonb, jsonb, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.rx_app_write_schedule_with_campaigns(jsonb, uuid[], integer, uuid, text) from public, anon, authenticated;
revoke all on function public.rx_app_set_post_media(uuid, uuid[], integer, uuid, text) from public, anon, authenticated;
grant execute on function public.rx_app_write_campaign_with_posts(jsonb, jsonb, integer, uuid, text) to service_role;
grant execute on function public.rx_app_write_schedule_with_campaigns(jsonb, uuid[], integer, uuid, text) to service_role;
grant execute on function public.rx_app_set_post_media(uuid, uuid[], integer, uuid, text) to service_role;
