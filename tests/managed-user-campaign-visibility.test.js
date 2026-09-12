'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
const campaignB = '44444444-4444-4444-8444-444444444444';
const targetId = '55555555-5555-4555-8555-555555555555';
const now = new Date().toISOString();
const campaign = (campaignId, title) => ({ campaign_id: campaignId, legacy_id: title, kind: 'property', title, active: true, revision: 1, app_campaign_posts: [{ post_id: `${campaignId}-post`, day: 1, active: true, revision: 1, text: 'safe', app_post_media: [] }] });

function fixture() {
  const campaigns = new Map([[campaignA, campaign(campaignA, 'C1')], [campaignB, campaign(campaignB, 'C2')]]);
  const assignments = [{ user_id: userA, campaign_id: campaignA, enabled: true }, { user_id: userB, campaign_id: campaignB, enabled: true }];
  const store = {
    listCampaignFolders: async () => [], listTargets: async () => [{ target_id: targetId, display_name: 'Synthetic Target', target_url: 'https://example.invalid', active: true }],
    listCampaigns: async () => [...campaigns.values()],
    listCampaignsForManagedUser: async (userId) => assignments.filter((row) => row.user_id === userId && row.enabled).map((row) => campaigns.get(row.campaign_id)),
    getCampaignPreflightSource: async ({ campaignId, targetId: requestedTargetId }) => ({ campaign: campaigns.get(campaignId) || null, target: requestedTargetId === targetId ? (await store.listTargets())[0] : null }),
    getCampaignPreflightSourceForManagedUser: async ({ userId, campaignId, targetId: requestedTargetId }) => ({ campaign: assignments.some((row) => row.user_id === userId && row.campaign_id === campaignId && row.enabled) ? campaigns.get(campaignId) : null, target: requestedTargetId === targetId ? (await store.listTargets())[0] : null }),
    listManagedUserExecutionTargets: async (userId, { enabledOnly } = {}) => userId === userA ? [{ device_id: 'agent-a', profile_id: 'profile-a', enabled: true }].filter((row) => !enabledOnly || row.enabled) : [],
    getManagedUserById: async (id) => [userA, userB].includes(id) ? { user_id: id, enabled: true, controlled_execution_enabled: true, live_execution_enabled: true } : null,
    getControlPlaneAgent: async (id) => id === 'agent-a' ? { agent_id: id, reported_status: 'ONLINE', last_seen_at: now } : null,
    getControlPlaneProfile: async (id) => id === 'profile-a' ? { profile_id: id, agent_id: 'agent-a', status: 'READY' } : null,
    getActiveControlPlaneTaskForProfile: async () => null, getControlPlaneTask: async () => null, createControlPlaneTask: async (task) => ({ ...task, status: 'QUEUED' }), listControlPlaneTaskEvents: async () => [],
    listManagedUserCampaignVisibility: async (id) => assignments.filter((row) => row.user_id === id).map((row) => ({ ...row, app_campaigns: campaigns.get(row.campaign_id) })),
    getCampaignById: async (id) => campaigns.get(id) || null,
    createManagedUserCampaignVisibility: async ({ userId, campaignId }) => { if (assignments.some((row) => row.user_id === userId && row.campaign_id === campaignId)) { const error = new Error('duplicate'); error.code = '23505'; throw error; } const row = { user_id: userId, campaign_id: campaignId, enabled: true }; assignments.push(row); return row; },
    updateManagedUserCampaignVisibility: async (userId, campaignId, { enabled }) => { const row = assignments.find((item) => item.user_id === userId && item.campaign_id === campaignId); if (!row) return null; row.enabled = enabled; return row; },
  };
  return store;
}

async function appRequest(app, user, pathName, options = {}) {
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { const response = await fetch(`http://127.0.0.1:${server.address().port}${pathName}`, { ...options, headers: { 'content-type': 'application/json', 'x-user': user, ...(options.headers || {}) } }); return { status: response.status, body: await response.json() }; }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('G5.5B migration is additive, unique, FK-bound, RLS-protected, and service-role-only', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609110002_hosted_user_campaign_visibility.sql'), 'utf8');
  assert.match(sql, /hosted_user_campaign_visibility/); assert.match(sql, /references public\.hosted_users/); assert.match(sql, /references public\.app_campaigns/); assert.match(sql, /primary key \(user_id, campaign_id\)/); assert.match(sql, /enable row level security/); assert.match(sql, /revoke all.*anon, authenticated/); assert.match(sql, /service_role/); assert.doesNotMatch(sql, /all campaigns|wildcard/i);
});

test('G5.5B Supabase reads scope campaign and execution-source resolution in the database query', async () => {
  const urls = []; const store = new SupabaseApplicationDataStore({ url: 'https://project.supabase.co', serviceRoleKey: 'test-key', fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => [] }; } });
  await store.listCampaignsForManagedUser(userA, 'property');
  await store.getCampaignPreflightSourceForManagedUser({ userId: userA, kind: 'property', campaignId: campaignA, targetId });
  assert.match(urls[0], /hosted_user_campaign_visibility!inner/); assert.match(urls[0], new RegExp(`hosted_user_campaign_visibility\.user_id=eq\.${userA}`)); assert.match(urls[0], /hosted_user_campaign_visibility\.enabled=eq\.true/);
  assert.match(urls[1], /hosted_user_campaign_visibility!inner/); assert.match(urls[1], new RegExp(`hosted_user_campaign_visibility\.user_id=eq\.${userA}`));
});

test('G5.5B scopes managed campaign reads and execution sources server-side without user-controlled widening', async () => {
  const store = fixture(); const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = req.get('x-user') === 'admin' ? { role: 'ADMIN' } : req.get('x-user') === 'b' ? { role: 'USER', managedUserId: userB } : { role: 'USER', managedUserId: userA }; next(); }); app.use('/read', createCloudDashboardReadRouter(store)); app.use('/remote', createCloudRemoteTaskRouter({ store, controlledExecutionEnabled: true, liveExecutionEnabled: true }));
  const aRows = await appRequest(app, 'a', '/read/properties'); const bRows = await appRequest(app, 'b', '/read/properties'); const adminRows = await appRequest(app, 'admin', '/read/properties');
  assert.deepEqual(aRows.body.map((row) => row.name), ['C1']); assert.deepEqual(bRows.body.map((row) => row.name), ['C2']); assert.equal(adminRows.body.length, 2);
  const body = { kind: 'property', campaignId: campaignB, targetId, day: 1, deviceId: 'agent-a', profileId: 'profile-a', userId: userB, ownerUserId: userB };
  for (const route of ['/remote/campaign-preflight', '/remote/controlled-execution', '/remote/live-campaign-execution']) { const result = await appRequest(app, 'a', route, { method: 'POST', body: JSON.stringify(body) }); assert.equal(result.status, 404); }
  const allowed = await appRequest(app, 'a', '/remote/campaign-preflight', { method: 'POST', body: JSON.stringify({ ...body, campaignId: campaignA }) }); assert.equal(allowed.status, 201); assert.doesNotMatch(JSON.stringify(aRows.body), /user_id|assignment|credential|secret/i);
});

test('G5.5B ADMIN campaign assignment management is safe and USER is denied', async () => {
  const store = fixture(); const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = req.get('x-user') === 'admin' ? { role: 'ADMIN' } : { role: 'USER', managedUserId: userA }; next(); }); app.use('/users', createUserAdminRouter({ store, env: {}, requirePermission }));
  assert.equal((await appRequest(app, 'a', `/users/${userA}/campaign-visibility`)).status, 403);
  const listed = await appRequest(app, 'admin', `/users/${userA}/campaign-visibility`); assert.deepEqual(listed.body.campaigns.map((row) => row.campaignId), [campaignA]); assert.doesNotMatch(JSON.stringify(listed.body), /user_id|assignment|secret/i);
  assert.equal((await appRequest(app, 'admin', `/users/${userA}/campaign-visibility`, { method: 'POST', body: JSON.stringify({ campaignId: 'not-a-uuid' }) })).status, 400);
  const disabled = await appRequest(app, 'admin', `/users/${userA}/campaign-visibility/${campaignA}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) }); assert.equal(disabled.status, 200); assert.equal(disabled.body.campaign.enabled, false);
  const usersUi = fs.readFileSync(path.join(__dirname, '..', 'dashboard-v2', 'src', 'pages', 'Users.jsx'), 'utf8'); const api = fs.readFileSync(path.join(__dirname, '..', 'dashboard-v2', 'src', 'services', 'api.js'), 'utf8');
  assert.match(usersUi, /Campanii vizibile/); assert.match(usersUi, /Atribuie campania/); assert.match(api, /campaign-visibility/);
});

test('G5.5B visibility changes do not alter owned task history; target visibility is an independent server boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'cloud-dashboard-read-api.js'), 'utf8');
  assert.match(source, /listVisibleCampaigns/); assert.match(source, /listVisibleTargets/); assert.doesNotMatch(source, /owner_user_id.*campaign/i);
});
