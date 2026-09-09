'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCampaignPreflightSnapshot, CAMPAIGN_PREFLIGHT_TASK_TYPE, safeCampaignPreflightResult } = require('../server/cloud-campaign-preflight');
const { createCampaignPreflightExecutor } = require('../app/local-agent/CampaignPreflightExecutor');

function source() {
  return {
    campaign: { campaign_id: 'campaign-uuid', legacy_id: 'campaign-safe', kind: 'property', active: true, profile_id: 'profile-reference', revision: 7, app_campaign_posts: [{ post_id: 'post-uuid', day: 5, text: 'Immutable source text', active: true, revision: 3, app_post_media: [{ ordinal: 1, app_media_objects: { media_id: 'media-two', sha256: 'b'.repeat(64), byte_size: 2, mime_type: 'image/png', state: 'READY', object_key: 'private/media-two' } }, { ordinal: 0, app_media_objects: { media_id: 'media-one', sha256: 'a'.repeat(64), byte_size: 1, mime_type: 'image/png', state: 'READY', object_key: 'private/media-one' } }] }] },
    target: { target_id: 'target-uuid', display_name: 'Synthetic target', target_url: 'https://example.test/group', active: true },
  };
}

test('campaign preflight snapshot is immutable, ordered, and permanently disables publishing', () => {
  const input = source(); const snapshot = buildCampaignPreflightSnapshot({ ...input, postDay: 5, expectedCampaignRevision: 7, expectedPostRevision: 3 });
  input.campaign.app_campaign_posts[0].text = 'changed after queueing'; input.target.target_url = 'https://changed.test';
  input.campaign.app_campaign_posts[0].app_post_media[0].app_media_objects.sha256 = 'c'.repeat(64);
  input.campaign.app_campaign_posts[0].app_post_media[0].app_media_objects.byte_size = 999;
  input.campaign.app_campaign_posts[0].app_post_media[0].app_media_objects.object_key = 'must-not-reach-task';
  assert.equal(snapshot.publishEnabled, false); assert.equal(snapshot.execution_config.publishEnabled, false); assert.equal(snapshot.post.text, 'Immutable source text'); assert.equal(snapshot.target.url, 'https://example.test/group'); assert.deepEqual(snapshot.media.map((item) => item.media_id), ['media-one', 'media-two']); assert.equal(JSON.stringify(snapshot).match(/cookie|credential|secret|path|object_key/i), null);
  assert.deepEqual(snapshot.media, [
    { media_id: 'media-one', ordinal: 0, sha256: 'a'.repeat(64), byte_size: 1, mime_type: 'image/png' },
    { media_id: 'media-two', ordinal: 1, sha256: 'b'.repeat(64), byte_size: 2, mime_type: 'image/png' },
  ]);
  assert.throws(() => buildCampaignPreflightSnapshot({ ...source(), postDay: 5, expectedCampaignRevision: 8 }), { code: 'CAMPAIGN_REVISION_STALE' });
});

test('zero-media campaign preflight validates the local profile without Chromium or Facebook', async () => {
  const registry = { getProfile: () => ({ status: 'READY' }) }; const execute = createCampaignPreflightExecutor(registry, () => []);
  const payload = { mode: 'PREFLIGHT', publishEnabled: false, execution_config: { publishEnabled: false }, campaign: { campaign_id: 'campaign' }, post: { post_id: 'post', day: 1 }, target: { target_id: 'target', url: 'https://example.test' }, media: [] };
  const result = await execute({ task_type: CAMPAIGN_PREFLIGHT_TASK_TYPE, profile_id: 'profile-safe', payload });
  assert.deepEqual(safeCampaignPreflightResult(result), { preflightPassed: true, publishEnabled: false, campaignPostResolved: true, targetResolved: true, localProfileAvailable: true, mediaCount: 0, mediaVerified: true, blockers: [] });
  await assert.rejects(createCampaignPreflightExecutor({ getProfile: () => null }, () => [])({ task_type: CAMPAIGN_PREFLIGHT_TASK_TYPE, profile_id: 'profile-safe', payload }), { code: 'PROFILE_UNAVAILABLE' });
});

test('campaign preflight accepts only media already materialized and verified by the agent service', async () => {
  const execute = createCampaignPreflightExecutor({ getProfile: () => ({ status: 'READY' }) }, () => []);
  const payload = { mode: 'PREFLIGHT', publishEnabled: false, execution_config: { publishEnabled: false }, campaign: { campaign_id: 'campaign' }, post: { post_id: 'post', day: 1 }, target: { target_id: 'target', url: 'https://example.test' }, media: [{ media_id: 'media', ordinal: 0, sha256: 'a'.repeat(64), byte_size: 1, mime_type: 'image/png' }], local_media_paths: ['C:/isolated/task/media'] };
  const result = await execute({ task_type: CAMPAIGN_PREFLIGHT_TASK_TYPE, profile_id: 'profile-safe', payload });
  assert.equal(result.media_count, 1); assert.equal(result.media_verified, true);
  await assert.rejects(execute({ task_type: CAMPAIGN_PREFLIGHT_TASK_TYPE, profile_id: 'profile-safe', payload: { ...payload, local_media_paths: [] } }), { code: 'MEDIA_PREFLIGHT_INCOMPLETE' });
});
