'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHostedBffApp } = require('../server/hosted-bff');

const root = path.join(__dirname, '..');
const origin = 'http://127.0.0.1:5173';
const password = 'device-admin-password';
const hash = (() => {
  const salt = Buffer.alloc(16, 31);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
})();
const env = {
  NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_SCRYPT: hash,
  USER_USERNAME: 'user', USER_PASSWORD_SCRYPT: hash,
  RX_BFF_SESSION_SIGNING_SECRET: 'device-admin-test-signing-secret-that-is-long-enough',
  RX_BFF_ALLOWED_ORIGINS: origin,
  RX_BFF_AGENT_PROTOCOL_URL: 'https://control-plane.example.test',
  RX_BFF_OPERATOR_API_TOKEN: 'operator-server-only-test-value',
};

function fixtureStore() {
  const renamed = [];
  return {
    renamed,
    renameControlPlaneAgent: async (agentId, displayName) => {
      renamed.push({ agentId, displayName });
      return agentId === 'agent_A' ? { agent_id: agentId, display_name: displayName, credential: 'never-returned' } : null;
    },
    listControlPlaneAgents: async () => [{ agent_id: 'agent_A', display_name: 'PC Birou', reported_status: 'ONLINE', last_seen_at: new Date().toISOString(), credential: 'machine-local-credential', enrollment_token: 'never-returned' }],
    listControlPlaneProfiles: async () => [{ profile_id: 'profile_A', agent_id: 'agent_A', display_name: 'Profil local', status: 'READY', last_seen_at: new Date().toISOString(), profile_path: 'never-returned' }],
  };
}

async function withBff(run) {
  const store = fixtureStore();
  const server = http.createServer(createHostedBffApp({ env, store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username) => {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username, password }) });
    const body = await response.json();
    return { body, cookie: (response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '').split(';')[0] };
  };
  try { await run({ base, store, login }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('device display-name validation trims only the reviewed input and rejects empty or oversized names', async () => {
  const { validateDeviceDisplayName, DEVICE_DISPLAY_NAME_MAX_LENGTH } = await import('../dashboard-v2/src/services/deviceAdminUi.js');
  assert.equal(DEVICE_DISPLAY_NAME_MAX_LENGTH, 80);
  assert.deepEqual(validateDeviceDisplayName('  PC Birou  '), { displayName: 'PC Birou', error: '' });
  assert.equal(validateDeviceDisplayName('   ').error.length > 0, true);
  assert.equal(validateDeviceDisplayName('x'.repeat(81)).error.length > 0, true);
});

test('ADMIN device UI keeps enrollment ephemeral and sends only the reviewed rename input', () => {
  const page = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'pages', 'Devices.jsx'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'services', 'api.js'), 'utf8');
  assert.match(page, /devices\.map\(\(device\)/);
  assert.match(page, /Adaugă dispozitiv/);
  assert.match(page, /Redenumește/);
  assert.match(page, /setRenameValue\(device\.displayName\)/);
  assert.match(page, /validateDeviceDisplayName\(renameValue\)/);
  assert.match(page, /await api\.renameDevice\(deviceId, displayName\)/);
  assert.match(page, /await load\(\)/);
  assert.match(page, /renameError\.message/);
  assert.match(api, /request\(`\/admin\/devices\/\$\{encodeURIComponent\(deviceId\)\}`, \{ method: 'PATCH', body: JSON\.stringify\(\{ displayName \}\) \}\)/);
  assert.match(api, /request\('\/admin\/devices\/enrollment-tokens', \{ method: 'POST', body: '\{\}' \}\)/);
  assert.match(page, /const \[enrollment, setEnrollment\] = useState\(null\)/);
  assert.match(page, /setEnrollment\(await api\.createEnrollmentToken\(\)\)/);
  assert.match(page, /onClick=\{\(\) => setEnrollment\(null\)\}/);
  assert.match(page, /navigator\.clipboard\?\.writeText\(enrollment\.enrollmentToken\)/);
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'window.location', 'URLSearchParams', 'analytics', 'console.']) assert.equal(page.includes(forbidden), false, `enrollment UI must not persist or log through ${forbidden}`);
});

test('ADMIN rename is CSRF/origin protected, exact-targeted, and returns no persistent credential', async () => {
  await withBff(async ({ base, store, login }) => {
    const admin = await login('admin');
    const call = (agentId, body, headers = {}) => fetch(`${base}/api/admin/devices/${agentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin, cookie: admin.cookie, 'x-rx-csrf': admin.body.csrfToken, ...headers }, body: JSON.stringify(body) });
    const renamed = await call('agent_A', { displayName: '  PC Nou  ', ignored: 'not-accepted' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(await renamed.json(), { device: { deviceId: 'agent_A', displayName: 'PC Nou' } });
    assert.deepEqual(store.renamed, [{ agentId: 'agent_A', displayName: 'PC Nou' }]);
    assert.equal((await call('agent_B', { displayName: 'PC B' })).status, 404);
    assert.equal((await call('agent_A', { displayName: ' ' })).status, 400);
    assert.equal((await call('agent_A', { displayName: 'x'.repeat(81) })).status, 400);
    assert.equal((await fetch(`${base}/api/admin/devices/agent_A`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin, cookie: admin.cookie }, body: JSON.stringify({ displayName: 'PC' }) })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/devices/agent_A`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://untrusted.example.test', cookie: admin.cookie, 'x-rx-csrf': admin.body.csrfToken }, body: JSON.stringify({ displayName: 'PC' }) })).status, 403);
  });
});

test('enrollment issuance is ADMIN-only, one-time response-only, and never exposes the operator credential', async () => {
  const originalFetch = global.fetch;
  let operatorRequest;
  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith('https://control-plane.example.test/')) {
      operatorRequest = { url: String(url), options };
      return new Response(JSON.stringify({ enrollment_token: 'one-time-enrollment-token', expires_at: '2026-09-09T12:15:00.000Z' }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(url, options);
  };
  try {
    await withBff(async ({ base, login }) => {
      const admin = await login('admin'); const user = await login('user');
      const issue = (auth, extra = {}) => fetch(`${base}/api/admin/devices/enrollment-tokens`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: auth.cookie, 'x-rx-csrf': auth.body.csrfToken, ...extra }, body: '{}' });
      assert.equal((await issue(user)).status, 403);
      assert.equal(operatorRequest, undefined);
      const response = await issue(admin); assert.equal(response.status, 201);
      const body = await response.json();
      assert.deepEqual(body, { enrollmentToken: 'one-time-enrollment-token', expiresAt: '2026-09-09T12:15:00.000Z' });
      assert.equal(operatorRequest.url, 'https://control-plane.example.test/v1/operator/enrollment-tokens');
      assert.deepEqual(JSON.parse(operatorRequest.options.body), { resolver: 'admin:admin', ttl_seconds: 900 });
      assert.equal(operatorRequest.options.headers['x-rx-operator-token'], env.RX_BFF_OPERATOR_API_TOKEN);
      assert.equal(JSON.stringify(body).includes(env.RX_BFF_OPERATOR_API_TOKEN), false);
      assert.equal((await issue(admin, { 'x-rx-csrf': '' })).status, 403);
      const devices = await fetch(`${base}/api/cloud-read/devices`, { headers: { cookie: admin.cookie } });
      const dto = await devices.json();
      assert.equal(devices.status, 200);
      assert.ok(!JSON.stringify(dto).match(/credential|enrollment|profile_path|secret|token/i));
    });
  } finally { global.fetch = originalFetch; }
});

test('USER cannot receive Device Admin UI or an enrollment token endpoint, while Phase B/C selection remains explicit', async () => {
  const sidebar = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'layout', 'Sidebar.jsx'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'pages', 'Devices.jsx'), 'utf8');
  assert.match(sidebar, /isAdmin \? hostedAdminItems : hostedManagedUserItems/);
  assert.match(page, /if \(!isAdmin\) return/);
  assert.match(page, /Dispozitivele sunt disponibile numai administratorilor/);
  assert.match(page, /if \(!api\.isCloudReadOnly\(\)\) return null/);
  const { resolveHostedDeviceProfileSelection, DEVICE_PROFILE_READINESS } = await import('../dashboard-v2/src/services/hostedDeviceSelection.js');
  const devices = [{ deviceId: 'agent-A', online: true, profiles: [{ profileId: 'profile-A', ready: true }] }, { deviceId: 'agent-B', online: true, profiles: [{ profileId: 'profile-B', ready: true }] }];
  const crossDevice = resolveHostedDeviceProfileSelection(devices, { deviceId: 'agent-A', profileId: 'profile-B' });
  assert.equal(crossDevice.selectedProfileId, null); assert.equal(crossDevice.readiness, DEVICE_PROFILE_READINESS.NO_PROFILE);
});

test('new-PC handoff documents the one-time enrollment boundary without storing credentials', () => {
  const guide = fs.readFileSync(path.join(root, 'docs', 'SETUP_NEW_PC.md'), 'utf8');
  assert.match(guide, /Hosted Admin/); assert.match(guide, /15 minute/); assert.match(guide, /nu poate fi recuperat/);
  assert.match(guide, /propria identitate/); assert.match(guide, /server-side/); assert.match(guide, /Revocarea/); assert.match(guide, /rotația credentialelor/);
});
