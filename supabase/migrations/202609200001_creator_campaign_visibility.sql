-- A managed USER's new campaign and its creator visibility are one transaction.
-- The browser cannot call this service-role-only RPC or choose the creator UUID.

alter table public.app_write_idempotency
  drop constraint if exists app_write_idempotency_operation_check;
alter table public.app_write_idempotency
  add constraint app_write_idempotency_operation_check
  check (operation in ('campaign_with_posts', 'campaign_with_posts_for_creator', 'schedule_with_campaigns', 'post_media_set'));

create or replace function public.rx_app_create_campaign_with_posts_for_creator(
  p_campaign jsonb,
  p_posts jsonb,
  p_creator_user_id uuid,
  p_request_id uuid,
  p_request_hash text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_campaign public.app_campaigns%rowtype;
  v_response jsonb;
  v_saved_hash text;
begin
  if jsonb_typeof(p_campaign) <> 'object' or jsonb_typeof(p_posts) <> 'array' or p_creator_user_id is null then
    raise exception 'APP_INVALID_INPUT';
  end if;

  insert into public.app_write_idempotency(operation, request_id, request_hash)
  values ('campaign_with_posts_for_creator', p_request_id, p_request_hash)
  on conflict do nothing returning response into v_response;
  if not found then
    select request_hash, response into v_saved_hash, v_response
      from public.app_write_idempotency
      where operation = 'campaign_with_posts_for_creator' and request_id = p_request_id;
    if v_saved_hash is distinct from p_request_hash then
      raise exception 'APP_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505';
    end if;
    if v_response is null then raise exception 'APP_IDEMPOTENCY_IN_PROGRESS' using errcode = '55P03'; end if;
    return v_response;
  end if;

  -- This boundary is creation-only. It cannot be used to self-assign an existing campaign.
  if exists (
    select 1 from public.app_campaigns
    where kind = p_campaign->>'kind' and legacy_id = p_campaign->>'legacy_id'
  ) then
    raise exception 'APP_CREATOR_CAMPAIGN_MUST_BE_NEW';
  end if;

  insert into public.app_campaigns(legacy_id, kind, title, active, folder_id, profile_id, data, archived_at)
  values (
    p_campaign->>'legacy_id', p_campaign->>'kind', p_campaign->>'title',
    coalesce((p_campaign->>'active')::boolean, true), nullif(p_campaign->>'folder_id','')::uuid,
    nullif(p_campaign->>'profile_id',''), coalesce(p_campaign->'data','{}'::jsonb),
    nullif(p_campaign->>'archived_at','')::timestamptz
  ) returning * into v_campaign;

  insert into public.app_campaign_posts(campaign_id, day, text, active, data)
    select v_campaign.campaign_id, (item->>'day')::integer, item->>'text',
      coalesce((item->>'active')::boolean, true), coalesce(item->'data','{}'::jsonb)
    from jsonb_array_elements(p_posts) item;

  insert into public.hosted_user_campaign_visibility(user_id, campaign_id, enabled)
  values (p_creator_user_id, v_campaign.campaign_id, true)
  on conflict (user_id, campaign_id) do nothing;

  select jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'posts', coalesce(jsonb_agg(to_jsonb(p) order by p.day), '[]'::jsonb)
  ) into v_response
  from public.app_campaign_posts p where p.campaign_id = v_campaign.campaign_id;

  update public.app_write_idempotency set response = v_response
    where operation = 'campaign_with_posts_for_creator' and request_id = p_request_id;
  return v_response;
end $$;

revoke all on function public.rx_app_create_campaign_with_posts_for_creator(jsonb, jsonb, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.rx_app_create_campaign_with_posts_for_creator(jsonb, jsonb, uuid, uuid, text)
  to service_role;
