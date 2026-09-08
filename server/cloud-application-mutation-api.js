'use strict';

// Deliberately narrow hosted editing surface.  Execution, history, robot, and
// control-plane endpoints are not mounted here.
const crypto = require('crypto');
const express = require('express');
const { mapCampaign, mapFolder, mapSchedule, mapTarget } = require('./cloud-dashboard-read-api');

const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const string = (value, label, required = false) => {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) throw fail(`${label} is required.`);
  return result;
};
const revision = (value, create = false) => {
  const result = Number(value);
  if (create && (value === undefined || value === null)) return 0;
  if (!Number.isInteger(result) || result < (create ? 0 : 1)) throw fail('A current revision is required. Reload the cloud data and try again.', 409, 'APP_REVISION_CONFLICT');
  return result;
};
const requestId = (req) => req.get('x-rx-request-id') || crypto.randomUUID();
const safeError = (error) => {
  if (error?.code === 'APP_REVISION_CONFLICT' || /APP_REVISION_CONFLICT/.test(error?.message || '')) return fail('This record changed in cloud. Reload it before saving again.', 409, 'APP_REVISION_CONFLICT');
  if (error?.code === 'APP_REFERENCE_CONFLICT' || error?.code === '23503') return fail('This record is still referenced and cannot be deleted.', 409, 'APP_REFERENCE_CONFLICT');
  return error;
};
const send = (res, promise, status = 200) => Promise.resolve(promise).then((value) => res.status(status).json(value)).catch((error) => {
  const safe = safeError(error); res.status(safe.status || 400).json({ error: safe.message, code: safe.code });
});

function postsFromDto(posts) {
  if (!Array.isArray(posts)) throw fail('posts must be an array.');
  const days = new Set();
  return posts.map((post) => {
    const day = Number(post?.day);
    if (!Number.isInteger(day) || day < 1 || day > 366 || days.has(day)) throw fail('Each post requires a unique day between 1 and 366.');
    days.add(day);
    return { day, text: string(post?.text, 'post text', true), active: post.active !== false, data: Object.fromEntries(['title', 'variant', 'published'].flatMap((key) => post?.[key] === undefined ? [] : [[key, post[key]]])) };
  });
}

async function campaignWrite(store, dto, kind, legacyId) {
  const id = string(legacyId || dto?.id, 'campaign id', true);
  if (legacyId && dto?.id && String(dto.id) !== legacyId) throw fail('Cloud campaign legacy IDs cannot be renamed. Create a new campaign instead.', 409);
  const folders = await store.listCampaignFolders(); const folder = dto?.folderId ? folders.find((row) => row.legacy_id === dto.folderId) : null;
  if (dto?.folderId && !folder) throw fail('The selected campaign folder is unavailable.', 409, 'APP_REFERENCE_CONFLICT');
  const title = string(kind === 'job' ? dto?.title : dto?.name, kind === 'job' ? 'job title' : 'property name', true);
  const campaign = {
    legacy_id: id, kind, title, active: dto?.active !== false, folder_id: folder?.folder_id || null,
    profile_id: string(dto?.facebookProfileId || dto?.postingProfileId, 'profile'),
    data: Object.fromEntries(['transactionType', 'company', 'description', 'location', 'price'].flatMap((key) => dto?.[key] === undefined ? [] : [[key, dto[key]]])),
  };
  const result = await store.saveCampaign({ campaign, posts: postsFromDto(dto?.posts), expectedRevision: revision(dto?.revision, true), requestId: requestId(dto.__request) });
  const current = (await store.listCampaigns(kind)).find((row) => row.legacy_id === id);
  if (!current) throw fail('Campaign save did not return a readable cloud record.', 409);
  return mapCampaign(current, new Map(folders.map((row) => [row.folder_id, row.legacy_id])));
}

function targetWrite(group) {
  const id = string(group?.id, 'group id', true);
  return {
    legacy_id: id, display_name: string(group?.name, 'group name', true), target_url: string(group?.url, 'group URL', true),
    external_id: typeof group?.externalId === 'string' ? group.externalId : null, category: string(group?.groupListCategory, 'group list category') || 'Romania', active: group?.active !== false,
    data: Object.fromEntries(['category', 'favorite', 'overrideType'].flatMap((key) => group?.[key] === undefined ? [] : [[key, group[key]]])), expectedRevision: revision(group?.revision, true),
  };
}

async function folderWrite(store, table, dto, existingId) {
  const id = string(existingId || dto?.id || `folder_${crypto.randomUUID()}`, 'folder id', true); const name = string(dto?.name, 'folder name', true);
  const value = { legacy_id: id, name };
  const row = existingId ? await store[table.update](value) : await store[table.create](value);
  return mapFolder(row);
}

async function scheduleWrite(store, dto, legacyId) {
  const id = string(legacyId || dto?.id, 'schedule id', true);
  if (legacyId && dto?.id && String(dto.id) !== legacyId) throw fail('Cloud schedule legacy IDs cannot be renamed. Create a new schedule instead.', 409);
  const [folders, properties, jobs] = await Promise.all([store.listScheduleFolders(), store.listCampaigns('property'), store.listCampaigns('job')]);
  const folder = dto?.folderId ? folders.find((row) => row.legacy_id === dto.folderId) : null;
  if (dto?.folderId && !folder) throw fail('The selected schedule folder is unavailable.', 409, 'APP_REFERENCE_CONFLICT');
  const campaigns = [...properties, ...jobs]; const ids = Array.isArray(dto?.campaignIds) ? dto.campaignIds : null;
  if (!ids) throw fail('campaignIds must be an array.');
  const resolved = ids.map((campaignId) => campaigns.find((row) => row.legacy_id === campaignId)?.campaign_id);
  if (resolved.some((value) => !value) || new Set(resolved).size !== resolved.length) throw fail('One or more selected campaigns are unavailable.', 409, 'APP_REFERENCE_CONFLICT');
  const schedule = {
    legacy_id: id, name: string(dto?.name, 'schedule name', true), enabled: dto?.enabled !== false, folder_id: folder?.folder_id || null,
    profile_id: string(dto?.facebookProfileId, 'profile') || null,
    schedule: Object.fromEntries(['daysOfWeek', 'time', 'campaignCategory', 'groupListCategory', 'campaignDay', 'groupLimit', 'startFromGroup', 'skipGroupsPostedToday', 'publishEnabled', 'confirmedPublishEnabled', 'maxLateMinutes', 'liveConfirmed'].flatMap((key) => dto?.[key] === undefined ? [] : [[key, dto[key]]])),
  };
  const result = await store.saveSchedule({ schedule, campaignIds: resolved, expectedRevision: revision(dto?.revision, true), requestId: requestId(dto.__request) });
  const current = (await store.listSchedules()).find((row) => row.legacy_id === id);
  return mapSchedule(current, new Map(folders.map((row) => [row.folder_id, row.legacy_id])), new Map(campaigns.map((row) => [row.campaign_id, row.legacy_id])));
}

function createCloudApplicationMutationRouter(store) {
  const router = express.Router();
  router.get('/revisions/:kind/:legacyId', (req, res) => send(res, (async () => {
    const kind = req.params.kind;
    let row;
    if (kind === 'property' || kind === 'job') row = (await store.listCampaigns(kind)).find((item) => item.legacy_id === req.params.legacyId);
    else if (kind === 'group') row = (await store.listTargets()).find((item) => item.legacy_id === req.params.legacyId);
    else if (kind === 'schedule') row = (await store.listSchedules()).find((item) => item.legacy_id === req.params.legacyId);
    else throw fail('Unknown application record type.', 404);
    return { revision: Number.isInteger(row?.revision) ? row.revision : 0 };
  })()));
  const campaign = (kind, legacyId) => (req, res) => send(res, campaignWrite(store, { ...req.body, __request: req }, kind, legacyId), legacyId ? 200 : 201);
  router.post('/properties', campaign('property')); router.put('/properties/:legacyId', (req, res) => campaign('property', req.params.legacyId)(req, res));
  router.delete('/properties/:legacyId', (req, res) => send(res, store.deleteCampaign({ legacyId: req.params.legacyId, kind: 'property', expectedRevision: revision(req.body?.revision) }).then(() => ({ id: req.params.legacyId }))));
  router.post('/jobs', campaign('job')); router.put('/jobs/:legacyId', (req, res) => campaign('job', req.params.legacyId)(req, res));
  router.delete('/jobs/:legacyId', (req, res) => send(res, store.deleteCampaign({ legacyId: req.params.legacyId, kind: 'job', expectedRevision: revision(req.body?.revision) }).then(() => ({ id: req.params.legacyId }))));

  router.post('/groups', (req, res) => send(res, (async () => {
    if (!Array.isArray(req.body)) throw fail('groups must be an array.');
    const requested = req.body.map(targetWrite); const ids = new Set(requested.map((row) => row.legacy_id)); if (ids.size !== requested.length) throw fail('Group IDs must be unique.');
    const current = await store.listTargets();
    // Preflight all deletes before changing a row, so a known FK conflict leaves
    // the complete dashboard save untouched instead of partially applying it.
    const deleted = current.filter((row) => !ids.has(row.legacy_id));
    for (const target of deleted) if (await store.targetHasReferences(target.legacy_id)) throw fail('This record is still referenced and cannot be deleted.', 409, 'APP_REFERENCE_CONFLICT');
    for (const target of deleted) await store.deleteTarget({ legacyId: target.legacy_id, expectedRevision: revision(target.revision) });
    for (const target of requested) await store.saveTarget(target);
    return (await store.listTargets()).map(mapTarget);
  })()));

  const folders = (prefix, table) => {
    router.post(`/${prefix}`, (req, res) => send(res, folderWrite(store, table, req.body), 201));
    router.put(`/${prefix}/:legacyId`, (req, res) => send(res, folderWrite(store, table, req.body, req.params.legacyId)));
    router.delete(`/${prefix}/:legacyId`, (req, res) => send(res, store[table.delete]({ legacyId: req.params.legacyId }).then(() => ({ id: req.params.legacyId }))));
  };
  folders('campaign-folders', { create: 'saveCampaignFolder', update: 'updateCampaignFolder', delete: 'deleteCampaignFolder' });
  folders('schedule-folders', { create: 'saveScheduleFolder', update: 'updateScheduleFolder', delete: 'deleteScheduleFolder' });

  router.post('/schedules', (req, res) => send(res, scheduleWrite(store, { ...req.body, __request: req }), 201));
  router.put('/schedules/:legacyId', (req, res) => send(res, scheduleWrite(store, { ...req.body, __request: req }, req.params.legacyId)));
  router.delete('/schedules/:legacyId', (req, res) => send(res, store.deleteSchedule({ legacyId: req.params.legacyId, expectedRevision: revision(req.body?.revision) }).then(() => ({ id: req.params.legacyId }))));
  return router;
}

module.exports = { createCloudApplicationMutationRouter, postsFromDto, targetWrite };
