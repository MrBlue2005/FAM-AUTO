const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { logsPath } = require('../config/storagePaths');
const { AgentTransport } = require('./AgentTransport');
const { TASK_STATUS } = require('./TaskContract');

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

class LocalTaskTransport extends AgentTransport {
  constructor(runId, options = {}) {
    super();
    this.runId = runId;
    this.filePath = options.filePath || path.join(logsPath, 'local-agent-tasks', `${runId}.json`);
  }

  read() {
    if (!fs.existsSync(this.filePath)) return { version: 1, run_id: this.runId, agent: null, tasks: [] };
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  write(value) {
    atomicWrite(this.filePath, value);
    return value;
  }

  createRun(agentMetadata, tasks) {
    return this.write({ version: 1, run_id: this.runId, agent: agentMetadata, tasks });
  }

  register(agentMetadata) {
    const state = this.read();
    state.agent = agentMetadata;
    state.registered_at = new Date().toISOString();
    return this.write(state).agent;
  }

  heartbeat() {
    const state = this.read();
    state.heartbeat_at = new Date().toISOString();
    this.write(state);
    return { ok: true, heartbeat_at: state.heartbeat_at };
  }

  publishProfiles(agentMetadata) { return this.register(agentMetadata); }

  updateTask(taskId, updater) {
    const state = this.read();
    const index = state.tasks.findIndex((task) => task.task_id === taskId);
    if (index === -1) return null;
    state.tasks[index] = updater(state.tasks[index]);
    this.write(state);
    return state.tasks[index];
  }

  claimNextTask({ agentId, profileId }) {
    const state = this.read();
    const index = state.tasks.findIndex((task) =>
      task.status === TASK_STATUS.QUEUED && task.agent_id === agentId && task.profile_id === profileId
    );
    if (index === -1) return null;
    state.tasks[index] = {
      ...state.tasks[index],
      status: TASK_STATUS.CLAIMED,
      attempts: Number(state.tasks[index].attempts || 0) + 1,
      claimed_at: new Date().toISOString(),
    };
    this.write(state);
    return state.tasks[index];
  }

  acknowledgeTask(taskId) { return this.updateTask(taskId, (task) => ({ ...task, acknowledged_at: new Date().toISOString() })); }
  reportRunning(taskId) { return this.updateTask(taskId, (task) => ({ ...task, status: TASK_STATUS.RUNNING, started_at: new Date().toISOString(), error: null })); }
  reportCompletion(taskId, result = null) { return this.updateTask(taskId, (task) => ({ ...task, status: TASK_STATUS.COMPLETED, completed_at: new Date().toISOString(), result, error: null })); }
  reportFailure(taskId, error) { return this.updateTask(taskId, (task) => ({ ...task, status: TASK_STATUS.FAILED, completed_at: new Date().toISOString(), error: { code: error?.code || 'EXECUTION_FAILED', message: error?.message || String(error) } })); }
  reportOutcomeUnknown(taskId, error) { return this.updateTask(taskId, (task) => ({ ...task, status: TASK_STATUS.OUTCOME_UNKNOWN, completed_at: new Date().toISOString(), error: { code: error?.code || 'EXECUTION_OUTCOME_UNKNOWN', message: error?.message || String(error) } })); }
  reportCancelled(taskId, reason = { code: 'CANCELLED' }) { return this.cancelTask(taskId, reason); }
  renewLease(taskId) { return this.updateTask(taskId, (task) => ({ ...task, lease_renewed_at: new Date().toISOString() })); }
  reportProgress(taskId, progress) { return this.updateTask(taskId, (task) => ({ ...task, progress })); }
  getCancellationState(taskId) { const task = this.read().tasks.find((item) => item.task_id === taskId); return { cancellation_requested: Boolean(task?.cancellation_requested_at) }; }
  cancelTask(taskId, reason) { return this.updateTask(taskId, (task) => ({ ...task, status: TASK_STATUS.CANCELLED, completed_at: new Date().toISOString(), error: reason })); }
  deferTask(taskId, reason) { return this.updateTask(taskId, (task) => ({ ...task, status: TASK_STATUS.QUEUED, error: reason })); }

  cancelQueuedTasks({ agentId, profileId }, reason) {
    const state = this.read();
    const completedAt = new Date().toISOString();
    let cancelled = 0;
    state.tasks = state.tasks.map((task) => {
      if (task.status !== TASK_STATUS.QUEUED || task.agent_id !== agentId || task.profile_id !== profileId) return task;
      cancelled += 1;
      return { ...task, status: TASK_STATUS.CANCELLED, completed_at: completedAt, error: reason };
    });
    this.write(state);
    return cancelled;
  }

  deferProfileTasks({ agentId, profileId }, reason) {
    const state = this.read();
    state.tasks = state.tasks.map((task) =>
      task.status === TASK_STATUS.QUEUED && task.agent_id === agentId && task.profile_id === profileId
        ? { ...task, error: reason }
        : task
    );
    this.write(state);
  }
}

module.exports = { LocalTaskTransport };
