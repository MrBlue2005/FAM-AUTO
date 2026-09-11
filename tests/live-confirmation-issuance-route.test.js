'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const { createCloudRemoteTaskRouter } = require('../server/cloud-remote-task-api');
const { createHostedBffApp, signPayload } = require('../server/hosted-bff');
const { verifyLiveConfirmationToken } = require('../server/live-confirmation-token');

const signingSecret = 'test-live-confirmation-signing-secret-that-is-long-enough';
const fixedNow = Date.parse('2026-09-12T12:00:00.000Z');
const ownerId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';
const targetId = '33333333-3333-4333-8333-333333333333';
const intent = { kind: 'property', campaignId, day: 1, targetId, deviceId: 'agent-live', profileId: 'profile-live' };

function fixture({ managedEnabled = true, liveEnabled = true, assigned = true, profileOwner = 'agent-live', sourceVisible = true } = {}) {
  const created = [];
  const campaign = { campaign_id: campaignId, legacy_id: 'synthetic-campaign', kind: 'property', active: true, revision: 1, app_campaign_posts: [{ post_id: 'post-1', day: 1, active: true, revision: 1, text: 'safe', app_post_media: [] }] };
  const target = { target_id: targetId, display_name: 'Synthetic Target', target_url: 'https://example.invalid/synthetic', active: true };
  return {
    created,
    getManagedUserById: async (id) => id === ownerId ? { user_id: ownerId, role: 'USER', session_version: 1, enabled: managedEnabled, live_execution_enabled: liveEnabled } : null,
    listManagedUserExecutionTargets: async (id) => id === ownerId && assigned ? [{ device_id: 'agent-live', profile_id: 'profile-live', enabled: true }] : [],
    getControlPlaneAgent: async (id) => id === 'agent-live' ? { agent_id: id, reported_status: 'ONLINE', last_seen_at: new Date(fixedNow).toISOString() } : null,
    getControlPlaneProfile: async (id) => id === 'profile-live' ? { profile_id: id, agent_id: profileOwner, status: 'READY' } : null,
    getCampaignPreflightSource: async ({ campaignId: requestedCampaignId, targetId: requestedTargetId }) => requestedCampaignId === campaignId && requestedTargetId === targetId ? { campaign, target } : { campaign: null, target: null },
    getCampaignPreflightSourceForManagedUser: async ({ userId, campaignId: requestedCampaignId, targetId: requestedTargetId }) => sourceVisible && userId === ownerId && requestedCampaignId === campaignId && requestedTargetId === targetId ? { campaign, target } : { campaign: null, target: null },
    createControlPlaneTask: async (task) => { created.push(task); return task; },
  };
}

async function withRouter({ user = { role: 'USER', managedUserId: ownerId }, store = fixture(), liveExecutionEnabled = true } = {}, run) {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = user; next(); });
  app.use(createCloudRemoteTaskRouter({ store, liveExecutionEnabled, signingSecret, now: () => fixedNow }));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = async (body = intent) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/live-confirmations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ request, store }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function assertNoTasks(store) { assert.equal(store.created.length, 0, 'confirmation issuance must not create a task'); }

test('A2 issues managed USER and ADMIN confirmation tokens without creating tasks', async () => {
  await withRouter({}, async ({ request, store }) => {
    const result = await request(); assert.equal(result.status, 200); assert.deepEqual(Object.keys(result.body).sort(), ['confirmationToken', 'expiresAt']);
    const verified = verifyLiveConfirmationToken({ token: result.body.confirmationToken, signingSecret, expectedOwner: { role: 'USER', managedUserId: ownerId }, expectedIntent: { campaignId, day: 1, targetId, deviceId: 'agent-live', profileId: 'profile-live' }, now: fixedNow });
    assert.equal(verified.campaignId, campaignId); assertNoTasks(store);
  });
  await withRouter({ user: { role: 'ADMIN', username: 'admin' } }, async ({ request, store }) => {
    const result = await request(); assert.equal(result.status, 200); assertNoTasks(store);
  });
});

test('A2 issues distinct tokens for the same reviewed intent and ignores injected authority fields', async () => {
  await withRouter({}, async ({ request, store }) => {
    const injected = { ...intent, taskType: 'DRY_RUN', executionMode: 'DRY_RUN', publishEnabled: false, owner: 'attacker', side_effect_state: 'VERIFIED_SUCCESS', payload: { localPath: 'C:/secret' }, idempotencyKey: 'attacker-key', facebookUrl: 'https://facebook.invalid' };
    const first = await request(injected); const second = await request(injected);
    assert.equal(first.status, 200); assert.equal(second.status, 200); assert.notEqual(first.body.confirmationToken, second.body.confirmationToken);
    const verified = verifyLiveConfirmationToken({ token: first.body.confirmationToken, signingSecret, expectedOwner: { role: 'USER', managedUserId: ownerId }, expectedIntent: { campaignId, day: 1, targetId, deviceId: 'agent-live', profileId: 'profile-live' }, now: fixedNow });
    assert.doesNotMatch(JSON.stringify(verified), /DRY_RUN|attacker|localPath|facebook/i); assertNoTasks(store);
  });
});

test('A2 denies disabled gate, anonymous, legacy USER, disabled policy, missing ACL, and missing assignment without tasks', async () => {
  const cases = [
    [{ liveExecutionEnabled: false }, 404, 'LIVE_EXECUTION_DISABLED'],
    [{ user: null }, 401, 'LIVE_CONFIRMATION_UNAUTHENTICATED'],
    [{ user: { role: 'USER', username: 'legacy' } }, 403, 'LIVE_CONFIRMATION_LEGACY_USER_DENIED'],
    [{ store: fixture({ liveEnabled: false }) }, 403, 'LIVE_CONFIRMATION_POLICY_DISABLED'],
    [{ store: fixture({ sourceVisible: false }) }, 404, 'LIVE_CONFIRMATION_CAMPAIGN_UNAVAILABLE'],
    [{ store: fixture({ assigned: false }) }, 403, 'LIVE_CONFIRMATION_ASSIGNMENT_UNAVAILABLE'],
  ];
  for (const [options, status, code] of cases) await withRouter(options, async ({ request, store }) => { const result = await request(); assert.equal(result.status, status); assert.equal(result.body.code, code); assertNoTasks(store); });
});

test('A2 rejects device/profile ownership and malformed or unavailable source without tasks', async () => {
  await withRouter({ store: fixture({ profileOwner: 'other-agent' }) }, async ({ request, store }) => { const result = await request(); assert.equal(result.status, 409); assert.equal(result.body.code, 'PROFILE_OWNERSHIP_MISMATCH'); assertNoTasks(store); });
  await withRouter({}, async ({ request, store }) => { const malformed = await request({ ...intent, campaignId: 'legacy' }); assert.equal(malformed.status, 400); assert.equal(malformed.body.code, 'INVALID_CAMPAIGN_ID'); const unknown = await request({ ...intent, targetId: '44444444-4444-4444-8444-444444444444' }); assert.equal(unknown.status, 404); assert.equal(unknown.body.code, 'LIVE_CONFIRMATION_CAMPAIGN_UNAVAILABLE'); assertNoTasks(store); });
});

test('A2 receives hosted authentication, CSRF, and Origin protection before issuance', async () => {
  const password = 'test-password'; const salt = Buffer.alloc(16, 2); const adminHash = `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
  const origin = 'http://127.0.0.1:5173'; const store = fixture();
  const app = createHostedBffApp({ env: { NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_SCRYPT: adminHash, RX_BFF_SESSION_SIGNING_SECRET: signingSecret, RX_BFF_ALLOWED_ORIGINS: origin, RX_BFF_CLOUD_REMOTE_TASKS_ENABLED: 'true', RX_BFF_LIVE_EXECUTION_ENABLED: 'true', RX_APP_SUPABASE_URL: 'https://supabase.invalid', RX_APP_SUPABASE_SERVICE_ROLE_KEY: 'test-key' }, store, now: () => fixedNow });
  const session = signPayload({ v: 1, username: 'managed', role: 'USER', csrf: 'csrf', iat: fixedNow / 1000, exp: (fixedNow / 1000) + 3600, managedUserId: ownerId, sessionVersion: 1 }, signingSecret);
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const send = async (headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/cloud-remote-tasks/live-confirmations`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(intent) });
    assert.equal((await send()).status, 401);
    assert.equal((await send({ cookie: `rx_session=${session}`, origin })).status, 403);
    assert.equal((await send({ cookie: `rx_session=${session}`, origin: 'https://attacker.invalid', 'x-rx-csrf': 'csrf' })).status, 403);
    assert.equal((await send({ cookie: `rx_session=${session}`, origin, 'x-rx-csrf': 'csrf' })).status, 200);
    assertNoTasks(store);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
