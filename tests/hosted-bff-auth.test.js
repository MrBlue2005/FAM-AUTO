'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { createHostedBffApp, signPayload } = require('../server/hosted-bff');

const origin = 'http://127.0.0.1:5173';
const sessionSecret = 'test-session-signing-secret-that-is-long-enough-12345';
const adminPassword = 'correct horse battery staple';
const salt = Buffer.alloc(16, 7);
const adminHash = `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(adminPassword, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;

function environment() {
  return {
    NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_SCRYPT: adminHash,
    RX_BFF_SESSION_SIGNING_SECRET: sessionSecret, RX_BFF_ALLOWED_ORIGINS: origin,
    RX_APP_SUPABASE_URL: 'https://supabase.invalid', RX_APP_SUPABASE_SERVICE_ROLE_KEY: 'service-role-value-must-not-leak',
  };
}

async function withBff(run, options = {}) {
  const app = createHostedBffApp({ env: environment(), ...options });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie, csrf, requestOrigin = method === 'GET' ? undefined : origin } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-rx-csrf'] = csrf;
    if (requestOrigin !== undefined) headers.origin = requestOrigin;
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
    return { response, body: await response.json(), cookie: setCookie.split(';')[0], setCookie };
  };
  try { await run({ request, base }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('hosted BFF uses signed stateless sessions, session-bound CSRF, and strict origin checks', async () => {
  let clock = Date.parse('2026-09-08T12:00:00.000Z');
  await withBff(async ({ request }) => {
    const health = await request('/api/bff/healthz');
    assert.equal(health.response.status, 200); assert.deepEqual(health.body, { ok: true, status: 'ready' });

    const invalid = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
    assert.equal(invalid.response.status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: adminPassword } });
    assert.equal(login.response.status, 200); assert.equal(login.body.username, 'admin'); assert.ok(login.body.csrfToken);
    assert.match(login.cookie, /^rx_session=/); assert.match(login.setCookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/); assert.ok(!JSON.stringify(login).includes(sessionSecret)); assert.ok(!JSON.stringify(login).includes('service-role-value-must-not-leak'));

    const status = await request('/api/auth/status', { cookie: login.cookie });
    assert.equal(status.body.authenticated, true); assert.equal(status.body.csrfToken, login.body.csrfToken);
    const tampered = await request('/api/auth/status', { cookie: `${login.cookie}x` });
    assert.equal(tampered.body.authenticated, false);
    const expiredToken = signPayload({ v: 1, username: 'admin', role: 'admin', csrf: 'expired', exp: Math.floor(clock / 1000) - 1 }, sessionSecret);
    const expired = await request('/api/auth/status', { cookie: `rx_session=${expiredToken}` });
    assert.equal(expired.body.authenticated, false);

    const missingCsrf = await request('/api/bff/csrf-probe', { method: 'POST', cookie: login.cookie });
    assert.equal(missingCsrf.response.status, 403);
    const invalidCsrf = await request('/api/bff/csrf-probe', { method: 'POST', cookie: login.cookie, csrf: 'not-the-session-token' });
    assert.equal(invalidCsrf.response.status, 403);
    const validCsrf = await request('/api/bff/csrf-probe', { method: 'POST', cookie: login.cookie, csrf: login.body.csrfToken });
    assert.equal(validCsrf.response.status, 200);
    const crossOrigin = await request('/api/bff/csrf-probe', { method: 'POST', cookie: login.cookie, csrf: login.body.csrfToken, requestOrigin: 'https://attacker.invalid' });
    assert.equal(crossOrigin.response.status, 403);

    const second = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: adminPassword } });
    const crossSessionCsrf = await request('/api/bff/csrf-probe', { method: 'POST', cookie: login.cookie, csrf: second.body.csrfToken });
    assert.equal(crossSessionCsrf.response.status, 403);

    // A newly constructed app represents a serverless cold instance: no Map is shared.
    const coldApp = createHostedBffApp({ env: environment(), now: () => clock });
    const coldServer = http.createServer(coldApp); await new Promise((resolve) => coldServer.listen(0, '127.0.0.1', resolve));
    try {
      const cold = await fetch(`http://127.0.0.1:${coldServer.address().port}/api/auth/status`, { headers: { cookie: login.cookie } });
      assert.equal((await cold.json()).authenticated, true);
    } finally { await new Promise((resolve) => coldServer.close(resolve)); }

    const logout = await request('/api/auth/logout', { method: 'POST', cookie: login.cookie, csrf: login.body.csrfToken });
    assert.equal(logout.response.status, 200); assert.match(logout.setCookie, /Max-Age=0/);
    const afterLogout = await request('/api/auth/status'); assert.equal(afterLogout.body.authenticated, false);
  }, { now: () => clock });
});

test('hosted BFF fails closed in production without dedicated secrets and origin', () => {
  assert.throws(() => createHostedBffApp({ env: { NODE_ENV: 'production', AUTH_ENABLED: 'true' } }), /Hosted BFF configuration is invalid/);
});

test('hosted BFF never exposes temporary auth diagnostics', async () => {
  await withBff(async ({ request, base }) => {
    const diagnostic = await fetch(`${base}/api/auth/diagnostics`);
    assert.equal(diagnostic.status, 404);
    const invalid = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
    assert.equal(invalid.response.status, 401);
    assert.equal(invalid.response.headers.get('x-rx-auth-diagnostic-password-fingerprint'), null);
  }, { env: { ...environment(), RX_BFF_AUTH_DIAGNOSTICS_ENABLED: 'true' } });
});

test('browser form-shaped login credentials authenticate through the hosted BFF', async () => {
  const { loginCredentialsFromFormData } = await import('../dashboard-v2/src/components/loginCredentials.js');
  await withBff(async ({ request }) => {
    const form = new FormData();
    form.set('username', ' admin ');
    form.set('password', adminPassword);
    const login = await request('/api/auth/login', { method: 'POST', body: loginCredentialsFromFormData(form) });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.username, 'admin');

    form.set('password', 'wrong');
    const invalid = await request('/api/auth/login', { method: 'POST', body: loginCredentialsFromFormData(form) });
    assert.equal(invalid.response.status, 401);
  });
});

test('production sessions set Secure cookies for the configured same origin', async () => {
  const productionOrigin = 'https://dashboard.example';
  await withBff(async ({ request }) => {
    const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: adminPassword }, requestOrigin: productionOrigin });
    assert.equal(login.response.status, 200); assert.match(login.setCookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure$/);
  }, { env: { ...environment(), NODE_ENV: 'production', RX_BFF_PUBLIC_ORIGIN: productionOrigin } });
});
