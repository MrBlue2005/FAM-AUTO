'use strict';

const { CAMPAIGN_PREFLIGHT_TASK_TYPE } = require('../../server/cloud-campaign-preflight');

function preflightError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createCampaignPreflightExecutor(registry, runtimeProfiles) {
  return async (task) => {
    if (task.task_type !== CAMPAIGN_PREFLIGHT_TASK_TYPE) throw preflightError('UNSUPPORTED_TASK_TYPE', 'Unsupported cloud preflight task.');
    const payload = task.payload || {};
    if (payload.publishEnabled !== false || payload.execution_config?.publishEnabled !== false || payload.mode !== 'PREFLIGHT') throw preflightError('PUBLISHING_NOT_DISABLED', 'Campaign preflight requires publishing to remain disabled.');
    if (!payload.campaign?.campaign_id || !payload.post?.post_id || !Number.isInteger(payload.post?.day) || !payload.target?.target_id || !payload.target?.url) throw preflightError('PREFLIGHT_SNAPSHOT_INVALID', 'Campaign preflight snapshot is incomplete.');
    const profile = registry.getProfile(task.profile_id, runtimeProfiles());
    if (!profile || profile.status !== 'READY') throw preflightError('PROFILE_UNAVAILABLE', 'Local profile is unavailable for preflight.');
    const media = Array.isArray(payload.media) ? payload.media : [];
    const localMediaPaths = Array.isArray(payload.local_media_paths) ? payload.local_media_paths : [];
    if (media.length !== localMediaPaths.length) throw preflightError('MEDIA_PREFLIGHT_INCOMPLETE', 'Campaign media was not verified before preflight.');
    return {
      preflight_passed: true,
      publishEnabled: false,
      campaign_post_resolved: true,
      target_resolved: true,
      local_profile_available: true,
      media_count: media.length,
      media_verified: true,
      blockers: [],
    };
  };
}

module.exports = { createCampaignPreflightExecutor };
