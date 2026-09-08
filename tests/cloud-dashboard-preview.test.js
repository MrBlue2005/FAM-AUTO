'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { createHostedBffApp } = require('../server/hosted-bff');

const origin = 'http://127.0.0.1:5173';
const password = 'preview password'; const salt = Buffer.alloc(16, 4);
const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
const env = () => ({ NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_PASSWORD_SCRYPT: passwordHash, RX_BFF_SESSION_SIGNING_SECRET: 'preview-test-signing-secret-that-is-long-enough', RX_BFF_ALLOWED_ORIGINS: origin });
const denied = () => Object.assign(new Error('Media is not authorized for preview.'), { status: 404 });

function store() {
  return {
    listCampaignFolders: async () => [], listCampaigns: async () => [], listTargets: async () => [], listScheduleFolders: async () => [], listSchedules: async () => [], listMedia: async () => [],
    createPreview: async (mediaId) => {
      if (mediaId === 'ready-linked') return { url: 'https://storage.example.test/signed/temporary-token', expiresIn: 1 };
      if (['staged', 'unrelated-ready', 'missing'].includes(mediaId)) throw denied();
      throw denied();
    },
  };
}

async function withBff(run) {
  const server = http.createServer(createHostedBffApp({ env: env(), store: store() }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json', origin } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
    return { response, body: await response.json().catch(() => ({})), cookie: setCookie.split(';')[0] };
  };
  try { await run(request); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('cloud dashboard preview route requires a session and issues only a linked READY media authorization', async () => {
  await withBff(async (request) => {
    const anonymous = await request('/api/cloud-read/media/ready-linked/preview'); assert.equal(anonymous.response.status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } }); assert.equal(login.response.status, 200);
    const ready = await request('/api/cloud-read/media/ready-linked/preview', { cookie: login.cookie });
    assert.equal(ready.response.status, 200); assert.deepEqual(ready.body, { url: 'https://storage.example.test/signed/temporary-token', expiresIn: 1 });
    for (const mediaId of ['staged', 'unrelated-ready', 'missing']) {
      const rejected = await request(`/api/cloud-read/media/${mediaId}/preview`, { cookie: login.cookie }); assert.equal(rejected.response.status, 404);
    }
    assert.ok(!JSON.stringify(ready.body).match(/bucket|object_key|sha256|service_role|operator|agent|database/i));
  });
});

test('ephemeral cloud preview cache refreshes an expired or invalidated authorization without durable storage', async () => {
  const { createEphemeralPreviewCache } = await import('../dashboard-v2/src/services/cloudMediaPreview.js');
  let now = 0; let calls = 0;
  const cache = createEphemeralPreviewCache({ now: () => now, requestPreview: async () => ({ url: `https://storage.example.test/signed/${++calls}`, expiresIn: 2 }) });
  assert.equal(await cache.resolve('ready-linked'), 'https://storage.example.test/signed/1'); assert.equal(await cache.resolve('ready-linked'), 'https://storage.example.test/signed/1'); assert.equal(calls, 1);
  now = 3000; assert.equal(await cache.resolve('ready-linked'), 'https://storage.example.test/signed/2'); assert.equal(calls, 2);
  cache.invalidate('ready-linked'); assert.equal(await cache.resolve('ready-linked'), 'https://storage.example.test/signed/3'); assert.equal(calls, 3);
});

test('central cloud-mode capabilities preserve local media behavior and block local write fallback', async () => {
  const mode = await import('../dashboard-v2/src/services/dashboardDataMode.js');
  assert.equal(mode.dashboardCapabilities(mode.DASHBOARD_DATA_MODES.LOCAL).mediaUpload, true);
  assert.equal(mode.dashboardCapabilities(mode.DASHBOARD_DATA_MODES.LOCAL).signedMediaPreview, false);
  assert.equal(mode.dashboardCapabilities(mode.DASHBOARD_DATA_MODES.CLOUD_READ_ONLY).signedMediaPreview, true);
  assert.equal(mode.dashboardCapabilities(mode.DASHBOARD_DATA_MODES.CLOUD_READ_ONLY).mediaUpload, false);
  assert.throws(() => mode.assertCloudReadOnlyRequest(mode.DASHBOARD_DATA_MODES.CLOUD_READ_ONLY, 'DELETE', '/media'), /no local write fallback/);
});
