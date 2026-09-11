'use strict';

const express = require('express');
const { safeResult } = require('./cloud-remote-task-api');
const { managedTaskOwnerId } = require('./task-ownership');

const AGENT_HEARTBEAT_FRESHNESS_MS = 90 * 1000;
const ACTIVE_TASK_STATUSES = new Set(['QUEUED', 'CLAIMED', 'RUNNING']);
const TASK_HISTORY_DEFAULT_LIMIT = 25;
const TASK_HISTORY_MAX_LIMIT = 50;
const TASK_HISTORY_STATUSES = new Set(['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'OUTCOME_UNKNOWN']);
const SAFE_ERROR_CODES = new Set(['DEVICE_OFFLINE', 'DEVICE_STALE', 'PROFILE_NOT_READY', 'PROFILE_NOT_FOUND', 'PROFILE_OWNERSHIP_MISMATCH', 'CONFLICTING_WORK', 'MEDIA_NOT_READY', 'MEDIA_SNAPSHOT_INVALID', 'CAMPAIGN_REVISION_STALE', 'POST_REVISION_STALE', 'CAMPAIGN_NOT_FOUND', 'TARGET_NOT_FOUND', 'POST_NOT_FOUND', 'EXECUTION_FAILED', 'OUTCOME_UNKNOWN']);

const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const string = (value) => typeof value === 'string' ? value : undefined;
const boolean = (value) => typeof value === 'boolean' ? value : undefined;
const pick = (source, fields) => Object.fromEntries(fields.flatMap((field) => source[field] === undefined ? [] : [[field, source[field]]])) ;

function mapPost(row) {
  const data = plainObject(row.data);
  return {
    day: Number(row.day), text: String(row.text || ''), active: row.active !== false,
    ...pick(data, ['title', 'variant', 'published']),
    media: (Array.isArray(row.app_post_media) ? row.app_post_media : [])
      .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
      .map((relation) => relation.app_media_objects)
      .filter((media) => media?.media_id)
      .map((media) => ({ mediaId: media.media_id, type: String(media.mime_type || '').startsWith('video/') ? 'video' : 'image', name: media.original_name || 'media' })),
  };
}

function mapCampaign(row, folders = new Map()) {
  const data = plainObject(row.data);
  const common = {
    id: String(row.legacy_id), active: row.active !== false,
    folderId: folders.get(row.folder_id) || null, facebookProfileId: row.profile_id || '',
    posts: (Array.isArray(row.app_campaign_posts) ? row.app_campaign_posts : []).sort((left, right) => Number(left.day) - Number(right.day)).map(mapPost),
    ...pick(data, ['transactionType', 'company', 'description', 'location', 'price']),
  };
  return row.kind === 'job' ? { ...common, title: String(row.title || row.legacy_id) } : { ...common, name: String(row.title || row.legacy_id) };
}

function mapTarget(row) {
  const data = plainObject(row.data);
  return {
    id: String(row.legacy_id), name: String(row.display_name || row.legacy_id), url: String(row.target_url || ''), active: row.active !== false,
    category: string(data.category) || 'real_estate', groupListCategory: string(data.groupListCategory) || String(row.category || 'Romania'),
    ...pick(data, ['favorite', 'overrideType']),
  };
}

function mapPreflightCampaign(row) {
  return { campaignId: String(row.campaign_id), kind: String(row.kind), title: String(row.title || 'Campanie'), revision: Number.isInteger(row.revision) ? row.revision : undefined, posts: (Array.isArray(row.app_campaign_posts) ? row.app_campaign_posts : []).filter((post) => post.active !== false).sort((left, right) => Number(left.day) - Number(right.day)).map((post) => ({ day: Number(post.day), revision: Number.isInteger(post.revision) ? post.revision : undefined })) };
}

function mapPreflightTarget(row) {
  return { targetId: String(row.target_id), name: String(row.display_name || 'Target') };
}

function mapFolder(row) {
  return { id: String(row.legacy_id), name: String(row.name), createdAt: row.created_at || null, updatedAt: row.updated_at || null };
}

function mapSchedule(row, folders, campaigns) {
  const schedule = plainObject(row.schedule);
  return {
    ...pick(schedule, ['daysOfWeek', 'time', 'campaignCategory', 'groupListCategory', 'campaignDay', 'groupLimit', 'startFromGroup', 'skipGroupsPostedToday', 'publishEnabled', 'confirmedPublishEnabled', 'maxLateMinutes', 'liveConfirmed']),
    id: String(row.legacy_id), name: String(row.name), enabled: row.enabled !== false,
    folderId: folders.get(row.folder_id) || null, facebookProfileId: row.profile_id || '',
    campaignIds: (Array.isArray(row.app_schedule_campaigns) ? row.app_schedule_campaigns : [])
      .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
      .map((relation) => campaigns.get(relation.app_campaigns?.campaign_id)).filter(Boolean),
  };
}

function mapMedia(row, campaignByPostId) {
  const relations = Array.isArray(row.app_post_media) ? row.app_post_media : [];
  const campaignId = relations.map((relation) => campaignByPostId.get(relation.post_id)).find(Boolean) || null;
  const mime = String(row.mime_type || '');
  return {
    id: String(row.media_id), path: '', relativePath: '', name: String(row.original_name || 'media'),
    type: mime.startsWith('video/') ? 'video' : 'image', size: Number(row.byte_size) || 0, createdAt: row.created_at || null,
    propertyId: campaignId, used: relations.length > 0, duplicate: false, state: String(row.state || ''), previewAvailable: row.state === 'READY' && relations.length > 0,
  };
}

function mapAgentStatus(row, nowMs = Date.now()) {
  if (!row) return { configured: false, online: false, lastSeenAt: null, agentName: null, capabilities: { localExecution: false, facebookAutomation: false } };
  const lastSeenMs = Date.parse(row.last_seen_at || '');
  const fresh = Number.isFinite(lastSeenMs) && nowMs - lastSeenMs <= AGENT_HEARTBEAT_FRESHNESS_MS;
  const reportedOnline = ['ONLINE', 'BUSY', 'DEGRADED'].includes(String(row.reported_status || '').toUpperCase());
  return {
    configured: true,
    online: fresh && reportedOnline,
    lastSeenAt: Number.isFinite(lastSeenMs) ? new Date(lastSeenMs).toISOString() : null,
    agentName: String(row.display_name || 'RX Local Agent'),
    capabilities: { localExecution: true, facebookAutomation: false },
  };
}

function isoDate(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function deviceCapabilities() {
  // The current agent protocol authoritatively establishes local task execution,
  // but does not report per-agent feature/version capability flags yet.
  return { localExecution: true, facebookAutomation: false };
}

function activeWorkload(tasks = []) {
  const relevant = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(String(task.status || '').toUpperCase()));
  const count = (status) => relevant.filter((task) => String(task.status || '').toUpperCase() === status).length;
  return { activeTaskCount: relevant.length, queuedTaskCount: count('QUEUED'), claimedTaskCount: count('CLAIMED'), runningTaskCount: count('RUNNING') };
}

function mapDeviceProfile(row, tasks = []) {
  const status = String(row.status || 'UNAVAILABLE').toUpperCase();
  const workload = activeWorkload(tasks);
  const busy = workload.claimedTaskCount + workload.runningTaskCount > 0;
  const ready = status === 'READY';
  const active = tasks.find((task) => ['CLAIMED', 'RUNNING'].includes(String(task.status || '').toUpperCase()));
  return {
    profileId: String(row.profile_id), displayName: String(row.display_name || row.profile_id), status,
    lastSeenAt: isoDate(row.last_seen_at), ready, busy, workload,
    activeTaskType: active?.task_type ? String(active.task_type) : null,
    readinessState: !ready ? 'PROFILE_NOT_READY' : busy ? 'PROFILE_BUSY' : 'READY',
    reasonCodes: !ready ? ['PROFILE_NOT_READY'] : busy ? ['PROFILE_BUSY'] : [],
  };
}

function deviceReadiness(row, profiles, workload, nowMs) {
  const reportedStatus = String(row.reported_status || 'OFFLINE').toUpperCase();
  const seen = Date.parse(row.last_seen_at || '');
  const fresh = Number.isFinite(seen) && nowMs - seen <= AGENT_HEARTBEAT_FRESHNESS_MS;
  const accepted = ['ONLINE', 'BUSY', 'DEGRADED'].includes(reportedStatus);
  const freeReadyProfiles = profiles.filter((profile) => profile.ready && !profile.busy);
  if (!accepted) return { state: 'OFFLINE', canAcceptPreflight: false, reasonCodes: ['DEVICE_OFFLINE'] };
  if (!fresh) return { state: 'STALE', canAcceptPreflight: false, reasonCodes: ['DEVICE_STALE'] };
  if (reportedStatus === 'DEGRADED') return { state: 'DEGRADED', canAcceptPreflight: false, reasonCodes: ['DEVICE_DEGRADED'] };
  if (!deviceCapabilities().localExecution) return { state: 'CAPABILITY_UNAVAILABLE', canAcceptPreflight: false, reasonCodes: ['CAPABILITY_UNAVAILABLE'] };
  if (reportedStatus === 'BUSY' || workload.claimedTaskCount + workload.runningTaskCount > 0 && !freeReadyProfiles.length) return { state: 'BUSY', canAcceptPreflight: false, reasonCodes: ['PROFILE_BUSY'] };
  if (!freeReadyProfiles.length) return { state: 'NO_READY_PROFILE', canAcceptPreflight: false, reasonCodes: profiles.some((profile) => profile.busy) ? ['PROFILE_BUSY'] : ['NO_READY_PROFILE'] };
  return { state: 'READY', canAcceptPreflight: true, reasonCodes: [] };
}

function mapDevice(row, nowMs = Date.now(), profiles = [], tasks = []) {
  const reportedStatus = String(row.reported_status || 'OFFLINE').toUpperCase();
  const lastSeenAt = isoDate(row.last_seen_at);
  const fresh = lastSeenAt && nowMs - Date.parse(lastSeenAt) <= AGENT_HEARTBEAT_FRESHNESS_MS;
  const accepted = ['ONLINE', 'BUSY', 'DEGRADED'].includes(reportedStatus);
  const mappedProfiles = profiles.map((profile) => mapDeviceProfile(profile.row, profile.tasks));
  const workload = { ...activeWorkload(tasks), busyProfileCount: mappedProfiles.filter((profile) => profile.busy).length };
  return {
    deviceId: String(row.agent_id),
    displayName: String(row.display_name || 'RX Local Agent'),
    online: Boolean(fresh && accepted),
    reportedStatus: fresh && accepted ? reportedStatus : 'OFFLINE',
    lastSeenAt,
    capabilities: deviceCapabilities(), workload,
    readiness: deviceReadiness(row, mappedProfiles, workload, nowMs), profiles: mappedProfiles,
  };
}

async function listDevices(store, nowMs = Date.now()) {
  const [agents, profiles, activeTasks] = await Promise.all([store.listControlPlaneAgents(), store.listControlPlaneProfiles(), typeof store.listActiveControlPlaneTasks === 'function' ? store.listActiveControlPlaneTasks() : []]);
  const tasksByAgent = new Map(); const tasksByProfile = new Map();
  for (const task of activeTasks) {
    const agentId = String(task.agent_id || ''); const profileId = String(task.profile_id || '');
    if (!tasksByAgent.has(agentId)) tasksByAgent.set(agentId, []); tasksByAgent.get(agentId).push(task);
    if (!tasksByProfile.has(profileId)) tasksByProfile.set(profileId, []); tasksByProfile.get(profileId).push(task);
  }
  const profilesByAgent = new Map();
  for (const profile of profiles) {
    const agentId = String(profile.agent_id || '');
    if (!profilesByAgent.has(agentId)) profilesByAgent.set(agentId, []);
    profilesByAgent.get(agentId).push({ row: profile, tasks: (tasksByProfile.get(String(profile.profile_id)) || []).filter((task) => String(task.agent_id) === agentId) });
  }
  return { devices: agents.map((agent) => mapDevice(agent, nowMs, profilesByAgent.get(String(agent.agent_id)) || [], tasksByAgent.get(String(agent.agent_id)) || [])) };
}

function historyLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return TASK_HISTORY_DEFAULT_LIMIT;
  return Math.min(parsed, TASK_HISTORY_MAX_LIMIT);
}

function safeErrorCode(error, status) {
  if (String(status).toUpperCase() === 'OUTCOME_UNKNOWN') return 'OUTCOME_UNKNOWN';
  const code = string(plainObject(error).code);
  return code && SAFE_ERROR_CODES.has(code) ? code : (error ? 'EXECUTION_FAILED' : null);
}

function mapHistoryTask(task, agents = new Map(), profiles = new Map()) {
  const agent = agents.get(String(task.agent_id));
  const profile = profiles.get(String(task.profile_id));
  const result = safeResult(task.result, task.task_type);
  return {
    taskId: String(task.task_id), taskType: String(task.task_type || 'UNKNOWN'), status: String(task.status || 'QUEUED').toUpperCase(),
    createdAt: isoDate(task.created_at), claimedAt: isoDate(task.claimed_at), startedAt: isoDate(task.started_at), completedAt: isoDate(task.completed_at),
    deviceId: String(task.agent_id || ''), deviceDisplayName: String(agent?.display_name || 'Dispozitiv necunoscut'),
    profileId: String(task.profile_id || ''), profileDisplayName: String(profile?.display_name || 'Profil necunoscut'),
    attempt: Number.isInteger(task.attempt) ? task.attempt : 0,
    result,
    mediaCount: Number.isInteger(result?.mediaCount) ? result.mediaCount : 0,
    mediaVerified: result?.mediaVerified === true,
    preflightPassed: result?.preflightPassed === true,
    executionValidated: result?.executionValidated === true,
    readyForFutureLiveExecution: result?.readyForFutureLiveExecution === true,
    blockers: Array.isArray(result?.blockers) ? result.blockers.filter((value) => typeof value === 'string').slice(0, 16) : [],
    errorCode: safeErrorCode(task.error, task.status),
    outcomeUnknown: String(task.status || '').toUpperCase() === 'OUTCOME_UNKNOWN',
    sideEffectState: ['NOT_ATTEMPTED','ATTEMPT_STARTED','VERIFIED_SUCCESS'].includes(String(task.side_effect_state || '').toUpperCase()) ? String(task.side_effect_state).toUpperCase() : null,
  };
}

async function taskHistoryContext(store) {
  const [agents, profiles] = await Promise.all([store.listControlPlaneAgents(), store.listControlPlaneProfiles()]);
  return { agents: new Map(agents.map((agent) => [String(agent.agent_id), agent])), profiles: new Map(profiles.map((profile) => [String(profile.profile_id), profile])) };
}

async function managedExecutionTargets(store, userId) {
  const assignments = await store.listManagedUserExecutionTargets(userId, { enabledOnly: true });
  const [agents, profiles] = await Promise.all([store.listControlPlaneAgents(), store.listControlPlaneProfiles()]);
  const agentById = new Map(agents.map((agent) => [String(agent.agent_id), agent])); const profileById = new Map(profiles.map((profile) => [String(profile.profile_id), profile]));
  return assignments.map((assignment) => {
    const agent = agentById.get(String(assignment.device_id)); const profile = profileById.get(String(assignment.profile_id)); const seen = Date.parse(agent?.last_seen_at || '');
    const online = ['ONLINE', 'BUSY', 'DEGRADED'].includes(String(agent?.reported_status || '').toUpperCase()) && Number.isFinite(seen) && Date.now() - seen <= AGENT_HEARTBEAT_FRESHNESS_MS;
    const profileStatus = String(profile?.status || 'UNAVAILABLE').toUpperCase();
    return { deviceId: String(assignment.device_id), deviceDisplayName: String(agent?.display_name || 'Dispozitiv indisponibil'), profileId: String(assignment.profile_id), profileDisplayName: String(profile?.display_name || 'Profil indisponibil'), online, profileStatus, canRequestPreflight: Boolean(agent && profile && profile.agent_id === assignment.device_id && online && profileStatus === 'READY') };
  });
}

function createCloudDashboardReadRouter(store, { requirePermission } = {}) {
  const router = express.Router();
  const send = (res, promise) => Promise.resolve(promise).then((value) => res.json(value)).catch((error) => res.status(error.status || 400).json({ error: error.message }));
  const campaignFolders = async () => (await store.listCampaignFolders()).map(mapFolder);
  const campaigns = async (kind) => {
    const folders = new Map((await store.listCampaignFolders()).map((folder) => [folder.folder_id, String(folder.legacy_id)]));
    return (await store.listCampaigns(kind)).map((row) => mapCampaign(row, folders));
  };
  router.get('/properties', (req, res) => send(res, campaigns('property')));
  router.get('/jobs', (req, res) => send(res, campaigns('job')));
  router.get('/groups', (req, res) => send(res, store.listTargets().then((rows) => rows.map(mapTarget))));
  router.get('/preflight-sources', (req, res) => send(res, Promise.all([store.listCampaigns('property'), store.listCampaigns('job'), store.listTargets()]).then(([properties, jobs, targets]) => ({ campaigns: [...properties, ...jobs].filter((row) => row.active !== false).map(mapPreflightCampaign), targets: targets.filter((row) => row.active !== false).map(mapPreflightTarget) }))));
  router.get('/campaign-folders', (req, res) => send(res, campaignFolders()));
  router.get('/schedule-folders', (req, res) => send(res, store.listScheduleFolders().then((rows) => rows.map(mapFolder))));
  router.get('/schedules', (req, res) => send(res, Promise.all([store.listSchedules(), store.listScheduleFolders(), store.listCampaigns('property'), store.listCampaigns('job')]).then(([rows, folders, properties, jobs]) => {
    const folderMap = new Map(folders.map((folder) => [folder.folder_id, String(folder.legacy_id)]));
    const campaignMap = new Map([...properties, ...jobs].map((campaign) => [campaign.campaign_id, String(campaign.legacy_id)]));
    return { timezone: 'cloud-read-only', schedules: rows.map((row) => mapSchedule(row, folderMap, campaignMap)), folders: folders.map(mapFolder) };
  })));
  router.get('/media', (req, res) => send(res, Promise.all([store.listMedia(), store.listCampaigns('property'), store.listCampaigns('job')]).then(([media, properties, jobs]) => {
    const campaignByPostId = new Map([...properties, ...jobs].flatMap((campaign) => (campaign.app_campaign_posts || []).map((post) => [post.post_id, campaign.legacy_id])));
    return media.map((row) => mapMedia(row, campaignByPostId));
  })));
  router.get('/agent-status', (req, res) => send(res, store.getAgentStatus().then((agent) => mapAgentStatus(agent))));
  router.get('/devices', requirePermission ? requirePermission('devices.read') : (req, res, next) => next(), (req, res) => send(res, listDevices(store)));
  router.get('/my-execution-targets', (req, res) => {
    const userId = managedTaskOwnerId(req.user);
    if (!userId) return res.status(403).json({ error: 'Execution targets are unavailable for this session.' });
    return send(res, managedExecutionTargets(store, userId).then((targets) => ({ targets })));
  });
  const taskHistoryAccess = (req, res, next) => {
    if (req.user?.role === 'ADMIN') { req.taskHistoryOwnerUserId = null; return next(); }
    const ownerUserId = managedTaskOwnerId(req.user);
    if (!ownerUserId) return res.status(403).json({ error: 'Task history is unavailable for this session.' });
    req.taskHistoryOwnerUserId = ownerUserId;
    return next();
  };
  router.get('/tasks', taskHistoryAccess, (req, res) => send(res, (async () => {
    const deviceId = string(req.query.deviceId)?.trim() || '';
    const profileId = string(req.query.profileId)?.trim() || '';
    const status = string(req.query.status)?.trim().toUpperCase() || '';
    if (status && !TASK_HISTORY_STATUSES.has(status)) return { tasks: [], limit: historyLimit(req.query.limit) };
    const context = await taskHistoryContext(store);
    if (deviceId && profileId && context.profiles.get(profileId)?.agent_id !== deviceId) return { tasks: [], limit: historyLimit(req.query.limit) };
    const limit = historyLimit(req.query.limit);
    const tasks = await store.listControlPlaneTasks({ limit, deviceId, profileId, status, ownerUserId: req.taskHistoryOwnerUserId });
    return { tasks: tasks.map((task) => mapHistoryTask(task, context.agents, context.profiles)), limit };
  })()));
  router.get('/tasks/:taskId', taskHistoryAccess, (req, res) => send(res, (async () => {
    const task = await store.getControlPlaneTaskHistory(req.params.taskId, { ownerUserId: req.taskHistoryOwnerUserId });
    if (!task) throw Object.assign(new Error('Task-ul nu a fost găsit.'), { status: 404 });
    const context = await taskHistoryContext(store);
    const events = (await store.listControlPlaneTaskEvents(task.task_id)).map((event) => ({ type: String(event.event_type || ''), occurredAt: isoDate(event.occurred_at) }));
    return { task: mapHistoryTask(task, context.agents, context.profiles), events };
  })()));
  router.get('/media/:mediaId/preview', (req, res) => send(res, store.createPreview(req.params.mediaId).then((preview) => ({ url: preview.url, expiresIn: Number(preview.expiresIn) || 120 }))));
  router.get('/campaign-preview', (req, res) => send(res, store.listCampaigns(req.query.category === 'jobs' ? 'job' : 'property').then((rows) => {
    const campaign = rows.find((row) => String(row.legacy_id) === String(req.query.campaignId || ''));
    if (!campaign) return { text: '', media: [], warnings: ['Campaign is unavailable in cloud read-only data.'], facebookProfileLabel: '', postingIdentityLabel: '' };
    const post = (campaign.app_campaign_posts || []).find((item) => Number(item.day) === Number(req.query.day)) || (campaign.app_campaign_posts || [])[0];
    return { text: post?.text || '', media: [], warnings: ['Scheduler and execution context remain local.'], facebookProfileLabel: campaign.profile_id || '', postingIdentityLabel: '' };
  })));
  return router;
}

module.exports = { AGENT_HEARTBEAT_FRESHNESS_MS, TASK_HISTORY_DEFAULT_LIMIT, TASK_HISTORY_MAX_LIMIT, createCloudDashboardReadRouter, mapAgentStatus, mapDevice, mapDeviceProfile, listDevices, mapHistoryTask, mapCampaign, mapTarget, mapPreflightCampaign, mapPreflightTarget, mapFolder, mapSchedule, mapMedia };
