const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const migration = path.join(root, 'supabase', 'migrations', '202609080004_application_transactional_rpcs.sql');
const sql = fs.readFileSync(migration, 'utf8');

test('Phase 4B-B limits RPCs to compound application writes with server-only execution', () => {
  for (const name of ['rx_app_write_campaign_with_posts', 'rx_app_write_schedule_with_campaigns', 'rx_app_set_post_media']) assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
  assert.match(sql, /app_write_idempotency/);
  assert.match(sql, /APP_REVISION_CONFLICT/);
  assert.match(sql, /APP_IDEMPOTENCY_KEY_CONFLICT/);
  assert.match(sql, /security invoker set search_path = pg_catalog, public/g);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/g);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/g);
  assert.doesNotMatch(sql, /rx_cp_/);
  assert.doesNotMatch(sql, /security definer/i);
});

test('local Postgres validates transactional RPC success, conflicts, retries, rollback, and grants', { skip: process.env.RX_RUN_LOCAL_SUPABASE_RPC_TESTS !== '1' }, () => {
  const container = 'supabase_db_rx-agent-control-plane';
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
    input: fs.readFileSync(path.join(root, 'supabase', 'tests', 'application_transactional_rpcs.sql')),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
