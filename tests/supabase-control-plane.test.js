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
