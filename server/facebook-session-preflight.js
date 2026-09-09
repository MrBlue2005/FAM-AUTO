'use strict';
const FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE = 'FACEBOOK_SESSION_READINESS_PREFLIGHT';
const FACEBOOK_READINESS_URL = 'https://www.facebook.com/';
const SESSION_STATES = new Set(['AUTHENTICATED', 'UNAUTHENTICATED', 'INDETERMINATE']);
function safeFacebookSessionResult(result) {
  if (!result || result.preflight_passed !== true || result.publishEnabled !== false || result.browser_closed !== true || result.profile_lock_released !== true || result.interaction_performed !== false || !SESSION_STATES.has(result.session_state) || !Array.isArray(result.blockers)) return null;
  return { preflightPassed: true, sessionState: result.session_state, facebookReached: result.facebook_reached === true, browserClosed: true, profileLockReleased: true, publishEnabled: false, interactionPerformed: false, blockers: result.blockers.map(String).slice(0, 16) };
}
module.exports = { FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE, FACEBOOK_READINESS_URL, SESSION_STATES, safeFacebookSessionResult };
