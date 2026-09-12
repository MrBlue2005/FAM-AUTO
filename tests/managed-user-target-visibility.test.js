'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createCloudDashboardReadRouter } = require('../server/cloud-dashboard-read-api');
const { createCloudRemoteTaskRouter } = require('../server/cloud-remote-task-api');
const { createUserAdminRouter } = require('../server/user-admin-api');
const { requirePermission } = require('../server/hosted-rbac');
const { SupabaseApplicationDataStore } = require('../app/cloud/SupabaseApplicationDataStore');

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const campaignA = '33333333-3333-4333-8333-333333333333';
const targetA = '55555555-5555-4555-8555-555555555555';
const targetB = '66666666-6666-4666-8666-666666666666';
const targetInactive = '77777777-7777-4777-8777-777777777777';
const now = new Date().toISOString();
const campaign = { campaign_id: campaignA, legacy_id: 'C1', kind: 'property', title: 'Campaign A', active: true, revision: 1, app_campaign_posts: [{ post_id: 'post-a', day: 1, active: true, revision: 1, text: 'safe text', app_post_media: [] }] };
const targets = [
  { target_id: targetA, display_name: 'Target A', target_url: 'https://example.invalid/a', active: true, revision: 1 },
  { target_id: targetB, display_name: 'Target B', target_url: 'https://example.invalid/b', active: true, revision: 1 },
  { target_id: targetInactive, display_name: 'Inactive target', target_url: 'https://example.invalid/inactive', active: false, revision: 1 },
];

function fixture() {
  const campaignAssignments = [{ user_id: userA, campaign_id: campaignA, enabled: true }, { user_id: userB, campaign_id: campaignA, enabled: true }];
  const targetAssignments = [{ user_id: userA, target_id: targetA, enabled: true }, { user_id: userB, target_id: targetB, enabled: true }, { user_id: userA, target_id: targetInactive, enabled: true }];
  let created = 0;
  const visibleTarget = (userId, targetId) => targetAssignments.some((row) => row.user_id === userId && row.target_id === targetId && row.enabled) ? targets.find((target) => target.target_id === targetId) || null : null;
  const store = {
    listCampaignFolders: async () => [],
    listCampaigns: async () => [campaign],
    listCampaignsForManagedUser: async (userId) => campaignAssignments.some((row) => row.user_id === userId && row.enabled) ? [campaign] : [],
    listTargets: async () => targets,
    listTargetsForManagedUser: async (userId) => targetAssignments.filter((row) => row.user_id === userId && row.enabled).map((row) => targets.find((target) => target.target_id === row.target_id)).filter(Boolean),
    getCampaignPreflightSource: async ({ campaignId, targetId }) => ({ campaign: campaignId === campaignA ? campaign : null, target: targets.find((target) => target.target_id === targetId) || null }),
    getCampaignPreflightSourceForManagedUser: async ({ userId, campaignId, targetId }) => ({ campaign: campaignId === campaignA && campaignAssignments.some((row) => row.user_id === userId && row.enabled) ? campaign : null, target: visibleTarget(userId, targetId) }),
    getManagedUserById: async (id) => [userA, userB].includes(id) ? { user_id: id, enabled: true, controlled_execution_enabled: true, live_execution_enabled: true } : null,
    listManagedUserExecutionTargets: async (id, { enabledOnly } = {}) => id === userA ? [{ device_id: 'agent-a', profile_id: 'profile-a', enabled: true }].filter((row) => !enabledOnly || row.enabled) : [],
    getControlPlaneAgent: async (id) => id === 'agent-a' ? { agent_id: id, reported_status: 'ONLINE', last_seen_at: now } : null,
    getControlPlaneProfile: async (id) => id === 'profile-a' ? { profile_id: id, agent_id: 'agent-a', status: 'READY' } : null,
    getActiveControlPlaneTaskForProfile: async () => null,
    getControlPlaneTask: async () => null,
    listControlPlaneTasks: async () => [],
    createControlPlaneTask: async (task) => { created += 1; return { ...task, status: 'QUEUED' }; },
    listControlPlaneTaskEvents: async () => [],
    listManagedUsers: async () => [],
    listManagedUserTargetVisibility: async (id) => targetAssignments.filter((row) => row.user_id === id).map((row) => ({ ...row, app_targets: targets.find((target) => target.target_id === row.target_id) })),
    getTargetById: async (id) => targets.find((target) => target.target_id === id) || null,
    createManagedUserTargetVisibility: async ({ userId, targetId }) => { if (targetAssignments.some((row) => row.user_id === userId && row.target_id === targetId)) { const error = new Error('duplicate'); error.code = '23505'; throw error; } const row = { user_id: userId, target_id: targetId, enabled: true }; targetAssignments.push(row); return row; },
    updateManagedUserTargetVisibility: async (userId, targetId, { enabled }) => { const row = targetAssignments.find((item) => item.user_id === userId && item.target_id === targetId); if (!row) return null; row.enabled = enabled; return { ...row, app_targets: targets.find((target) => target.target_id === targetId) }; },
  };
  return { store, created: () => created, targetAssignments };
}

async function request(app, user, route, options = {}) {
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: options.method || 'GET', headers: { 'content-type': 'application/json', 'x-user': user }, body: options.body }); return { status: response.status, body: await response.json() }; }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function appFor(store) {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = req.get('x-user') === 'admin' ? { role: 'ADMIN', username: 'admin' } : req.get('x-user') === 'b' ? { role: 'USER', managedUserId: userB } : req.get('x-user') === 'zero' ? { role: 'USER', managedUserId: '88888888-8888-4888-8888-888888888888' } : { role: 'USER', managedUserId: userA }; next(); }); app.use('/read', createCloudDashboardReadRouter(store)); app.use('/remote', createCloudRemoteTaskRouter({ store, controlledExecutionEnabled: true, liveExecutionEnabled: true, signingSecret: 'target-visibility-signing-secret-that-is-long-enough' })); app.use('/admin', createUserAdminRouter({ store, env: {}, requirePermission })); return app;
}

test('G5.7D migration is additive, FK-bound, unique, RLS-protected, and service-role-only', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609120001_hosted_user_target_visibility.sql'), 'utf8');
  assert.match(sql, /hosted_user_target_visibility/); assert.match(sql, /references public\.hosted_users/); assert.match(sql, /references public\.app_targets/); assert.match(sql, /primary key \(user_id, target_id\)/); assert.match(sql, /enable row level security/); assert.match(sql, /revoke all.*anon, authenticated/); assert.match(sql, /service_role/); assert.doesNotMatch(sql, /wildcard|backfill/i);
});

test('G5.7D scopes target REST reads and managed source resolution in the database query', async () => {
  const urls = []; const store = new SupabaseApplicationDataStore({ url: 'https://project.supabase.co', serviceRoleKey: 'test-key', fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => [] }; } });
  await store.listTargetsForManagedUser(userA); await store.getCampaignPreflightSourceForManagedUser({ userId: userA, kind: 'property', campaignId: campaignA, targetId: targetA });
  assert.match(urls[0], /hosted_user_target_visibility!inner/); assert.match(urls[0], new RegExp(`hosted_user_target_visibility\.user_id=eq\.${userA}`)); assert.match(urls[0], /hosted_user_target_visibility\.enabled=eq\.true/);
  assert.match(urls[2], /hosted_user_target_visibility!inner/); assert.match(urls[2], new RegExp(`hosted_user_target_visibility\.user_id=eq\.${userA}`));
});

test('G5.7D scopes managed target sources, preserves ADMIN global reads, and excludes inactive targets', async () => {
  const { store } = fixture(); const app = appFor(store);
  const [a, b, zero, admin] = await Promise.all(['a', 'b', 'zero', 'admin'].map((user) => request(app, user, '/read/preflight-sources')));
  assert.deepEqual(a.body.targets.map((target) => target.targetId), [targetA]);
  assert.deepEqual(b.body.targets.map((target) => target.targetId), [targetB]);
  assert.deepEqual(zero.body.targets, []);
  assert.deepEqual(admin.body.targets.map((target) => target.targetId).sort(), [targetA, targetB]);
  assert.doesNotMatch(JSON.stringify(a.body), /user_id|assignment|secret|target_url/i);
});

test('G5.7D rejects injected unassigned targets for preflight, controlled, and live routes without creating tasks', async () => {
  const { store, created } = fixture(); const app = appFor(store); const body = JSON.stringify({ kind: 'property', campaignId: campaignA, day: 1, targetId: targetB, deviceId: 'agent-a', profileId: 'profile-a' });
  for (const route of ['/remote/campaign-preflight', '/remote/controlled-execution', '/remote/live-campaign-execution']) {
    const result = await request(app, 'a', route, { method: 'POST', body });
    assert.equal(result.status, 404); assert.equal(created(), 0);
  }
});

test('G5.7D rejects an inactive target even when its managed relation remains enabled', async () => {
  const { store, created } = fixture(); const app = appFor(store);
  const result = await request(app, 'a', '/remote/campaign-preflight', { method: 'POST', body: JSON.stringify({ kind: 'property', campaignId: campaignA, day: 1, targetId: targetInactive, deviceId: 'agent-a', profileId: 'profile-a' }) });
  assert.equal(result.status, 404); assert.equal(result.body.error, 'The selected target is unavailable.'); assert.equal(created(), 0);
});

test('G5.7D disables target relations conservatively and admin target-visibility management is RBAC-protected', async () => {
  const { store, targetAssignments } = fixture(); const app = appFor(store);
  assert.equal((await request(app, 'a', `/admin/${userA}/target-visibility`)).status, 403);
  const listed = await request(app, 'admin', `/admin/${userA}/target-visibility`); assert.deepEqual(listed.body.targets.map((target) => target.targetId).sort(), [targetA, targetInactive].sort()); assert.doesNotMatch(JSON.stringify(listed.body), /target_url|secret|path/i);
  const disabled = await request(app, 'admin', `/admin/${userA}/target-visibility/${targetA}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) }); assert.equal(disabled.status, 200); assert.equal(disabled.body.target.enabled, false);
  const sources = await request(app, 'a', '/read/preflight-sources'); assert.deepEqual(sources.body.targets, []);
  assert.equal(targetAssignments.find((row) => row.user_id === userA && row.target_id === targetA).enabled, false);
});

test('G5.7D keeps campaign, target, device/profile, and historical ownership boundaries independent', () => {
  const readSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'cloud-dashboard-read-api.js'), 'utf8');
  const remoteSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'cloud-remote-task-api.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'dashboard-v2', 'src', 'pages', 'Users.jsx'), 'utf8');
  assert.match(readSource, /listVisibleTargets/); assert.match(remoteSource, /getVisibleCampaignPreflightSource/); assert.match(ui, /Targeturi Facebook vizibile/);
  assert.doesNotMatch(readSource, /owner_user_id.*target/i);
});
