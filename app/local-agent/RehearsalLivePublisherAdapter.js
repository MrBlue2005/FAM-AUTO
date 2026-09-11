'use strict';

// Deterministic, browser-free rehearsal adapter.  It intentionally accepts
// only server-marked rehearsal snapshots, so it cannot be used as a silent
// substitute for an actual live publication.
function failure(code, message) { return Object.assign(new Error(message), { code }); }

function createRehearsalLivePublisherAdapter({ onEvent = () => {} } = {}) {
  const counters = { prepare: 0, verifyReady: 0, submit: 0, verifyOutcome: 0 };
  const rehearsalTask = (task) => task?.payload?.execution_config?.rehearsal === true;
  const event = (phase) => onEvent({ type: 'LIVE_REHEARSAL_PUBLISHER', phase, counters: { ...counters } });
  const requireRehearsal = (task) => { if (!rehearsalTask(task)) throw failure('LIVE_REHEARSAL_SNAPSHOT_REQUIRED', 'The fake publisher accepts only a server-marked rehearsal task.'); };
  return {
    async prepare(task) { requireRehearsal(task); counters.prepare += 1; event('PREPARE'); },
    async verifyReady(task) { requireRehearsal(task); counters.verifyReady += 1; event('VERIFY_READY'); return { sessionReady: true, targetReady: true, composerReady: true }; },
    async submit(task) { requireRehearsal(task); counters.submit += 1; event('SUBMIT'); },
    async verifyOutcome(task) { requireRehearsal(task); counters.verifyOutcome += 1; event('VERIFY_OUTCOME'); return { verified: true, rehearsal: true }; },
    getCounters: () => ({ ...counters }),
    async cleanup() {},
  };
}

module.exports = { createRehearsalLivePublisherAdapter };
