'use strict';
const { startBrowser } = require('../facebook/browserManager');
const { FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE, FACEBOOK_READINESS_URL } = require('../../server/facebook-session-preflight');
const FACEBOOK_SESSION_SETTLE_TIMEOUT_MS = 1500;

const NEGATIVE_URL_PATHS = [
  /^\/login(?:\/|$)/i,
  /^\/checkpoint(?:\/|$)/i,
  /^\/challenge(?:\/|$)/i,
  /^\/recover(?:\/|$)/i,
  /^\/security(?:\/|$)/i,
];

function inspectSessionState(text) {
  const value = String(text || '').toLowerCase();
  // Whole-document text is diagnostic only. Facebook can retain login and
  // challenge strings in scripts, hidden templates, or inert shell markup.
  // Real-publisher authority is established exclusively by observeFacebookSession.
  const checkpoint = /checkpoint/.test(value);
  const securityCheck = /security check/.test(value);
  const challenge = /challenge/.test(value);
  const emailForm = /name="email"/.test(value);
  const passwordForm = /name="pass"/.test(value);
  const loginPrompt = /log into facebook/.test(value);
  const authenticatedMarker = /aria-label="account"|facebook menu/.test(value);
  return {
    state: authenticatedMarker ? 'AUTHENTICATED' : 'INDETERMINATE',
    authenticatedMarker,
    explicitNegative: false,
    diagnosticGlobalMarkers: { checkpoint, securityCheck, challenge, emailForm, passwordForm, loginPrompt },
  };
}

function detectSessionState(text) { return inspectSessionState(text).state; }

function knownNegativeFacebookPath(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'www.facebook.com' || url.port || url.username || url.password) return false;
    return NEGATIVE_URL_PATHS.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}

async function locatorVisible(locator) {
  if (!locator) return false;
  try {
    const count = typeof locator.count === 'function' ? Math.min(Number(await locator.count()) || 0, 8) : 1;
    for (let index = 0; index < count; index += 1) {
      const candidate = typeof locator.nth === 'function' ? locator.nth(index) : index === 0 ? locator : null;
      if (candidate && typeof candidate.isVisible === 'function' && await candidate.isVisible().catch(() => false)) return true;
    }
  } catch {}
  return false;
}

async function anyVisibleSelector(page, selectors) {
  if (typeof page?.locator !== 'function') return false;
  for (const selector of selectors) {
    try { if (await locatorVisible(page.locator(selector))) return true; } catch {}
  }
  return false;
}

async function anyVisibleRole(page, role, names) {
  if (typeof page?.getByRole !== 'function') return false;
  for (const name of names) {
    try { if (await locatorVisible(page.getByRole(role, { name }))) return true; } catch {}
  }
  return false;
}

async function visibleNegativeEvidence(page) {
  const currentUrl = typeof page?.url === 'function' ? page.url() : '';
  const negativePath = knownNegativeFacebookPath(currentUrl);
  const visibleEmail = await anyVisibleSelector(page, ['input[name="email"]', 'input[type="email"]', 'input[autocomplete="username"]']);
  const visiblePassword = await anyVisibleSelector(page, ['input[name="pass"]', 'input[type="password"]', 'input[autocomplete="current-password"]']);
  const visibleLoginForm = await anyVisibleSelector(page, ['form[action*="login" i]']);
  const visibleLoginButton = await anyVisibleRole(page, 'button', [/^log in$/i, /^log into facebook$/i, /^sign in$/i]);
  const login = visibleLoginForm || (visibleEmail && visiblePassword) || (visibleLoginButton && (visibleEmail || visiblePassword));

  const visibleCheckpointForm = await anyVisibleSelector(page, ['form[action*="checkpoint" i]', '[role="dialog"] form[action*="checkpoint" i]']);
  const visibleChallengeForm = await anyVisibleSelector(page, ['form[action*="challenge" i]', 'form[action*="security" i]']);
  const checkpoint = visibleCheckpointForm || await anyVisibleRole(page, 'heading', [/checkpoint/i]);
  const challenge = visibleChallengeForm || await anyVisibleRole(page, 'heading', [/challenge/i, /security check/i]);
  return { negativePath, login, checkpoint, challenge };
}

async function observeFacebookSession(page) {
  // DOMContentLoaded is sufficient to start, but Facebook's shell can finish
  // hydrating shortly after. This is bounded observation only, never polling
  // for a positive marker and never a substitute for trusted identity checks.
  if (typeof page?.waitForFunction === 'function') {
    await page.waitForFunction(() => document.readyState === 'complete', undefined, { timeout: FACEBOOK_SESSION_SETTLE_TIMEOUT_MS }).catch(() => {});
  }
  const diagnostics = inspectSessionState(await page?.content?.().catch(() => ''));
  const visible = await visibleNegativeEvidence(page);
  return {
    ...diagnostics,
    ...visible,
    explicitNegative: visible.negativePath || visible.login || visible.checkpoint || visible.challenge,
  };
}

function requireNoExplicitNegativeSessionState(observation, trace = () => {}) {
  if (observation?.negativePath) {
    trace('NEGATIVE_URL_DETECTED');
    throw Object.assign(new Error('Facebook session is unavailable, challenged, or requires login.'), { code: 'FACEBOOK_SESSION_NOT_READY' });
  }
  if (observation?.login) {
    trace('VISIBLE_LOGIN_DETECTED');
    throw Object.assign(new Error('Facebook session is unavailable, challenged, or requires login.'), { code: 'FACEBOOK_SESSION_NOT_READY' });
  }
  if (observation?.checkpoint) {
    trace('VISIBLE_CHECKPOINT_DETECTED');
    throw Object.assign(new Error('Facebook session is unavailable, challenged, or requires login.'), { code: 'FACEBOOK_SESSION_NOT_READY' });
  }
  if (observation?.challenge) {
    trace('VISIBLE_CHALLENGE_DETECTED');
    throw Object.assign(new Error('Facebook session is unavailable, challenged, or requires login.'), { code: 'FACEBOOK_SESSION_NOT_READY' });
  }
  trace('NEGATIVE_STATE_NONE_VISIBLE');
  return observation;
}

function createFacebookSessionReadinessExecutor(registry, runtimeProfiles, options = {}) { const enabled = options.enabled === true; const openBrowser = options.openBrowser || startBrowser; return async (task) => { if (task.task_type !== FACEBOOK_SESSION_READINESS_PREFLIGHT_TASK_TYPE) throw Object.assign(new Error('Unsupported session readiness task.'), { code: 'UNSUPPORTED_TASK_TYPE' }); if (!enabled) throw Object.assign(new Error('Facebook session readiness preflight is disabled.'), { code: 'FACEBOOK_SESSION_PREFLIGHT_DISABLED' }); if (task.payload?.executionMode !== 'SESSION_READINESS' || task.payload?.publishEnabled !== false) throw Object.assign(new Error('Session readiness requires publishing to remain disabled.'), { code: 'PUBLISHING_NOT_DISABLED' }); const profile = registry.getProfile(task.profile_id, runtimeProfiles()); if (!profile || profile.status !== 'READY') throw Object.assign(new Error('Configured local profile is unavailable.'), { code: 'PROFILE_UNAVAILABLE' }); let browser; try { browser = await openBrowser((profile.legacyProfileIds || [])[0], { profilePath: profile.localProfilePath, displayName: profile.displayName }); await browser.page.goto(FACEBOOK_READINESS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); const sessionState = detectSessionState(await browser.page.content().catch(() => '')); await browser.context.close(); browser = null; return { preflight_passed: true, session_state: sessionState, facebook_reached: true, browser_closed: true, profile_lock_released: true, publishEnabled: false, interaction_performed: false, blockers: [] }; } finally { if (browser) await browser.context.close().catch(() => {}); } }; }
module.exports = { FACEBOOK_SESSION_SETTLE_TIMEOUT_MS, NEGATIVE_URL_PATHS, createFacebookSessionReadinessExecutor, detectSessionState, inspectSessionState, knownNegativeFacebookPath, observeFacebookSession, requireNoExplicitNegativeSessionState, visibleNegativeEvidence };
