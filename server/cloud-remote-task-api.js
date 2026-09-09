'use strict';

const crypto = require('crypto');
const express = require('express');

const FRESHNESS_MS = 90 * 1000;
const TASK_PREFIX = 'synthetic_dry_run_';
const AVAILABILITY_CODES = new Set([
  'SYNTHETIC_AGENT_NOT_FOUND',
  'SYNTHETIC_PROFILE_NOT_FOUND',
  'SYNTHETIC_PROFILE_OWNERSHIP_MISMATCH',
]);

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

function targetIdFingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function targetAvailability(agent, profile, agentId, profileId, now = Date.now()) {
  const seen = Date.parse(agent?.last_seen_at || '');
  const agentStatusAccepted = ['ONLINE', 'BUSY', 'DEGRADED'].includes(String(agent?.reported_status || '').toUpperCase());
  return {
    agentConfigured: Boolean(agent),
    profileConfigured: Boolean(profile),
    ownershipCorrect: Boolean(agent) && Boolean(profile) && profile.agent_id === agentId,
    profileReady: Boolean(profile) && String(profile.status || '').toUpperCase() === 'READY',
    agentStatusAccepted,
    heartbeatFresh: Boolean(agent) && Number.isFinite(seen) && now - seen <= FRESHNESS_MS,
    configuredAgentIdLength: agentId.length,
    configuredAgentIdFingerprint: targetIdFingerprint(agentId),
    configuredProfileIdLength: profileId.length,
    configuredProfileIdFingerprint: targetIdFingerprint(profileId),
  };
}

function availabilityError(code) {
  return Object.assign(new Error('Configured synthetic agent/profile is unavailable.'), { status: 409, code });
}

function createCloudRemoteTaskRouter({ store, agentId, profileId, now = () => Date.now() }) {
  const router = express.Router();
  const readTarget = async () => {
    const [agent, profile] = await Promise.all([store.getControlPlaneAgent(agentId), store.getControlPlaneProfile(profileId)]);
    return { agent, profile, availability: targetAvailability(agent, profile, agentId, profileId, now()) };
  };
  const verifyTarget = async () => {
    const { agent, profile, availability } = await readTarget();
    if (!agent) throw availabilityError('SYNTHETIC_AGENT_NOT_FOUND');
    if (!profile) throw availabilityError('SYNTHETIC_PROFILE_NOT_FOUND');
    if (!availability.ownershipCorrect) throw availabilityError('SYNTHETIC_PROFILE_OWNERSHIP_MISMATCH');
    if (String(profile.status).toUpperCase() !== 'READY' || !isOnline(agent, now())) throw Object.assign(new Error('Synthetic Local Agent is offline or unavailable; no task was created.'), { status: 409 });
  };
  const belongsToSyntheticTarget = (task) => task && task.agent_id === agentId && task.profile_id === profileId && task.task_type === 'DRY_RUN' && String(task.task_id || '').startsWith(TASK_PREFIX);
  const sendError = (res, error) => {
    const body = { error: error.message };
    if (AVAILABILITY_CODES.has(error.code)) body.code = error.code;
    return res.status(error.status || 400).json(body);
  };

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
    } catch (error) { return sendError(res, error); }
  });

  router.get('/synthetic-dry-run/availability', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'This action requires administrator access.' });
    try {
      return res.json((await readTarget()).availability);
    } catch (error) { return sendError(res, error); }
  });

  router.get('/synthetic-dry-run/:taskId', async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(TASK_PREFIX)) return res.status(404).json({ error: 'Synthetic task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToSyntheticTarget(task)) return res.status(404).json({ error: 'Synthetic task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return sendError(res, error); }
  });
  return router;
}

module.exports = { FRESHNESS_MS, TASK_PREFIX, AVAILABILITY_CODES, createCloudRemoteTaskRouter, safeTask, safeResult, isOnline, targetAvailability, targetIdFingerprint };
