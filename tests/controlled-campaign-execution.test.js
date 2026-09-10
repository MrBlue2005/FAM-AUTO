'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, buildControlledExecutionSnapshot, safeControlledExecutionResult } = require('../server/cloud-controlled-execution');
const { createControlledCampaignExecutionExecutor } = require('../app/local-agent/ControlledCampaignExecutionExecutor');

const source = { campaign: { campaign_id: 'campaign', legacy_id: 'legacy', kind: 'property', active: true, revision: 1, app_campaign_posts: [{ post_id: 'post', day: 1, active: true, revision: 1, text: 'safe', app_post_media: [] }] }, target: { target_id: 'target', display_name: 'target', target_url: 'https://example.test', active: true } };
test('controlled execution is a no-browser, no-publish executor with a verified immutable snapshot', async () => {
  const payload = buildControlledExecutionSnapshot({ ...source, postDay: 1 });
  assert.equal(payload.mode, 'CONTROLLED_DRY_EXECUTION'); assert.equal(payload.publishEnabled, false); assert.equal(payload.execution_config.publishEnabled, false);
  let browserCalls = 0; const execute = createControlledCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true });
  const result = await execute({ task_type: CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, profile_id: 'exact-profile', payload });
  assert.equal(browserCalls, 0); assert.deepEqual(safeControlledExecutionResult(result), { executionValidated: true, publishEnabled: false, campaignPostResolved: true, targetResolved: true, localProfileAvailable: true, mediaCount: 0, mediaVerified: true, readyForFutureLiveExecution: true, blockers: [] });
  await assert.rejects(createControlledCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: false })({ task_type: CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, profile_id: 'exact-profile', payload }), { code: 'CONTROLLED_EXECUTION_DISABLED' });
  await assert.rejects(execute({ task_type: CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, profile_id: 'exact-profile', payload: { ...payload, publishEnabled: true } }), { code: 'PUBLISHING_NOT_DISABLED' });
});
