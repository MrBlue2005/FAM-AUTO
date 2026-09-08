'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeMediaReference, resolveMediaReference } = require('../utils/mediaPath');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256'); const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
    for (;;) { const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, position); if (!bytes) break; hash.update(buffer.subarray(0, bytes)); position += bytes; }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}
function safeArray(value) { return Array.isArray(value) ? value : []; }
function emptySummary() {
  return { mode: 'DRY_RUN', writes_performed: false, storage_uploads_performed: false,
    campaigns: { properties: 0, jobs: 0, posts: 0, invalid: 0 }, folders: { campaign: 0, schedule: 0 }, targets: 0, schedules: 0,
    media: { references: 0, unique_references: 0, files_found: 0, files_hashed: 0, bytes: 0, duplicates_by_hash: 0, missing: 0 },
    execution_mapping: { history_entries: 0, runs: 0, proposed_posting_results: 0, proposed_execution_runs: 0 }, anomalies: [],
    property_copywriter: { migration: 'SEPARATE_REQUIRED', sqlite_detected: false }, planned_entities: { campaigns: [], media_unique_hashes: 0 } };
}
function issue(summary, code) { summary.anomalies.push({ code }); }
function mediaReferences(post) {
  return [post?.imagePath, ...safeArray(post?.media).map((item) => typeof item === 'string' ? item : item?.path)]
    .filter((value) => typeof value === 'string' && value.trim()).map(normalizeMediaReference);
}

// Pure reader: no source file is moved, renamed, deleted, or changed.
function planLocalApplicationImport({ dataManager, resolveMedia = resolveMediaReference, copywriterDatabasePath } = {}) {
  if (!dataManager) throw new Error('A DataManager-compatible reader is required.');
  const summary = emptySummary(), references = new Map(), campaignKeys = new Set();
  for (const [kind, reader, counter] of [['property', dataManager.getProperties, 'properties'], ['job', dataManager.getJobs, 'jobs']]) {
    for (const campaign of safeArray(reader.call(dataManager))) {
      const legacyId = String(campaign?.id || '').trim(), key = `${kind}:${legacyId}`;
      if (!legacyId || campaignKeys.has(key)) { summary.campaigns.invalid += 1; issue(summary, 'INVALID_OR_DUPLICATE_CAMPAIGN'); continue; }
      campaignKeys.add(key); summary.campaigns[counter] += 1; const days = new Set(), posts = [];
      for (const post of safeArray(campaign.posts)) {
        const day = Number(post?.day);
        if (!Number.isInteger(day) || day < 1 || day > 366 || days.has(day) || typeof post?.text !== 'string') { summary.campaigns.invalid += 1; issue(summary, 'INVALID_CAMPAIGN_POST'); continue; }
        days.add(day); summary.campaigns.posts += 1; const items = mediaReferences(post);
        for (const reference of items) { summary.media.references += 1; if (!references.has(reference)) references.set(reference, reference); }
        posts.push({ day, media_references: items.length });
      }
      summary.planned_entities.campaigns.push({ kind, legacy_id: legacyId, post_count: posts.length });
    }
  }
  summary.media.unique_references = references.size; const hashes = new Set();
  for (const reference of references.values()) {
    const sourcePath = resolveMedia(reference);
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) { summary.media.missing += 1; issue(summary, 'MISSING_MEDIA_REFERENCE'); continue; }
    const stat = fs.statSync(sourcePath), hash = sha256File(sourcePath);
    summary.media.files_found += 1; summary.media.files_hashed += 1; summary.media.bytes += stat.size;
    if (hashes.has(hash)) summary.media.duplicates_by_hash += 1; hashes.add(hash);
  }
  summary.planned_entities.media_unique_hashes = hashes.size;
  summary.folders.campaign = safeArray(dataManager.getCampaignFolders?.()).length;
  summary.folders.schedule = safeArray(dataManager.getScheduleFolders?.()).length;
  const targetIds = new Set();
  for (const target of safeArray(dataManager.getGroups?.())) { const id = String(target?.id || '').trim(); if (!id || targetIds.has(id)) issue(summary, 'INVALID_OR_DUPLICATE_TARGET'); else { targetIds.add(id); summary.targets += 1; } }
  const schedules = safeArray(dataManager.getSchedules?.()); summary.schedules = schedules.length;
  for (const schedule of schedules) if (!String(schedule?.id || '').trim() || !safeArray(schedule?.campaignIds).length) issue(summary, 'INVALID_OR_EMPTY_SCHEDULE');
  const history = safeArray(dataManager.getHistory?.()), runs = safeArray(dataManager.getCampaignRuns?.());
  summary.execution_mapping = { history_entries: history.length, runs: runs.length, proposed_posting_results: history.length, proposed_execution_runs: runs.length };
  summary.property_copywriter.sqlite_detected = fs.existsSync(copywriterDatabasePath || path.join(process.cwd(), 'property-copywriter', 'prisma', 'dev.db'));
  summary.property_copywriter.reason = 'PropertyRecord and DescriptionTemplate are a separate SQLite/Prisma model and need an explicitly approved mapping.';
  return summary;
}
function publicImportReport(summary) {
  return { mode: summary.mode, writes_performed: summary.writes_performed, storage_uploads_performed: summary.storage_uploads_performed,
    campaigns: summary.campaigns, folders: summary.folders, targets: summary.targets, schedules: summary.schedules, media: summary.media,
    execution_mapping: summary.execution_mapping, anomalies: summary.anomalies.map(({ code }) => ({ code })), property_copywriter: summary.property_copywriter,
    planned_entities: { campaign_count: summary.planned_entities.campaigns.length, media_unique_hashes: summary.planned_entities.media_unique_hashes } };
}
module.exports = { planLocalApplicationImport, publicImportReport, sha256File };
