'use strict';

const path = require('path');
const { chromium } = require('playwright');
const { profilesPath } = require('../config/storagePaths');
const { CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE } = require('../../server/cloud-chromium-preflight');

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function normalized(value) { const resolved = path.resolve(value); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; }
function isInside(root, candidate) { const base = normalized(root); const target = normalized(candidate); return target.startsWith(`${base}${path.sep}`); }

function createChromiumSafePreflightExecutor(registry, runtimeProfiles, options = {}) {
  const allowedProfilesRoot = options.profilesRoot || profilesPath;
  const launchPersistentContext = options.launchPersistentContext || chromium.launchPersistentContext.bind(chromium);
  const enabled = options.enabled === true;
  return async (task) => {
    if (task.task_type !== CHROMIUM_SAFE_PREFLIGHT_TASK_TYPE) throw failure('UNSUPPORTED_TASK_TYPE', 'Unsupported Chromium preflight task.');
    if (!enabled) throw failure('CHROMIUM_PREFLIGHT_DISABLED', 'Chromium safe preflight is disabled.');
    const payload = task.payload || {};
    if (payload.mode !== 'CHROMIUM_SAFE_PREFLIGHT' || payload.publishEnabled !== false) throw failure('PUBLISHING_NOT_DISABLED', 'Chromium safe preflight requires publishing to remain disabled.');
    const profile = registry.getProfile(task.profile_id, runtimeProfiles());
    if (!profile || profile.status !== 'READY') throw failure('PROFILE_UNAVAILABLE', 'Local profile is unavailable for Chromium preflight.');
    if (!isInside(allowedProfilesRoot, profile.localProfilePath)) throw failure('SYNTHETIC_PROFILE_ROOT_INVALID', 'Chromium preflight profile is outside the isolated profile root.');
    let context;
    try {
      context = await launchPersistentContext(profile.localProfilePath, { headless: true });
      const page = context.pages().length ? context.pages()[0] : await context.newPage();
      await page.goto('about:blank', { waitUntil: 'load' });
      if (page.url() !== 'about:blank') throw failure('SAFE_NAVIGATION_FAILED', 'Chromium preflight did not remain on the internal safe page.');
      await context.close(); context = null;
      return { preflight_passed: true, chromium_launched: true, page_ready: true, safe_navigation: true, browser_closed: true, profile_lock_released: true, publishEnabled: false, blockers: [] };
    } finally {
      if (context) await context.close().catch(() => {});
    }
  };
}

module.exports = { createChromiumSafePreflightExecutor, isInside };
