'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { createHostedBffApp } = require('../server/hosted-bff');

const origin = 'http://127.0.0.1:5173';
const password = 'managed-history-password';
const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const salt = Buffer.alloc(16, 7);
const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`;
const env = { NODE_ENV: 'test', AUTH_ENABLED: 'true', ADMIN_PASSWORD_SCRYPT: passwordHash, RX_BFF_SESSION_SIGNING_SECRET: 'user-history-test-signing-secret-that-is-long-enough', RX_BFF_ALLOWED_ORIGINS: origin };

function fixture() {
  const users = new Map([
    [ownerA, { user_id: ownerA, username: 'user.a', username_normalized: 'user.a', password_scrypt: passwordHash, role: 'USER', enabled: true, session_version: 1 }],
    [ownerB, { user_id: ownerB, username: 'user.b', username_normalized: 'user.b', password_scrypt: passwordHash, role: 'USER', enabled: true, session_version: 1 }],
  ]);
  const tasks = [
    { task_id: 'a-completed', owner_user_id: ownerA, agent_id: 'agent-a', profile_id: 'profile-a', task_type: 'CAMPAIGN_PREFLIGHT', status: 'COMPLETED', created_at: '2026-09-10T10:00:00Z', attempt: 1, result: { preflight_passed: true, publishEnabled: false, blockers: [] }, payload: { secret: 'never' } },
    { task_id: 'a-unknown', owner_user_id: ownerA, agent_id: 'agent-a', profile_id: 'profile-a', task_type: 'CAMPAIGN_PREFLIGHT', status: 'OUTCOME_UNKNOWN', created_at: '2026-09-10T11:00:00Z', attempt: 1, result: { blockers: [] }, error: { code: 'private' }, lease_id: 'never' },
    { task_id: 'b-completed', owner_user_id: ownerB, agent_id: 'agent-b', profile_id: 'profile-b', task_type: 'CAMPAIGN_PREFLIGHT', status: 'COMPLETED', created_at: '2026-09-10T12:00:00Z', attempt: 1, result: { blockers: [] }, credential: 'never' },
    { task_id: 'legacy-system', owner_user_id: null, agent_id: 'agent-system', profile_id: 'profile-system', task_type: 'DRY_RUN', status: 'COMPLETED', created_at: '2026-09-10T13:00:00Z', attempt: 1, result: { blockers: [] }, payload: { token: 'never' } },
  ];
  const filters = [];
  const store = {
    getManagedUserByUsername: async (username) => [...users.values()].find((user) => user.username_normalized === username) || null,
    getManagedUserById: async (userId) => users.get(userId) || null,
    recordManagedUserLogin: async () => null,
    updateManagedUser: async (userId, { enabled, passwordScrypt, invalidateSessions }) => { const user = users.get(userId); if (!user) return null; if (typeof enabled === 'boolean') user.enabled = enabled; if (passwordScrypt) user.password_scrypt = passwordScrypt; if (invalidateSessions) user.session_version += 1; return user; },
    listControlPlaneAgents: async () => [{ agent_id: 'agent-a', display_name: 'Device A' }, { agent_id: 'agent-b', display_name: 'Device B' }, { agent_id: 'agent-system', display_name: 'System' }],
    listControlPlaneProfiles: async () => [{ profile_id: 'profile-a', agent_id: 'agent-a', display_name: 'Profile A' }, { profile_id: 'profile-b', agent_id: 'agent-b', display_name: 'Profile B' }, { profile_id: 'profile-system', agent_id: 'agent-system', display_name: 'System Profile' }],
    listControlPlaneTasks: async ({ limit, deviceId, profileId, status, ownerUserId }) => { filters.push(ownerUserId); return tasks.filter((task) => (!ownerUserId || task.owner_user_id === ownerUserId) && (!deviceId || task.agent_id === deviceId) && (!profileId || task.profile_id === profileId) && (!status || task.status === status)).slice(0, limit); },
    getControlPlaneTaskHistory: async (taskId, { ownerUserId } = {}) => tasks.find((task) => task.task_id === taskId && (!ownerUserId || task.owner_user_id === ownerUserId)) || null,
    listControlPlaneTaskEvents: async (taskId) => [{ event_type: 'TASK_COMPLETED', occurred_at: '2026-09-10T10:01:00Z', metadata: { secret: taskId } }],
  };
  return { store, users, filters };
}

async function withBff(run) {
  const data = fixture(); const server = http.createServer(createHostedBffApp({ env, store: data.store }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie, csrf } = {}) => { const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json', origin } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-rx-csrf': csrf } : {}) }, body: body && JSON.stringify(body) }); const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || ''; return { response, body: await response.json(), cookie: setCookie.split(';')[0] }; };
  try { await run({ ...data, request }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('managed users receive only database-owner-scoped task history while ADMIN remains global', async () => {
  await withBff(async ({ request, filters }) => {
    const admin = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } });
    const a = await request('/api/auth/login', { method: 'POST', body: { username: 'user.a', password } });
    const b = await request('/api/auth/login', { method: 'POST', body: { username: 'user.b', password } });
    assert.equal((await request('/api/auth/status', { cookie: a.cookie })).body.managedUser, true);
    const all = await request('/api/cloud-read/tasks', { cookie: admin.cookie }); assert.deepEqual(all.body.tasks.map((task) => task.taskId).sort(), ['a-completed', 'a-unknown', 'b-completed', 'legacy-system']);
    const aTasks = await request(`/api/cloud-read/tasks?ownerUserId=${ownerB}&userId=${ownerB}&scope=all`, { cookie: a.cookie }); assert.deepEqual(aTasks.body.tasks.map((task) => task.taskId).sort(), ['a-completed', 'a-unknown']);
    const bTasks = await request('/api/cloud-read/tasks', { cookie: b.cookie }); assert.deepEqual(bTasks.body.tasks.map((task) => task.taskId), ['b-completed']);
    assert.ok(filters.includes(ownerA)); assert.ok(filters.includes(ownerB)); assert.ok(filters.includes(null));
  });
});

test('owner-scoped detail prevents IDOR and NULL-owned legacy task inspection without leaking internals', async () => {
  await withBff(async ({ request }) => {
    const a = await request('/api/auth/login', { method: 'POST', body: { username: 'user.a', password } }); const b = await request('/api/auth/login', { method: 'POST', body: { username: 'user.b', password } });
    assert.equal((await request('/api/cloud-read/tasks/b-completed', { cookie: a.cookie })).response.status, 404);
    assert.equal((await request('/api/cloud-read/tasks/a-completed', { cookie: b.cookie })).response.status, 404);
    assert.equal((await request('/api/cloud-read/tasks/legacy-system', { cookie: a.cookie })).response.status, 404);
    const unknown = await request('/api/cloud-read/tasks/a-unknown', { cookie: a.cookie }); assert.equal(unknown.response.status, 200); assert.equal(unknown.body.task.outcomeUnknown, true); assert.equal(unknown.body.task.errorCode, 'OUTCOME_UNKNOWN');
    assert.doesNotMatch(JSON.stringify(unknown.body), /owner_user_id|secret|payload|lease|credential|metadata|private/i);
  });
});

test('disabled managed sessions cannot read history and password reset does not alter task ownership', async () => {
  await withBff(async ({ request, users }) => {
    const a = await request('/api/auth/login', { method: 'POST', body: { username: 'user.a', password } });
    const current = users.get(ownerA); current.enabled = false; current.session_version += 1;
    assert.equal((await request('/api/cloud-read/tasks', { cookie: a.cookie })).response.status, 401);
    current.enabled = true;
    const admin = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } });
    const resetPassword = 'managed-history-password-reset';
    const reset = await request(`/api/admin/users/${ownerA}/reset-password`, { method: 'POST', cookie: admin.cookie, csrf: admin.body.csrfToken, body: { password: resetPassword } }); assert.equal(reset.response.status, 200);
    assert.equal((await request('/api/cloud-read/tasks', { cookie: a.cookie })).response.status, 401);
    const renewed = await request('/api/auth/login', { method: 'POST', body: { username: 'user.a', password: resetPassword } });
    const tasks = await request('/api/cloud-read/tasks', { cookie: renewed.cookie }); assert.deepEqual(tasks.body.tasks.map((task) => task.taskId).sort(), ['a-completed', 'a-unknown']);
  });
});
