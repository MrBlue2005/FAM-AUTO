const { LocalAgentExecutor } = require('./LocalAgentExecutor');
const RobotManager = require('../core/RobotManager');

class CloudAgentService {
  constructor(options) {
    this.transport = options.transport; this.registry = options.registry; this.runtimeProfiles = options.runtimeProfiles || (() => []);
    this.executeTask = options.executeTask; this.executor = options.executor || new LocalAgentExecutor(); this.events = options.events || (() => {});
    this.intervalMs = Math.max(15000, options.intervalMs || 30000); this.leaseRenewIntervalMs = Math.max(5000, options.leaseRenewIntervalMs || 30000); this.timer = null;
  }
  metadata() { return this.registry.getSafeMetadata(this.runtimeProfiles()); }
  async runOnce() {
    await this.transport.heartbeat({ ...this.metadata(), agent_version: require('../../package.json').version, active_task_ids: [] });
    const claimed = await this.transport.claimNextTask(); const task = claimed.task;
    if (!task) return { task: null };
    this.events('TASK_CLAIMED', { task_id: task.task_id });
    if ((await this.transport.getCancellationState(task)).cancellation_requested) {
      await this.transport.reportCancelled(task); return { task, cancelled: true };
    }
    let leaseTimer = null; let executionFinished = false;
    try {
      await this.transport.reportRunning(task); this.events('TASK_STARTED', { task_id: task.task_id });
      leaseTimer = setInterval(() => this.transport.renewLease(task).then(() => this.events('LEASE_RENEWED', { task_id: task.task_id })).catch((error) => this.events('LEASE_RENEW_FAILED', { task_id: task.task_id, code: error.code || 'TRANSPORT_ERROR' })), this.leaseRenewIntervalMs);
      const result = await RobotManager.runExternalProfileTask(task.profile_id, () => this.executor.runProfile(task.profile_id, () => this.executeTask(task, async () => (await this.transport.getCancellationState(task)).cancellation_requested), { taskId: task.task_id }));
      executionFinished = true;
      if (result?.cancelled || result?.cancellation_requested_after_safe_point) { await this.transport.reportCancelled(task); return { task, cancelled: true, result }; }
      await this.transport.reportCompletion(task, result || {}); this.events('TASK_COMPLETED', { task_id: task.task_id }); return { task, result };
    } catch (error) {
      if (error.code === 'EXECUTION_OUTCOME_UNKNOWN' || executionFinished) { await this.transport.reportOutcomeUnknown(task, error); this.events('TASK_OUTCOME_UNKNOWN', { task_id: task.task_id }); }
      else if (error.code === 'PROFILE_BUSY') { await this.transport.reportFailure(task, error); this.events('PROFILE_BUSY', { task_id: task.task_id }); }
      else { await this.transport.reportFailure(task, error); this.events('TASK_FAILED', { task_id: task.task_id }); }
      throw error;
    } finally { if (leaseTimer) clearInterval(leaseTimer); }
  }
  start() { if (this.timer) return; const tick = async () => { try { await this.runOnce(); } catch {} finally { this.timer = setTimeout(tick, this.intervalMs); } }; tick(); }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

module.exports = { CloudAgentService };
