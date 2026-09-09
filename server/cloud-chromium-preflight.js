'use strict';

const CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE = 'CHROMIUM_SAFE_PREFLIGHT';

function safeChromiumPreflightResult(result) {
  if (!result || result.preflight_passed !== true || result.publishEnabled !== false
    || result.chromium_launched !== true || result.page_ready !== true
    || result.safe_navigation !== true || result.browser_closed !== true
    || result.profile_lock_released !== true || !Array.isArray(result.blockers)
    || result.blockers.length !== 0) return null;
  return {
    preflightPassed: true,
    chromiumLaunched: result.chromium_launched === true,
    pageReady: result.page_ready === true,
    safeNavigation: result.safe_navigation === true,
    browserClosed: result.browser_closed === true,
    profileLockReleased: result.profile_lock_released === true,
    publishEnabled: false,
    blockers: Array.isArray(result.blockers) ? result.blockers.map(String).slice(0, 16) : [],
  };
}

module.exports = { CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE, safeChromiumPreflightResult };
