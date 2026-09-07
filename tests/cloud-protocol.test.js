const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { ReferenceControlPlane, ProtocolError, PROTOCOL_VERSION } = require('../app/cloud-reference/ReferenceControlPlane');
const { HttpAgentTransport } = require('../app/local-agent/HttpAgentTransport');
const { AgentConnectionManager } = require('../app/local-agent/AgentConnectionManager');
const { CloudAgentService } = require('../app/local-agent/CloudAgentService');
const { createReferenceCloudApp } = require('../server/reference-cloud-server');

function fixture() {
  let current = new Date('2026-09-07T12:00:00.000Z');
  const plane = new ReferenceControlPlane({ now: () => new Date(current), leaseMs: 1000, heartbeatExpiryMs: 2000 });
  const advance = (ms) => { current = new Date(current.getTime() + ms); };
  const agent = (id, secret) => plane.enroll({ protocol_version: 1, agent_id: id, agent_secret: secret, display_name: id });
  const heartbeat = (id, profiles, requestId = `hb-${id}-${current.getTime()}`) => plane.heartbeat(id, { protocol_version: 1, display_name: id, agent_status: 'ONLINE', agent_version: '1.1.3', profiles }, requestId);
  const profile = (profileId, displayName = profileId) => ({ profile_id: profileId, display_name: displayName, status: 'READY' });
  const enqueue = (agentId, profileId, taskId = `task-${Object.keys(plane.state.tasks).length + 1}`) => plane.enqueue({ protocol_version: 1, task_id: taskId, agent_id: agentId, profile_id: profileId, task_type: 'FACEBOOK_GROUP_POST', payload: { description: 'snapshot', media: ['object-ref'] } });
  return { plane, advance, agent, heartbeat, profile, enqueue };
}

function claim(f, agentId, requestId) { return f.plane.claim(agentId, { protocol_version: 1 }, requestId).task; }

test('authenticated heartbeat succeeds, invalid secrets fail, and agents expire offline', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a');
  assert.throws(() => f.plane.authenticate('agent_a', 'wrong'), (error) => error.code === 'UNAUTHORIZED_AGENT');
  const result = f.heartbeat('agent_a', [f.profile('profile_a')]);
  assert.equal(result.agent_status, 'ONLINE');
  f.advance(3000); f.plane.expire(); assert.equal(f.plane.state.agents.agent_a.status, 'OFFLINE');
});

test('profile sync rejects sensitive metadata and server-side ownership conflicts', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a'); f.agent('agent_b', 'secret-b');
  assert.throws(() => f.heartbeat('agent_a', [{ ...f.profile('profile_a'), profilePath: 'C:\\secret' }]), (error) => error.code === 'SENSITIVE_FIELD_PROHIBITED');
  f.heartbeat('agent_a', [f.profile('profile_a')]);
  assert.throws(() => f.heartbeat('agent_b', [f.profile('profile_a')]), (error) => error.code === 'PROFILE_OWNERSHIP_CONFLICT');
});

test('claim is atomic, agent-scoped, and same-profile leases are exclusive', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a'); f.agent('agent_b', 'secret-b');
  f.heartbeat('agent_a', [f.profile('profile_a')]); f.heartbeat('agent_b', [f.profile('profile_b')]);
  f.enqueue('agent_a', 'profile_a', 'task_a');
  assert.equal(claim(f, 'agent_b', 'claim-b'), null);
  const first = claim(f, 'agent_a', 'claim-a'); assert.equal(first.task_id, 'task_a');
  assert.equal(claim(f, 'agent_a', 'claim-a-second'), null);
});

test('different profiles may claim independently and lease renewal validates ownership', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a'); f.heartbeat('agent_a', [f.profile('p1'), f.profile('p2')]);
  f.enqueue('agent_a', 'p1', 't1'); f.enqueue('agent_a', 'p2', 't2');
  const one = claim(f, 'agent_a', 'c1'); const two = claim(f, 'agent_a', 'c2'); assert.notEqual(one.profile_id, two.profile_id);
  assert.ok(f.plane.renew('agent_a', one.task_id, one.lease_id, { protocol_version: 1, progress: { current: 1 } }, 'renew-1').lease_expires_at);
  assert.deepEqual(f.plane.state.tasks.t1.progress, { current: 1 });
  assert.throws(() => f.plane.renew('agent_a', one.task_id, 'stale', { protocol_version: 1 }, 'renew-stale'), (error) => error.code === 'STALE_LEASE');
});

test('claimed lease expiry recovers conservatively and stale holders cannot overwrite newer leases', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a'); f.heartbeat('agent_a', [f.profile('p1')]); f.enqueue('agent_a', 'p1', 't1');
  const oldLease = claim(f, 'agent_a', 'claim-1'); f.advance(1200); f.plane.expire();
  const newer = claim(f, 'agent_a', 'claim-2'); assert.notEqual(newer.lease_id, oldLease.lease_id);
  assert.throws(() => f.plane.update('agent_a', 't1', oldLease.lease_id, { protocol_version: 1, result: {} }, 'old-complete', 'COMPLETED'), (error) => error.code === 'STALE_LEASE');
});

test('running lease expiry becomes OUTCOME_UNKNOWN instead of retrying Facebook side effects', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a'); f.heartbeat('agent_a', [f.profile('p1')]); f.enqueue('agent_a', 'p1', 't1');
  const task = claim(f, 'agent_a', 'claim'); f.plane.update('agent_a', 't1', task.lease_id, { protocol_version: 1 }, 'running', 'RUNNING'); f.advance(1200); f.plane.expire();
  assert.equal(f.plane.state.tasks.t1.status, 'OUTCOME_UNKNOWN'); assert.equal(claim(f, 'agent_a', 'claim-again'), null);
});

test('idempotent completion/failure and illegal transitions are enforced', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a'); f.heartbeat('agent_a', [f.profile('p1')]); f.enqueue('agent_a', 'p1', 't1');
  const task = claim(f, 'agent_a', 'claim'); f.plane.update('agent_a', 't1', task.lease_id, { protocol_version: 1 }, 'running', 'RUNNING');
  const done = f.plane.update('agent_a', 't1', task.lease_id, { protocol_version: 1, result: { ok: true } }, 'complete', 'COMPLETED');
  assert.deepEqual(f.plane.update('agent_a', 't1', task.lease_id, { protocol_version: 1, result: { ok: true } }, 'complete', 'COMPLETED'), done);
  assert.throws(() => f.plane.update('agent_a', 't1', task.lease_id, { protocol_version: 1 }, 'illegal', 'RUNNING'), (error) => error.code === 'ILLEGAL_TRANSITION');
});

test('queued cancellation is terminal, claimed/running cancellation is cooperative and observable', () => {
  const f = fixture(); f.agent('agent_a', 'secret-a'); f.heartbeat('agent_a', [f.profile('p1'), f.profile('p2')]);
  f.enqueue('agent_a', 'p1', 'queued'); assert.equal(f.plane.requestCancellation('queued').status, 'CANCELLED');
  f.enqueue('agent_a', 'p2', 'claimed'); const task = claim(f, 'agent_a', 'claim'); f.plane.requestCancellation('claimed');
  assert.equal(f.plane.cancellation('agent_a', 'claimed', task.lease_id).cancellation_requested, true);
  assert.equal(f.plane.update('agent_a', 'claimed', task.lease_id, { protocol_version: 1 }, 'cancelled', 'CANCELLED').task.status, 'CANCELLED');
});

test('HTTP transport uses authenticated versioned outbound requests and reconnect backoff', async () => {
  const { app, plane } = createReferenceCloudApp();
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const transport = new HttpAgentTransport({ baseUrl, agentId: 'agent_http', agentSecret: 'secret-http', allowInsecureHttp: true });
    await transport.enroll('', { agent_id: 'agent_http', display_name: 'HTTP agent' });
    const response = await transport.heartbeat({ display_name: 'HTTP agent', agent_status: 'ONLINE', agent_version: '1.1.3', profiles: [fProfile()] });
    assert.equal(response.protocol_version, PROTOCOL_VERSION); assert.equal(plane.state.agents.agent_http.status, 'ONLINE');
    const broken = new AgentConnectionManager({ transport: { heartbeat: async () => { throw Object.assign(new Error('offline'), { code: 'NETWORK' }); } }, metadata: () => ({}), now: () => 0, random: () => 0 });
    assert.equal((await broken.heartbeat()).ok, false); assert.equal((await broken.heartbeat()).skipped, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('cloud agent service uses the transport protocol without depending on dashboard APIs', async () => {
  const calls = []; const task = { task_id: 'task_service', profile_id: 'profile_service', lease_id: 'lease_service', task_type: 'TEST', payload: {} };
  const transport = { heartbeat: async () => calls.push('heartbeat'), claimNextTask: async () => ({ task }), getCancellationState: async () => ({ cancellation_requested: false }), reportRunning: async () => calls.push('running'), reportCompletion: async () => calls.push('completed'), reportFailure: async () => calls.push('failed') };
  const registry = { getSafeMetadata: () => ({ agent_id: 'agent_service', profiles: [] }) };
  const service = new CloudAgentService({ transport, registry, executeTask: async () => ({ processed: 1 }) });
  const result = await service.runOnce(); assert.equal(result.result.processed, 1); assert.deepEqual(calls, ['heartbeat', 'running', 'completed']);
});

function fProfile() { return { profile_id: 'profile_http', display_name: 'HTTP profile', status: 'READY' }; }
