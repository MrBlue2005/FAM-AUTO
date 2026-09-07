const crypto = require('crypto');
const { AgentTransport } = require('./AgentTransport');
const { PROTOCOL_VERSION } = require('../cloud-reference/ReferenceControlPlane');

class HttpAgentTransport extends AgentTransport {
  constructor(options = {}) {
    super(); this.baseUrl = String(options.baseUrl || '').replace(/\/$/, ''); this.agentId = options.agentId; this.agentSecret = options.agentSecret;
    this.fetch = options.fetch || global.fetch; this.allowInsecureHttp = options.allowInsecureHttp === true;
    if (!this.baseUrl) throw new Error('Cloud transport URL is required.');
    if (!this.baseUrl.startsWith('https://') && !(this.allowInsecureHttp && this.baseUrl.startsWith('http://'))) throw new Error('HTTPS is required for cloud transport. HTTP is permitted only for the explicit local reference backend.');
  }
  requestId() { return crypto.randomUUID(); }
  async request(method, pathname, body = null, extraHeaders = {}, requestId = this.requestId()) {
    const response = await this.fetch(`${this.baseUrl}${pathname}`, { method, headers: { authorization: `Bearer ${this.agentSecret}`, 'content-type': 'application/json', 'x-rx-agent-id': this.agentId, 'x-rx-agent-protocol': String(PROTOCOL_VERSION), 'x-rx-request-id': requestId, ...extraHeaders }, body: body ? JSON.stringify({ protocol_version: PROTOCOL_VERSION, ...body }) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error?.message || `Cloud transport failed (${response.status}).`); error.code = data.error?.code || 'TRANSPORT_ERROR'; error.status = response.status; throw error; }
    return data;
  }
  enroll(enrollmentToken, metadata = {}) { return this.request('POST', '/v1/agents/enroll', metadata, { 'x-rx-enrollment-token': enrollmentToken || '' }); }
  register(enrollmentToken, metadata = {}) { return this.enroll(enrollmentToken, metadata); }
  heartbeat(metadata, requestId) { return this.request('POST', '/v1/agent/heartbeat', metadata, {}, requestId); }
  publishProfiles(metadata, requestId) { return this.heartbeat(metadata, requestId); }
  claimNextTask(requestId) { return this.request('POST', '/v1/agent/tasks/claim', {}, {}, requestId); }
  acknowledgeTask() { return Promise.resolve({ protocol_version: PROTOCOL_VERSION, acknowledged: true }); }
  reportRunning(task, requestId) { return this.request('POST', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/running`, {}, { 'x-rx-lease-id': task.lease_id }, requestId); }
  renewLease(task, requestId) { return this.request('POST', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/renew`, {}, { 'x-rx-lease-id': task.lease_id }, requestId); }
  reportProgress(task, progress, requestId) { return this.request('POST', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/renew`, { progress }, { 'x-rx-lease-id': task.lease_id }, requestId); }
  reportCompletion(task, result, requestId) { return this.request('POST', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/completed`, { result }, { 'x-rx-lease-id': task.lease_id }, requestId); }
  reportFailure(task, error, requestId) { return this.request('POST', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/failed`, { error: { code: error?.code || 'EXECUTION_FAILED', message: error?.message || String(error) } }, { 'x-rx-lease-id': task.lease_id }, requestId); }
  reportOutcomeUnknown(task, error, requestId) { return this.request('POST', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/outcome-unknown`, { error: { code: error?.code || 'EXECUTION_OUTCOME_UNKNOWN', message: error?.message || String(error) } }, { 'x-rx-lease-id': task.lease_id }, requestId); }
  reportCancelled(task, requestId) { return this.request('POST', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/cancelled`, {}, { 'x-rx-lease-id': task.lease_id }, requestId); }
  getCancellationState(task) { return this.request('GET', `/v1/agent/tasks/${encodeURIComponent(task.task_id)}/cancellation`, null, { 'x-rx-lease-id': task.lease_id }); }
}

module.exports = { HttpAgentTransport };
