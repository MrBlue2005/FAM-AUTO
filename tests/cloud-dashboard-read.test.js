'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { createHostedBffApp } = require('../server/hosted-bff');
const { AGENT_HEARTBEAT_FRESHNESS_MS, mapAgentStatus, mapCampaign, mapTarget, mapFolder, mapSchedule, mapMedia } = require('../server/cloud-dashboard-read-api');

const origin = 'http://127.0.0.1:5173';
const password = 'correct horse battery staple';
const salt = Buffer.alloc(16, 9);
const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
const env = () => ({ NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_PASSWORD_SCRYPT: passwordHash, RX_BFF_SESSION_SIGNING_SECRET: 'cloud-read-test-signing-secret-that-is-long-enough', RX_BFF_ALLOWED_ORIGINS: origin });

function fixtureStore() {
  const property = { campaign_id: 'campaign-property', legacy_id: 'PROPERTY_1', kind: 'property', title: 'Synthetic property', active: true, folder_id: 'campaign-folder', profile_id: 'profile-main', revision: 99, data: { transactionType: 'rent', secret: 'not-for-browser' }, app_campaign_posts: [{ post_id: 'post-property', day: 1, text: 'Property post', active: true, data: { title: 'Ziua 1', internal: 'nope' }, app_post_media: [{ ordinal: 0, app_media_objects: { media_id: 'media-1', original_name: 'home.png', mime_type: 'image/png', byte_size: 12, state: 'READY', object_key: 'private' } }] }] };
  const job = { campaign_id: 'campaign-job', legacy_id: 'JOB_1', kind: 'job', title: 'Synthetic job', active: true, folder_id: null, profile_id: null, data: {}, app_campaign_posts: [{ post_id: 'post-job', day: 2, text: 'Job post', active: true, data: {}, app_post_media: [] }] };
  const campaignFolders = [{ folder_id: 'campaign-folder', legacy_id: 'FOLDER_1', name: 'Campaign folder', created_at: '2026-09-08T00:00:00Z' }];
  const scheduleFolders = [{ folder_id: 'schedule-folder', legacy_id: 'SCHEDULE_FOLDER_1', name: 'Schedule folder', created_at: '2026-09-08T00:00:00Z' }];
  const schedules = [{ schedule_id: 'schedule-1', legacy_id: 'SCHEDULE_1', name: 'Synthetic schedule', enabled: true, folder_id: 'schedule-folder', profile_id: 'profile-main', schedule: { daysOfWeek: [1, 3], time: '09:00', campaignCategory: 'property', publishEnabled: false }, revision: 5, app_schedule_campaigns: [{ ordinal: 0, app_campaigns: { campaign_id: 'campaign-property', legacy_id: 'PROPERTY_1', kind: 'property' } }] }];
  return {
    listCampaigns: async (kind) => kind === 'property' ? [property] : [job], listTargets: async () => [{ target_id: 'target-1', legacy_id: 'GROUP_1', display_name: 'Synthetic group', target_url: 'https://example.test/group', active: true, category: 'Romania', data: { category: 'real_estate', favorite: true, secret: 'nope' }, revision: 8 }],
    listCampaignFolders: async () => campaignFolders, listScheduleFolders: async () => scheduleFolders, listSchedules: async () => schedules,
    listMedia: async () => [{ media_id: 'media-1', original_name: 'home.png', mime_type: 'image/png', byte_size: 12, state: 'READY', created_at: '2026-09-08T00:00:00Z', sha256: 'secret-hash', object_key: 'private/key', app_post_media: [{ post_id: 'post-property' }] }],
    getAgentStatus: async () => ({ agent_id: 'agent-private', display_name: 'Synthetic Local Agent', reported_status: 'ONLINE', last_seen_at: new Date().toISOString(), credential: 'must-not-leak', lease_id: 'must-not-leak' }),
  };
}

async function withBff(run) {
  const server = http.createServer(createHostedBffApp({ env: env(), store: fixtureStore() }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie, csrf } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json', origin } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-rx-csrf': csrf } : {}) }, body: body && JSON.stringify(body) });
    const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
    return { response, body: await response.json().catch(() => ({})), cookie: setCookie.split(';')[0] };
  };
  try { await run(request); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('cloud dashboard DTO mappers preserve legacy shapes and omit internal application rows', async () => {
  const store = fixtureStore();
  const property = mapCampaign((await store.listCampaigns('property'))[0], new Map([['campaign-folder', 'FOLDER_1']]));
  const target = mapTarget({ legacy_id: 'GROUP_1', display_name: 'Group', target_url: 'https://example.test', active: true, category: 'Romania', data: { category: 'real_estate', secret: 'hidden' } });
  const folder = mapFolder({ legacy_id: 'FOLDER_1', name: 'Folder', created_at: '2026-09-08T00:00:00Z' });
  const schedule = mapSchedule({ legacy_id: 'SCHEDULE_1', name: 'Schedule', enabled: true, folder_id: 'folder', profile_id: 'profile', schedule: { daysOfWeek: [1], time: '09:00' }, app_schedule_campaigns: [{ ordinal: 0, app_campaigns: { campaign_id: 'campaign' } }] }, new Map([['folder', 'FOLDER_1']]), new Map([['campaign', 'PROPERTY_1']]));
  const media = mapMedia({ media_id: 'media-1', original_name: 'home.png', mime_type: 'image/png', byte_size: 12, state: 'READY', app_post_media: [{ post_id: 'post' }], sha256: 'hidden', object_key: 'hidden' }, new Map([['post', 'PROPERTY_1']]));
  assert.deepEqual(target, { id: 'GROUP_1', name: 'Group', url: 'https://example.test', active: true, category: 'real_estate', groupListCategory: 'Romania' });
  assert.equal(property.id, 'PROPERTY_1'); assert.equal(property.folderId, 'FOLDER_1'); assert.equal(folder.id, 'FOLDER_1'); assert.deepEqual(schedule.campaignIds, ['PROPERTY_1']); assert.equal(media.propertyId, 'PROPERTY_1');
  assert.ok(!JSON.stringify({ property, target, folder, schedule, media }).includes('hidden'));
});

test('authenticated cloud dashboard reads expose synthetic legacy DTOs only and accept no writes', async () => {
  await withBff(async (request) => {
    const anonymous = await request('/api/cloud-read/properties'); assert.equal(anonymous.response.status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } }); assert.equal(login.response.status, 200);
    const anonymousAgent = await request('/api/cloud-read/agent-status'); assert.equal(anonymousAgent.response.status, 401);
    const [properties, jobs, groups, folders, scheduleFolders, schedules, media, agent] = await Promise.all(['/properties', '/jobs', '/groups', '/campaign-folders', '/schedule-folders', '/schedules', '/media', '/agent-status'].map((path) => request(`/api/cloud-read${path}`, { cookie: login.cookie })));
    assert.equal(properties.body[0].id, 'PROPERTY_1'); assert.equal(properties.body[0].posts[0].text, 'Property post'); assert.equal(jobs.body[0].id, 'JOB_1'); assert.equal(groups.body[0].id, 'GROUP_1'); assert.equal(folders.body[0].id, 'FOLDER_1'); assert.equal(scheduleFolders.body[0].id, 'SCHEDULE_FOLDER_1'); assert.deepEqual(schedules.body.schedules[0].campaignIds, ['PROPERTY_1']); assert.equal(media.body[0].path, '');
    assert.ok(!JSON.stringify([properties.body, jobs.body, groups.body, folders.body, scheduleFolders.body, schedules.body, media.body]).match(/secret|revision|object_key|sha256|bucket/));
    assert.deepEqual(agent.body, { configured: true, online: true, lastSeenAt: agent.body.lastSeenAt, agentName: 'Synthetic Local Agent', capabilities: { localExecution: true, facebookAutomation: false } });
    assert.ok(!JSON.stringify(agent.body).match(/agent_id|credential|lease/));
    const write = await request('/api/cloud-read/properties', { method: 'POST', body: { unsafe: true }, cookie: login.cookie, csrf: login.body.csrfToken }); assert.equal(write.response.status, 404);
  });
});

test('agent-status is online only for a fresh reported heartbeat and handles no registration safely', () => {
  const now = Date.parse('2026-09-09T12:00:00.000Z');
  const fresh = mapAgentStatus({ display_name: 'Agent', reported_status: 'ONLINE', last_seen_at: new Date(now - AGENT_HEARTBEAT_FRESHNESS_MS + 1).toISOString() }, now);
  const stale = mapAgentStatus({ display_name: 'Agent', reported_status: 'ONLINE', last_seen_at: new Date(now - AGENT_HEARTBEAT_FRESHNESS_MS - 1).toISOString() }, now);
  assert.equal(fresh.online, true); assert.equal(stale.online, false);
  assert.deepEqual(mapAgentStatus(null, now), { configured: false, online: false, lastSeenAt: null, agentName: null, capabilities: { localExecution: false, facebookAutomation: false } });
});

test('hosted runtime status never calls local health and keeps local mode unchanged', async () => {
  const { loadRuntimeStatus, localAgentStatusView } = await import('../dashboard-v2/src/services/hostedRuntimeStatus.js');
  let healthCalls = 0; let agentCalls = 0;
  const hosted = await loadRuntimeStatus({ cloudReadOnly: true, getHealth: async () => { healthCalls += 1; throw new Error('localhost must not be called'); }, getAgentStatus: async () => { agentCalls += 1; return { configured: true, online: false }; } });
  assert.equal(healthCalls, 0); assert.equal(agentCalls, 1); assert.deepEqual(localAgentStatusView(hosted.agent), { value: 'offline', message: 'Local Agent offline' });
  const local = await loadRuntimeStatus({ cloudReadOnly: false, getHealth: async () => { healthCalls += 1; return { api: 'online' }; }, getAgentStatus: async () => { agentCalls += 1; return {}; } });
  assert.equal(healthCalls, 1); assert.equal(agentCalls, 1); assert.deepEqual(local.health, { api: 'online' });
  assert.deepEqual(localAgentStatusView({ configured: false, online: false }), { value: 'requires agent', message: 'Requires Local Agent' });
});

test('dashboard mode gate selects LOCAL by default and rejects cloud-read-only writes without a local fallback', async () => {
  const mode = await import('../dashboard-v2/src/services/dashboardDataMode.js');
  assert.equal(mode.normalizeDashboardDataMode(), mode.DASHBOARD_DATA_MODES.LOCAL); assert.equal(mode.normalizeDashboardDataMode('cloud_read_only'), mode.DASHBOARD_DATA_MODES.CLOUD_READ_ONLY);
  assert.throws(() => mode.assertCloudReadOnlyRequest(mode.DASHBOARD_DATA_MODES.CLOUD_READ_ONLY, 'POST', '/properties'), /no local write fallback/);
  assert.doesNotThrow(() => mode.assertCloudReadOnlyRequest(mode.DASHBOARD_DATA_MODES.CLOUD_READ_ONLY, 'GET', '/cloud-read/properties'));
});
