'use strict';

const { startBrowser } = require('../facebook/browserManager');
const { openGroup } = require('../facebook/groupNavigation');
const { createPost } = require('../facebook/postCreator');
const { verifyLivePostPublished } = require('../facebook/verifyPost');
const { detectSessionState } = require('./FacebookSessionReadinessExecutor');
const { requireExpectedFacebookAccountId } = require('./FacebookIdentityConfig');
const { verifyAuthenticatedFacebookAccountId } = require('./FacebookSessionIdentity');
const { canonicalFacebookGroupTarget, verifyCanonicalFacebookGroupTarget, captureVerifiedComposer, ensureRetainedComposer, verifyComposerText, inspectComposerMedia, findScopedPublishControl, ensureScopedPublishControl } = require('./FacebookLiveReadiness');

function failure(code, message) { return Object.assign(new Error(message), { code }); }

// The sole adapter capable of reaching the real browser publishing click. It
// owns neither claiming, lease validation, durable markers, nor completion.
function createRealFacebookPublisherAdapter(registry, runtimeProfiles, options = {}) {
  const openBrowser = options.openBrowser || startBrowser;
  const navigateGroup = options.openGroup || openGroup;
  const preparePost = options.createPost || createPost;
  const verifyPublished = options.verifyLivePostPublished || verifyLivePostPublished;
  const canonicalTarget = options.canonicalTarget || canonicalFacebookGroupTarget;
  const verifyTarget = options.verifyTarget || verifyCanonicalFacebookGroupTarget;
  const captureComposer = options.captureComposer || captureVerifiedComposer;
  const verifyComposer = options.verifyComposer || ensureRetainedComposer;
  const verifyText = options.verifyText || verifyComposerText;
  const verifyMedia = options.verifyMedia || inspectComposerMedia;
  const findPublishControl = options.findPublishControl || findScopedPublishControl;
  const verifyPublishControl = options.verifyPublishControl || ensureScopedPublishControl;
  let browser = null; let preparedTaskId = null; let composer = null; let publishButton = null; let submitInvoked = false; let expectedFacebookAccountId = null; let targetCanonical = null;

  function requirePrepared(task) {
    if (!browser || preparedTaskId !== task?.task_id || !composer) throw failure('PUBLISHER_NOT_PREPARED', 'Live publisher has not prepared this exact task.');
  }
  async function sessionReady(page) {
    const state = detectSessionState(await page.content().catch(() => ''));
    if (state !== 'AUTHENTICATED') throw failure('FACEBOOK_SESSION_NOT_READY', 'Facebook session is unavailable, challenged, or requires login.');
  }
  async function cleanup() {
    const current = browser; browser = null; composer = null; publishButton = null; preparedTaskId = null; expectedFacebookAccountId = null; targetCanonical = null;
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
      targetCanonical = canonicalTarget(targetUrl);
      try {
        browser = await openBrowser((profile.legacyProfileIds || [])[0], { profilePath: profile.localProfilePath, displayName: profile.displayName });
        await sessionReady(browser.page);
        await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
        await navigateGroup(browser.page, targetUrl);
        verifyTarget(browser.page.url(), targetCanonical);
        const post = { ...task.payload.post, media: task.payload.local_media_paths, imagePath: task.payload.local_media_paths?.[0], postingIdentityId: task.payload.posting_identity_id || task.payload.post?.postingIdentityId };
        await preparePost(browser.page, post);
        composer = await captureComposer(browser.page);
        await verifyComposer(composer);
        await verifyText(composer, task.payload?.post?.text);
        await verifyMedia(composer, task);
        preparedTaskId = task.task_id;
      } catch (error) { await cleanup(); throw error; }
    },
    async verifyReady(task) {
      requirePrepared(task);
      await sessionReady(browser.page);
      await verifyAuthenticatedFacebookAccountId(browser.page, expectedFacebookAccountId);
      verifyTarget(browser.page.url(), targetCanonical);
      await verifyComposer(composer);
      await verifyText(composer, task.payload?.post?.text);
      await verifyMedia(composer, task);
      publishButton = await findPublishControl(composer);
      return { sessionReady: true, targetReady: true, composerReady: true };
    },
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
