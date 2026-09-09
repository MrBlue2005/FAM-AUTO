'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('node:crypto'); const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const { createHostedBffApp } = require('../server/hosted-bff');
const origin = 'http://127.0.0.1:5173';
const scrypt = (password) => { const salt = Buffer.alloc(16, 45); return `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`; };
const env = { NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_SCRYPT: scrypt('admin-password'), USER_USERNAME: 'legacy-user', USER_PASSWORD_SCRYPT: scrypt('legacy-password'), RX_BFF_SESSION_SIGNING_SECRET: 'managed-user-test-signing-secret-that-is-long-enough', RX_BFF_ALLOWED_ORIGINS: origin };
function memoryStore() {
  const users = []; let next = 1; const safe = (user) => user && ({ ...user });
  return {
    listManagedUsers: async () => users.map(safe), getManagedUserByUsername: async (username) => safe(users.find((user) => user.username_normalized === username)), getManagedUserById: async (id) => safe(users.find((user) => user.user_id === id)),
    createManagedUser: async ({ username, passwordScrypt }) => { const now = new Date().toISOString(); const user = { user_id: `user-${next++}`, username, username_normalized: username, password_scrypt: passwordScrypt, role: 'USER', enabled: true, session_version: 1, created_at: now, updated_at: now, last_login_at: null }; users.push(user); return safe(user); },
    updateManagedUser: async (id, change) => { const user = users.find((item) => item.user_id === id); if (!user) return null; if (typeof change.enabled === 'boolean') user.enabled = change.enabled; if (change.passwordScrypt) user.password_scrypt = change.passwordScrypt; if (change.invalidateSessions) user.session_version += 1; user.updated_at = new Date().toISOString(); return safe(user); },
    recordManagedUserLogin: async (id) => { const user = users.find((item) => item.user_id === id); if (user) user.last_login_at = new Date().toISOString(); return safe(user); },
  };
}
async function withBff(run) { const store = memoryStore(); const server = http.createServer(createHostedBffApp({ env, store })); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`; const request = async (url, { method = 'GET', body, auth, csrf = true, requestOrigin = origin } = {}) => { const response = await fetch(`${base}${url}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { cookie: auth.cookie } : {}), ...(method !== 'GET' && csrf && auth ? { 'x-rx-csrf': auth.body.csrfToken } : {}), ...(method !== 'GET' ? { origin: requestOrigin } : {}) }, body: body && JSON.stringify(body) }); return { response, body: await response.json().catch(() => ({})), cookie: (response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '').split(';')[0] }; }; const login = (username, password, extra = {}) => request('/api/auth/login', { method: 'POST', body: { username, password, ...extra } }); try { await run({ request, login }); } finally { await new Promise((resolve) => server.close(resolve)); } }

test('ADMIN bootstraps managed USER lifecycle with safe DTOs and session-version invalidation', async () => {
  await withBff(async ({ request, login }) => {
    const admin = await login('admin', 'admin-password', { role: 'USER' }); assert.equal(admin.response.status, 200); assert.equal(admin.body.role, 'ADMIN');
    const create = await request('/api/admin/users', { method: 'POST', auth: admin, body: { username: '  Alice.Test  ', password: 'managed-password-123', role: 'ADMIN' } }); assert.equal(create.response.status, 400);
    const made = await request('/api/admin/users', { method: 'POST', auth: admin, body: { username: '  Alice.Test  ', password: 'managed-password-123' } }); assert.equal(made.response.status, 201); assert.deepEqual(Object.keys(made.body.user).sort(), ['createdAt', 'enabled', 'lastLoginAt', 'role', 'updatedAt', 'userId', 'username']); assert.equal(made.body.user.username, 'alice.test'); assert.ok(!JSON.stringify(made.body).match(/scrypt|password|secret/i));
    assert.equal((await request('/api/admin/users', { method: 'POST', auth: admin, body: { username: 'ADMIN', password: 'managed-password-123' } })).response.status, 400);
    const user = await login('alice.test', 'managed-password-123', { role: 'ADMIN' }); assert.equal(user.response.status, 200); assert.equal(user.body.role, 'USER');
    assert.equal((await request('/api/admin/users', { auth: user })).response.status, 403);
    const listed = await request('/api/admin/users', { auth: admin }); assert.equal(listed.response.status, 200); assert.equal(listed.body.users.length, 1); assert.ok(listed.body.users[0].lastLoginAt);
    const disabled = await request(`/api/admin/users/${made.body.user.userId}`, { method: 'PATCH', auth: admin, body: { enabled: false } }); assert.equal(disabled.response.status, 200); assert.equal(disabled.body.user.enabled, false);
    assert.equal((await login('alice.test', 'managed-password-123')).response.status, 401); assert.equal((await request('/api/auth/status', { auth: user })).body.authenticated, false);
    const enabled = await request(`/api/admin/users/${made.body.user.userId}`, { method: 'PATCH', auth: admin, body: { enabled: true } }); assert.equal(enabled.response.status, 200);
    const renewed = await login('alice.test', 'managed-password-123'); assert.equal(renewed.response.status, 200);
    const reset = await request(`/api/admin/users/${made.body.user.userId}/reset-password`, { method: 'POST', auth: admin, body: { password: 'replacement-password-456' } }); assert.equal(reset.response.status, 200); assert.ok(!JSON.stringify(reset.body).match(/password|scrypt|secret/i));
    assert.equal((await login('alice.test', 'managed-password-123')).response.status, 401); assert.equal((await request('/api/auth/status', { auth: renewed })).body.authenticated, false); assert.equal((await login('alice.test', 'replacement-password-456')).body.role, 'USER');
    assert.equal((await login('legacy-user', 'legacy-password')).body.role, 'USER');
    assert.equal((await request('/api/admin/users', { method: 'POST', auth: admin, csrf: false, body: { username: 'bob', password: 'managed-password-123' } })).response.status, 403);
    assert.equal((await request('/api/admin/users', { method: 'POST', auth: admin, requestOrigin: 'https://untrusted.example.test', body: { username: 'bob', password: 'managed-password-123' } })).response.status, 403);
  });
});
test('managed-user migration and hosted ADMIN Users UI keep hashes and passwords server-only', () => {
  const root = path.join(__dirname, '..'); const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202609090001_hosted_managed_users.sql'), 'utf8'); const page = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'pages', 'Users.jsx'), 'utf8'); const sidebar = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'layout', 'Sidebar.jsx'), 'utf8');
  for (const field of ['user_id', 'username_normalized', 'password_scrypt', 'session_version', 'last_login_at']) assert.match(sql, new RegExp(field)); assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on table public\.hosted_users from public, anon, authenticated/); assert.match(sql, /grant select, insert, update, delete on table public\.hosted_users to service_role/);
  assert.match(sidebar, /id: 'users'/); assert.match(page, /if \(!isAdmin\)/); assert.match(page, /type="password"/); assert.match(page, /Adaugă utilizator/); assert.match(page, /Resetează parola/); for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'console.', 'password_scrypt']) assert.equal(page.includes(forbidden), false);
});
