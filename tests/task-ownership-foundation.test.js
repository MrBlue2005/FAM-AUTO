'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { managedTaskOwnerId, taskWithServerOwner } = require('../server/task-ownership');
const { SupabaseApplicationDataStore } = require('../app/cloud/SupabaseApplicationDataStore');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202609100001_task_owner_user.sql'), 'utf8');

test('Phase G1 migration preserves legacy ownership, restricts deletion, and makes only owner changes immutable', () => {
  assert.match(migration, /add column if not exists owner_user_id uuid references public\.hosted_users\(user_id\) on delete restrict/i);
  assert.match(migration, /tasks_owner_history_idx[\s\S]*owner_user_id, created_at desc[\s\S]*where owner_user_id is not null/i);
  assert.match(migration, /old\.owner_user_id is distinct from new\.owner_user_id/i);
  assert.match(migration, /TASK_OWNER_IMMUTABLE/);
  assert.doesNotMatch(migration, /update public\.tasks|update tasks/i);
  assert.doesNotMatch(migration, /on delete (cascade|set null)/i);
  assert.match(migration, /revoke all on function public\.rx_cp_task_owner_immutable\(\) from public, anon, authenticated/i);
});

test('only a stable managed USER session can provide the internal task owner', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  assert.equal(managedTaskOwnerId({ role: 'ADMIN', managedUserId: userA }), null);
  assert.equal(managedTaskOwnerId({ role: 'USER' }), null);
  assert.equal(managedTaskOwnerId({ role: 'USER', managedUserId: 'not-a-user-id' }), null);
  assert.equal(managedTaskOwnerId({ role: 'USER', managedUserId: userA }), userA);
  assert.deepEqual(taskWithServerOwner({ task_id: 'task-a', payload: { ownerUserId: userB } }, { role: 'USER', managedUserId: userA }), { task_id: 'task-a', payload: { ownerUserId: userB }, owner_user_id: userA });
  assert.equal(taskWithServerOwner({ task_id: 'system-task' }, null).owner_user_id, null);
});

test('control-plane store selects ownership internally and pushes owner filtering to Supabase', async () => {
  const requests = [];
  const store = new SupabaseApplicationDataStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-key', fetchImpl: async (url) => { requests.push(url); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); } });
  await store.listControlPlaneTasks({ limit: 25, ownerUserId: '11111111-1111-4111-8111-111111111111' });
  await store.getControlPlaneTaskHistory('task-a', { ownerUserId: '11111111-1111-4111-8111-111111111111' });
  assert.match(requests[0], /owner_user_id=eq\.11111111-1111-4111-8111-111111111111/);
  assert.match(requests[0], /select=.*owner_user_id/);
  assert.match(requests[1], /select=.*owner_user_id/);
  assert.match(requests[1], /owner_user_id=eq\.11111111-1111-4111-8111-111111111111/);
});

test('remote task creation accepts no browser ownership field', () => {
  const source = fs.readFileSync(path.join(root, 'server', 'cloud-remote-task-api.js'), 'utf8');
  assert.match(source, /taskWithServerOwner\([^\n]*user\)/);
  assert.match(source, /user: req\.user/);
  assert.doesNotMatch(source, /req\.body\?\.(owner_user_id|ownerUserId|createdByUserId)/);
  assert.match(source, /taskWithServerOwner\([\s\S]*?\}, null\)/);
});
