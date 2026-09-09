'use strict';

const express = require('express');

const AGENT_HEARTBEAT_FRESHNESS_MS = 90 * 1000;

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

function mapDevice(row, nowMs = Date.now()) {
  const reportedStatus = String(row.reported_status || 'OFFLINE').toUpperCase();
  const lastSeenAt = isoDate(row.last_seen_at);
  const fresh = lastSeenAt && nowMs - Date.parse(lastSeenAt) <= AGENT_HEARTBEAT_FRESHNESS_MS;
  const accepted = ['ONLINE', 'BUSY', 'DEGRADED'].includes(reportedStatus);
  return {
    deviceId: String(row.agent_id),
    displayName: String(row.display_name || 'RX Local Agent'),
    online: Boolean(fresh && accepted),
    reportedStatus: fresh && accepted ? reportedStatus : 'OFFLINE',
    lastSeenAt,
    capabilities: { localExecution: true, facebookAutomation: false },
    profiles: [],
  };
}

function mapDeviceProfile(row) {
  const status = String(row.status || 'UNAVAILABLE').toUpperCase();
  return {
    profileId: String(row.profile_id),
    displayName: String(row.display_name || row.profile_id),
    status,
    lastSeenAt: isoDate(row.last_seen_at),
    ready: status === 'READY',
  };
}

async function listDevices(store, nowMs = Date.now()) {
  const [agents, profiles] = await Promise.all([store.listControlPlaneAgents(), store.listControlPlaneProfiles()]);
  const devices = agents.map((agent) => mapDevice(agent, nowMs));
  const byId = new Map(devices.map((device) => [device.deviceId, device]));
  for (const profile of profiles) {
    const device = byId.get(String(profile.agent_id));
    if (device) device.profiles.push(mapDeviceProfile(profile));
  }
  return { devices };
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
  router.get('/media/:mediaId/preview', (req, res) => send(res, store.createPreview(req.params.mediaId).then((preview) => ({ url: preview.url, expiresIn: Number(preview.expiresIn) || 120 }))));
  router.get('/campaign-preview', (req, res) => send(res, store.listCampaigns(req.query.category === 'jobs' ? 'job' : 'property').then((rows) => {
    const campaign = rows.find((row) => String(row.legacy_id) === String(req.query.campaignId || ''));
    if (!campaign) return { text: '', media: [], warnings: ['Campaign is unavailable in cloud read-only data.'], facebookProfileLabel: '', postingIdentityLabel: '' };
    const post = (campaign.app_campaign_posts || []).find((item) => Number(item.day) === Number(req.query.day)) || (campaign.app_campaign_posts || [])[0];
    return { text: post?.text || '', media: [], warnings: ['Scheduler and execution context remain local.'], facebookProfileLabel: campaign.profile_id || '', postingIdentityLabel: '' };
  })));
  return router;
}

module.exports = { AGENT_HEARTBEAT_FRESHNESS_MS, createCloudDashboardReadRouter, mapAgentStatus, mapDevice, mapDeviceProfile, listDevices, mapCampaign, mapTarget, mapFolder, mapSchedule, mapMedia };
