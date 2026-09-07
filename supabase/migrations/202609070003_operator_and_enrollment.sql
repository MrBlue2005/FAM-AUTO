create or replace function public.rx_cp_create_enrollment_token(p_token text,p_created_by text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare enrollment_id uuid; begin
 if p_expires_at<=now() or p_expires_at>now()+interval '24 hours' then raise exception 'INVALID_ENROLLMENT_EXPIRY'; end if;
 insert into agent_enrollment_tokens(token_hash,created_by,expires_at) values(digest(p_token,'sha256'),p_created_by,p_expires_at) returning enrollment_id into enrollment_id;
 perform rx_cp_event('ENROLLMENT_TOKEN_CREATED',null,null,jsonb_build_object('enrollment_id',enrollment_id,'created_by',p_created_by));
 return jsonb_build_object('enrollment_id',enrollment_id,'expires_at',p_expires_at); end $$;
create or replace function public.rx_cp_revoke_credential(p_credential_id uuid,p_resolver text)
returns void language plpgsql security definer set search_path=public as $$
declare target agent_credentials; begin select * into target from agent_credentials where credential_id=p_credential_id for update; if not found then raise exception 'CREDENTIAL_NOT_FOUND'; end if;
 update agent_credentials set revoked_at=now() where credential_id=p_credential_id; perform rx_cp_event('AGENT_CREDENTIAL_REVOKED',target.agent_id,null,jsonb_build_object('resolver',p_resolver,'credential_id',p_credential_id)); end $$;
