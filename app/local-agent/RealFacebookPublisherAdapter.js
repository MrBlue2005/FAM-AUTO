'use strict';

const { startBrowser } = require('../facebook/browserManager');
const { openGroup } = require('../facebook/groupNavigation');
const { createPost } = require('../facebook/postCreator');
const { verifyLivePostPublished } = require('../facebook/verifyPost');
const { observeFacebookSession, requireNoExplicitNegativeSessionState } = require('./FacebookSessionReadinessExecutor');
const { requireExpectedFacebookAccountId } = require('./FacebookIdentityConfig');
const { verifyAuthenticatedFacebookAccountId } = require('./FacebookSessionIdentity');
const { canonicalFacebookGroupTarget, verifyCanonicalFacebookGroupTarget, requirePreparedComposer, ensureRetainedComposer, verifyComposerText, inspectComposerMedia, findScopedPublishControl, ensureScopedPublishControl } = require('./FacebookLiveReadiness');

function failure(code, message) { return Object.assign(new Error(message), { code }); }
const FACEBOOK_ROOT_URL = 'https://www.facebook.com/';
const FACEBOOK_ROOT_TIMEOUT_MS = 30000;

function isApprovedFacebookOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'www.facebook.com'
      && !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}

// The sole adapter capable of reaching the real browser publishing click. It
// owns neither claiming, lease validation, durable markers, nor completion.
function createRealFacebookPublisherAdapter(registry, runtimeProfiles, options = {}) {
  const openBrowser = options.openBrowser || startBrowser;
  const navigateGroup = options.openGroup || openGroup;
  const preparePost = options.createPost || createPost;
  const verifyPublished = options.verifyLivePostPublished || verifyLivePostPublished;
  const canonicalTarget = options.canonicalTarget || canonicalFacebookGroupTarget;
  const verifyTarget = options.verifyTarget || verifyCanonicalFacebookGroupTarget;
  const preparedComposer = options.requirePreparedComposer || requirePreparedComposer;
  const verifyComposer = options.verifyComposer || ensureRetainedComposer;
  const verifyText = options.verifyText || verifyComposerText;
  const verifyMedia = options.verifyMedia || inspectComposerMedia;
  const findPublishControl = options.findPublishControl || findScopedPublishControl;
  const verifyPublishControl = options.verifyPublishControl || ensureScopedPublishControl;
  let browser = null; let preparedTaskId = null; let composer = null; let publishButton = null; let submitInvoked = false; let expectedFacebookAccountId = null; let targetCanonical = null;

  function requirePrepared(task) {
    if (!browser || preparedTaskId !== task?.task_id || !composer) throw failure('PUBLISHER_NOT_PREPARED', 'Live publisher has not prepared this exact task.');
  }
  async function sessionReady(page, trace = () => {}) {
    requireNoExplicitNegativeSessionState(await observeFacebookSession(page));
    trace('SESSION_NEGATIVE_GUARD_CLEAR');
  }
  async function navigateFacebookRoot(page) {
    try {
      await page.goto(FACEBOOK_ROOT_URL, { waitUntil: 'domcontentloaded', timeout: FACEBOOK_ROOT_TIMEOUT_MS });
    } catch {
      throw failure('FACEBOOK_SESSION_NOT_READY', 'Facebook session root could not be reached.');
    }
    if (!isApprovedFacebookOrigin(page?.url?.())) {
      throw failure('FACEBOOK_SESSION_NOT_READY', 'Facebook session root redirected to an unapproved origin.');
    }
  }
  async function cleanup() {
    const current = browser; browser = null; composer = null; publishButton = null; preparedTaskId = null; expectedFacebookAccountId = null; targetCanonical = null;
    if (current?.context) await current.context.close().catch(() => {});
  }
  async function verifyCurrentReadiness(task) {
    requirePrepared(task);
    await sessionReady(browser.page);
    await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
    verifyTarget(browser.page.url(), targetCanonical);
    await verifyComposer(composer);
    await verifyText(composer, task.payload?.post?.text);
    await verifyMedia(composer, task);
    publishButton = await findPublishControl(composer);
    return { sessionReady: true, targetReady: true, composerReady: true };
  }

  return {
    async prepare(task, options = {}) {
      const trace = typeof options.trace === 'function' ? options.trace : () => {};
      if (browser) throw failure('PUBLISHER_ALREADY_PREPARED', 'Live publisher is already preparing another task.');
      if (task?.payload?.execution_config?.rehearsal === true) throw failure('LIVE_REHEARSAL_REAL_ADAPTER_FORBIDDEN', 'The real Facebook publisher rejects rehearsal task snapshots.');
      const profile = registry?.getProfile?.(task.profile_id, runtimeProfiles());
      if (!profile || profile.status !== 'READY') throw failure('PROFILE_UNAVAILABLE', 'Configured local profile is unavailable.');
      // G5.6A1: require local trusted identity configuration before opening a
      // browser. Session equality verification is deliberately added later.
      expectedFacebookAccountId = requireExpectedFacebookAccountId(profile);
      const targetUrl = String(task.payload?.target?.url || '');
      targetCanonical = canonicalTarget(targetUrl);
      try {
        browser = await openBrowser((profile.legacyProfileIds || [])[0], { profilePath: profile.localProfilePath, displayName: profile.displayName });
        // The initial persistent-context page may be blank, stale, or a new tab.
        // Root navigation is bounded and side-effect-free; identity and target work
        // remain unavailable until its authenticated state is established.
        await navigateFacebookRoot(browser.page);
        trace('ROOT_NAVIGATION_OK');
        await sessionReady(browser.page, trace);
        await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
        trace('TRUSTED_IDENTITY_MATCH');
        await navigateGroup(browser.page, targetUrl);
        verifyTarget(browser.page.url(), targetCanonical);
        trace('TARGET_READY');
        const post = { ...task.payload.post, media: task.payload.local_media_paths, imagePath: task.payload.local_media_paths?.[0], postingIdentityId: task.payload.posting_identity_id || task.payload.post?.postingIdentityId };
        const prepared = await preparePost(browser.page, post);
        composer = preparedComposer(prepared);
        await verifyComposer(composer);
        await verifyText(composer, task.payload?.post?.text);
        await verifyMedia(composer, task);
        trace('COMPOSER_READY');
        preparedTaskId = task.task_id;
      } catch (error) { await cleanup(); throw error; }
    },
    async verifyReady(task) {
      return verifyCurrentReadiness(task);
    },
    async verifyAfterLeaseReadiness(task) { return verifyCurrentReadiness(task); },
    async verifyBeforeAttempt(task) {
      requirePrepared(task);
      await sessionReady(browser.page);
      await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
      verifyTarget(browser.page.url(), targetCanonical);
      await verifyComposer(composer);
      await verifyText(composer, task.payload?.post?.text);
      await verifyMedia(composer, task);
      await verifyPublishControl(publishButton, composer);
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
      const verified = await verifyPublished(browser.page, composer.locator);
      return verified ? { verified: true, state: 'VERIFIED_SUCCESS' } : { verified: false, state: 'AMBIGUOUS' };
    },
    cleanup,
  };
}

module.exports = { createRealFacebookPublisherAdapter };
