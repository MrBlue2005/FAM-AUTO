const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROTOCOL_VERSION = 1;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN']);
const ACTIVE = new Set(['CLAIMED', 'RUNNING']);
const TRANSITIONS = {
  QUEUED: new Set(['CLAIMED', 'CANCELLED']),
  CLAIMED: new Set(['RUNNING', 'CANCELLED', 'QUEUED']),
  RUNNING: new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN']),
};
const PROHIBITED_KEYS = new Set(['cookies', 'password', 'credentials', 'profilepath', 'userdatadir', 'chromiumpath', 'sessionstorage', 'localstorage', 'indexeddb', 'accesstoken', 'refreshtoken', 'authtoken']);

class ProtocolError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function id(prefix) { return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function timestamp(now) { return now().toISOString(); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function hashSecret(secret, salt = crypto.randomBytes(16).toString('base64url')) {
  return { salt, hash: crypto.scryptSync(secret, salt, 32).toString('base64url') };
}
function assertSafe(value, label = 'payload') {
  if (Array.isArray(value)) return value.forEach((item) => assertSafe(item, label));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (PROHIBITED_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      throw new ProtocolError('SENSITIVE_FIELD_PROHIBITED', `${label} contains prohibited field ${key}.`);
    }
    assertSafe(item, label);
  }
}

class ReferenceControlPlane {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
    this.leaseMs = options.leaseMs || 120000;
    this.heartbeatExpiryMs = options.heartbeatExpiryMs || 90000;
    this.enrollmentToken = options.enrollmentToken || null;
    this.filePath = options.filePath || null;
    this.state = this.filePath && fs.existsSync(this.filePath)
      ? JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      : { version: 1, agents: {}, profiles: {}, tasks: {}, events: [], idempotency: {} };
  }

  persist() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2));
    fs.renameSync(temp, this.filePath);
  }

  event(type, metadata = {}) {
    this.state.events.push({ event_id: id('event'), event_type: type, timestamp: timestamp(this.now), metadata: clone(metadata) });
    this.state.events = this.state.events.slice(-5000);
  }

  requireVersion(body) {
    if (Number(body?.protocol_version) !== PROTOCOL_VERSION) throw new ProtocolError('UNSUPPORTED_PROTOCOL', 'Unsupported agent protocol version.', 426);
  }

  enroll({ protocol_version, agent_id, agent_secret, display_name = 'RX Local Agent', enrollment_token }) {
    if (Number(protocol_version) !== PROTOCOL_VERSION) throw new ProtocolError('UNSUPPORTED_PROTOCOL', 'Unsupported agent protocol version.', 426);
    if (!agent_id || !agent_secret) throw new ProtocolError('INVALID_ENROLLMENT', 'agent_id and agent_secret are required.');
    if (this.enrollmentToken && !safeEqual(enrollment_token, this.enrollmentToken)) throw new ProtocolError('ENROLLMENT_DENIED', 'Invalid enrollment token.', 401);
    const existing = this.state.agents[agent_id];
    if (existing && !safeEqual(hashSecret(agent_secret, existing.secret.salt).hash, existing.secret.hash)) throw new ProtocolError('AGENT_CONFLICT', 'Agent is already enrolled with another secret.', 409);
    this.state.agents[agent_id] = existing || { agent_id, secret: hashSecret(agent_secret), display_name, status: 'OFFLINE', created_at: timestamp(this.now), last_seen_at: null };
    this.event('AGENT_ENROLLED', { agent_id }); this.persist();
    return { protocol_version: PROTOCOL_VERSION, agent_id, enrolled: true };
  }

  authenticate(agentId, secret) {
    const agent = this.state.agents[agentId];
    if (!agent || !secret) throw new ProtocolError('UNAUTHORIZED_AGENT', 'Invalid agent authentication.', 401);
    const candidate = hashSecret(secret, agent.secret.salt).hash;
    if (!safeEqual(candidate, agent.secret.hash)) throw new ProtocolError('UNAUTHORIZED_AGENT', 'Invalid agent authentication.', 401);
    return agent;
  }

  expire() {
    const nowMs = this.now().getTime();
    for (const agent of Object.values(this.state.agents)) {
      if (!agent.last_seen_at || nowMs - new Date(agent.last_seen_at).getTime() > this.heartbeatExpiryMs) agent.status = 'OFFLINE';
    }
    for (const task of Object.values(this.state.tasks)) {
      if (!ACTIVE.has(task.status) || !task.lease_expires_at || new Date(task.lease_expires_at).getTime() > nowMs) continue;
      if (task.status === 'CLAIMED') {
        if (task.cancellation_requested_at) this.transition(task, 'CANCELLED', { error: { code: 'CANCELLED_BEFORE_START' } });
        else this.transition(task, 'QUEUED', { lease_id: null, lease_expires_at: null, leased_by_agent_id: null });
      } else {
        this.transition(task, 'OUTCOME_UNKNOWN', { error: { code: 'LEASE_EXPIRED_DURING_EXECUTION', message: 'External side effect may have occurred; automatic retry is blocked.' } });
      }
      this.event('LEASE_EXPIRED', { task_id: task.task_id, status: task.status });
    }
    this.persist();
  }

  syncProfiles(agentId, profiles = []) {
    assertSafe(profiles, 'profiles');
    for (const profile of profiles) {
      if (!profile.profile_id || !profile.display_name || !profile.status) throw new ProtocolError('INVALID_PROFILE', 'Safe profile metadata is incomplete.');
      const existing = this.state.profiles[profile.profile_id];
      if (existing && existing.agent_id !== agentId) throw new ProtocolError('PROFILE_OWNERSHIP_CONFLICT', 'Profile belongs to another agent.', 409);
      this.state.profiles[profile.profile_id] = { profile_id: profile.profile_id, agent_id: agentId, display_name: profile.display_name, status: profile.status, last_seen_at: timestamp(this.now) };
    }
  }

  heartbeat(agentId, body, requestId) {
    this.requireVersion(body); this.expire();
    return this.idempotent(agentId, requestId, () => {
      assertSafe(body, 'heartbeat');
      const agent = this.state.agents[agentId];
      agent.display_name = body.display_name || agent.display_name;
      agent.status = body.agent_status || 'ONLINE'; agent.last_seen_at = timestamp(this.now);
      agent.version = body.agent_version || null; agent.protocol_version = PROTOCOL_VERSION;
      this.syncProfiles(agentId, body.profiles || []);
      this.event('HEARTBEAT_OK', { agent_id: agentId, active_task_ids: Array.isArray(body.active_task_ids) ? body.active_task_ids : [] });
      this.persist();
      return { protocol_version: PROTOCOL_VERSION, agent_status: agent.status, server_time: timestamp(this.now) };
    });
  }

  enqueue(task) {
    this.requireVersion(task); this.expire(); assertSafe(task.payload, 'task payload');
    if (!task.agent_id || !task.profile_id || !task.task_type) throw new ProtocolError('INVALID_TASK', 'Task identity is incomplete.');
    const profile = this.state.profiles[task.profile_id];
    if (!profile || profile.agent_id !== task.agent_id) throw new ProtocolError('PROFILE_NOT_OWNED', 'Task profile is not owned by its agent.', 409);
    const taskId = task.task_id || id('task');
    if (this.state.tasks[taskId]) throw new ProtocolError('TASK_EXISTS', 'Task already exists.', 409);
    const created = { task_id: taskId, agent_id: task.agent_id, profile_id: task.profile_id, task_type: task.task_type, status: 'QUEUED', payload: clone(task.payload), created_at: timestamp(this.now), scheduled_at: task.scheduled_at || timestamp(this.now), claimed_at: null, started_at: null, completed_at: null, attempt: 0, lease_id: null, lease_expires_at: null, leased_by_agent_id: null, cancellation_requested_at: null, result: null, error: null };
    this.state.tasks[taskId] = created; this.event('TASK_ENQUEUED', { task_id: taskId, agent_id: task.agent_id, profile_id: task.profile_id }); this.persist();
    return clone(created);
  }

  claim(agentId, body, requestId) {
    this.requireVersion(body); this.expire();
    return this.idempotent(agentId, requestId, () => {
      const now = this.now();
      const task = Object.values(this.state.tasks).filter((item) => item.agent_id === agentId && item.status === 'QUEUED' && !item.cancellation_requested_at && new Date(item.scheduled_at).getTime() <= now.getTime()).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).find((item) => !Object.values(this.state.tasks).some((other) => other.profile_id === item.profile_id && ACTIVE.has(other.status)));
      if (!task) return { protocol_version: PROTOCOL_VERSION, task: null };
      const profile = this.state.profiles[task.profile_id];
      if (!profile || profile.agent_id !== agentId) throw new ProtocolError('PROFILE_NOT_OWNED', 'Task profile ownership is invalid.', 409);
      const leaseId = id('lease');
      this.transition(task, 'CLAIMED', { claimed_at: timestamp(this.now), attempt: task.attempt + 1, leased_by_agent_id: agentId, lease_id: leaseId, lease_expires_at: new Date(now.getTime() + this.leaseMs).toISOString() });
      this.event('TASK_CLAIMED', { task_id: task.task_id, agent_id: agentId, profile_id: task.profile_id }); this.persist();
      return { protocol_version: PROTOCOL_VERSION, task: clone(task) };
    });
  }

  transition(task, next, patch = {}) {
    if (!TRANSITIONS[task.status]?.has(next)) throw new ProtocolError('ILLEGAL_TRANSITION', `${task.status} cannot transition to ${next}.`, 409);
    task.status = next; Object.assign(task, patch);
    if (TERMINAL.has(next)) { task.completed_at = timestamp(this.now); task.lease_expires_at = null; }
  }

  withLease(agentId, taskId, leaseId, requestId, operation) {
    this.expire();
    return this.idempotent(agentId, requestId, () => {
      const task = this.state.tasks[taskId];
      if (!task || task.agent_id !== agentId) throw new ProtocolError('TASK_NOT_FOUND', 'Task is not assigned to this agent.', 404);
      if (!safeEqual(task.lease_id || '', leaseId || '') || task.leased_by_agent_id !== agentId) throw new ProtocolError('STALE_LEASE', 'Lease is no longer valid.', 409);
      const response = operation(task);
      this.persist(); return response;
    });
  }

  renew(agentId, taskId, leaseId, body, requestId) {
    this.requireVersion(body);
    return this.withLease(agentId, taskId, leaseId, requestId, (task) => {
      if (!ACTIVE.has(task.status)) throw new ProtocolError('ILLEGAL_TRANSITION', 'Only active tasks can renew a lease.', 409);
      task.lease_expires_at = new Date(this.now().getTime() + this.leaseMs).toISOString();
      if (body.progress && typeof body.progress === 'object') task.progress = clone(body.progress);
      this.event('LEASE_RENEWED', { task_id: taskId, agent_id: agentId });
      return { protocol_version: PROTOCOL_VERSION, lease_expires_at: task.lease_expires_at };
    });
  }

  update(agentId, taskId, leaseId, body, requestId, next) {
    this.requireVersion(body);
    return this.withLease(agentId, taskId, leaseId, requestId, (task) => {
      if (next === 'RUNNING') this.transition(task, 'RUNNING', { started_at: task.started_at || timestamp(this.now) });
      else this.transition(task, next, { result: body.result || null, error: body.error || null });
      this.event(`TASK_${next}`, { task_id: taskId, agent_id: agentId });
      return { protocol_version: PROTOCOL_VERSION, task: clone(task) };
    });
  }

  cancellation(agentId, taskId, leaseId) {
    const task = this.state.tasks[taskId];
    if (!task || task.agent_id !== agentId) throw new ProtocolError('TASK_NOT_FOUND', 'Task is not assigned to this agent.', 404);
    if (!safeEqual(task.lease_id || '', leaseId || '')) throw new ProtocolError('STALE_LEASE', 'Lease is no longer valid.', 409);
    return { protocol_version: PROTOCOL_VERSION, cancellation_requested: Boolean(task.cancellation_requested_at), cancellation_requested_at: task.cancellation_requested_at };
  }

  requestCancellation(taskId) {
    this.expire(); const task = this.state.tasks[taskId]; if (!task) throw new ProtocolError('TASK_NOT_FOUND', 'Task not found.', 404);
    if (task.status === 'QUEUED') this.transition(task, 'CANCELLED', { error: { code: 'CANCELLED_BY_CONTROL_PLANE' } });
    else if (ACTIVE.has(task.status)) task.cancellation_requested_at = timestamp(this.now);
    this.event('CANCELLATION_REQUESTED', { task_id: taskId, status: task.status }); this.persist(); return clone(task);
  }

  idempotent(agentId, requestId, operation) {
    if (!requestId) throw new ProtocolError('IDEMPOTENCY_KEY_REQUIRED', 'X-RX-Request-Id is required.');
    const key = `${agentId}:${requestId}`; if (this.state.idempotency[key]) return clone(this.state.idempotency[key]);
    const response = operation(); this.state.idempotency[key] = clone(response); this.persist(); return clone(response);
  }
}

module.exports = { ACTIVE, PROTOCOL_VERSION, ProtocolError, ReferenceControlPlane, TERMINAL, assertSafe };
