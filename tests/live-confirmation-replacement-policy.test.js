'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createCloudRemoteTaskRouter } = require('../server/cloud-remote-task-api');
const { issueLiveConfirmationToken } = require('../server/live-confirmation-token');
const { buildCampaignPreflightSnapshot } = require('../server/cloud-campaign-preflight');
const { LIVE_EXECUTION_MODE, LIVE_CAMPAIGN_EXECUTION_TASK_TYPE } = require('../app/local-agent/LiveCampaignExecutionExecutor');

const secret = 'test-live-confirmation-signing-secret-that-is-long-enough';
const now = Date.parse('2026-09-12T12:00:00.000Z');
const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const campaignId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';
const body = { kind: 'property', campaignId, day: 1, targetId, deviceId: 'agent-live', profileId: 'profile-live' };

function source() {
  return {
    campaign: { campaign_id: campaignId, legacy_id: 'synthetic-campaign', kind: 'property', active: true, revision: 1, app_campaign_posts: [{ post_id: 'post-1', day: 1, active: true, revision: 1, text: 'safe', app_post_media: [] }] },
    target: { target_id: targetId, display_name: 'Synthetic Target', target_url: 'https://example.invalid/synthetic', active: true },
  };
}

function legacyPayload() {
  const preflight = buildCampaignPreflightSnapshot({ campaign: source().campaign, target: source().target, postDay: 1 });
  return { ...preflight, mode: LIVE_EXECUTION_MODE, execution_config: { mode: LIVE_EXECUTION_MODE, publishEnabled: true, rehearsal: false }, publishEnabled: true };
}

function fixture(initialTasks = []) {
  const tasks = new Map(initialTasks.map((task) => [task.task_id, task]));
  const state = { liveEnabled: true, assigned: true, visible: true, ready: true, user: { role: 'USER', managedUserId: ownerA } };
  const store = {
    getManagedUserById: async (id) => ({ user_id: id, enabled: true, live_execution_enabled: state.liveEnabled }),
    listManagedUserExecutionTargets: async () => state.assigned ? [{ device_id: 'agent-live', profile_id: 'profile-live', enabled: true }] : [],
    getControlPlaneAgent: async (id) => id === 'agent-live' ? { agent_id: id, reported_status: 'ONLINE', last_seen_at: new Date(now).toISOString() } : null,
    getControlPlaneProfile: async (id) => id === 'profile-live' ? { profile_id: id, agent_id: 'agent-live', status: state.ready ? 'READY' : 'DISABLED' } : null,
    getCampaignPreflightSource: async ({ campaignId: c, targetId: t }) => c === campaignId && t === targetId ? source() : { campaign: null, target: null },
    getCampaignPreflightSourceForManagedUser: async ({ campaignId: c, targetId: t }) => state.visible && c === campaignId && t === targetId ? source() : { campaign: null, target: null },
    getControlPlaneTask: async (id) => tasks.get(id) || null,
    listControlPlaneTasks: async ({ deviceId, profileId, ownerUserId } = {}) => [...tasks.values()].filter((task) => (!deviceId || task.agent_id === deviceId) && (!profileId || task.profile_id === profileId) && (!ownerUserId || task.owner_user_id === ownerUserId)),
    getActiveControlPlaneTaskForProfile: async () => null,
    createControlPlaneTask: async (task) => { const row = { ...task, status: 'QUEUED', side_effect_state: 'NOT_ATTEMPTED' }; tasks.set(task.task_id, row); return row; },
  };
  return { state, store, tasks };
}

function token(owner = { role: 'USER', managedUserId: ownerA }, overrides = {}) {
  return issueLiveConfirmationToken({ signingSecret: secret, owner, campaignId, day: 1, targetId, deviceId: 'agent-live', profileId: 'profile-live', now, ...overrides }).token;
}

async function withRoute(memory, run) {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = memory.state.user; next(); }); app.use(createCloudRemoteTaskRouter({ store: memory.store, signingSecret: secret, liveExecutionEnabled: true, now: () => now }));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = async (confirmationToken, overrides = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/live-campaign-execution`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, confirmationToken, ...overrides }) });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ request, memory }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function historical({ status, sideEffectState = 'NOT_ATTEMPTED', taskId = `legacy-${status}-${sideEffectState}` }) {
  return { task_id: taskId, agent_id: 'agent-live', profile_id: 'profile-live', owner_user_id: ownerA, task_type: LIVE_CAMPAIGN_EXECUTION_TASK_TYPE, status, side_effect_state: sideEffectState, payload: legacyPayload() };
}

test('G5.5F-B replaces only a legacy FAILED/NOT_ATTEMPTED equivalent with a new confirmation-scoped task', async () => {
  const old = historical({ status: 'FAILED', taskId: 'live_execution_aa9e6b2f2cd1c8671f1005d50a986f56' }); const before = JSON.stringify(old); const memory = fixture([old]);
  await withRoute(memory, async ({ request, memory: state }) => {
    const result = await request(token()); assert.equal(result.status, 201); assert.notEqual(result.body.task.taskId, old.task_id); assert.equal(state.tasks.size, 2); assert.equal(JSON.stringify(old), before); assert.equal(result.body.task.taskId, [...state.tasks.keys()].find((id) => id !== old.task_id));
    const created = [...state.tasks.values()].find((task) => task.task_id !== old.task_id); assert.ok(memory.tasks.get(created.task_id).payload.confirmationId); assert.doesNotMatch(JSON.stringify(result.body), /confirmationId/);
  });
});

test('G5.5F-B replays the same confirmation idempotently, including a lost response', async () => {
  const memory = fixture(); const issued = token();
  await withRoute(memory, async ({ request, memory: state }) => {
    await request(issued); // Simulate a successfully inserted task whose response was lost.
    const replay = await request(issued); assert.equal(replay.status, 200); assert.equal(state.tasks.size, 1); assert.equal(replay.body.task.taskId, [...state.tasks.keys()][0]);
  });
});

test('G5.5F-B blocks fresh confirmations after active, attempted, unknown, or successful equivalents', async () => {
  const cases = [
    [historical({ status: 'QUEUED' }), 'LIVE_EXECUTION_ALREADY_ACTIVE'],
    [historical({ status: 'CLAIMED' }), 'LIVE_EXECUTION_ALREADY_ACTIVE'],
    [historical({ status: 'RUNNING' }), 'LIVE_EXECUTION_ALREADY_ACTIVE'],
    [historical({ status: 'FAILED', sideEffectState: 'ATTEMPT_STARTED' }), 'LIVE_REPLACEMENT_REQUIRES_MANUAL_REVIEW'],
    [historical({ status: 'OUTCOME_UNKNOWN', sideEffectState: 'ATTEMPT_STARTED' }), 'LIVE_REPLACEMENT_REQUIRES_MANUAL_REVIEW'],
    [historical({ status: 'COMPLETED', sideEffectState: 'VERIFIED_SUCCESS' }), 'LIVE_REPEAT_PUBLICATION_NOT_AUTHORIZED'],
  ];
  for (const [old, code] of cases) {
    const memory = fixture([old]); const before = JSON.stringify(old);
    await withRoute(memory, async ({ request, memory: state }) => { const result = await request(token()); assert.equal(result.status, 409); assert.equal(result.body.code, code); assert.equal(state.tasks.size, 1); assert.equal(JSON.stringify(old), before); });
  }
});

test('G5.5F-B rejects token tampering, expiry, cross-user use, and intent mismatch without inserts', async () => {
  const security = [
    (value) => `${value}x`,
    () => token(undefined, { now: now - (11 * 60 * 1000) }),
  ];
  for (const alter of security) {
    const memory = fixture(); await withRoute(memory, async ({ request, memory: state }) => { const result = await request(alter(token())); assert.equal(result.status, 400); assert.equal(state.tasks.size, 0); });
  }
  const cross = fixture(); cross.state.user = { role: 'USER', managedUserId: ownerB };
  await withRoute(cross, async ({ request, memory }) => { const result = await request(token()); assert.equal(result.status, 400); assert.equal(result.body.code, 'LIVE_CONFIRMATION_MISMATCH'); assert.equal(memory.tasks.size, 0); });
  for (const [field, value] of Object.entries({ campaignId: '55555555-5555-4555-8555-555555555555', day: 2, targetId: '66666666-6666-4666-8666-666666666666', deviceId: 'other-agent', profileId: 'other-profile' })) {
    const memory = fixture(); await withRoute(memory, async ({ request, memory: state }) => { const result = await request(token(), { [field]: value }); assert.notEqual(result.status, 201); assert.equal(state.tasks.size, 0); });
  }
});

test('G5.5F-B reauthorizes every live-create request after token issuance', async () => {
  for (const mutate of [
    (state) => { state.liveEnabled = false; },
    (state) => { state.visible = false; },
    (state) => { state.assigned = false; },
    (state) => { state.ready = false; },
  ]) {
    const memory = fixture(); const issued = token(); mutate(memory.state);
    await withRoute(memory, async ({ request, memory: state }) => { const result = await request(issued); assert.notEqual(result.status, 201); assert.equal(state.tasks.size, 0); });
  }
});

test('G5.5F-B requires a server confirmation token and ignores browser authority fields', async () => {
  const memory = fixture();
  await withRoute(memory, async ({ request, memory: state }) => {
    const missing = await request(undefined); assert.equal(missing.status, 400); assert.equal(missing.body.code, 'LIVE_CONFIRMATION_REQUIRED');
    const result = await request(token(), { confirmationId: 'browser-id', owner: 'attacker', taskType: 'DRY_RUN', executionMode: 'DRY_RUN', publishEnabled: false, side_effect_state: 'VERIFIED_SUCCESS', adapterMode: 'real', taskId: 'attacker-task' });
    assert.equal(result.status, 201); assert.equal(state.tasks.size, 1); const task = [...state.tasks.values()][0]; assert.equal(task.task_type, LIVE_CAMPAIGN_EXECUTION_TASK_TYPE); assert.equal(task.payload.publishEnabled, true); assert.notEqual(task.payload.confirmationId, 'browser-id');
  });
});
