'use strict';

// This is deliberately a separate contract from CAMPAIGN_PREFLIGHT.  It is
// execution plumbing only: the immutable snapshot can never request a publish.
const CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE = 'CONTROLLED_CAMPAIGN_EXECUTION';

function buildControlledExecutionSnapshot(input) {
  const { buildCampaignPreflightSnapshot } = require('./cloud-campaign-preflight');
  const preflight = buildCampaignPreflightSnapshot(input);
  return Object.freeze({
    ...preflight,
    mode: 'CONTROLLED_DRY_EXECUTION',
    execution_config: Object.freeze({ mode: 'CONTROLLED_DRY_EXECUTION', publishEnabled: false }),
    publishEnabled: false,
  });
}

function safeControlledExecutionResult(result) {
  if (!result || result.execution_validated !== true || result.publishEnabled !== false) return null;
  return {
    executionValidated: true,
    publishEnabled: false,
    campaignPostResolved: result.campaign_post_resolved === true,
    targetResolved: result.target_resolved === true,
    localProfileAvailable: result.local_profile_available === true,
    mediaCount: Number.isInteger(result.media_count) ? result.media_count : 0,
    mediaVerified: result.media_verified === true,
    readyForFutureLiveExecution: result.ready_for_future_live_execution === true,
    blockers: Array.isArray(result.blockers) ? result.blockers.map(String).slice(0, 16) : [],
  };
}

module.exports = { CONTROLLED_CAMPAIGN_EXECUTION_TASK_TYPE, buildControlledExecutionSnapshot, safeControlledExecutionResult };
