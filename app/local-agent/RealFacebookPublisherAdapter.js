'use strict';

const { startBrowser } = require('../facebook/browserManager');
const { openGroup } = require('../facebook/groupNavigation');
const { createPost } = require('../facebook/postCreator');
const { findPublishButton } = require('../facebook/publishPost');
const { verifyLivePostPublished } = require('../facebook/verifyPost');
const { detectSessionState } = require('./FacebookSessionReadinessExecutor');
const { requireExpectedFacebookAccountId } = require('./FacebookIdentityConfig');
const { verifyAuthenticatedFacebookAccountId } = require('./FacebookSessionIdentity');

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function targetIdentity(url) { try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return ''; } }
function sameTarget(actual, expected) { return Boolean(targetIdentity(actual) && targetIdentity(actual) === targetIdentity(expected)); }

async function defaultContentInspection({ composerDialog, task }) {
  const text = String(task.payload?.post?.text || '');
  const composerText = await composerDialog.textContent().catch(() => '');
  if (text && !String(composerText || '').includes(text)) return { textPresent: false, mediaReady: false };
  const expectedMedia = Array.isArray(task.payload?.media) ? task.payload.media.length : 0;
  if (!expectedMedia) return { textPresent: true, mediaReady: true };
  const attachments = await composerDialog.locator('img, video').count().catch(() => 0);
  return { textPresent: true, mediaReady: attachments >= expectedMedia };
}

// The sole adapter capable of reaching the real browser publishing click. It
// owns neither claiming, lease validation, durable markers, nor completion.
function createRealFacebookPublisherAdapter(registry, runtimeProfiles, options = {}) {
  const openBrowser = options.openBrowser || startBrowser;
  const navigateGroup = options.openGroup || openGroup;
  const preparePost = options.createPost || createPost;
  const locatePublishButton = options.findPublishButton || findPublishButton;
  const verifyPublished = options.verifyLivePostPublished || verifyLivePostPublished;
  const inspectContent = options.inspectContent || defaultContentInspection;
  let browser = null; let preparedTaskId = null; let composerDialog = null; let publishButton = null; let submitInvoked = false; let expectedFacebookAccountId = null;

  function requirePrepared(task) {
    if (!browser || preparedTaskId !== task?.task_id || !composerDialog) throw failure('PUBLISHER_NOT_PREPARED', 'Live publisher has not prepared this exact task.');
  }
  async function sessionReady(page) {
    const state = detectSessionState(await page.content().catch(() => ''));
    if (state !== 'AUTHENTICATED') throw failure('FACEBOOK_SESSION_NOT_READY', 'Facebook session is unavailable, challenged, or requires login.');
  }
  async function cleanup() {
    const current = browser; browser = null; composerDialog = null; publishButton = null; preparedTaskId = null; expectedFacebookAccountId = null;
    if (current?.context) await current.context.close().catch(() => {});
  }

  return {
    async prepare(task) {
      if (browser) throw failure('PUBLISHER_ALREADY_PREPARED', 'Live publisher is already preparing another task.');
      const profile = registry?.getProfile?.(task.profile_id, runtimeProfiles());
      if (!profile || profile.status !== 'READY') throw failure('PROFILE_UNAVAILABLE', 'Configured local profile is unavailable.');
      // G5.6A1: require local trusted identity configuration before opening a
      // browser. Session equality verification is deliberately added later.
      expectedFacebookAccountId = requireExpectedFacebookAccountId(profile);
      const targetUrl = String(task.payload?.target?.url || '');
      if (!targetIdentity(targetUrl)) throw failure('TARGET_INVALID', 'Live task target is invalid.');
      try {
        browser = await openBrowser((profile.legacyProfileIds || [])[0], { profilePath: profile.localProfilePath, displayName: profile.displayName });
        await sessionReady(browser.page);
        await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
        await navigateGroup(browser.page, targetUrl);
        if (!sameTarget(browser.page.url(), targetUrl)) throw failure('TARGET_MISMATCH', 'Browser is not on the exact requested Facebook target.');
        const post = { ...task.payload.post, media: task.payload.local_media_paths, imagePath: task.payload.local_media_paths?.[0], postingIdentityId: task.payload.posting_identity_id || task.payload.post?.postingIdentityId };
        await preparePost(browser.page, post);
        composerDialog = browser.page.getByRole('dialog').last();
        await composerDialog.waitFor({ state: 'visible', timeout: 10000 });
        preparedTaskId = task.task_id;
      } catch (error) { await cleanup(); throw error; }
    },
    async verifyReady(task) {
      requirePrepared(task);
      await sessionReady(browser.page);
      await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
      if (!sameTarget(browser.page.url(), task.payload?.target?.url)) throw failure('TARGET_MISMATCH', 'Browser target changed before publication.');
      await composerDialog.waitFor({ state: 'visible', timeout: 5000 });
      const content = await inspectContent({ page: browser.page, composerDialog, task });
      if (content?.textPresent !== true) throw failure('CONTENT_MISMATCH', 'Prepared composer text does not match the immutable task snapshot.');
      if (content?.mediaReady !== true) throw failure('MEDIA_MISMATCH', 'Prepared composer media does not match the verified task snapshot.');
      publishButton = await locatePublishButton(browser.page);
      if (typeof publishButton.isEnabled === 'function' && !await publishButton.isEnabled()) throw failure('PUBLISH_CONTROL_UNAVAILABLE', 'Facebook publish control is unavailable.');
      return { sessionReady: true, targetReady: true, composerReady: true };
    },
    async verifyBeforeAttempt(task) {
      requirePrepared(task);
      await sessionReady(browser.page);
      await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
    },
    async submit(task) {
      requirePrepared(task);
      if (!publishButton) throw failure('PUBLISH_CONTROL_UNAVAILABLE', 'Facebook publish control was not verified.');
      if (submitInvoked) throw failure('PUBLISH_ALREADY_ATTEMPTED', 'The live publisher will not submit twice.');
      submitInvoked = true;
      // DANGEROUS BOUNDARY: the sole real Facebook side effect in this adapter.
      await publishButton.click();
    },
    async verifyOutcome(task) {
      requirePrepared(task);
      const verified = await verifyPublished(browser.page, composerDialog);
      return verified ? { verified: true, state: 'VERIFIED_SUCCESS' } : { verified: false, state: 'AMBIGUOUS' };
    },
    cleanup,
  };
}

module.exports = { createRealFacebookPublisherAdapter, sameTarget, targetIdentity, defaultContentInspection };
