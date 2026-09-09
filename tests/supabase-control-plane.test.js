const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalAgentCredentials } = require('../app/local-agent/LocalAgentCredentials');

const root = path.join(__dirname, '..');
function migrationText() { return fs.readdirSync(path.join(root, 'supabase', 'migrations')).sort().map((name) => fs.readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8')).join('\n'); }

test('Supabase migrations define the Protocol v1 schema, RLS, atomic claim, lease safety, and durable idempotency', () => {
  const sql = migrationText();
  for (const table of ['agents', 'agent_credentials', 'agent_enrollment_tokens', 'profiles', 'tasks', 'task_events', 'idempotency_requests']) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql, /tasks_one_active_profile_idx/); assert.match(sql, /for update skip locked/i); assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /not exists \(select 1 from tasks active/);
  assert.match(sql, /rx_cp_reconcile_expired_leases/); assert.match(sql, /OUTCOME_UNKNOWN/); assert.match(sql, /IDEMPOTENCY_KEY_CONFLICT/); assert.match(sql, /rx_cp_idempotent_rotate_credential/);
  assert.match(sql, /rx_cp_transition_task[\s\S]*perform rx_cp_reconcile_expired_leases/);
  assert.match(sql, /extensions\.digest/); assert.match(sql, /extensions\.crypt/);
  assert.match(sql, /update agent_credentials c set last_used_at/);
  assert.match(sql, /if item\.status in \('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN'\) then return to_jsonb\(item\)/);
  assert.match(sql, /if item\.status = p_next then return jsonb_build_object\('protocol_version',1,'task',to_jsonb\(item\)\); end if;[\s\S]*raise exception 'ILLEGAL_TRANSITION'/);
  assert.match(sql, /enable row level security/g); assert.match(sql, /revoke all on all tables in schema public from anon, authenticated/);
});

test('Windows credential storage migrates a legacy plaintext secret only after DPAPI protection succeeds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-dpapi-')); const filePath = path.join(directory, 'credentials.json');
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, agent_id: 'agent_test', agent_secret: 'legacy-secret', created_at: '2026-09-07T00:00:00.000Z' }));
  const storage = new LocalAgentCredentials({ filePath, platform: 'win32', dpapi: (mode, value) => mode === 'protect' ? `protected:${value}` : value.replace(/^protected:/, '') });
  const loaded = storage.ensure('agent_test'); const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(loaded.agent_secret, 'legacy-secret'); assert.equal(persisted.protection, 'dpapi-current-user'); assert.equal('agent_secret' in persisted, false);
  const nextSecret = storage.stageRotation('agent_test', 'new-secret'); assert.equal(nextSecret, 'new-secret'); assert.equal(storage.load().agent_secret, 'legacy-secret');
  assert.equal(storage.commitRotation().agent_secret, 'new-secret');
});

test('Windows DPAPI invocation uses encoded PowerShell so secret syntax is not shell-expanded', () => {
  const source = fs.readFileSync(path.join(root, 'app', 'local-agent', 'LocalAgentCredentials.js'), 'utf8');
  assert.match(source, /-EncodedCommand/); assert.match(source, /utf16le/); assert.match(source, /Add-Type -AssemblyName System\.Security/);
});

test('Supabase Edge Function exposes only the versioned Protocol v1 agent and operator surface', () => {
  const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'agent-protocol', 'index.ts'), 'utf8');
  for (const route of ['/v1/agents/enroll', '/v1/agent/heartbeat', '/v1/agent/tasks/claim', '/v1/agent/credentials/rotate', '/resolve']) assert.match(edge, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/); assert.match(edge, /rx_cp_idempotent_rotate_credential/); assert.doesNotMatch(edge, /rejectUnauthorized/);
  assert.match(edge, /await rpc\('rx_cp_reconcile_expired_leases', \{\}\)/);
  assert.ok(edge.indexOf("route.startsWith('/v1/operator/tasks/')") < edge.indexOf("rx_cp_authenticate_agent"), 'operator endpoints must not require agent credentials');
});

test('Phase 4B application foundation is separate, private, and models immutable media', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202609080003_application_data_foundation.sql'), 'utf8');
  for (const table of ['app_campaigns', 'app_campaign_posts', 'app_media_objects', 'app_post_media', 'app_targets', 'app_campaign_folders', 'app_schedule_folders', 'app_schedules', 'app_schedule_campaigns', 'app_execution_runs', 'app_posting_results']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /fam-app-media/); assert.match(sql, /public = false/); assert.match(sql, /rx_app_media_object_immutable/);
  assert.match(sql, /APP_MEDIA_OBJECT_IMMUTABLE/); assert.match(sql, /revoke all on table storage\.objects, storage\.buckets from anon, authenticated/);
  assert.match(sql, /references public\.tasks\(task_id\)/);
});

test('Phase 4B-B transactional RPC foundation is scoped to compound application writes', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202609080004_application_transactional_rpcs.sql'), 'utf8');
  for (const rpc of ['rx_app_write_campaign_with_posts', 'rx_app_write_schedule_with_campaigns', 'rx_app_set_post_media']) assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`));
  assert.match(sql, /app_write_idempotency/); assert.match(sql, /APP_REVISION_CONFLICT/); assert.match(sql, /APP_IDEMPOTENCY_KEY_CONFLICT/);
  assert.match(sql, /security invoker set search_path = pg_catalog, public/g);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/g);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/g);
  assert.doesNotMatch(sql, /rx_cp_|security definer/i);
});

test('hosted managed users are private, RLS-protected, and session-versioned', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202609090001_hosted_managed_users.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.hosted_users/);
  for (const field of ['password_scrypt', 'username_normalized', 'session_version', 'enabled', 'last_login_at']) assert.match(sql, new RegExp(field));
  assert.match(sql, /alter table public\.hosted_users enable row level security/);
  assert.match(sql, /revoke all on table public\.hosted_users from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.hosted_users to service_role/);
});

test('Phase G1 task ownership migration is additive, immutable, and remains service-role-only', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202609100001_task_owner_user.sql'), 'utf8');
  assert.match(sql, /owner_user_id uuid references public\.hosted_users\(user_id\) on delete restrict/i);
  assert.match(sql, /tasks_owner_history_idx/); assert.match(sql, /where owner_user_id is not null/i);
  assert.match(sql, /rx_cp_task_owner_immutable/); assert.match(sql, /TASK_OWNER_IMMUTABLE/);
  assert.doesNotMatch(sql, /grant .* to (anon|authenticated)/i);
});
