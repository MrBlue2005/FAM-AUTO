'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('node:crypto'); const http = require('node:http');
const { createHostedBffApp } = require('../server/hosted-bff');
const origin = 'http://127.0.0.1:5173'; const password = 'mutation password'; const salt = Buffer.alloc(16, 9);
const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
const env = (enabled = true) => ({ NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_PASSWORD_SCRYPT: passwordHash, RX_BFF_SESSION_SIGNING_SECRET: 'mutation-test-signing-secret-that-is-long-enough', RX_BFF_ALLOWED_ORIGINS: origin, RX_BFF_CLOUD_APP_MUTATIONS_ENABLED: enabled ? 'true' : 'false' });
const clone = (value) => JSON.parse(JSON.stringify(value));

function createStore() {
  const state = {
    campaignFolders: [], scheduleFolders: [], targets: [], campaigns: [], schedules: [], references: new Set(['TARGET_LOCKED']),
  };
  const rowCampaign = (input, posts, revision = 1) => ({ campaign_id: `campaign-${input.legacy_id}`, ...input, revision, app_campaign_posts: posts.map((post) => ({ post_id: `post-${input.legacy_id}-${post.day}`, ...post, revision: 1, app_post_media: [] })) });
  const store = {
    state,
    listCampaignFolders: async () => clone(state.campaignFolders), listScheduleFolders: async () => clone(state.scheduleFolders), listTargets: async () => clone(state.targets),
    listCampaigns: async (kind) => clone(state.campaigns.filter((row) => row.kind === kind)), listSchedules: async () => clone(state.schedules),
    saveCampaign: async ({ campaign, posts, expectedRevision }) => { const index = state.campaigns.findIndex((row) => row.kind === campaign.kind && row.legacy_id === campaign.legacy_id); if (index >= 0) { const old = state.campaigns[index]; if (old.revision !== expectedRevision) throw Object.assign(new Error('APP_REVISION_CONFLICT'), { status: 409, code: 'APP_REVISION_CONFLICT' }); state.campaigns[index] = rowCampaign(campaign, posts, old.revision + 1); } else { if (expectedRevision !== 0) throw Object.assign(new Error('APP_REVISION_CONFLICT'), { status: 409, code: 'APP_REVISION_CONFLICT' }); state.campaigns.push(rowCampaign(campaign, posts)); } return {}; },
    deleteCampaign: async ({ legacyId, kind, expectedRevision }) => { const index = state.campaigns.findIndex((row) => row.kind === kind && row.legacy_id === legacyId); if (index < 0 || state.campaigns[index].revision !== expectedRevision) throw Object.assign(new Error('APP_REVISION_CONFLICT'), { status: 409, code: 'APP_REVISION_CONFLICT' }); if (state.schedules.some((schedule) => schedule.app_schedule_campaigns.some((link) => link.app_campaigns.legacy_id === legacyId))) throw Object.assign(new Error('foreign key'), { status: 409, code: 'APP_REFERENCE_CONFLICT' }); state.campaigns.splice(index, 1); },
    saveTarget: async (input) => { const index = state.targets.findIndex((row) => row.legacy_id === input.legacy_id); if (index >= 0) { if (state.targets[index].revision !== input.expectedRevision) throw Object.assign(new Error('APP_REVISION_CONFLICT'), { status: 409, code: 'APP_REVISION_CONFLICT' }); state.targets[index] = { ...input, target_id: state.targets[index].target_id, revision: input.expectedRevision + 1 }; } else state.targets.push({ ...input, target_id: `target-${input.legacy_id}`, revision: 1 }); },
    targetHasReferences: async (legacyId) => state.references.has(legacyId), deleteTarget: async ({ legacyId }) => { if (state.references.has(legacyId)) throw Object.assign(new Error('foreign key'), { status: 409, code: 'APP_REFERENCE_CONFLICT' }); state.targets = state.targets.filter((row) => row.legacy_id !== legacyId); },
    saveCampaignFolder: async ({ legacy_id, name }) => { const row = { folder_id: `cf-${legacy_id}`, legacy_id, name }; state.campaignFolders.push(row); return clone(row); }, updateCampaignFolder: async ({ legacy_id, name }) => { const row = state.campaignFolders.find((item) => item.legacy_id === legacy_id); if (!row) throw Object.assign(new Error('missing'), { status: 404 }); row.name = name; return clone(row); }, deleteCampaignFolder: async ({ legacyId }) => { state.campaignFolders = state.campaignFolders.filter((row) => row.legacy_id !== legacyId); },
    saveScheduleFolder: async ({ legacy_id, name }) => { const row = { folder_id: `sf-${legacy_id}`, legacy_id, name }; state.scheduleFolders.push(row); return clone(row); }, updateScheduleFolder: async ({ legacy_id, name }) => { const row = state.scheduleFolders.find((item) => item.legacy_id === legacy_id); if (!row) throw Object.assign(new Error('missing'), { status: 404 }); row.name = name; return clone(row); }, deleteScheduleFolder: async ({ legacyId }) => { state.scheduleFolders = state.scheduleFolders.filter((row) => row.legacy_id !== legacyId); },
    saveSchedule: async ({ schedule, campaignIds, expectedRevision }) => { const index = state.schedules.findIndex((row) => row.legacy_id === schedule.legacy_id); const links = campaignIds.map((id, ordinal) => ({ ordinal, app_campaigns: state.campaigns.find((campaign) => campaign.campaign_id === id) })); if (index >= 0) { if (state.schedules[index].revision !== expectedRevision) throw Object.assign(new Error('APP_REVISION_CONFLICT'), { status: 409, code: 'APP_REVISION_CONFLICT' }); state.schedules[index] = { schedule_id: state.schedules[index].schedule_id, ...schedule, revision: expectedRevision + 1, app_schedule_campaigns: links }; } else state.schedules.push({ schedule_id: `schedule-${schedule.legacy_id}`, ...schedule, revision: 1, app_schedule_campaigns: links }); },
    deleteSchedule: async ({ legacyId, expectedRevision }) => { const index = state.schedules.findIndex((row) => row.legacy_id === legacyId); if (index < 0 || state.schedules[index].revision !== expectedRevision) throw Object.assign(new Error('APP_REVISION_CONFLICT'), { status: 409, code: 'APP_REVISION_CONFLICT' }); state.schedules.splice(index, 1); },
  };
  return store;
}

async function fixture(run, enabled = true) {
  const store = createStore(); const server = http.createServer(createHostedBffApp({ env: env(enabled), store })); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie, csrf, requestOrigin = method === 'GET' ? undefined : origin } = {}) => { const response = await fetch(`${base}${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-rx-csrf': csrf } : {}), ...(requestOrigin ? { origin: requestOrigin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || ''; return { response, body: await response.json().catch(() => ({})), cookie: setCookie.split(';')[0] }; };
  try { await run({ request, store }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const property = (id = 'PROPERTY_1', revision) => ({ id, name: 'Synthetic property', active: true, ...(revision === undefined ? {} : { revision }), transactionType: 'rent', posts: [{ day: 1, text: 'One', active: true, title: 'Day one' }] });
const job = (id = 'JOB_1', revision) => ({ id, title: 'Synthetic job', active: true, ...(revision === undefined ? {} : { revision }), posts: [{ day: 1, text: 'Role', active: true }] });

test('cloud application mutations require capability, session, CSRF, and same origin', async () => {
  await fixture(async ({ request, store }) => {
    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property() })).response.status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } });
    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property(), cookie: login.cookie })).response.status, 403);
    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property(), cookie: login.cookie, csrf: login.body.csrfToken, requestOrigin: 'https://attacker.test' })).response.status, 403);
    assert.equal((await request('/api/cloud', { method: 'POST', body: { status: 'COMPLETED' }, cookie: login.cookie, csrf: login.body.csrfToken })).response.status, 404);
  });
  await fixture(async ({ request }) => { const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } }); assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property(), cookie: login.cookie, csrf: login.body.csrfToken })).response.status, 404); }, false);
});

test('cloud mutation CRUD maps safe DTOs, preserves ordered schedule links, and rejects stale/delete conflicts', async () => {
  await fixture(async ({ request, store }) => {
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } }); const auth = { cookie: login.cookie, csrf: login.body.csrfToken };
    const createProperty = await request('/api/cloud-mutations/properties', { method: 'POST', body: property(), ...auth }); assert.equal(createProperty.response.status, 201); assert.ok(!JSON.stringify(createProperty.body).match(/service_role|operator|credential|database|campaign_id|data|revision/i));
    const updateProperty = await request('/api/cloud-mutations/properties/PROPERTY_1', { method: 'PUT', body: { ...property('PROPERTY_1', 1), posts: [{ day: 1, text: 'Updated', active: true }] }, ...auth }); assert.equal(updateProperty.body.posts[0].text, 'Updated');
    const stale = await request('/api/cloud-mutations/properties/PROPERTY_1', { method: 'PUT', body: property('PROPERTY_1', 1), ...auth }); assert.equal(stale.response.status, 409); assert.match(stale.body.error, /changed in cloud/i);
    const createJob = await request('/api/cloud-mutations/jobs', { method: 'POST', body: job(), ...auth }); assert.equal(createJob.response.status, 201);
    const groups = await request('/api/cloud-mutations/groups', { method: 'POST', body: [{ id: 'GROUP_1', name: 'Group', url: 'https://example.test/g', category: 'real_estate', groupListCategory: 'Romania', active: true }], ...auth }); assert.equal(groups.response.status, 200); assert.equal(groups.body[0].id, 'GROUP_1');
    const cf = await request('/api/cloud-mutations/campaign-folders', { method: 'POST', body: { name: 'Campaign folder' }, ...auth }); assert.equal(cf.response.status, 201); assert.equal((await request(`/api/cloud-mutations/campaign-folders/${cf.body.id}`, { method: 'PUT', body: { name: 'Renamed campaign folder' }, ...auth })).body.name, 'Renamed campaign folder');
    const sf = await request('/api/cloud-mutations/schedule-folders', { method: 'POST', body: { name: 'Schedule folder' }, ...auth }); assert.equal(sf.response.status, 201);
    const schedule = { id: 'SCHEDULE_1', name: 'Metadata only', enabled: true, folderId: sf.body.id, campaignIds: ['JOB_1', 'PROPERTY_1'], daysOfWeek: [1], time: '09:00', campaignCategory: 'jobs', publishEnabled: false };
    const savedSchedule = await request('/api/cloud-mutations/schedules', { method: 'POST', body: schedule, ...auth }); assert.equal(savedSchedule.response.status, 201); assert.deepEqual(savedSchedule.body.campaignIds, ['JOB_1', 'PROPERTY_1']);
    const campaignDelete = await request('/api/cloud-mutations/properties/PROPERTY_1', { method: 'DELETE', body: { revision: 2 }, ...auth }); assert.equal(campaignDelete.response.status, 409); assert.match(campaignDelete.body.error, /referenced/i);
    const lockedGroup = await request('/api/cloud-mutations/groups', { method: 'POST', body: [{ id: 'GROUP_1', name: 'Group', url: 'https://example.test/g', category: 'real_estate', groupListCategory: 'Romania', active: true, revision: 1 }, { id: 'TARGET_LOCKED', name: 'Locked', url: 'https://example.test/locked', category: 'real_estate', groupListCategory: 'Romania' }], ...auth }); assert.equal(lockedGroup.response.status, 200);
    const lockedDelete = await request('/api/cloud-mutations/groups', { method: 'POST', body: [{ id: 'GROUP_1', name: 'Group', url: 'https://example.test/g', category: 'real_estate', groupListCategory: 'Romania', active: true, revision: 1 }], ...auth }); assert.equal(lockedDelete.response.status, 409); assert.ok(store.state.targets.some((target) => target.legacy_id === 'GROUP_1'));
    const groupDelete = await request('/api/cloud-mutations/groups', { method: 'POST', body: [{ id: 'TARGET_LOCKED', name: 'Locked', url: 'https://example.test/locked', category: 'real_estate', groupListCategory: 'Romania', revision: 1 }], ...auth }); assert.equal(groupDelete.response.status, 200); assert.equal(groupDelete.body.length, 1);
    assert.equal((await request('/api/cloud-mutations/schedules/SCHEDULE_1', { method: 'DELETE', body: { revision: 1 }, ...auth })).response.status, 200);
    assert.equal((await request(`/api/cloud-mutations/schedule-folders/${sf.body.id}`, { method: 'DELETE', body: {}, ...auth })).response.status, 200);
    assert.equal((await request(`/api/cloud-mutations/campaign-folders/${cf.body.id}`, { method: 'DELETE', body: {}, ...auth })).response.status, 200);
  });
});
