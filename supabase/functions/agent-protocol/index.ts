import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERSION = 1;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'X-RX-Agent-Protocol': '1' } });
const error = (code: string, message: string, status = 400) => json({ protocol_version: VERSION, error: { code, message } }, status);
const hash = async (value: unknown) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return `\\x${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};
const uuid = () => crypto.randomUUID();
const safeOperator = (request: Request) => {
  const expected = Deno.env.get('RX_OPERATOR_API_TOKEN'); const received = request.headers.get('x-rx-operator-token') || '';
  if (!expected || expected.length !== received.length) return false;
  let difference = 0; for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
};

Deno.serve(async (request) => {
  const url = new URL(request.url); const route = url.pathname.replace(/^.*\/agent-protocol/, '') || '/';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
  const requestId = request.headers.get('x-rx-request-id') || '';
  const agentId = request.headers.get('x-rx-agent-id') || '';
  const secret = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error: rpcError } = await supabase.rpc(fn, args); if (rpcError) throw rpcError; return data; };
  try {
    if (route === '/v1/operator/enrollment-tokens' && request.method === 'POST') {
      if (!safeOperator(request)) return error('OPERATOR_UNAUTHORIZED', 'Operator authorization is required.', 401);
      const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const expiresAt = new Date(Date.now() + Math.min(Math.max(Number(body.ttl_seconds || 900), 60), 86400) * 1000).toISOString();
      const created = await rpc('rx_cp_create_enrollment_token', { p_token: token, p_created_by: String(body.resolver || 'operator'), p_expires_at: expiresAt });
      return json({ protocol_version: VERSION, enrollment_token: token, ...created }, 201);
    }
    if (route === '/v1/agents/enroll' && request.method === 'POST') {
      if (Number(body.protocol_version) !== VERSION) return error('UNSUPPORTED_PROTOCOL', 'Unsupported agent protocol version.', 426);
      const enrolled = await rpc('rx_cp_enroll_agent', { p_agent_id: body.agent_id, p_secret: secret, p_display_name: body.display_name || 'RX Local Agent', p_token: request.headers.get('x-rx-enrollment-token') || '', p_protocol_version: VERSION });
      return json(enrolled);
    }
    if (route.startsWith('/v1/operator/tasks/') && route.endsWith('/resolve') && request.method === 'POST') {
      if (!safeOperator(request)) return error('OPERATOR_UNAUTHORIZED', 'Operator authorization is required.', 401);
      const taskId = route.split('/')[4]; return json(await rpc('rx_cp_resolve_outcome', { p_task_id:taskId,p_action:body.action,p_resolver:String(body.resolver || 'operator'),p_note:body.note || null }));
    }
    if (route.startsWith('/v1/operator/tasks/') && route.endsWith('/cancel') && request.method === 'POST') {
      if (!safeOperator(request)) return error('OPERATOR_UNAUTHORIZED', 'Operator authorization is required.', 401);
      const taskId = route.split('/')[4]; return json(await rpc('rx_cp_request_cancellation', { p_task_id: taskId, p_resolver: String(body.resolver || 'operator') }));
    }
    if (route.startsWith('/v1/operator/tasks/') && request.method === 'GET') {
      if (!safeOperator(request)) return error('OPERATOR_UNAUTHORIZED', 'Operator authorization is required.', 401);
      const taskId = route.split('/')[4]; const { data, error: queryError } = await supabase.from('tasks').select('task_id,agent_id,profile_id,status,error,outcome_resolution,outcome_resolver,outcome_note,created_at,completed_at').eq('task_id', taskId).single();
      if (queryError) return error('TASK_NOT_FOUND', 'Task not found.', 404); return json({ protocol_version: VERSION, task: data });
    }
    const authenticated = await rpc('rx_cp_authenticate_agent', { p_agent_id: agentId, p_secret: secret });
    const authenticatedId = Array.isArray(authenticated) ? authenticated[0]?.agent_id : authenticated?.agent_id;
    if (!authenticatedId) return error('UNAUTHORIZED_AGENT', 'Invalid agent credential.', 401);
    if (Number(body.protocol_version ?? VERSION) !== VERSION) return error('UNSUPPORTED_PROTOCOL', 'Unsupported agent protocol version.', 426);
    if (!requestId && request.method !== 'GET') return error('IDEMPOTENCY_KEY_REQUIRED', 'X-RX-Request-Id is required.');
    const fingerprint = await hash({ route, body });
    if (route === '/v1/agent/heartbeat' && request.method === 'POST') return json(await rpc('rx_cp_idempotent_heartbeat', { p_agent_id: authenticatedId, p_request_id: requestId, p_request_hash: fingerprint, p_display_name: body.display_name, p_agent_status: body.agent_status, p_agent_version: body.agent_version, p_profiles: body.profiles || [], p_active_task_ids: body.active_task_ids || [] }));
    if (route === '/v1/agent/tasks/claim' && request.method === 'POST') return json(await rpc('rx_cp_idempotent_claim', { p_agent_id: authenticatedId, p_request_id: requestId, p_request_hash: fingerprint, p_lease_seconds: Number(body.lease_seconds || 120) }));
    const mediaMatch = route.match(/^\/v1\/agent\/tasks\/([^/]+)\/media-manifest$/);
    if (mediaMatch && request.method === 'POST') {
      const leaseId = request.headers.get('x-rx-lease-id'); const { data: task, error: taskError } = await supabase.from('tasks').select('payload,status').eq('task_id', mediaMatch[1]).eq('agent_id', authenticatedId).eq('lease_id', leaseId).eq('status', 'CLAIMED').single();
      if (taskError) return error('STALE_LEASE', 'Task lease is no longer valid.', 409);
      const snapshot = Array.isArray(task.payload?.media) ? task.payload.media : []; const requested = Array.isArray(body.media) ? body.media : [];
      if (requested.length !== snapshot.length || requested.some((id: unknown) => !snapshot.some((item: any) => item.media_id === id))) return error('MEDIA_NOT_IN_TASK', 'Requested media is not in the immutable task snapshot.', 403);
      const { data: media, error: mediaError } = await supabase.from('app_media_objects').select('media_id,bucket,object_key,sha256,byte_size,mime_type,state').in('media_id', requested).eq('state','READY');
      if (mediaError || media.length !== snapshot.length) return error('MEDIA_NOT_READY', 'Task media is unavailable.', 409);
      const result = await Promise.all(snapshot.sort((a: any,b: any) => a.ordinal-b.ordinal).map(async (item: any) => { const row = media.find((entry: any) => entry.media_id === item.media_id); if (!row || row.sha256 !== item.sha256 || Number(row.byte_size) !== Number(item.byte_size) || row.mime_type !== item.mime_type) throw new Error('MEDIA_SNAPSHOT_MISMATCH'); const { data, error: signError } = await supabase.storage.from(row.bucket).createSignedUrl(row.object_key, 120); if (signError) throw signError; const signed = new URL(data.signedUrl); return { media_id: row.media_id, sha256: row.sha256, byte_size: row.byte_size, mime_type: row.mime_type, ordinal: item.ordinal, download_url: `${signed.pathname}${signed.search}` }; }));
      return json({ protocol_version: VERSION, media: result });
    }
    const match = route.match(/^\/v1\/agent\/tasks\/([^/]+)\/(renew|running|completed|failed|outcome-unknown|cancelled|cancellation)$/);
    if (match) {
      const [, taskId, action] = match; const leaseId = request.headers.get('x-rx-lease-id');
      await rpc('rx_cp_reconcile_expired_leases', {});
      if (action === 'cancellation' && request.method === 'GET') { const { data, error: taskError } = await supabase.from('tasks').select('cancellation_requested_at').eq('task_id', taskId).eq('agent_id', authenticatedId).eq('lease_id', leaseId).single(); if (taskError) return error('STALE_LEASE', 'Lease is no longer valid.', 409); return json({ protocol_version: VERSION, cancellation_requested: Boolean(data.cancellation_requested_at), cancellation_requested_at: data.cancellation_requested_at }); }
      if (action === 'renew') return json(await rpc('rx_cp_idempotent_renew', { p_agent_id: authenticatedId,p_request_id:requestId,p_request_hash:fingerprint,p_task_id:taskId,p_lease_id:leaseId,p_lease_seconds:Number(body.lease_seconds||120),p_progress:body.progress||null }));
      const next = ({ running:'RUNNING', completed:'COMPLETED', failed:'FAILED', 'outcome-unknown':'OUTCOME_UNKNOWN', cancelled:'CANCELLED' } as Record<string,string>)[action];
      return json(await rpc('rx_cp_idempotent_transition', { p_agent_id:authenticatedId,p_request_id:requestId,p_request_hash:fingerprint,p_task_id:taskId,p_lease_id:leaseId,p_next:next,p_result:body.result||null,p_error:body.error||null }));
    }
    if (route === '/v1/agent/credentials/rotate' && request.method === 'POST') return json(await rpc('rx_cp_idempotent_rotate_credential', { p_agent_id: authenticatedId, p_request_id: requestId, p_request_hash: fingerprint, p_new_secret: body.new_secret, p_overlap_seconds: Number(body.overlap_seconds || 900) }));
    return error('NOT_FOUND', 'Protocol endpoint not found.', 404);
  } catch (caught) {
    const message = String((caught as Error).message || 'Control-plane failure.');
    const code = /UNAUTHORIZED|28000/.test(message) ? 'UNAUTHORIZED_AGENT' : /STALE_LEASE/.test(message) ? 'STALE_LEASE' : /IDEMPOTENCY_KEY_CONFLICT/.test(message) ? 'IDEMPOTENCY_KEY_CONFLICT' : /PROFILE_OWNERSHIP/.test(message) ? 'PROFILE_OWNERSHIP_CONFLICT' : 'CONTROL_PLANE_ERROR';
    return error(code, 'Control-plane request was rejected.', code === 'UNAUTHORIZED_AGENT' ? 401 : 409);
  }
});
