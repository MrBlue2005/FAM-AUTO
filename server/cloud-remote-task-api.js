'use strict';

const crypto = require('crypto');
const express = require('express');

const FRESHNESS_MS = 90 * 1000;
const TASK_PREFIX = 'synthetic_dry_run_';

function safeResult(result) {
  return result && result.dry_run === true && result.publishEnabled === false
    ? { dryRun: true, publishEnabled: false }
    : null;
}

function safeTask(task) {
  return {
    taskId: task.task_id,
    status: task.status,
    createdAt: task.created_at || null,
    claimedAt: task.claimed_at || null,
    startedAt: task.started_at || null,
    completedAt: task.completed_at || null,
    result: safeResult(task.result),
  };
}

function isOnline(agent, now = Date.now()) {
  const seen = Date.parse(agent?.last_seen_at || '');
  return ['ONLINE', 'BUSY', 'DEGRADED'].includes(String(agent?.reported_status || '').toUpperCase())
    && Number.isFinite(seen) && now - seen <= FRESHNESS_MS;
}

function createCloudRemoteTaskRouter({ store, agentId, profileId, now = () => Date.now() }) {
  const router = express.Router();
  const verifyTarget = async () => {
    const [agent, profile] = await Promise.all([store.getControlPlaneAgent(agentId), store.getControlPlaneProfile(profileId)]);
    if (!agent || !profile || profile.agent_id !== agentId) throw Object.assign(new Error('Configured synthetic agent/profile is unavailable.'), { status: 409 });
    if (String(profile.status).toUpperCase() !== 'READY' || !isOnline(agent, now())) throw Object.assign(new Error('Synthetic Local Agent is offline or unavailable; no task was created.'), { status: 409 });
  };
  const belongsToSyntheticTarget = (task) => task && task.agent_id === agentId && task.profile_id === profileId && task.task_type === 'DRY_RUN' && String(task.task_id || '').startsWith(TASK_PREFIX);

  router.post('/synthetic-dry-run', async (req, res) => {
    try {
      await verifyTarget();
      const task = await store.createControlPlaneTask({
        task_id: `${TASK_PREFIX}${crypto.randomUUID()}`,
        agent_id: agentId,
        profile_id: profileId,
        task_type: 'DRY_RUN',
        payload: { validation: 'hosted-remote-roundtrip', publishEnabled: false },
      });
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  });

  router.get('/synthetic-dry-run/:taskId', async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(TASK_PREFIX)) return res.status(404).json({ error: 'Synthetic task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToSyntheticTarget(task)) return res.status(404).json({ error: 'Synthetic task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  });
  return router;
}

module.exports = { FRESHNESS_MS, TASK_PREFIX, createCloudRemoteTaskRouter, safeTask, safeResult, isOnline };
