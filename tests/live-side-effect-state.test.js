'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createLiveCampaignExecutionExecutor, LIVE_CAMPAIGN_EXECUTION_TASK_TYPE } = require('../app/local-agent/LiveCampaignExecutionExecutor');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609110001_live_side_effect_state.sql'), 'utf8');

test('G5.1 migration makes the side-effect marker durable, monotonic, and service-role-only', () => {
  assert.match(migration, /side_effect_state text not null default 'NOT_ATTEMPTED'/i);
  assert.match(migration, /side_effect_attempted_at timestamptz/i);
  assert.match(migration, /NOT_ATTEMPTED','ATTEMPT_STARTED','VERIFIED_SUCCESS/);
  assert.match(migration, /INVALID_SIDE_EFFECT_TRANSITION/);
  assert.match(migration, /TASK_SIDE_EFFECT_ATTEMPT_STARTED/);
  assert.match(migration, /revoke all on function public\.rx_cp_mark_side_effect_attempt_started[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.rx_cp_mark_side_effect_attempt_started[\s\S]*to service_role/i);
});

test('G5.1 claim, stale-lease, and terminal rules prohibit duplicate future-live publication', () => {
  assert.match(migration, /t\.side_effect_state='NOT_ATTEMPTED'/);
  assert.match(migration, /item\.side_effect_state = 'ATTEMPT_STARTED'[\s\S]*status='OUTCOME_UNKNOWN'/);
  assert.match(migration, /item\.task_type='LIVE_CAMPAIGN_EXECUTION'[\s\S]*LIVE_SUCCESS_NOT_VERIFIED/);
  assert.match(migration, /item\.side_effect_state='ATTEMPT_STARTED' and p_next in \('FAILED','CANCELLED'\) then p_next:='OUTCOME_UNKNOWN'/);
  assert.match(migration, /item\.status in \('COMPLETED','FAILED','CANCELLED','OUTCOME_UNKNOWN'\)[\s\S]*ILLEGAL_TRANSITION/);
});

test('G5.1 Local Agent live dispatch is fail-closed before browser launch', async () => {
  const execute = createLiveCampaignExecutionExecutor();
  await assert.rejects(() => execute({ task_type: LIVE_CAMPAIGN_EXECUTION_TASK_TYPE }), (error) => error.code === 'LIVE_EXECUTION_DISABLED');
  await assert.rejects(() => createLiveCampaignExecutionExecutor({ enabled: true })({ task_type: LIVE_CAMPAIGN_EXECUTION_TASK_TYPE }), (error) => error.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED');
  await assert.rejects(() => execute({ task_type: 'CAMPAIGN_PREFLIGHT' }), (error) => error.code === 'UNSUPPORTED_TASK_TYPE');
});

test('G5.1 keeps independent BFF, browser, and Local Agent live gates default-deny', () => {
  const bff = fs.readFileSync(path.join(__dirname, '..', 'server', 'hosted-bff.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard-v2', 'src', 'services', 'api.js'), 'utf8');
  const agent = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-http-agent.js'), 'utf8');
  assert.match(bff, /RX_BFF_LIVE_EXECUTION_ENABLED === 'true'/);
  assert.match(dashboard, /VITE_LIVE_EXECUTION_ENABLED === 'true'/);
  assert.match(agent, /RX_AGENT_LIVE_EXECUTION_ENABLED === 'true'/);
});
