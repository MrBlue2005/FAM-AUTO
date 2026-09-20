'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHostedBffApp } = require('../server/hosted-bff');
const { SupabaseApplicationDataStore } = require('../app/cloud/SupabaseApplicationDataStore');

const origin = 'http://127.0.0.1:5173';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const password = 'creator visibility password';
const hashPassword = (value, byte) => {
  const salt = Buffer.alloc(16, byte);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
};

function campaignRow(input, posts, campaignId = crypto.randomUUID()) {
  return {
    campaign_id: campaignId,
    ...input,
    revision: 1,
    app_campaign_posts: posts.map((post) => ({ post_id: crypto.randomUUID(), ...post, revision: 1, app_post_media: [] })),
  };
}

function createStore() {
  const existing = campaignRow({ legacy_id: 'EXISTING', kind: 'property', title: 'Existing', active: true, folder_id: null, profile_id: null, data: {} }, [{ day: 1, text: 'Existing', active: true, data: {} }]);
  const users = new Map([
    ['creator_a', { user_id: userA, username: 'creator_a', username_normalized: 'creator_a', password_scrypt: hashPassword(password, 1), role: 'USER', enabled: true, session_version: 1 }],
    ['creator_b', { user_id: userB, username: 'creator_b', username_normalized: 'creator_b', password_scrypt: hashPassword(password, 2), role: 'USER', enabled: true, session_version: 1 }],
  ]);
  const state = { campaigns: [existing], visibility: [], idempotency: new Map(), failVisibility: false, creatorCalls: [], adminSaveCalls: 0 };
  const store = {
    state,
    getManagedUserByUsername: async (username) => users.get(username) || null,
    getManagedUserById: async (id) => [...users.values()].find((user) => user.user_id === id) || null,
    recordManagedUserLogin: async () => null,
    listCampaignFolders: async () => [],
    listCampaigns: async (kind) => state.campaigns.filter((row) => row.kind === kind),
    listCampaignsForManagedUser: async (id, kind) => state.visibility
      .filter((row) => row.user_id === id && row.enabled)
      .map((row) => state.campaigns.find((campaign) => campaign.campaign_id === row.campaign_id))
      .filter((campaign) => campaign?.kind === kind),
    createCampaignForManagedUser: async ({ campaign, posts, creatorUserId, requestId }) => {
      state.creatorCalls.push({ creatorUserId, requestId });
      const prior = state.idempotency.get(requestId);
      if (prior) return prior;
      if (state.campaigns.some((row) => row.kind === campaign.kind && row.legacy_id === campaign.legacy_id)) throw new Error('APP_CREATOR_CAMPAIGN_MUST_BE_NEW');
      if (state.failVisibility) throw Object.assign(new Error('creator visibility unavailable'), { status: 503 });
      const row = campaignRow(campaign, posts);
      state.campaigns.push(row);
      if (!state.visibility.some((item) => item.user_id === creatorUserId && item.campaign_id === row.campaign_id)) {
        state.visibility.push({ user_id: creatorUserId, campaign_id: row.campaign_id, enabled: true });
      }
      const result = { campaign: row, posts: row.app_campaign_posts };
      state.idempotency.set(requestId, result);
      return result;
    },
    saveCampaign: async ({ campaign, posts, expectedRevision }) => {
      state.adminSaveCalls += 1;
      if (expectedRevision !== 0) throw new Error('APP_REVISION_CONFLICT');
      state.campaigns.push(campaignRow(campaign, posts));
      return {};
    },
  };
  return store;
}

const env = {
  NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_SCRYPT: hashPassword(password, 3),
  RX_BFF_SESSION_SIGNING_SECRET: 'creator-visibility-signing-secret-long-enough', RX_BFF_ALLOWED_ORIGINS: origin,
  RX_BFF_CLOUD_APP_MUTATIONS_ENABLED: 'true',
};
const property = (id, recipient = userB) => ({ id, name: `Campaign ${id}`, active: true, userId: recipient, creatorUserId: recipient, posts: [{ day: 1, text: 'Synthetic', active: true }] });

async function withServer(store, run) {
  const server = http.createServer(createHostedBffApp({ env, store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = 'GET', body, auth, requestId } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(auth ? { cookie: auth.cookie, 'x-rx-csrf': auth.csrf } : {}),
        ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { origin } : {}),
        ...(requestId ? { 'x-rx-request-id': requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
    return { status: response.status, body: await response.json().catch(() => ({})), cookie: setCookie.split(';')[0] };
  };
  const login = async (username) => {
    const response = await request('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(response.status, 200);
    return { cookie: response.cookie, csrf: response.body.csrfToken };
  };
  try { await run({ request, login }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('managed creator gets exactly one immediate scoped visibility relation from server session identity', async () => {
  const store = createStore();
  await withServer(store, async ({ request, login }) => {
    const authA = await login('creator_a');
    const authB = await login('creator_b');
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property('NEW_A'), auth: authA, requestId })).status, 201);
    assert.equal(store.state.creatorCalls[0].creatorUserId, userA);
    assert.equal(store.state.visibility.length, 1);
    assert.equal(store.state.visibility[0].user_id, userA);

    const creatorRows = await request('/api/cloud-read/properties', { auth: authA });
    const unrelatedRows = await request('/api/cloud-read/properties', { auth: authB });
    assert.deepEqual(creatorRows.body.map((row) => row.id), ['NEW_A']);
    assert.deepEqual(unrelatedRows.body, []);

    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property('NEW_A'), auth: authA, requestId })).status, 201);
    assert.equal(store.state.visibility.length, 1);
    assert.equal(store.state.campaigns.filter((row) => row.legacy_id === 'NEW_A').length, 1);
  });
});

test('creator path cannot self-assign existing campaigns or use ADMIN ACL endpoints', async () => {
  const store = createStore();
  await withServer(store, async ({ request, login }) => {
    const authA = await login('creator_a');
    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property('EXISTING'), auth: authA })).status, 400);
    assert.equal(store.state.visibility.length, 0);
    assert.equal((await request(`/api/admin/users/${userB}/campaign-visibility`, { method: 'POST', body: { campaignId: store.state.campaigns[0].campaign_id }, auth: authA })).status, 403);
    assert.equal((await request(`/api/admin/users/${userB}/campaign-visibility/${store.state.campaigns[0].campaign_id}`, { method: 'PATCH', body: { enabled: true }, auth: authA })).status, 403);
    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property('UNAUTHENTICATED') })).status, 401);
  });
});

test('creator visibility failure returns failure without a partially readable campaign', async () => {
  const store = createStore(); store.state.failVisibility = true;
  await withServer(store, async ({ request, login }) => {
    const authA = await login('creator_a');
    const response = await request('/api/cloud-mutations/properties', { method: 'POST', body: property('ROLLBACK'), auth: authA });
    assert.equal(response.status, 503);
    assert.equal(store.state.campaigns.some((row) => row.legacy_id === 'ROLLBACK'), false);
    assert.equal(store.state.visibility.length, 0);
  });
});

test('ADMIN campaign creation remains separate and does not synthesize creator visibility', async () => {
  const store = createStore();
  await withServer(store, async ({ request, login }) => {
    const admin = await login('admin');
    assert.equal((await request('/api/cloud-mutations/properties', { method: 'POST', body: property('ADMIN_NEW'), auth: admin })).status, 201);
    assert.equal(store.state.adminSaveCalls, 1);
    assert.equal(store.state.creatorCalls.length, 0);
    assert.equal(store.state.visibility.length, 0);
  });
});

test('creator RPC is atomic, creation-only, idempotent, and service-role-only', async () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609200001_creator_campaign_visibility.sql'), 'utf8');
  assert.match(migration, /campaign_with_posts_for_creator/);
  assert.match(migration, /APP_CREATOR_CAMPAIGN_MUST_BE_NEW/);
  assert.match(migration, /hosted_user_campaign_visibility\(user_id, campaign_id, enabled\)/);
  assert.match(migration, /on conflict \(user_id, campaign_id\) do nothing/);
  assert.match(migration, /revoke all[\s\S]*public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*service_role/);

  const calls = [];
  const store = new SupabaseApplicationDataStore({ url: 'https://project.supabase.co', serviceRoleKey: 'test-key', fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; } });
  await store.createCampaignForManagedUser({ campaign: { legacy_id: 'NEW', kind: 'property', title: 'New' }, posts: [], creatorUserId: userA, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  assert.match(calls[0].url, /rx_app_create_campaign_with_posts_for_creator/);
  assert.equal(calls[0].body.p_creator_user_id, userA);
  assert.equal(Object.hasOwn(calls[0].body.p_campaign, 'creatorUserId'), false);
});
