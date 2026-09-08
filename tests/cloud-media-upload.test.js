'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('node:crypto'); const http = require('node:http');
const { createHostedBffApp } = require('../server/hosted-bff');
const origin = 'http://127.0.0.1:5173'; const password = 'upload password'; const salt = Buffer.alloc(16, 2);
const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
const env = (enabled = true) => ({ NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_PASSWORD_SCRYPT: passwordHash, RX_BFF_SESSION_SIGNING_SECRET: 'upload-test-signing-secret-that-is-long-enough', RX_BFF_ALLOWED_ORIGINS: origin, RX_BFF_CLOUD_MEDIA_UPLOAD_ENABLED: enabled ? 'true' : 'false' });

async function fixture(run, enabled = true) {
  let uploaded = false; let attachment; let wrongHash = false; const storage = http.createServer((req, res) => { uploaded = req.method === 'PUT' && req.headers.authorization === 'Bearer scoped-token'; res.statusCode = uploaded ? 200 : 403; res.end(); });
  await new Promise((resolve) => storage.listen(0, '127.0.0.1', resolve)); const uploadUrl = `http://127.0.0.1:${storage.address().port}/upload`;
  const store = { listCampaignFolders: async () => [], listTargets: async () => [], listScheduleFolders: async () => [], listSchedules: async () => [], listMedia: async () => [], createPreview: async () => ({ url: 'https://preview.test/token', expiresIn: 120 }),
    listCampaigns: async () => [{ legacy_id: 'PROPERTY_1', app_campaign_posts: [{ post_id: 'post-1', day: 1, revision: 3, app_post_media: [{ ordinal: 0, app_media_objects: { media_id: 'existing' } }] }] }],
    initiateMedia: async (value) => { if (value.mimeType !== 'image/png') throw Object.assign(new Error('Invalid immutable media metadata.'), { status: 400 }); if (value.byteSize > 100) throw Object.assign(new Error('Invalid immutable media metadata.'), { status: 400 }); wrongHash = value.sha256 === 'b'.repeat(64); return { media: { media_id: 'media-1', state: 'STAGED', byte_size: value.byteSize, mime_type: value.mimeType }, upload: { url: uploadUrl, token: 'scoped-token' }, expires_in: 120 }; },
    finalizeMedia: async () => { if (!uploaded) throw Object.assign(new Error('Uploaded object was not found for verification.'), { status: 409 }); if (wrongHash) throw Object.assign(new Error('Uploaded object SHA-256 does not match immutable metadata.'), { status: 409 }); return { media: { media_id: 'media-1', state: 'READY', byte_size: 3, mime_type: 'image/png', original_name: 'synthetic.png' }, verification: { byte_size: 3 } }; },
    setPostMedia: async (value) => { attachment = value; return { media_ids: value.mediaIds }; },
  };
  const server = http.createServer(createHostedBffApp({ env: env(enabled), store })); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie, csrf, requestOrigin = method === 'GET' ? undefined : origin } = {}) => { const response = await fetch(`${base}${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-rx-csrf': csrf } : {}), ...(requestOrigin ? { origin: requestOrigin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || ''; return { response, body: await response.json().catch(() => ({})), cookie: setCookie.split(';')[0] }; };
  try { await run({ request, uploadUrl, getAttachment: () => attachment }); } finally { await new Promise((resolve) => server.close(resolve)); await new Promise((resolve) => storage.close(resolve)); }
}

test('cloud media upload capability authorizes initiate, direct scoped upload, verification, and ordered attachment', async () => {
  await fixture(async ({ request, uploadUrl, getAttachment }) => {
    const anonymous = await request('/api/cloud-media/initiate', { method: 'POST', body: {} }); assert.equal(anonymous.response.status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } });
    const missingCsrf = await request('/api/cloud-media/initiate', { method: 'POST', body: { originalName: 'x.png', mimeType: 'image/png', byteSize: 3, sha256: 'a'.repeat(64) }, cookie: login.cookie }); assert.equal(missingCsrf.response.status, 403);
    const wrongOrigin = await request('/api/cloud-media/initiate', { method: 'POST', body: { originalName: 'x.png', mimeType: 'image/png', byteSize: 3, sha256: 'a'.repeat(64) }, cookie: login.cookie, csrf: login.body.csrfToken, requestOrigin: 'https://attacker.test' }); assert.equal(wrongOrigin.response.status, 403);
    const initiated = await request('/api/cloud-media/initiate', { method: 'POST', body: { originalName: 'synthetic.png', mimeType: 'image/png', byteSize: 3, sha256: 'a'.repeat(64) }, cookie: login.cookie, csrf: login.body.csrfToken }); assert.equal(initiated.response.status, 200); assert.equal(initiated.body.media.state, 'STAGED'); assert.ok(!JSON.stringify(initiated.body).match(/service_role|operator|agent|database|object_key|bucket|sha256/i));
    assert.equal((await fetch(uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${initiated.body.upload.token}`, 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) })).status, 200);
    const finalized = await request('/api/cloud-media/media-1/finalize', { method: 'POST', body: {}, cookie: login.cookie, csrf: login.body.csrfToken }); assert.equal(finalized.body.media.state, 'READY');
    const attached = await request('/api/cloud-media/attach', { method: 'POST', body: { kind: 'property', campaignId: 'PROPERTY_1', day: 1, mediaId: 'media-1' }, cookie: login.cookie, csrf: login.body.csrfToken }); assert.deepEqual(attached.body.post.mediaIds, ['existing', 'media-1']); assert.deepEqual(getAttachment().mediaIds, ['existing', 'media-1']);
    const retry = await request('/api/cloud-media/attach', { method: 'POST', body: { kind: 'property', campaignId: 'PROPERTY_1', day: 1, mediaId: 'media-1' }, cookie: login.cookie, csrf: login.body.csrfToken }); assert.deepEqual(retry.body.post.mediaIds, ['existing', 'media-1']);
  });
});

test('cloud media upload rejects invalid input, failed storage finalization, and disabled capability without fallback', async () => {
  await fixture(async ({ request, uploadUrl }) => { const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } }); const csrf = login.body.csrfToken;
    const invalidMime = await request('/api/cloud-media/initiate', { method: 'POST', body: { mimeType: 'text/plain', byteSize: 3 }, cookie: login.cookie, csrf }); assert.equal(invalidMime.response.status, 400);
    const oversized = await request('/api/cloud-media/initiate', { method: 'POST', body: { mimeType: 'image/png', byteSize: 101 }, cookie: login.cookie, csrf }); assert.equal(oversized.response.status, 400);
    const finalizeWithoutUpload = await request('/api/cloud-media/media-1/finalize', { method: 'POST', body: {}, cookie: login.cookie, csrf }); assert.equal(finalizeWithoutUpload.response.status, 409);
    const wrongHash = await request('/api/cloud-media/initiate', { method: 'POST', body: { originalName: 'wrong.png', mimeType: 'image/png', byteSize: 3, sha256: 'b'.repeat(64) }, cookie: login.cookie, csrf }); await fetch(uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${wrongHash.body.upload.token}` }, body: new Uint8Array([1, 2, 3]) }); const hashFinalize = await request('/api/cloud-media/media-1/finalize', { method: 'POST', body: {}, cookie: login.cookie, csrf }); assert.equal(hashFinalize.response.status, 409);
  });
  await fixture(async ({ request }) => { const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } }); const disabled = await request('/api/cloud-media/initiate', { method: 'POST', body: {}, cookie: login.cookie, csrf: login.body.csrfToken }); assert.equal(disabled.response.status, 404); }, false);
});
