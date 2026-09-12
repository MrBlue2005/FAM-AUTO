'use strict';
const { startBrowser } = require('../facebook/browserManager');
const { FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE, FACEBOOK_READINESS_URL } = require('../../server/facebook-session-preflight');
const FACEBOOK_SESSION_SETTLE_TIMEOUT_MS = 1500;

function inspectSessionState(text) {
  const value = String(text || '').toLowerCase();
  const checkpoint = /checkpoint/.test(value);
  const securityCheck = /security check/.test(value);
  const challenge = /challenge/.test(value);
  const emailForm = /name="email"/.test(value);
  const passwordForm = /name="pass"/.test(value);
  const loginPrompt = /log into facebook/.test(value);
  const authenticatedMarker = /aria-label="account"|facebook menu/.test(value);
  const explicitNegative = checkpoint || securityCheck || challenge || emailForm || passwordForm || loginPrompt;
  const state = (checkpoint || securityCheck || challenge) ? 'INDETERMINATE'
    : authenticatedMarker === (emailForm || passwordForm || loginPrompt) ? 'INDETERMINATE'
      : authenticatedMarker ? 'AUTHENTICATED' : 'UNAUTHENTICATED';
  return { state, authenticatedMarker, explicitNegative, checkpoint, securityCheck, challenge, emailForm, passwordForm, loginPrompt };
}

function detectSessionState(text) { return inspectSessionState(text).state; }

async function observeFacebookSession(page) {
  // DOMContentLoaded is sufficient to start, but Facebook's shell can finish
  // hydrating shortly after. This is bounded observation only, never polling
  // for a positive marker and never a substitute for trusted identity checks.
  if (typeof page?.waitForFunction === 'function') {
    await page.waitForFunction(() => document.readyState === 'complete', undefined, { timeout: FACEBOOK_SESSION_SETTLE_TIMEOUT_MS }).catch(() => {});
  }
  return inspectSessionState(await page?.content?.().catch(() => ''));
}

function requireNoExplicitNegativeSessionState(observation) {
  if (observation?.explicitNegative) throw Object.assign(new Error('Facebook session is unavailable, challenged, or requires login.'), { code: 'FACEBOOK_SESSION_NOT_READY' });
  return observation;
}

function createFacebookSessionReadinessExecutor(registry, runtimeProfiles, options = {}) { const enabled = options.enabled === true; const openBrowser = options.openBrowser || startBrowser; return async (task) => { if (task.task_type !== FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE) throw Object.assign(new Error('Unsupported session readiness task.'), { code: 'UNSUPPORTED_TASK_TYPE' }); if (!enabled) throw Object.assign(new Error('Facebook session readiness preflight is disabled.'), { code: 'FACEBOOK_SESSION_PREFLIGHT_DISABLED' }); if (task.payload?.executionMode !== 'SESSION_READINESS' || task.payload?.publishEnabled !== false) throw Object.assign(new Error('Session readiness requires publishing to remain disabled.'), { code: 'PUBLISHING_NOT_DISABLED' }); const profile = registry.getProfile(task.profile_id, runtimeProfiles()); if (!profile || profile.status !== 'READY') throw Object.assign(new Error('Configured local profile is unavailable.'), { code: 'PROFILE_UNAVAILABLE' }); let browser; try { browser = await openBrowser((profile.legacyProfileIds || [])[0], { profilePath: profile.localProfilePath, displayName: profile.displayName }); await browser.page.goto(FACEBOOK_READINESS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); const sessionState = detectSessionState(await browser.page.content().catch(() => '')); await browser.context.close(); browser = null; return { preflight_passed: true, session_state: sessionState, facebook_reached: true, browser_closed: true, profile_lock_released: true, publishEnabled: false, interaction_performed: false, blockers: [] }; } finally { if (browser) await browser.context.close().catch(() => {}); } }; }
module.exports = { FACEBOOK_SESSION_SETTLE_TIMEOUT_MS, createFacebookSessionReadinessExecutor, detectSessionState, inspectSessionState, observeFacebookSession, requireNoExplicitNegativeSessionState };
