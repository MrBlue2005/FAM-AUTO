'use strict';

const { CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE } = require('../../server/cloud-controlled-execution');

function failure(code, message) { return Object.assign(new Error(message), { code }); }

// Intentionally has no browser, Facebook, or publisher dependency. CloudAgentService
// materializes verified media and owns the profile lock before this executor runs.
function createControlledCampaignExecutionExecutor(registry, runtimeProfiles, { enabled = false } = {}) {
  return async (task) => {
    if (task.task_type !== CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE) throw failure('UNSUPPORTED_TASK_TYPE', 'Unsupported controlled execution task.');
    if (enabled !== true) throw failure('CONTROLLED_EXECUTION_DISABLED', 'Controlled execution is disabled.');
    const payload = task.payload || {};
    if (payload.mode !== 'CONTROLLED_DRY_EXECUTION' || payload.publishEnabled !== false || payload.execution_config?.publishEnabled !== false) throw failure('PUBLISHING_NOT_DISABLED', 'Controlled execution requires publishing to remain disabled.');
    if (!payload.campaign?.campaign_id || !payload.post?.post_id || !payload.target?.target_id || !Number.isInteger(payload.post?.day)) throw failure('EXECUTION_SNAPSHOT_INVALID', 'Controlled execution snapshot is incomplete.');
    const profile = registry.getProfile(task.profile_id, runtimeProfiles());
    if (!profile || profile.status !== 'READY') throw failure('PROFILE_UNAVAILABLE', 'Local profile is unavailable for controlled execution.');
    const media = Array.isArray(payload.media) ? payload.media : [];
    const localMedia = Array.isArray(payload.local_media_paths) ? payload.local_media_paths : [];
    if (media.length !== localMedia.length) throw failure('MEDIA_EXECUTION_INCOMPLETE', 'Campaign media was not verified before controlled execution.');
    return { execution_validated: true, publishEnabled: false, campaign_post_resolved: true, target_resolved: true, local_profile_available: true, media_count: media.length, media_verified: true, ready_for_future_live_execution: true, blockers: [] };
  };
}

module.exports = { createControlledCampaignExecutionExecutor };
