'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const intent = { kind: 'property', campaignId: 'campaign', day: 1, targetId: 'target', deviceId: 'device', profileId: 'profile', campaignRevision: 2, postRevision: 3 };

async function flowFixture(run) {
  let clock = Date.parse('2026-09-12T12:00:00.000Z');
  const { createLiveConfirmationFlow } = await import('../dashboard-v2/src/services/liveConfirmationFlow.js');
  const flow = createLiveConfirmationFlow({ now: () => clock });
  const advance = (milliseconds) => { clock += milliseconds; };
  await run({ flow, advance, now: () => clock });
}

test('G5.5F-C first click issues once, opens one dialog, and does not create a task on rerender', async () => {
  await flowFixture(async ({ flow, now }) => {
    let issues = 0; let creates = 0;
    const opened = await flow.open(intent, async () => ({ confirmationToken: `token-${++issues}`, expiresAt: Math.floor(now() / 1000) + 600 }));
    assert.equal(opened.opened, true); assert.equal(issues, 1); assert.equal(creates, 0); assert.equal(flow.snapshot().dialogOpen, true);
    assert.equal(flow.snapshot().dialogOpen, true); assert.equal(issues, 1, 'rerender reads state only'); assert.equal(creates, 0);
  });
});

test('G5.5F-C submits exactly one frozen token, suppresses pending duplicates, and displays the new returned task', async () => {
  await flowFixture(async ({ flow, now }) => {
    await flow.open(intent, async () => ({ confirmationToken: 'token-A', expiresAt: Math.floor(now() / 1000) + 600 }));
    let resolveCreate; let creates = 0; let body;
    const create = async (request) => { creates += 1; body = request; return new Promise((resolve) => { resolveCreate = () => resolve({ task: { taskId: 'new-task-B', status: 'QUEUED' } }); }); };
    const first = flow.submit(intent, create); const second = await flow.submit(intent, create);
    assert.equal(second.ignored, true); assert.equal(creates, 1); assert.deepEqual(body, { ...intent, confirmationToken: 'token-A' });
    resolveCreate(); const completed = await first;
    assert.equal(completed.result.task.taskId, 'new-task-B'); assert.equal(flow.snapshot().dialogOpen, false);
  });
});

test('G5.5F-C cancel/close discard tokens and each explicit reopen receives a fresh token', async () => {
  await flowFixture(async ({ flow, now }) => {
    let issued = 0; const issue = async () => ({ confirmationToken: `token-${++issued}`, expiresAt: Math.floor(now() / 1000) + 600 });
    await flow.open(intent, issue); flow.cancel(); assert.equal(flow.snapshot().dialogOpen, false);
    await flow.open(intent, issue); assert.equal(issued, 2); flow.cancel();
    await flow.open(intent, issue); assert.equal(issued, 3);
  });
});

test('G5.5F-C invalidates on selection change, issuance failure, expiry, and token-invalid create errors without task creation', async () => {
  await flowFixture(async ({ flow, advance, now }) => {
    let creates = 0;
    const issue = async () => ({ confirmationToken: 'token-A', expiresAt: Math.floor(now() / 1000) + 1 });
    await flow.open(intent, issue); assert.equal(flow.invalidateIfIntentChanged({ ...intent, day: 2 }), true); assert.equal(flow.snapshot().dialogOpen, false);
    const failed = await flow.open(intent, async () => { throw new Error('safe issuance failure'); }); assert.ok(failed.error); assert.equal(flow.snapshot().dialogOpen, false);
    await flow.open(intent, issue); advance(1000); const expired = await flow.submit(intent, async () => { creates += 1; }); assert.equal(expired.expired, true); assert.equal(creates, 0);
    flow.cancel(); await flow.open(intent, async () => ({ confirmationToken: 'token-B', expiresAt: Math.floor(now() / 1000) + 600 }));
    const invalid = await flow.submit(intent, async () => { const error = new Error('safe'); error.code = 'LIVE_CONFIRMATION_EXPIRED'; throw error; }); assert.equal(invalid.invalidated, true); assert.equal(flow.snapshot().dialogOpen, false);
  });
});

test('G5.5F-C keeps the same token for a manual network retry and never persists or displays it', async () => {
  await flowFixture(async ({ flow, now }) => {
    await flow.open(intent, async () => ({ confirmationToken: 'token-retry', expiresAt: Math.floor(now() / 1000) + 600 }));
    const requests = [];
    const first = await flow.submit(intent, async (body) => { requests.push(body); throw new Error('network'); });
    assert.ok(first.error); assert.equal(flow.snapshot().dialogOpen, true);
    await flow.submit(intent, async (body) => { requests.push(body); return { task: { taskId: 'new-task-B', status: 'QUEUED' } }; });
    assert.equal(requests.length, 2); assert.equal(requests[0].confirmationToken, requests[1].confirmationToken);
    for (const request of requests) for (const forbidden of ['confirmationId', 'publishEnabled', 'taskType', 'executionMode', 'owner', 'sideEffectState', 'payload', 'path']) assert.equal(Object.hasOwn(request, forbidden), false);
  });
  const page = source('dashboard-v2', 'src', 'pages', 'Executions.jsx'); const api = source('dashboard-v2', 'src', 'services', 'api.js'); const flow = source('dashboard-v2', 'src', 'services', 'liveConfirmationFlow.js');
  assert.match(page, /liveFlow\.intent\.campaignId/); assert.match(page, /Confirmarea a expirat\. Deschide din nou publicarea\./); assert.match(api, /issueLiveConfirmation/); assert.match(api, /confirmationToken/);
  for (const file of [page, api, flow]) assert.doesNotMatch(file, /localStorage|sessionStorage|indexedDB|document\.cookie|console\.(log|info|debug)/i);
});
