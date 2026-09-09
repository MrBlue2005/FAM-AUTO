'use strict';

const crypto = require('crypto');
const express = require('express');
const { CAMPAIGN_PREFLIGHT_TASK_TYPE, buildCampaignPreflightSnapshot, safeCampaignPreflightResult } = require('./cloud-campaign-preflight');
const { CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE, safeChromiumPreflightResult } = require('./cloud-chromium-preflight');
const { FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE, safeFacebookSessionResult } = require('./facebook-session-preflight');

const FRESHNESS_MS = 90 * 1000;
const TASK_PREFIX = 'synthetic_dry_run_';
const CAMPAIGN_PREFLIGHT_PREFIX = 'campaign_preflight_';
const CHROMIUM_SAFE_PREFLIGHT_PREFIX = 'chromium_safe_preflight_';
const FACEBOOK_SESSION_READINESS_PREFIX = 'facebook_session_readiness_';
const AVAILABILITY_CODES = new Set([
  'SYNTHETIC_AGENT_NOT_FOUND',
  'SYNTHETIC_PROFILE_NOT_FOUND',
  'SYNTHETIC_PROFILE_OWNERSHIP_MISMATCH',
]);

function safeResult(result, taskType) {
  if (result && result.dry_run === true && result.publishEnabled === false) return { dryRun: true, publishEnabled: false };
  if (taskType === CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE) return safeChromiumPreflightResult(result);
  if (taskType === FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE) return safeFacebookSessionResult(result);
  if (taskType === CAMPAIGN_PREFLIGHT_TASK_TYPE) return safeCampaignPreflightResult(result);
  return null;
}

function safeTask(task) {
  return {
    taskId: task.task_id,
    status: task.status,
    createdAt: task.created_at || null,
    claimedAt: task.claimed_at || null,
    startedAt: task.started_at || null,
    completedAt: task.completed_at || null,
    result: safeResult(task.result, task.task_type),
  };
}

function isOnline(agent, now = Date.now()) {
  const seen = Date.parse(agent?.last_seen_at || '');
  return ['ONLINE', 'BUSY', 'DEGRADED'].includes(String(agent?.reported_status || '').toUpperCase())
    && Number.isFinite(seen) && now - seen <= FRESHNESS_MS;
}

function targetAvailability(agent, profile, agentId, now = Date.now()) {
  const seen = Date.parse(agent?.last_seen_at || '');
  const agentStatusAccepted = ['ONLINE', 'BUSY', 'DEGRADED'].includes(String(agent?.reported_status || '').toUpperCase());
  return {
    agentConfigured: Boolean(agent),
    profileConfigured: Boolean(profile),
    ownershipCorrect: Boolean(agent) && Boolean(profile) && profile.agent_id === agentId,
    profileReady: Boolean(profile) && String(profile.status || '').toUpperCase() === 'READY',
    agentStatusAccepted,
    heartbeatFresh: Boolean(agent) && Number.isFinite(seen) && now - seen <= FRESHNESS_MS,
  };
}

function availabilityError(code) {
  return Object.assign(new Error('Configured synthetic agent/profile is unavailable.'), { status: 409, code });
}

function createCloudRemoteTaskRouter({ store, agentId, profileId, chromiumPreflightEnabled = false, facebookSessionPreflightEnabled = false, facebookSessionAgentId = '', facebookSessionProfileId = '', now = () => Date.now() }) {
  const router = express.Router();
  const readTarget = async () => {
    const [agent, profile] = await Promise.all([store.getControlPlaneAgent(agentId), store.getControlPlaneProfile(profileId)]);
    return { agent, profile, availability: targetAvailability(agent, profile, agentId, now()) };
  };
  const verifyTarget = async () => {
    const { agent, profile, availability } = await readTarget();
    if (!agent) throw availabilityError('SYNTHETIC_AGENT_NOT_FOUND');
    if (!profile) throw availabilityError('SYNTHETIC_PROFILE_NOT_FOUND');
    if (!availability.ownershipCorrect) throw availabilityError('SYNTHETIC_PROFILE_OWNERSHIP_MISMATCH');
    if (String(profile.status).toUpperCase() !== 'READY' || !isOnline(agent, now())) throw Object.assign(new Error('Synthetic Local Agent is offline or unavailable; no task was created.'), { status: 409 });
  };
  const belongsToSyntheticTarget = (task, taskType, prefix) => task && task.agent_id === agentId && task.profile_id === profileId && task.task_type === taskType && String(task.task_id || '').startsWith(prefix);
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

  router.post('/campaign-preflight', async (req, res) => {
    try {
      await verifyTarget();
      const kind = String(req.body?.kind || '');
      if (!['property', 'job'].includes(kind)) throw Object.assign(new Error('A supported campaign kind is required.'), { status: 400 });
      const source = await store.getCampaignPreflightSource({ kind, campaignLegacyId: String(req.body?.campaignId || ''), targetLegacyId: String(req.body?.targetId || '') });
      const payload = buildCampaignPreflightSnapshot({ campaign: source.campaign, target: source.target, postDay: Number(req.body?.day), expectedCampaignRevision: req.body?.campaignRevision, expectedPostRevision: req.body?.postRevision });
      const task = await store.createControlPlaneTask({
        task_id: `${CAMPAIGN_PREFLIGHT_PREFIX}${crypto.randomUUID()}`,
        agent_id: agentId,
        profile_id: profileId,
        task_type: CAMPAIGN_PREFLIGHT_TASK_TYPE,
        payload,
      });
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/chromium-safe-preflight', async (req, res) => {
    try {
      if (!chromiumPreflightEnabled) throw Object.assign(new Error('Chromium safe preflight is disabled.'), { status: 404, code: 'CHROMIUM_PREFLIGHT_DISABLED' });
      await verifyTarget();
      const task = await store.createControlPlaneTask({ task_id: `${CHROMIUM_SAFE_PREFLIGHT_PREFIX}${crypto.randomUUID()}`, agent_id: agentId, profile_id: profileId, task_type: CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE, payload: { mode: 'CHROMIUM_SAFE_PREFLIGHT', publishEnabled: false } });
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return sendError(res, error); }
  });
  router.post('/facebook-session-readiness', async (req, res) => {
    try {
      if (!facebookSessionPreflightEnabled || !facebookSessionAgentId || !facebookSessionProfileId) throw Object.assign(new Error('Facebook session readiness preflight is disabled.'), { status: 404 });
      const [agent, profile] = await Promise.all([store.getControlPlaneAgent(facebookSessionAgentId), store.getControlPlaneProfile(facebookSessionProfileId)]);
      if (!agent || !profile || profile.agent_id !== facebookSessionAgentId || String(profile.status).toUpperCase() !== 'READY' || !isOnline(agent, now())) throw Object.assign(new Error('Reviewed Local Agent profile is unavailable; no task was created.'), { status: 409 });
      const task = await store.createControlPlaneTask({ task_id: `${FACEBOOK_SESSION_READINESS_PREFIX}${crypto.randomUUID()}`, agent_id: facebookSessionAgentId, profile_id: facebookSessionProfileId, task_type: FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE, payload: { executionMode: 'SESSION_READINESS', publishEnabled: false } });
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/campaign-preflight/:taskId', async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(CAMPAIGN_PREFLIGHT_PREFIX)) return res.status(404).json({ error: 'Campaign preflight task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToSyntheticTarget(task, CAMPAIGN_PREFLIGHT_TASK_TYPE, CAMPAIGN_PREFLIGHT_PREFIX)) return res.status(404).json({ error: 'Campaign preflight task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/chromium-safe-preflight/:taskId', async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(CHROMIUM_SAFE_PREFLIGHT_PREFIX)) return res.status(404).json({ error: 'Chromium safe preflight task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToSyntheticTarget(task, CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE, CHROMIUM_SAFE_PREFLIGHT_PREFIX)) return res.status(404).json({ error: 'Chromium safe preflight task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/synthetic-dry-run/:taskId', async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(TASK_PREFIX)) return res.status(404).json({ error: 'Synthetic task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToSyntheticTarget(task, 'DRY_RUN', TASK_PREFIX)) return res.status(404).json({ error: 'Synthetic task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return sendError(res, error); }
  });
  return router;
}

module.exports = { FRESHNESS_MS, TASK_PREFIX, CAMPAIGN_PREFLIGHT_PREFIX, CHROMIUM_SAFE_PREFLIGHT_PREFIX, FACEBOOK_SESSION_READINESS_PREFIX, AVAILABILITY_CODES, createCloudRemoteTaskRouter, safeTask, safeResult, isOnline, targetAvailability };
