const { createAcknowledgementShapeObserver } = require('./acknowledgementDiagnostics');
const { STORY_REFERENCE_RESULT } = require('./storyReferenceVerifier');

const STORY_ID_PATTERN = /^\d{1,32}$/;
const STORY_VERIFICATION_TOKEN_PATTERN = /(?<![A-Z0-9-])RXV-[A-Z0-9]+(?:-[A-Z0-9]+){2,}(?![A-Z0-9-])/g;

function exactStoryVerificationToken(value) {
  const matches = String(value ?? '').match(STORY_VERIFICATION_TOKEN_PATTERN) || [];
  return matches.length === 1 && matches[0].length <= 128 ? matches[0] : null;
}

function validatedStoryReference(transportSummary) {
  const reference = transportSummary?.createdObjectVerificationReference;
  return reference?.objectType === 'STORY' && STORY_ID_PATTERN.test(String(reference.opaqueId || ''))
    ? Object.freeze({ objectType: 'STORY', opaqueId: String(reference.opaqueId) })
    : null;
}

function storyVerificationExact(storyVerification, storyReference) {
  return storyReference?.objectType === 'STORY'
    && STORY_ID_PATTERN.test(String(storyReference.opaqueId || ''))
    && storyVerification?.result === STORY_REFERENCE_RESULT.VISIBLE_EXACT
    && storyVerification.targetMatched === true
    && storyVerification.tokenMatched === true
    && storyVerification.bodyHashMatched === true
    && String(storyVerification.storyId || '') === String(storyReference?.opaqueId || '');
}

async function verifyPostPublished(page, composerDialog) {
  console.log('Astept confirmarea publicarii...');

  const successMessage = page
    .getByText(/postarea (ta )?(a fost|este acum) publicat[ăa]|your post (was|is now) published/i)
    .first();

  try {
    await Promise.any([
      composerDialog.waitFor({ state: 'hidden', timeout: 120000 }),
      successMessage.waitFor({ state: 'visible', timeout: 120000 }),
    ]);

    console.log('Publicarea a fost confirmata de interfata Facebook.');
    return true;
  } catch {
    console.log('Publicarea nu a putut fi confirmata in 120 secunde.');
    return false;
  }
}

function elapsedBucket(value) {
  const elapsed = Math.max(0, Number(value) || 0);
  if (elapsed < 1000) return 'UNDER_1_SECOND';
  if (elapsed < 5000) return 'UNDER_5_SECONDS';
  if (elapsed < 30000) return 'UNDER_30_SECONDS';
  if (elapsed < 120000) return 'UNDER_120_SECONDS';
  return 'AT_OR_OVER_TIMEOUT';
}

function predicateFailure(error) { return error?.name === 'TimeoutError' ? 'FAILED_TIMEOUT' : 'FAILED_ERROR'; }

async function waitPredicate(locator, state, timeout) {
  try { await locator.waitFor({ state, timeout }); return { passed: true, result: 'PASSED' }; }
  catch (error) { return { passed: false, result: predicateFailure(error) }; }
}

async function acknowledgementWithinGrace(acknowledgementPromise, graceMs) {
  const configured = Number(graceMs);
  const grace = Math.max(0, Math.min(10000, Number.isFinite(configured) ? configured : 5000));
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ passed: false, result: 'NOT_OBSERVED_BEFORE_RELOAD' }), grace));
  return Promise.race([acknowledgementPromise, timeout]);
}

async function observeComposerState(composerDialog) {
  try {
    if (!composerDialog || typeof composerDialog.evaluate !== 'function' || typeof composerDialog.isVisible !== 'function') return { retainedComposerAttached: false, retainedComposerVisible: false, composerState: 'UNAVAILABLE' };
    const [attached, visible] = await Promise.all([composerDialog.evaluate((node) => node?.isConnected === true), composerDialog.isVisible()]);
    if (attached !== true) return { retainedComposerAttached: false, retainedComposerVisible: false, composerState: 'DETACHED' };
    return { retainedComposerAttached: true, retainedComposerVisible: visible === true, composerState: visible === true ? 'ATTACHED_VISIBLE' : 'ATTACHED_HIDDEN' };
  } catch { return { retainedComposerAttached: false, retainedComposerVisible: false, composerState: 'SAFE_EVALUATION_ERROR' }; }
}

async function observeAcknowledgement(successMessage, acknowledgementPassed) {
  try {
    if (!successMessage || typeof successMessage.count !== 'function') return { acknowledgementCandidateCount: 0, acknowledgementClassification: acknowledgementPassed ? 'MATCH_FOUND' : 'UNAVAILABLE' };
    const count = await successMessage.count(); const safeCount = Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 1000) : 0;
    return { acknowledgementCandidateCount: safeCount, acknowledgementClassification: acknowledgementPassed ? 'MATCH_FOUND' : safeCount > 0 ? 'CANDIDATES_PRESENT_NO_MATCH' : 'NONE' };
  } catch { return { acknowledgementCandidateCount: 0, acknowledgementClassification: 'SAFE_EVALUATION_ERROR' }; }
}

async function observePostPublicationStructure(page, publishControl, composerState, canonicalTargetStillValid) {
  const bucket = (count) => !Number.isSafeInteger(count) || count < 0 ? 'UNKNOWN' : count === 0 ? 'ZERO' : count === 1 ? 'ONE' : 'MULTIPLE';
  try {
    const [publishControlPresent, publishControlVisible, dialogCounts] = await Promise.all([
      publishControl && typeof publishControl.count === 'function' ? publishControl.count().then((count) => Number(count) > 0).catch(() => false) : Promise.resolve(false),
      publishControl && typeof publishControl.isVisible === 'function' ? publishControl.isVisible().catch(() => false) : Promise.resolve(false),
      page && typeof page.evaluate === 'function' ? page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('[role="dialog"]'));
        const isVisible = (node) => { const style = window.getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; };
        return { all: all.length, visible: all.filter(isVisible).length };
      }).catch(() => null) : Promise.resolve(null),
    ]);
    return { ...composerState, publishControlPresent, publishControlVisible, targetCanonicalValid: canonicalTargetStillValid === true, dialogCountBucket: bucket(dialogCounts?.all), visibleDialogCountBucket: bucket(dialogCounts?.visible) };
  } catch {
    return { ...composerState, publishControlPresent: false, publishControlVisible: false, targetCanonicalValid: canonicalTargetStillValid === true, dialogCountBucket: 'UNKNOWN', visibleDialogCountBucket: 'UNKNOWN' };
  }
}

function failurePredicate(composer, acknowledgement) {
  if (composer.passed && acknowledgement.passed) return 'NONE';
  if (!composer.passed && !acknowledgement.passed) return 'BOTH_FAILED';
  return composer.passed ? 'ACKNOWLEDGEMENT_NOT_OBSERVED' : 'COMPOSER_NOT_HIDDEN';
}

const POST_SUBMIT_OUTCOME = Object.freeze({
  PUBLISHED_ACKNOWLEDGED: 'PUBLISHED_ACKNOWLEDGED',
  PUBLISHED_VISIBLE_EXACT: 'PUBLISHED_VISIBLE_EXACT',
  SUBMITTED_FOR_APPROVAL: 'SUBMITTED_FOR_APPROVAL',
  EXPLICIT_FACEBOOK_FAILURE: 'EXPLICIT_FACEBOOK_FAILURE',
  UNCONFIRMED: 'UNCONFIRMED',
});

function classifyPostSubmitOutcome({ composerPassed, acknowledgementPassed, storyVerification, storyReference, targetReload, semanticSummary, transportSummary } = {}) {
  const exactCount = Math.max(0, Math.min(16, Number(targetReload?.postReloadExactTrustedPostCount) || 0));
  const storyExact = storyVerificationExact(storyVerification, storyReference);
  const counts = { matchingImmutableBodyCount: Math.max(exactCount, storyExact ? 1 : 0), matchingTokenCount: Math.max(exactCount, storyExact ? 1 : 0) };
  if (composerPassed === true && acknowledgementPassed === true) return { outcomeClassification: POST_SUBMIT_OUTCOME.PUBLISHED_ACKNOWLEDGED, outcomeEvidenceSource: 'EXPLICIT_ACKNOWLEDGEMENT', ...counts };
  if (semanticSummary?.semanticSubmissionPendingObserved === true) return { outcomeClassification: POST_SUBMIT_OUTCOME.SUBMITTED_FOR_APPROVAL, outcomeEvidenceSource: 'PENDING_MODERATION_ACKNOWLEDGEMENT', ...counts };
  if ((Number(semanticSummary?.publicationFailureLikeCount) || 0) > 0 || (Number(semanticSummary?.genericErrorLikeCount) || 0) > 0) return { outcomeClassification: POST_SUBMIT_OUTCOME.EXPLICIT_FACEBOOK_FAILURE, outcomeEvidenceSource: 'ERROR_OR_REJECTION_ACKNOWLEDGEMENT', ...counts };
  if (transportSummary?.explicitFailureObserved === true) return { outcomeClassification: POST_SUBMIT_OUTCOME.EXPLICIT_FACEBOOK_FAILURE, outcomeEvidenceSource: 'SUBMIT_TRANSPORT_FAILURE', ...counts };
  if (composerPassed === true && storyExact) return { outcomeClassification: POST_SUBMIT_OUTCOME.PUBLISHED_VISIBLE_EXACT, outcomeEvidenceSource: 'STORY_ID_VISIBLE_EXACT', ...counts };
  if (storyReference?.objectType === 'STORY' && STORY_ID_PATTERN.test(String(storyReference.opaqueId || '')) && storyVerification?.result === STORY_REFERENCE_RESULT.PENDING && storyVerification.targetMatched === true && storyVerification.tokenMatched === true && String(storyVerification.storyId || '') === String(storyReference.opaqueId)) return { outcomeClassification: POST_SUBMIT_OUTCOME.SUBMITTED_FOR_APPROVAL, outcomeEvidenceSource: 'STORY_ID_PENDING', ...counts };
  if (composerPassed === true && targetReload?.resultClass === 'VERIFIED_EXACT_TARGET_POST') return { outcomeClassification: POST_SUBMIT_OUTCOME.PUBLISHED_VISIBLE_EXACT, outcomeEvidenceSource: 'CANONICAL_TARGET_RELOAD', ...counts };
  return { outcomeClassification: POST_SUBMIT_OUTCOME.UNCONFIRMED, outcomeEvidenceSource: 'NO_AUTHORITATIVE_EVIDENCE', ...counts };
}

function explicitNegativeEvidence(semanticSummary, transportSummary) {
  return semanticSummary?.semanticSubmissionPendingObserved === true
    || (Number(semanticSummary?.publicationFailureLikeCount) || 0) > 0
    || (Number(semanticSummary?.genericErrorLikeCount) || 0) > 0
    || transportSummary?.explicitFailureObserved === true;
}

function verificationSurface(storyVerification, targetReload) {
  if (storyVerification && targetReload) return 'ACKNOWLEDGEMENT_STORY_ID_AND_CANONICAL_TARGET_RELOAD';
  if (storyVerification) return 'ACKNOWLEDGEMENT_AND_STORY_ID';
  if (targetReload) return 'ACKNOWLEDGEMENT_AND_CANONICAL_TARGET_RELOAD';
  return 'ACKNOWLEDGEMENT_SURFACES';
}

function classifyCurrentLocation(page, canonicalTargetStillValid) {
  if (canonicalTargetStillValid === true) return 'CANONICAL_TARGET';
  try {
    const url = new URL(String(page?.url?.() || ''));
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'www.facebook.com' ? 'APPROVED_FACEBOOK_OTHER' : 'UNAPPROVED_OR_INVALID';
  } catch { return 'UNAVAILABLE'; }
}

// The acknowledgement matcher remains a valid success source. Once the
// composer is provably hidden, a short bounded grace gives it an opportunity
// to resolve before the single, canonical-target-only post-attempt verifier.
async function verifyLivePostPublished(page, composerDialog, timeout = 120000, options = {}) {
  const diagnostic = options.diagnostic; const now = typeof options.now === 'function' ? options.now : () => Date.now(); const startedAt = now();
  try { diagnostic?.postSubmitVerificationStarted?.({ verificationTimeoutMs: timeout, composerHiddenPredicateEnabled: true, acknowledgementPredicateEnabled: true }); } catch { /* observability only */ }
  try {
    const successMessage = page.getByText(/postarea (ta )?(a fost|este acum) publicat[ăa]|your post (was|is now) published/i).first();
    // Starts without awaiting: this cannot delay, replace, or broaden either
    // existing verification predicate.
    const acknowledgementShapes = createAcknowledgementShapeObserver(page, { now, capture: options.captureAcknowledgementShapes, schedule: options.scheduleAcknowledgementObservation, cancel: options.cancelAcknowledgementObservation, immutableText: options.immutableText });
    acknowledgementShapes.start();
    const acknowledgementPromise = waitPredicate(successMessage, 'visible', timeout);
    // Prevent a later navigation from turning a rejected observer promise into
    // an unhandled rejection. Its outcome is used only before fallback starts.
    acknowledgementPromise.catch(() => {});
    const composer = await waitPredicate(composerDialog, 'hidden', timeout);
    if (composer.passed) options.submitTransportObserver?.markComposerHidden?.();
    const acknowledgement = composer.passed ? await acknowledgementWithinGrace(acknowledgementPromise, options.acknowledgementGraceMs) : await acknowledgementPromise;
    if (acknowledgement.passed) options.submitTransportObserver?.markAcknowledgement?.();
    const acknowledgementShapeSummary = acknowledgementShapes.stop();
    try { diagnostic?.acknowledgementShapeSummary?.(acknowledgementShapeSummary); } catch { /* observability only */ }
    const acknowledgementSemanticSummary = acknowledgementShapes.semanticSummary();
    try { diagnostic?.acknowledgementSemanticSummary?.(acknowledgementSemanticSummary); } catch { /* observability only */ }
    let transportSummary = null;
    if (composer.passed && !acknowledgement.passed) {
      transportSummary = await (options.submitTransportObserver?.snapshot?.() || options.submitTransportObserver?.stop?.());
    }
    const storyReference = validatedStoryReference(transportSummary);
    const expectedStoryToken = exactStoryVerificationToken(options.immutableText);
    let storyVerification = null;
    if (composer.passed && !acknowledgement.passed && options.clickReturned === true && options.canonicalTargetStillValid === true
      && !explicitNegativeEvidence(acknowledgementSemanticSummary, transportSummary)
      && storyReference && expectedStoryToken && typeof options.verifyStoryReference === 'function') {
      try {
        storyVerification = await options.verifyStoryReference({
          expectedTarget: options.targetCanonical,
          storyId: storyReference.opaqueId,
          expectedToken: expectedStoryToken,
          expectedBody: String(options.immutableText ?? ''),
        });
      } catch {
        storyVerification = Object.freeze({ result: STORY_REFERENCE_RESULT.INACCESSIBLE, storyId: storyReference.opaqueId, targetMatched: false, tokenMatched: false, bodyHashMatched: false });
      }
    }
    const storyExact = storyVerificationExact(storyVerification, storyReference);
    const storyPending = storyVerification?.result === STORY_REFERENCE_RESULT.PENDING && storyVerification.targetMatched === true && storyVerification.tokenMatched === true && String(storyVerification.storyId || '') === String(storyReference?.opaqueId || '');
    let targetReload = null;
    if (composer.passed && !acknowledgement.passed && options.clickReturned === true && options.canonicalTargetStillValid === true
      && !explicitNegativeEvidence(acknowledgementSemanticSummary, transportSummary) && !storyExact && !storyPending
      && typeof options.verifyRefreshedTarget === 'function') {
      options.submitTransportObserver?.markReload?.();
      targetReload = await options.verifyRefreshedTarget();
    }
    const [composerState, acknowledgementState] = await Promise.all([observeComposerState(composerDialog), observeAcknowledgement(successMessage, acknowledgement.passed)]);
    const elapsed = Math.max(0, now() - startedAt);
    const targetVerified = targetReload?.resultClass === 'VERIFIED_EXACT_TARGET_POST';
    const successful = composer.passed && (acknowledgement.passed || storyExact || targetVerified);
    const successPredicate = acknowledgement.passed ? 'BOTH_PREDICATES_PASSED' : storyExact ? 'STORY_ID_PROOF_PASSED' : targetVerified ? 'TARGET_RELOAD_PROOF_PASSED' : 'NOT_SATISFIED';
    const summary = { clickReturned: options.clickReturned === true, verificationStarted: true, verificationElapsedMs: elapsed, verificationElapsedBucket: elapsedBucket(elapsed), ...composerState, ...acknowledgementState, canonicalTargetStillValid: options.canonicalTargetStillValid === true, composerHiddenPredicate: composer.result, acknowledgementPredicate: acknowledgement.result, successPredicate: successful ? successPredicate : 'NOT_SATISFIED', failurePredicate: successful ? 'NONE' : failurePredicate(composer, acknowledgement) };
    transportSummary = await options.submitTransportObserver?.stop?.() || transportSummary;
    try { if (transportSummary) diagnostic?.submitTransportSummary?.(transportSummary); } catch { /* observability only */ }
    Object.assign(summary, classifyPostSubmitOutcome({ composerPassed: composer.passed, acknowledgementPassed: acknowledgement.passed, storyVerification, storyReference, targetReload, semanticSummary: acknowledgementSemanticSummary, transportSummary }), {
      verificationSurfaceSearched: verificationSurface(storyVerification, targetReload),
      currentLocationClassification: classifyCurrentLocation(page, options.canonicalTargetStillValid),
      storyVerificationResult: storyVerification?.result || null,
      storyTargetMatched: storyVerification?.targetMatched === true,
      storyTokenMatched: storyVerification?.tokenMatched === true,
      storyBodyMatched: storyVerification?.bodyHashMatched === true,
      pendingModerationEvidenceObserved: acknowledgementSemanticSummary.semanticSubmissionPendingObserved === true,
      explicitErrorEvidenceObserved: acknowledgementSemanticSummary.publicationFailureLikeCount > 0 || acknowledgementSemanticSummary.genericErrorLikeCount > 0 || transportSummary?.explicitFailureObserved === true,
    });
    const outcomeSuccessful = composer.passed && [POST_SUBMIT_OUTCOME.PUBLISHED_ACKNOWLEDGED, POST_SUBMIT_OUTCOME.PUBLISHED_VISIBLE_EXACT].includes(summary.outcomeClassification);
    if (!outcomeSuccessful) {
      summary.successPredicate = 'NOT_SATISFIED';
      summary.failurePredicate = failurePredicate(composer, acknowledgement);
    }
    try { diagnostic?.postSubmitVerificationSummary?.(summary); } catch { /* observability only */ }
    const postPublicationStructuralSummary = {
      ...acknowledgementShapes.structuralSummary(await observePostPublicationStructure(page, options.publishControl, composerState, options.canonicalTargetStillValid)),
      // Preserve pre-click baseline evidence even when the independent
      // acknowledgement path succeeds before a reload is needed.
      targetReloadVerification: { ...(options.preClickBaseline || {}), ...(targetReload || {}) },
    };
    try { diagnostic?.postPublicationStructuralSummary?.(postPublicationStructuralSummary); } catch { /* observability only */ }
    // This is an after-the-fact, privacy-reduced explanation of article text
    // parity. It is never consulted by either existing success predicate.
    try { diagnostic?.postCandidateTextParitySummary?.(acknowledgementShapes.textParitySummary()); } catch { /* observability only */ }
    // Bounded retained-subtree correlation is also diagnostic-only.  It runs
    // after the existing waits and cannot alter their strict success result.
    try { diagnostic?.postCandidateBodySubtreeSummary?.(acknowledgementShapes.bodySubtreeSummary()); } catch { /* observability only */ }
    return outcomeSuccessful;
  } catch (error) {
    const elapsed = Math.max(0, now() - startedAt);
    try { const transportSummary = await options.submitTransportObserver?.stop?.(); if (transportSummary) diagnostic?.submitTransportSummary?.(transportSummary); } catch { /* observability only */ }
    try { diagnostic?.postSubmitVerificationSummary?.({ clickReturned: options.clickReturned === true, verificationStarted: true, verificationElapsedMs: elapsed, verificationElapsedBucket: elapsedBucket(elapsed), retainedComposerAttached: false, retainedComposerVisible: false, composerState: 'SAFE_EVALUATION_ERROR', acknowledgementCandidateCount: 0, acknowledgementClassification: 'SAFE_EVALUATION_ERROR', canonicalTargetStillValid: options.canonicalTargetStillValid === true, composerHiddenPredicate: 'NOT_COMPLETED', acknowledgementPredicate: 'NOT_COMPLETED', successPredicate: 'NOT_SATISFIED', failurePredicate: 'VERIFICATION_ERROR' }); } catch { /* observability only */ }
    throw error;
  }
}

module.exports = {
  POST_SUBMIT_OUTCOME,
  classifyPostSubmitOutcome,
  classifyCurrentLocation,
  exactStoryVerificationToken,
  storyVerificationExact,
  verifyPostPublished,
  verifyLivePostPublished,
};
