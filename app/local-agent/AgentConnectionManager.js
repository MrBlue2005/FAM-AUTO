class AgentConnectionManager {
  constructor(options) { this.transport = options.transport; this.metadata = options.metadata; this.now = options.now || (() => Date.now()); this.random = options.random || Math.random; this.baseDelayMs = options.baseDelayMs || 5000; this.maxDelayMs = options.maxDelayMs || 300000; this.failures = 0; this.nextRetryAt = 0; this.events = options.events || (() => {}); }
  delay() { return Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** this.failures)) + Math.floor(this.random() * 1000); }
  async heartbeat() {
    if (this.now() < this.nextRetryAt) return { skipped: true, retry_at: this.nextRetryAt };
    try { const response = await this.transport.heartbeat(this.metadata()); const reconnected = this.failures > 0; this.failures = 0; this.nextRetryAt = 0; this.events(reconnected ? 'AGENT_RECONNECTED' : 'HEARTBEAT_OK'); return response; }
    catch (error) { this.failures += 1; this.nextRetryAt = this.now() + this.delay(); this.events('HEARTBEAT_FAILED', { code: error.code }); return { ok: false, error: error.code || 'TRANSPORT_ERROR', retry_at: this.nextRetryAt }; }
  }
}

module.exports = { AgentConnectionManager };
