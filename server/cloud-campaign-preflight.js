'use strict';

const CAMPAIGN_PREFLIGHT_TASK_TYPE = 'CAMPAIGN_PREFLIGHT';

function failure(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function finiteRevision(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function requiredString(value, code) {
  const result = String(value || '').trim();
  if (!result) throw failure(code, 'The selected campaign source is unavailable.', 404);
  return result;
}

function buildCampaignPreflightSnapshot({ campaign, target, postDay, expectedCampaignRevision, expectedPostRevision }) {
  if (!campaign || campaign.active === false) throw failure('CAMPAIGN_NOT_FOUND', 'The selected campaign is unavailable.', 404);
  if (!target || target.active === false) throw failure('TARGET_NOT_FOUND', 'The selected target is unavailable.', 404);
  if (finiteRevision(expectedCampaignRevision) && finiteRevision(campaign.revision) !== expectedCampaignRevision) throw failure('CAMPAIGN_REVISION_STALE', 'The selected campaign changed before preflight could be queued.');
  const post = (campaign.app_campaign_posts || []).find((item) => Number(item.day) === Number(postDay));
  if (!post || post.active === false) throw failure('POST_NOT_FOUND', 'The selected campaign post is unavailable.', 404);
  if (finiteRevision(expectedPostRevision) && finiteRevision(post.revision) !== expectedPostRevision) throw failure('POST_REVISION_STALE', 'The selected campaign post changed before preflight could be queued.');

  const media = (post.app_post_media || []).slice().sort((left, right) => Number(left.ordinal) - Number(right.ordinal)).map((relation) => {
    const item = relation.app_media_objects;
    if (!item || item.state !== 'READY') throw failure('MEDIA_NOT_READY', 'Selected campaign media is not ready for preflight.');
    const sha256 = String(item.sha256 || ''); const byteSize = Number(item.byte_size);
    if (!/^[a-f0-9]{64}$/i.test(sha256) || !Number.isInteger(byteSize) || byteSize < 1 || !String(item.mime_type || '')) throw failure('MEDIA_SNAPSHOT_INVALID', 'Selected campaign media cannot be snapshotted.');
    return { media_id: requiredString(item.media_id, 'MEDIA_SNAPSHOT_INVALID'), ordinal: Number(relation.ordinal), sha256: sha256.toLowerCase(), byte_size: byteSize, mime_type: String(item.mime_type) };
  });

  return Object.freeze({
    contract_version: 1,
    mode: 'PREFLIGHT',
    publishEnabled: false,
    campaign: {
      campaign_id: requiredString(campaign.campaign_id, 'CAMPAIGN_NOT_FOUND'),
      legacy_id: requiredString(campaign.legacy_id, 'CAMPAIGN_NOT_FOUND'),
      kind: String(campaign.kind || ''),
      revision: finiteRevision(campaign.revision),
      profile_identity: campaign.profile_id || null,
    },
    post: {
      post_id: requiredString(post.post_id, 'POST_NOT_FOUND'),
      day: Number(post.day),
      text: String(post.text || ''),
      revision: finiteRevision(post.revision),
    },
    target: {
      target_id: requiredString(target.target_id, 'TARGET_NOT_FOUND'),
      name: requiredString(target.display_name, 'TARGET_NOT_FOUND'),
      url: requiredString(target.target_url, 'TARGET_NOT_FOUND'),
    },
    execution_config: { mode: 'PREFLIGHT', publishEnabled: false },
    media,
  });
}

function safeCampaignPreflightResult(result) {
  if (!result || result.preflight_passed !== true || result.publishEnabled !== false) return null;
  return {
    preflightPassed: true,
    publishEnabled: false,
    campaignPostResolved: result.campaign_post_resolved === true,
    targetResolved: result.target_resolved === true,
    localProfileAvailable: result.local_profile_available === true,
    mediaCount: Number.isInteger(result.media_count) ? result.media_count : 0,
    mediaVerified: result.media_verified === true,
    blockers: Array.isArray(result.blockers) ? result.blockers.map((item) => String(item)).slice(0, 16) : [],
  };
}

module.exports = { CAMPAIGN_PREFLIGHT_TASK_TYPE, buildCampaignPreflightSnapshot, safeCampaignPreflightResult };
