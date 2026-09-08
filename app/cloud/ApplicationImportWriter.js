'use strict';
const fs = require('fs'); const path = require('path');
const { sha256File } = require('./LocalApplicationImportPlanner'); const { resolveMediaReference } = require('../utils/mediaPath');
const mimeFor = (file) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' }[path.extname(file).toLowerCase()] || null);
const list = (value) => Array.isArray(value) ? value : [];
const report = () => ({ mode: 'APPLY', writes_performed: true, storage_uploads_performed: false, media_state: 'STAGED_PENDING_STORAGE_VERIFICATION', successes: [], failures: [], counts: {} });
const success = (out, type, legacy_id) => { out.successes.push({ type, legacy_id }); out.counts[type] = (out.counts[type] || 0) + 1; };
const failure = (out, type, legacy_id, error) => out.failures.push({ type, legacy_id: legacy_id || null, code: error.code || 'IMPORT_WRITE_FAILED', message: error.message });
async function writeApplicationImport({ dataManager, store, resolveMedia = resolveMediaReference }) {
  const out = report(), campaignIds = new Map(), folderIds = new Map(), scheduleFolderIds = new Map();
  for (const folder of list(dataManager.getCampaignFolders?.())) try { const saved = await store.saveCampaignFolder({ legacy_id: String(folder.id), name: String(folder.name || folder.id) }); folderIds.set(String(folder.id), saved.folder_id); success(out, 'campaign_folder', String(folder.id)); } catch (error) { failure(out, 'campaign_folder', folder?.id, error); }
  for (const folder of list(dataManager.getScheduleFolders?.())) try { const saved = await store.saveScheduleFolder({ legacy_id: String(folder.id), name: String(folder.name || folder.id) }); scheduleFolderIds.set(String(folder.id), saved.folder_id); success(out, 'schedule_folder', String(folder.id)); } catch (error) { failure(out, 'schedule_folder', folder?.id, error); }
  for (const [kind, getter] of [['property', 'getProperties'], ['job', 'getJobs']]) for (const item of list(dataManager[getter]?.())) {
    const legacy_id = String(item?.id || ''); try {
      const existingCampaign = (await store.listCampaigns(kind)).find((row) => row.legacy_id === legacy_id);
      if (existingCampaign) { campaignIds.set(`${kind}:${legacy_id}`, existingCampaign.campaign_id); success(out, 'campaign_idempotent', legacy_id); continue; }
      const posts = list(item.posts).map((post) => ({ day: Number(post.day), text: String(post.text || post.description || ''), active: post.active !== false, data: { legacy_id: `${legacy_id}:${post.day}` } }));
      const saved = await store.saveCampaign({ campaign: { legacy_id, kind, title: String(item.name || item.title || legacy_id), active: item.active !== false, folder_id: folderIds.get(String(item.folderId)) || null, profile_id: item.facebookProfileId || null, data: { legacy_id } }, posts, expectedRevision: 0, requestId: `00000000-0000-4000-8000-${Buffer.from(`${kind}:${legacy_id}`).toString('hex').slice(0, 12).padEnd(12, '0')}` });
      campaignIds.set(`${kind}:${legacy_id}`, saved.campaign.campaign_id); success(out, 'campaign', legacy_id);
      for (const post of list(item.posts)) for (const reference of [post?.imagePath, ...list(post?.media).map((entry) => typeof entry === 'string' ? entry : entry?.path)].filter(Boolean)) {
        const source = resolveMedia(reference); if (!source || !fs.existsSync(source)) { failure(out, 'media', legacy_id, Object.assign(new Error('MISSING_MEDIA_REFERENCE'), { code: 'MISSING_MEDIA_REFERENCE' })); continue; }
        const mime_type = mimeFor(source); if (!mime_type) { failure(out, 'media', legacy_id, Object.assign(new Error('UNSUPPORTED_MEDIA_MIME'), { code: 'UNSUPPORTED_MEDIA_MIME' })); continue; }
        await store.saveMediaMetadata({ sha256: sha256File(source), byte_size: fs.statSync(source).size, mime_type, original_name: path.basename(source), state: 'STAGED' }); success(out, 'media_metadata_staged', legacy_id);
      }
    } catch (error) { if (error.code === 'APP_REVISION_CONFLICT') { const existing = await store.listCampaigns(kind); const found = existing.find((row) => row.legacy_id === legacy_id); if (found) { campaignIds.set(`${kind}:${legacy_id}`, found.campaign_id); success(out, 'campaign_idempotent', legacy_id); continue; } } failure(out, 'campaign', legacy_id, error); }
  }
  const existingTargets = await store.listTargets(); for (const target of list(dataManager.getGroups?.())) try { if (existingTargets.some((row) => row.legacy_id === String(target.id))) { success(out, 'target_idempotent', String(target.id)); continue; } await store.saveTarget({ legacy_id: String(target.id), display_name: String(target.name || target.id), target_url: String(target.url || target.groupUrl || `legacy://${target.id}`), external_id: target.externalId || null, category: target.listCategory || 'Romania', active: target.active !== false, data: { legacy_id: String(target.id) }, expectedRevision: 0 }); success(out, 'target', String(target.id)); } catch (error) { failure(out, 'target', target?.id, error); }
  const existingSchedules = await store.listSchedules();
  for (const schedule of list(dataManager.getSchedules?.())) { const legacy_id = String(schedule?.id || ''); try { if (existingSchedules.some((row) => row.legacy_id === legacy_id)) { success(out, 'schedule_idempotent', legacy_id); continue; } const category = schedule.campaignCategory === 'jobs' ? 'job' : 'property'; const ids = list(schedule.campaignIds).map((id) => campaignIds.get(`${category}:${id}`)).filter(Boolean); await store.saveSchedule({ schedule: { legacy_id, name: String(schedule.name || legacy_id), enabled: schedule.enabled !== false, folder_id: scheduleFolderIds.get(String(schedule.folderId)) || null, profile_id: schedule.facebookProfileId || null, schedule: { ...schedule, id: undefined, campaignIds: undefined } }, campaignIds: ids, expectedRevision: 0 }); success(out, 'schedule', legacy_id); } catch (error) { failure(out, 'schedule', legacy_id, error); } }
  for (const run of list(dataManager.getCampaignRuns?.())) try { await store.createExecutionRun({ legacy_id: String(run.id), status: String(run.status || 'UNKNOWN'), mode: run.publishEnabled ? 'live' : 'test', config_snapshot: run }); success(out, 'execution_run', String(run.id)); } catch (error) { failure(out, 'execution_run', run?.id, error); }
  for (const entry of list(dataManager.getHistory?.())) failure(out, 'posting_result', entry?.id, Object.assign(new Error('Historical result import is deferred: no stable result legacy key exists in the current schema.'), { code: 'HISTORY_MAPPING_DEFERRED' }));
  return out;
}
module.exports = { writeApplicationImport };
