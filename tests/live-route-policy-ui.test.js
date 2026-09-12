'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { mapHistoryTask } = require('../server/cloud-dashboard-read-api');
const { createCloudRemoteTaskRouter } = require('../server/cloud-remote-task-api');
const { issueLiveConfirmationToken } = require('../server/live-confirmation-token');
const { createRehearsalLivePublisherAdapter } = require('../app/local-agent/RehearsalLivePublisherAdapter');
const { createLiveCampaignExecutionExecutor } = require('../app/local-agent/LiveCampaignExecutionExecutor');

const source = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const campaignId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const signingSecret = 'test-live-confirmation-signing-secret-that-is-long-enough';

test('G5.4 live history fixtures keep status and durable side-effect states distinct', async () => {
  const history = await import('../dashboard-v2/src/services/executionHistory.js');
  const fixtures = [
    ['QUEUED', 'NOT_ATTEMPTED', 'În așteptare', 'Publicarea nu a fost inițiată'],
    ['FAILED', 'NOT_ATTEMPTED', 'Eșuat', 'Publicarea nu a fost inițiată'],
    ['OUTCOME_UNKNOWN', 'ATTEMPT_STARTED', 'Rezultat necunoscut', 'Publicarea a fost inițiată'],
    ['COMPLETED', 'VERIFIED_SUCCESS', 'Finalizat', 'Publicare confirmată'],
  ];
  for (const [status, state, statusLabel, stateLabel] of fixtures) {
    assert.equal(history.executionStatusView(status).label, statusLabel);
    assert.equal(history.sideEffectStateLabel(state), stateLabel);
  }
  assert.equal(history.executionTypeLabel('LIVE_CAMPAIGN_EXECUTION'), 'Publicare Facebook');
  assert.notEqual(history.executionTypeLabel('LIVE_CAMPAIGN_EXECUTION'), history.executionTypeLabel('CAMPAIGN_PREFLIGHT'));
  assert.notEqual(history.executionTypeLabel('LIVE_CAMPAIGN_EXECUTION'), history.executionTypeLabel('CONTROLLED_CAMPAIGN_EXECUTION'));
});

test('G5.4 LIVE failed and unknown copy is mutually exclusive and never offers retry', async () => {
  const history = await import('../dashboard-v2/src/services/executionHistory.js');
  const unknown = history.failureMessage({ taskType: 'LIVE_CAMPAIGN_EXECUTION', status: 'OUTCOME_UNKNOWN', sideEffectState: 'ATTEMPT_STARTED' });
  const failed = history.failureMessage({ taskType: 'LIVE_CAMPAIGN_EXECUTION', status: 'FAILED', sideEffectState: 'NOT_ATTEMPTED' });
  assert.match(unknown, /Verifică manual pe Facebook/i);
  assert.doesNotMatch(unknown, /confirmată|reușit înainte/i);
  assert.match(failed, /înainte ca publicarea să fie inițiată/i);
  assert.doesNotMatch(failed, /Verifică manual pe Facebook/i);
  const page = source('dashboard-v2', 'src', 'pages', 'Executions.jsx');
  assert.match(page, /Necesită verificare manuală/);
  assert.doesNotMatch(page, /\b(Retry|Reîncearcă|Resubmit|Retrimite)\b/i);
});

test('G5.4 history DTO exposes only allowlisted live side-effect state', () => {
  const task = {
    task_id: 'live_execution_safe', task_type: 'LIVE_CAMPAIGN_EXECUTION', status: 'OUTCOME_UNKNOWN',
    agent_id: 'agent-safe', profile_id: 'profile-safe', attempt: 1, side_effect_state: 'ATTEMPT_STARTED',
    payload: { cookies: 'no', local_profile_path: 'C:/private', signedUrl: 'https://secret' },
    lease_id: 'lease-secret', lease_token: 'token-secret', error: { message: 'raw playwright error', stack: 'secret' },
    result: { profilePath: 'C:/private', facebookCredentials: 'no', signedUrl: 'https://secret', blockers: ['SAFE_BLOCKER'] },
  };
  const mapped = mapHistoryTask(task, new Map(), new Map());
  assert.equal(mapped.sideEffectState, 'ATTEMPT_STARTED');
  assert.equal(mapped.taskType, 'LIVE_CAMPAIGN_EXECUTION');
  const serialized = JSON.stringify(mapped).toLowerCase();
  for (const forbidden of ['payload', 'lease', 'token-secret', 'profilepath', 'cookies', 'credential', 'signedurl', 'playwright', 'service_role', 'operator']) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

function liveStore({ userEnabled = true, liveEnabled = true, assigned = true } = {}) {
  const created = [];
  const sourceRow = { campaign: { campaign_id: campaignId, legacy_id: 'legacy', kind: 'property', active: true, revision: 1, app_campaign_posts: [{ post_id: 'post', day: 1, active: true, revision: 1, text: 'safe', app_post_media: [] }] }, target: { target_id: targetId, display_name: 'safe', target_url: 'https://example.test', active: true } };
  return { created,
    getManagedUserById: async () => ({ user_id: ownerId, enabled: userEnabled, live_execution_enabled: liveEnabled }),
    listManagedUserExecutionTargets: async () => assigned ? [{ device_id: 'agent-live', profile_id: 'profile-live', enabled: true }] : [],
    getControlPlaneAgent: async (id) => id === 'agent-live' ? { agent_id: id, reported_status: 'ONLINE', last_seen_at: new Date().toISOString() } : null,
    getControlPlaneProfile: async (id) => id === 'profile-live' ? { profile_id: id, agent_id: 'agent-live', status: 'READY' } : null,
    getCampaignPreflightSource: async () => sourceRow, getCampaignPreflightSourceForManagedUser: async () => sourceRow,
    getActiveControlPlaneTaskForProfile: async () => null, listControlPlaneTasks: async () => created,
    getControlPlaneTask: async (id) => created.find((task) => task.task_id === id) || null,
    createControlPlaneTask: async (task) => { const row = { ...task, status: 'QUEUED' }; created.push(row); return row; },
  };
}

async function liveRequest(options, body = {}) {
  const store = liveStore(options); const app = express(); app.use(express.json()); const user = options?.admin ? { role: 'ADMIN', username: 'admin' } : { role: 'USER', managedUserId: ownerId }; app.use((req, _res, next) => { req.user = user; next(); }); app.use(createCloudRemoteTaskRouter({ store, liveExecutionEnabled: options?.gate === true, liveExecutionRehearsal: options?.rehearsal === true, signingSecret }));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { const reviewed = { kind: 'property', campaignId, targetId, day: 1, deviceId: 'agent-live', profileId: 'profile-live' }; const confirmationToken = issueLiveConfirmationToken({ signingSecret, owner: user.role === 'ADMIN' ? { role: 'ADMIN', username: user.username } : { role: 'USER', managedUserId: ownerId }, campaignId, targetId, day: 1, deviceId: 'agent-live', profileId: 'profile-live' }).token; const response = await fetch(`http://127.0.0.1:${server.address().port}/live-campaign-execution`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...reviewed, confirmationToken, ...body }) }); return { status: response.status, body: await response.json(), created: store.created }; } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('G5.4 live route is gate-, policy-, assignment-, canonical-ID-, and server-authority-bound', async () => {
  assert.equal((await liveRequest({ gate: false })).status, 404);
  assert.equal((await liveRequest({ gate: true, liveEnabled: false })).status, 403);
  assert.equal((await liveRequest({ gate: true, assigned: false })).status, 403);
  assert.equal((await liveRequest({ gate: true }, { campaignId: 'legacy' })).status, 400);
  const accepted = await liveRequest({ gate: true, rehearsal: true }, { publishEnabled: false, taskType: 'DRY_RUN', ownerUserId: 'attacker', sideEffectState: 'VERIFIED_SUCCESS' });
  assert.equal(accepted.status, 201); assert.equal(accepted.created.length, 1);
  const task = accepted.created[0];
  assert.equal(task.owner_user_id, ownerId); assert.equal(task.task_type, 'LIVE_CAMPAIGN_EXECUTION'); assert.equal(task.payload.publishEnabled, true); assert.equal(task.payload.execution_config.publishEnabled, true); assert.equal(task.payload.execution_config.rehearsal, true);
  assert.equal((await liveRequest({ gate: true, admin: true })).status, 201);
});

test('G5.4 UI keeps separate ADMIN policies and a confirmation-only managed USER live request', () => {
  const users = source('dashboard-v2', 'src', 'pages', 'Users.jsx');
  const executions = source('dashboard-v2', 'src', 'pages', 'Executions.jsx');
  const api = source('dashboard-v2', 'src', 'services', 'api.js');
  assert.match(users, /<h3>Execuție controlată<\/h3>/); assert.match(users, /<h3>Publicare Facebook<\/h3>/);
  assert.match(users, /updateManagedUserControlledExecutionPolicy/); assert.match(users, /updateManagedUserLiveExecutionPolicy\(user\.userId, \{ enabled: !user\.liveExecutionEnabled \}\)/);
  assert.match(api, /live-execution-policy/); assert.match(api, /JSON\.stringify\(\{ enabled \}\)/);
  assert.match(executions, /setLiveConfirm\(true\)/); assert.match(executions, /role="dialog"/); assert.match(executions, /Confirm publicarea/);
  assert.match(executions, /if \(livePending\) return/); assert.match(executions, /createLiveCampaignExecutionTask\(\{ \.\.\.preflight, day: Number\(preflight\.day\) \}\)/);
  assert.doesNotMatch(executions, /publishEnabled\s*:/); assert.doesNotMatch(executions, /taskType\s*:/); assert.doesNotMatch(executions, /owner(UserId)?\s*:/); assert.doesNotMatch(executions, /sideEffectState\s*:/);
});

test('G5.5 rehearsal publisher is browser-free, server-snapshot-only, and marks its result as simulated', async () => {
  const events = []; const publisher = createRehearsalLivePublisherAdapter({ onEvent: (event) => events.push(event) });
  const task = { task_id: 'rehearsal', task_type: 'LIVE_CAMPAIGN_EXECUTION', agent_id: 'agent', profile_id: 'profile', side_effect_state: 'NOT_ATTEMPTED', payload: { mode: 'LIVE_EXECUTION', publishEnabled: true, execution_config: { publishEnabled: true, rehearsal: true }, campaign: { campaign_id: 'campaign' }, post: { post_id: 'post', day: 1 }, target: { target_id: 'target', url: 'https://example.test' }, media: [], local_media_paths: [] } };
  const calls = []; const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher });
  const result = await execute(task, { transport: { agentId: 'agent', renewLease: async () => calls.push('LEASE'), markSideEffectAttemptStarted: async () => calls.push('ATTEMPT_STARTED'), markSideEffectVerifiedSuccess: async () => calls.push('VERIFIED_SUCCESS') } });
  assert.deepEqual(publisher.getCounters(), { prepare: 1, verifyReady: 1, submit: 1, verifyOutcome: 1 });
  assert.deepEqual(calls, ['LEASE', 'ATTEMPT_STARTED', 'VERIFIED_SUCCESS']); assert.equal(result.executionRehearsal, true); assert.equal(result.sideEffectState, 'VERIFIED_SUCCESS');
  assert.deepEqual(events.map((event) => event.phase), ['PREPARE', 'VERIFY_READY', 'SUBMIT', 'VERIFY_OUTCOME']);
  await assert.rejects(publisher.prepare({ payload: { execution_config: { rehearsal: false } } }), { code: 'LIVE_REHEARSAL_SNAPSHOT_REQUIRED' });
  const script = source('scripts', 'run-http-agent.js'); assert.match(script, /LIVE_PUBLISHER_MODE_CONFLICT/); assert.match(script, /createRehearsalLivePublisherAdapter/);
});
