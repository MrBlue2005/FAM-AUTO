'use strict';

const crypto = require('crypto');
const express = require('express');
const { CAMPAIGN_PREFLIGHT_TASK_TYPE, buildCampaignPreflightSnapshot, safeCampaignPreflightResult } = require('./cloud-campaign-preflight');
const { CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, buildControlledExecutionSnapshot, safeControlledExecutionResult } = require('./cloud-controlled-execution');
const { LIVE_CAMPAIGN_EXECUTION_TASK_TYPE, LIVE_EXECUTION_MODE } = require('../app/local-agent/LiveCampaignExecutionExecutor');
const { CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE, safeChromiumPreflightResult } = require('./cloud-chromium-preflight');
const { FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE, safeFacebookSessionResult } = require('./facebook-session-preflight');
const { managedTaskOwnerId, taskWithServerOwner } = require('./task-ownership');
const { getVisibleCampaignPreflightSource } = require('./managed-user-campaign-visibility');
const { PERMISSIONS, hasPermission } = require('./hosted-rbac');
const { issueLiveConfirmationToken } = require('./live-confirmation-token');

const FRESHNESS_MS = 90 * 1000;
const TASK_PREFIX = 'synthetic_dry_run_';
const CAMPAIGN_PREFLIGHT_PREFIX = 'campaign_preflight_';
const CONTROLLED_EXECUTION_PREFIX = 'controlled_execution_';
const CHROMIUM_SAFE_PREFLIGHT_PREFIX = 'chromium_safe_preflight_';
const FACEBOOK_SESSION_READINESS_PREFIX = 'facebook_session_readiness_';
const AVAILABILITY_CODES = new Set([
  'SYNTHETIC_AGENT_NOT_FOUND',
  'SYNTHETIC_PROFILE_NOT_FOUND',
  'SYNTHETIC_PROFILE_OWNERSHIP_MISMATCH',
  'DEVICE_NOT_FOUND',
  'DEVICE_OFFLINE',
  'DEVICE_STALE',
  'PROFILE_NOT_FOUND',
  'PROFILE_NOT_READY',
  'PROFILE_OWNERSHIP_MISMATCH',
  'CAPABILITY_UNAVAILABLE',
  'CONFLICTING_WORK',
  'EXECUTION_TARGET_NOT_AUTHORIZED',
  'INVALID_CAMPAIGN_ID',
  'INVALID_TARGET_ID',
  'LIVE_EXECUTION_DISABLED',
  'LIVE_CONFIRMATION_UNAUTHENTICATED',
  'LIVE_CONFIRMATION_LEGACY_USER_DENIED',
  'LIVE_CONFIRMATION_POLICY_DISABLED',
  'LIVE_CONFIRMATION_CAMPAIGN_UNAVAILABLE',
  'LIVE_CONFIRMATION_ASSIGNMENT_UNAVAILABLE',
  'LIVE_CONFIRMATION_SOURCE_UNAVAILABLE',
  'LIVE_CONFIRMATION_INVALID_REQUEST',
]);

function safeResult(result, taskType) {
  if (result && result.dry_run === true && result.publishEnabled === false) return { dryRun: true, publishEnabled: false };
  if (taskType === CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE) return safeChromiumPreflightResult(result);
  if (taskType === FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE) return safeFacebookSessionResult(result);
  if (taskType === CAMPAIGN_PREFLIGHT_TASK_TYPE) return safeCampaignPreflightResult(result);
  if (taskType === CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE) return safeControlledExecutionResult(result);
  if (taskType === LIVE_CAMPAIGN_EXECUTION_TASK_TYPE && result?.liveExecution === true) return { liveExecution: true, executionRehearsal: result.executionRehearsal === true, sideEffectState: result.sideEffectState === 'VERIFIED_SUCCESS' ? 'VERIFIED_SUCCESS' : null, blockers: Array.isArray(result.blockers) ? result.blockers.filter((value) => typeof value === 'string').slice(0, 16) : [] };
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

function requestedTargetError(code) {
  return Object.assign(new Error('The selected Local Agent profile is unavailable.'), { status: 409, code });
}

function normalizedRequestedId(value) {
  return String(value || '').trim();
}

function canonicalUuid(value, code) {
  const normalized = normalizedRequestedId(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) throw Object.assign(new Error('The selected hosted record is unavailable.'), { status: 400, code });
  return normalized;
}

function campaignPreflightTaskId(deviceId, profileId, payload, ownerUserId = null) {
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ version: 2, deviceId, profileId, payload, ownerUserId })).digest('hex').slice(0, 32);
  return `${CAMPAIGN_PREFLIGHT_PREFIX}${fingerprint}`;
}

function controlledExecutionTaskId(deviceId, profileId, payload, ownerUserId = null) {
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ version: 1, type: CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, deviceId, profileId, payload, ownerUserId })).digest('hex').slice(0, 32);
  return `${CONTROLLED_EXECUTION_PREFIX}${fingerprint}`;
}

function createCloudRemoteTaskRouter({ store, agentId, profileId, chromiumPreflightEnabled = false, facebookSessionPreflightEnabled = false, facebookSessionAgentId = '', facebookSessionProfileId = '', controlledExecutionEnabled = false, liveExecutionEnabled = false, liveExecutionRehearsal = false, signingSecret, now = () => Date.now() }) {
  const router = express.Router();
  const adminOnly = (req, res, next) => req.user?.role === 'ADMIN' ? next() : res.status(403).json({ error: 'This action requires administrator access.' });
  const syntheticTargetConfigured = Boolean(agentId && profileId);
  const readTarget = async () => {
    if (!syntheticTargetConfigured) return { agent: null, profile: null, availability: targetAvailability(null, null, agentId, now()) };
    const [agent, profile] = await Promise.all([store.getControlPlaneAgent(agentId), store.getControlPlaneProfile(profileId)]);
    return { agent, profile, availability: targetAvailability(agent, profile, agentId, now()) };
  };
  const verifyTarget = async () => {
    if (!syntheticTargetConfigured) throw Object.assign(new Error('Synthetic remote task target is not configured.'), { status: 404 });
    const { agent, profile, availability } = await readTarget();
    if (!agent) throw availabilityError('SYNTHETIC_AGENT_NOT_FOUND');
    if (!profile) throw availabilityError('SYNTHETIC_PROFILE_NOT_FOUND');
    if (!availability.ownershipCorrect) throw availabilityError('SYNTHETIC_PROFILE_OWNERSHIP_MISMATCH');
    if (String(profile.status).toUpperCase() !== 'READY' || !isOnline(agent, now())) throw Object.assign(new Error('Synthetic Local Agent is offline or unavailable; no task was created.'), { status: 409 });
  };
  const belongsToSyntheticTarget = (task, taskType, prefix) => task && task.agent_id === agentId && task.profile_id === profileId && task.task_type === taskType && String(task.task_id || '').startsWith(prefix);
  const belongsToCampaignPreflight = (task) => task && task.task_type === CAMPAIGN_PREFLIGHT_TASK_TYPE && String(task.task_id || '').startsWith(CAMPAIGN_PREFLIGHT_PREFIX);
  const belongsToControlledExecution = (task) => task && task.task_type === CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE && String(task.task_id || '').startsWith(CONTROLLED_EXECUTION_PREFIX);
  const verifyRequestedTarget = async (body) => {
    const deviceId = normalizedRequestedId(body?.deviceId);
    const requestedProfileId = normalizedRequestedId(body?.profileId);
    const [agent, profile] = await Promise.all([store.getControlPlaneAgent(deviceId), store.getControlPlaneProfile(requestedProfileId)]);
    if (!agent) throw requestedTargetError('DEVICE_NOT_FOUND');
    const status = String(agent.reported_status || '').toUpperCase();
    if (!['ONLINE', 'BUSY', 'DEGRADED'].includes(status)) throw requestedTargetError('DEVICE_OFFLINE');
    const seen = Date.parse(agent.last_seen_at || '');
    if (!Number.isFinite(seen) || now() - seen > FRESHNESS_MS) throw requestedTargetError('DEVICE_STALE');
    // Agent capability is not yet modeled in the control-plane row. When it is,
    // this is the single server-side point to enforce local execution capability.
    if (!profile) throw requestedTargetError('PROFILE_NOT_FOUND');
    if (profile.agent_id !== deviceId) throw requestedTargetError('PROFILE_OWNERSHIP_MISMATCH');
    if (String(profile.status || '').toUpperCase() !== 'READY') throw requestedTargetError('PROFILE_NOT_READY');
    return { deviceId, profileId: requestedProfileId };
  };
  const existingCampaignTask = async (taskId, deviceId, requestedProfileId, ownerUserId) => {
    const task = await store.getControlPlaneTask(taskId);
    return belongsToCampaignPreflight(task) && task.agent_id === deviceId && task.profile_id === requestedProfileId && (task.owner_user_id || null) === ownerUserId ? task : null;
  };
  const createCampaignPreflightTask = async ({ deviceId, requestedProfileId, payload, user }) => {
    const ownerUserId = managedTaskOwnerId(user); const taskId = campaignPreflightTaskId(deviceId, requestedProfileId, payload, ownerUserId);
    const existing = await existingCampaignTask(taskId, deviceId, requestedProfileId, ownerUserId);
    if (existing) return { task: existing, created: false };
    if (typeof store.getActiveControlPlaneTaskForProfile === 'function') {
      const active = await store.getActiveControlPlaneTaskForProfile(requestedProfileId);
      if (active) throw requestedTargetError('CONFLICTING_WORK');
    }
    try {
      const task = await store.createControlPlaneTask(taskWithServerOwner({ task_id: taskId, agent_id: deviceId, profile_id: requestedProfileId, task_type: CAMPAIGN_PREFLIGHT_TASK_TYPE, payload }, user));
      return { task, created: true };
    } catch (error) {
      const concurrent = await existingCampaignTask(taskId, deviceId, requestedProfileId, ownerUserId);
      if (concurrent) return { task: concurrent, created: false };
      throw error;
    }
  };
  const liveConfirmationError = (code, status, message) => Object.assign(new Error(message), { status, code });
  const authorizeLiveConfirmation = async (user, body) => {
    if (!liveExecutionEnabled) throw liveConfirmationError('LIVE_EXECUTION_DISABLED', 404, 'Live execution is disabled.');
    if (!user) throw liveConfirmationError('LIVE_CONFIRMATION_UNAUTHENTICATED', 401, 'Authentication is required.');
    const requested = {
      kind: String(body?.kind || ''),
      campaignId: canonicalUuid(body?.campaignId, 'INVALID_CAMPAIGN_ID'),
      day: Number(body?.day),
      targetId: canonicalUuid(body?.targetId, 'INVALID_TARGET_ID'),
      deviceId: normalizedRequestedId(body?.deviceId),
      profileId: normalizedRequestedId(body?.profileId),
      campaignRevision: body?.campaignRevision,
      postRevision: body?.postRevision,
    };
    if (!['property', 'job'].includes(requested.kind) || !Number.isSafeInteger(requested.day) || requested.day < 1 || !requested.deviceId || !requested.profileId) {
      throw liveConfirmationError('LIVE_CONFIRMATION_INVALID_REQUEST', 400, 'The reviewed live confirmation intent is invalid.');
    }
    let owner;
    if (user.role === 'USER') {
      const ownerUserId = managedTaskOwnerId(user);
      if (!ownerUserId) throw liveConfirmationError('LIVE_CONFIRMATION_LEGACY_USER_DENIED', 403, 'Managed USER authorization is required.');
      if (typeof store.getManagedUserById !== 'function' || typeof store.listManagedUserExecutionTargets !== 'function') throw liveConfirmationError('LIVE_CONFIRMATION_POLICY_DISABLED', 403, 'Live execution is not enabled for this user.');
      const managed = await store.getManagedUserById(ownerUserId);
      if (!managed || managed.enabled === false || managed.live_execution_enabled !== true) throw liveConfirmationError('LIVE_CONFIRMATION_POLICY_DISABLED', 403, 'Live execution is not enabled for this user.');
      const assignments = await store.listManagedUserExecutionTargets(ownerUserId, { enabledOnly: true });
      if (!assignments.some((item) => item.device_id === requested.deviceId && item.profile_id === requested.profileId)) throw liveConfirmationError('LIVE_CONFIRMATION_ASSIGNMENT_UNAVAILABLE', 403, 'The selected execution target is not authorized.');
      owner = { role: 'USER', managedUserId: ownerUserId };
    } else if (user.role === 'ADMIN' && hasPermission(user.role, PERMISSIONS.EXECUTION_RUN)) {
      if (!user.username) throw liveConfirmationError('LIVE_CONFIRMATION_UNAUTHENTICATED', 401, 'Authentication is required.');
      owner = { role: 'ADMIN', username: user.username };
    } else {
      throw liveConfirmationError('LIVE_CONFIRMATION_LEGACY_USER_DENIED', 403, 'Managed USER authorization is required.');
    }
    const target = await verifyRequestedTarget(requested);
    let source;
    try {
      source = await getVisibleCampaignPreflightSource(store, user, requested);
      if (source?.campaign?.campaign_id !== requested.campaignId || source?.target?.target_id !== requested.targetId) throw new Error('source mismatch');
      // Reuse the existing canonical source/post/revision validation; the snapshot is not returned or queued.
      buildCampaignPreflightSnapshot({ campaign: source.campaign, target: source.target, postDay: requested.day, expectedCampaignRevision: requested.campaignRevision, expectedPostRevision: requested.postRevision });
    } catch {
      throw liveConfirmationError('LIVE_CONFIRMATION_CAMPAIGN_UNAVAILABLE', 404, 'The selected campaign source is unavailable.');
    }
    return { owner, intent: { campaignId: requested.campaignId, day: requested.day, targetId: requested.targetId, deviceId: target.deviceId, profileId: target.profileId } };
  };
  const sendError = (res, error) => {
    const body = { error: error.message };
    if (AVAILABILITY_CODES.has(error.code)) body.code = error.code;
    return res.status(error.status || 400).json(body);
  };

  router.post('/synthetic-dry-run', adminOnly, async (req, res) => {
    try {
      await verifyTarget();
      const task = await store.createControlPlaneTask(taskWithServerOwner({
        task_id: `${TASK_PREFIX}${crypto.randomUUID()}`,
        agent_id: agentId,
        profile_id: profileId,
        task_type: 'DRY_RUN',
        payload: { validation: 'hosted-remote-roundtrip', publishEnabled: false },
      }, null));
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/synthetic-dry-run/availability', async (req, res) => {
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'This action requires administrator access.' });
    try {
      return res.json((await readTarget()).availability);
    } catch (error) { return sendError(res, error); }
  });

  router.post('/campaign-preflight', async (req, res) => {
    try {
      const managedOwnerId = managedTaskOwnerId(req.user);
      if (req.user?.role === 'USER') {
        if (!managedOwnerId || typeof store.listManagedUserExecutionTargets !== 'function') throw Object.assign(new Error('Managed USER execution is unavailable for this session.'), { status: 403 });
        const requestedDeviceId = normalizedRequestedId(req.body?.deviceId); const requestedProfileId = normalizedRequestedId(req.body?.profileId);
        const targets = await store.listManagedUserExecutionTargets(managedOwnerId, { enabledOnly: true });
        if (!targets.some((target) => target.device_id === requestedDeviceId && target.profile_id === requestedProfileId)) throw Object.assign(new Error('The selected execution target is not authorized.'), { status: 403, code: 'EXECUTION_TARGET_NOT_AUTHORIZED' });
      }
      const { deviceId, profileId: requestedProfileId } = await verifyRequestedTarget(req.body);
      const kind = String(req.body?.kind || '');
      if (!['property', 'job'].includes(kind)) throw Object.assign(new Error('A supported campaign kind is required.'), { status: 400 });
      const campaignId = canonicalUuid(req.body?.campaignId, 'INVALID_CAMPAIGN_ID');
      const targetId = canonicalUuid(req.body?.targetId, 'INVALID_TARGET_ID');
      const source = await getVisibleCampaignPreflightSource(store, req.user, { kind, campaignId, targetId });
      const payload = buildCampaignPreflightSnapshot({ campaign: source.campaign, target: source.target, postDay: Number(req.body?.day), expectedCampaignRevision: req.body?.campaignRevision, expectedPostRevision: req.body?.postRevision });
      const created = await createCampaignPreflightTask({ deviceId, requestedProfileId, payload, user: req.user });
      return res.status(created.created ? 201 : 200).json({ task: safeTask(created.task) });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/controlled-execution', async (req, res) => {
    try {
      if (!controlledExecutionEnabled) throw Object.assign(new Error('Controlled execution is disabled.'), { status: 404, code: 'CONTROLLED_EXECUTION_DISABLED' });
      if (req.user?.role === 'USER') {
        const ownerUserId = managedTaskOwnerId(req.user);
        if (!ownerUserId || typeof store.getManagedUserById !== 'function' || typeof store.listManagedUserExecutionTargets !== 'function') throw Object.assign(new Error('Controlled execution is unavailable for this session.'), { status: 403 });
        const managed = await store.getManagedUserById(ownerUserId);
        if (!managed || managed.enabled === false || managed.controlled_execution_enabled !== true) throw Object.assign(new Error('Controlled execution is not enabled for this user.'), { status: 403 });
        const requestedDeviceId = normalizedRequestedId(req.body?.deviceId); const requestedProfileId = normalizedRequestedId(req.body?.profileId);
        const assignments = await store.listManagedUserExecutionTargets(ownerUserId, { enabledOnly: true });
        if (!assignments.some((item) => item.device_id === requestedDeviceId && item.profile_id === requestedProfileId)) throw Object.assign(new Error('The selected execution target is not authorized.'), { status: 403, code: 'EXECUTION_TARGET_NOT_AUTHORIZED' });
      } else if (!hasPermission(req.user?.role, PERMISSIONS.EXECUTION_RUN)) throw Object.assign(new Error('Controlled execution requires execution.run permission.'), { status: 403 });
      const { deviceId, profileId: requestedProfileId } = await verifyRequestedTarget(req.body);
      const kind = String(req.body?.kind || '');
      if (!['property', 'job'].includes(kind)) throw Object.assign(new Error('A supported campaign kind is required.'), { status: 400 });
      const campaignId = canonicalUuid(req.body?.campaignId, 'INVALID_CAMPAIGN_ID');
      const targetId = canonicalUuid(req.body?.targetId, 'INVALID_TARGET_ID');
      const source = await getVisibleCampaignPreflightSource(store, req.user, { kind, campaignId, targetId });
      const payload = buildControlledExecutionSnapshot({ campaign: source.campaign, target: source.target, postDay: Number(req.body?.day), expectedCampaignRevision: req.body?.campaignRevision, expectedPostRevision: req.body?.postRevision });
      const ownerUserId = managedTaskOwnerId(req.user); const taskId = controlledExecutionTaskId(deviceId, requestedProfileId, payload, ownerUserId);
      const existing = await store.getControlPlaneTask(taskId);
      if (belongsToControlledExecution(existing) && existing.agent_id === deviceId && existing.profile_id === requestedProfileId && (existing.owner_user_id || null) === ownerUserId) return res.json({ task: safeTask(existing) });
      if (typeof store.getActiveControlPlaneTaskForProfile === 'function' && await store.getActiveControlPlaneTaskForProfile(requestedProfileId)) throw requestedTargetError('CONFLICTING_WORK');
      try {
        const task = await store.createControlPlaneTask(taskWithServerOwner({ task_id: taskId, agent_id: deviceId, profile_id: requestedProfileId, task_type: CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, payload }, req.user));
        return res.status(201).json({ task: safeTask(task) });
      } catch (error) {
        const concurrent = await store.getControlPlaneTask(taskId);
        if (belongsToControlledExecution(concurrent)) return res.json({ task: safeTask(concurrent) });
        throw error;
      }
    } catch (error) { return sendError(res, error); }
  });

  router.post('/live-campaign-execution', async (req, res) => {
    try {
      if (!liveExecutionEnabled) throw Object.assign(new Error('Live execution is disabled.'), { status: 404, code: 'LIVE_EXECUTION_DISABLED' });
      const ownerUserId = managedTaskOwnerId(req.user);
      if (req.user?.role === 'USER') {
        const managed = ownerUserId && await store.getManagedUserById(ownerUserId);
        if (!managed || managed.enabled === false || managed.live_execution_enabled !== true) throw Object.assign(new Error('Live execution is not enabled for this user.'), { status: 403 });
        const requestedDeviceId = normalizedRequestedId(req.body?.deviceId); const requestedProfileId = normalizedRequestedId(req.body?.profileId);
        const assignments = await store.listManagedUserExecutionTargets(ownerUserId, { enabledOnly: true });
        if (!assignments.some((item) => item.device_id === requestedDeviceId && item.profile_id === requestedProfileId)) throw Object.assign(new Error('The selected execution target is not authorized.'), { status: 403, code: 'EXECUTION_TARGET_NOT_AUTHORIZED' });
      } else if (!hasPermission(req.user?.role, PERMISSIONS.EXECUTION_RUN)) throw Object.assign(new Error('Live execution requires execution.run permission.'), { status: 403 });
      const { deviceId, profileId: requestedProfileId } = await verifyRequestedTarget(req.body);
      const kind = String(req.body?.kind || ''); if (!['property', 'job'].includes(kind)) throw Object.assign(new Error('A supported campaign kind is required.'), { status: 400 });
      const source = await getVisibleCampaignPreflightSource(store, req.user, { kind, campaignId: canonicalUuid(req.body?.campaignId, 'INVALID_CAMPAIGN_ID'), targetId: canonicalUuid(req.body?.targetId, 'INVALID_TARGET_ID') });
      const preflight = buildCampaignPreflightSnapshot({ campaign: source.campaign, target: source.target, postDay: Number(req.body?.day), expectedCampaignRevision: req.body?.campaignRevision, expectedPostRevision: req.body?.postRevision });
      const payload = Object.freeze({ ...preflight, mode: LIVE_EXECUTION_MODE, execution_config: Object.freeze({ mode: LIVE_EXECUTION_MODE, publishEnabled: true, rehearsal: liveExecutionRehearsal === true }), publishEnabled: true });
      const taskId = `live_execution_${crypto.createHash('sha256').update(JSON.stringify({ deviceId, requestedProfileId, payload, ownerUserId })).digest('hex').slice(0, 32)}`;
      const existing = await store.getControlPlaneTask(taskId); if (existing) return res.json({ task: safeTask(existing) });
      if (typeof store.getActiveControlPlaneTaskForProfile === 'function' && await store.getActiveControlPlaneTaskForProfile(requestedProfileId)) throw requestedTargetError('CONFLICTING_WORK');
      const task = await store.createControlPlaneTask(taskWithServerOwner({ task_id: taskId, agent_id: deviceId, profile_id: requestedProfileId, task_type: LIVE_CAMPAIGN_EXECUTION_TASK_TYPE, payload }, req.user));
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/live-confirmations', async (req, res) => {
    try {
      const { owner, intent } = await authorizeLiveConfirmation(req.user, req.body);
      const issued = issueLiveConfirmationToken({ signingSecret, owner, ...intent, now });
      return res.status(200).json({ confirmationToken: issued.token, expiresAt: issued.expiresAt });
    } catch (error) { return sendError(res, error); }
  });

  router.post('/chromium-safe-preflight', adminOnly, async (req, res) => {
    try {
      if (!chromiumPreflightEnabled) throw Object.assign(new Error('Chromium safe preflight is disabled.'), { status: 404, code: 'CHROMIUM_PREFLIGHT_DISABLED' });
      await verifyTarget();
      const task = await store.createControlPlaneTask(taskWithServerOwner({ task_id: `${CHROMIUM_SAFE_PREFLIGHT_PREFIX}${crypto.randomUUID()}`, agent_id: agentId, profile_id: profileId, task_type: CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE, payload: { mode: 'CHROMIUM_SAFE_PREFLIGHT', publishEnabled: false } }, null));
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return sendError(res, error); }
  });
  router.post('/facebook-session-readiness', adminOnly, async (req, res) => {
    try {
      if (!facebookSessionPreflightEnabled || !facebookSessionAgentId || !facebookSessionProfileId) throw Object.assign(new Error('Facebook session readiness preflight is disabled.'), { status: 404 });
      const [agent, profile] = await Promise.all([store.getControlPlaneAgent(facebookSessionAgentId), store.getControlPlaneProfile(facebookSessionProfileId)]);
      if (!agent || !profile || profile.agent_id !== facebookSessionAgentId || String(profile.status).toUpperCase() !== 'READY' || !isOnline(agent, now())) throw Object.assign(new Error('Reviewed Local Agent profile is unavailable; no task was created.'), { status: 409 });
      const task = await store.createControlPlaneTask(taskWithServerOwner({ task_id: `${FACEBOOK_SESSION_READINESS_PREFIX}${crypto.randomUUID()}`, agent_id: facebookSessionAgentId, profile_id: facebookSessionProfileId, task_type: FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE, payload: { executionMode: 'SESSION_READINESS', publishEnabled: false } }, null));
      return res.status(201).json({ task: safeTask(task) });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/campaign-preflight/:taskId', async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(CAMPAIGN_PREFLIGHT_PREFIX)) return res.status(404).json({ error: 'Campaign preflight task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToCampaignPreflight(task) || (req.user?.role === 'USER' && task.owner_user_id !== managedTaskOwnerId(req.user))) return res.status(404).json({ error: 'Campaign preflight task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return sendError(res, error); }
  });
  router.get('/controlled-execution/:taskId', async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(CONTROLLED_EXECUTION_PREFIX)) return res.status(404).json({ error: 'Controlled execution task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToControlledExecution(task) || (req.user?.role === 'USER' && task.owner_user_id !== managedTaskOwnerId(req.user))) return res.status(404).json({ error: 'Controlled execution task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/chromium-safe-preflight/:taskId', adminOnly, async (req, res) => {
    try {
      if (!String(req.params.taskId || '').startsWith(CHROMIUM_SAFE_PREFLIGHT_PREFIX)) return res.status(404).json({ error: 'Chromium safe preflight task was not found.' });
      const task = await store.getControlPlaneTask(req.params.taskId);
      if (!belongsToSyntheticTarget(task, CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE, CHROMIUM_SAFE_PREFLIGHT_PREFIX)) return res.status(404).json({ error: 'Chromium safe preflight task was not found.' });
      const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: event.event_type, occurredAt: event.occurred_at }));
      return res.json({ task: safeTask(task), events });
    } catch (error) { return sendError(res, error); }
  });

  router.get('/synthetic-dry-run/:taskId', adminOnly, async (req, res) => {
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

module.exports = { FRESHNESS_MS, TASK_PREFIX, CAMPAIGN_PREFLIGHT_PREFIX, CONTROLLED_EXECUTION_PREFIX, CHROMIUM_SAFE_PREFLIGHT_PREFIX, FACEBOOK_SESSION_READINESS_PREFIX, AVAILABILITY_CODES, campaignPreflightTaskId, controlledExecutionTaskId, createCloudRemoteTaskRouter, safeTask, safeResult, isOnline, targetAvailability };
