const { startBrowser } = require('../facebook/browserManager');
const { runCampaign } = require('../facebook/campaignRunner');

function createCloudFacebookTaskExecutor(registry, runtimeProfiles) {
  return async (task, isCancellationRequested) => {
    if (task.task_type !== 'FACEBOOK_GROUP_POST') throw Object.assign(new Error('Unsupported cloud task type.'), { code: 'UNSUPPORTED_TASK_TYPE' });
    const payload = task.payload || {};
    if (payload.execution_config?.publishEnabled) throw Object.assign(new Error('Cloud LIVE publishing is disabled in Phase 2.'), { code: 'LIVE_PUBLISH_DISABLED' });
    const profile = registry.getProfile(task.profile_id, runtimeProfiles());
    if (!profile) throw Object.assign(new Error('Local profile is unavailable.'), { code: 'PROFILE_UNAVAILABLE' });
    const browser = await startBrowser(payload.runtime_profile_id, { profilePath: profile.localProfilePath, displayName: profile.displayName });
    try {
      if (await isCancellationRequested()) return { cancelled: true };
      const result = await runCampaign(browser.page, { ...payload.campaign, postingIdentityId: payload.posting_identity_id }, [payload.group], payload.campaign_day, { plannedGroups: [payload.group], facebookProfileId: payload.runtime_profile_id, executionConfig: { ...payload.execution_config, publishEnabled: false }, skipGroupsPostedToday: Boolean(payload.execution_config?.skipGroupsPostedToday) });
      if (await isCancellationRequested()) return { cancellation_requested_after_safe_point: true, processed: result?.processed || 0 };
      return { processed: result?.processed || 0 };
    } finally { await browser.context.close().catch(() => {}); }
  };
}

module.exports = { createCloudFacebookTaskExecutor };
