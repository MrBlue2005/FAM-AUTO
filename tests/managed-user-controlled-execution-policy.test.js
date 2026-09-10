'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const express = require('express'); const http = require('node:http');
const { createCloudRemoteTaskRouter } = require('../server/cloud-remote-task-api');

const owner = '11111111-1111-4111-8111-111111111111'; const campaignId = '22222222-2222-4222-8222-222222222222'; const targetId = '33333333-3333-4333-8333-333333333333';
function source() { return { campaign: { campaign_id: campaignId, legacy_id: 'safe', kind: 'property', active: true, revision: 1, app_campaign_posts: [{ post_id: 'post', day: 1, active: true, revision: 1, text: 'safe', app_post_media: [] }] }, target: { target_id: targetId, display_name: 'safe', target_url: 'https://example.test', active: true } }; }
async function requestFor({ policy, assigned, enabled = true }) { let created = 0; const store = { getManagedUserById: async () => ({ user_id: owner, enabled, controlled_execution_enabled: policy }), listManagedUserExecutionTargets: async () => assigned ? [{ device_id: 'agent', profile_id: 'profile', enabled: true }] : [], getControlPlaneAgent: async () => ({ agent_id: 'agent', reported_status: 'ONLINE', last_seen_at: new Date().toISOString() }), getControlPlaneProfile: async () => ({ profile_id: 'profile', agent_id: 'agent', status: 'READY' }), getCampaignPreflightSource: async () => source(), getActiveControlPlaneTaskForProfile: async () => null, getControlPlaneTask: async () => null, createControlPlaneTask: async (task) => { created += 1; return { ...task, status: 'QUEUED' }; }, listControlPlaneTaskEvents: async () => [] };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { role: 'USER', managedUserId: owner }; next(); }); app.use(createCloudRemoteTaskRouter({ store, controlledExecutionEnabled: true })); const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); try { const response = await fetch(`http://127.0.0.1:${server.address().port}/controlled-execution`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'property', campaignId, targetId, day: 1, deviceId: 'agent', profileId: 'profile', publishEnabled: true, owner_user_id: 'attacker' }) }); return { status: response.status, created }; } finally { await new Promise((resolve) => server.close(resolve)); }
}
test('managed controlled execution requires enabled account, explicit policy, and exact assignment', async () => {
  assert.deepEqual(await requestFor({ policy: false, assigned: true }), { status: 403, created: 0 });
  assert.deepEqual(await requestFor({ policy: true, assigned: false }), { status: 403, created: 0 });
  assert.deepEqual(await requestFor({ policy: true, assigned: true, enabled: false }), { status: 403, created: 0 });
  assert.deepEqual(await requestFor({ policy: true, assigned: true }), { status: 201, created: 1 });
});
