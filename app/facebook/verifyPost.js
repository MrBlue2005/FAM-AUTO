const { createAcknowledgementShapeObserver } = require('./acknowledgementDiagnostics');

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
    const acknowledgement = composer.passed ? await acknowledgementWithinGrace(acknowledgementPromise, options.acknowledgementGraceMs) : await acknowledgementPromise;
    let targetReload = null;
    if (composer.passed && !acknowledgement.passed && options.clickReturned === true && options.canonicalTargetStillValid === true && typeof options.verifyRefreshedTarget === 'function') {
      targetReload = await options.verifyRefreshedTarget();
    }
    const [composerState, acknowledgementState] = await Promise.all([observeComposerState(composerDialog), observeAcknowledgement(successMessage, acknowledgement.passed)]);
    const elapsed = Math.max(0, now() - startedAt);
    const targetVerified = targetReload?.resultClass === 'VERIFIED_EXACT_TARGET_POST';
    const summary = { clickReturned: options.clickReturned === true, verificationStarted: true, verificationElapsedMs: elapsed, verificationElapsedBucket: elapsedBucket(elapsed), ...composerState, ...acknowledgementState, canonicalTargetStillValid: options.canonicalTargetStillValid === true, composerHiddenPredicate: composer.result, acknowledgementPredicate: acknowledgement.result, successPredicate: composer.passed && (acknowledgement.passed || targetVerified) ? acknowledgement.passed ? 'BOTH_PREDICATES_PASSED' : 'TARGET_RELOAD_PROOF_PASSED' : 'NOT_SATISFIED', failurePredicate: composer.passed && targetVerified ? 'NONE' : failurePredicate(composer, acknowledgement) };
    try { diagnostic?.postSubmitVerificationSummary?.(summary); } catch { /* observability only */ }
    const acknowledgementShapeSummary = acknowledgementShapes.stop();
    try { diagnostic?.acknowledgementShapeSummary?.(acknowledgementShapeSummary); } catch { /* observability only */ }
    const acknowledgementSemanticSummary = acknowledgementShapes.semanticSummary();
    try { diagnostic?.acknowledgementSemanticSummary?.(acknowledgementSemanticSummary); } catch { /* observability only */ }
    const postPublicationStructuralSummary = { ...acknowledgementShapes.structuralSummary(await observePostPublicationStructure(page, options.publishControl, composerState, options.canonicalTargetStillValid)), targetReloadVerification: targetReload };
    try { diagnostic?.postPublicationStructuralSummary?.(postPublicationStructuralSummary); } catch { /* observability only */ }
    // This is an after-the-fact, privacy-reduced explanation of article text
    // parity. It is never consulted by either existing success predicate.
    try { diagnostic?.postCandidateTextParitySummary?.(acknowledgementShapes.textParitySummary()); } catch { /* observability only */ }
    // Bounded retained-subtree correlation is also diagnostic-only.  It runs
    // after the existing waits and cannot alter their strict success result.
    try { diagnostic?.postCandidateBodySubtreeSummary?.(acknowledgementShapes.bodySubtreeSummary()); } catch { /* observability only */ }
    return composer.passed && (acknowledgement.passed || targetVerified);
  } catch (error) {
    const elapsed = Math.max(0, now() - startedAt);
    try { diagnostic?.postSubmitVerificationSummary?.({ clickReturned: options.clickReturned === true, verificationStarted: true, verificationElapsedMs: elapsed, verificationElapsedBucket: elapsedBucket(elapsed), retainedComposerAttached: false, retainedComposerVisible: false, composerState: 'SAFE_EVALUATION_ERROR', acknowledgementCandidateCount: 0, acknowledgementClassification: 'SAFE_EVALUATION_ERROR', canonicalTargetStillValid: options.canonicalTargetStillValid === true, composerHiddenPredicate: 'NOT_COMPLETED', acknowledgementPredicate: 'NOT_COMPLETED', successPredicate: 'NOT_SATISFIED', failurePredicate: 'VERIFICATION_ERROR' }); } catch { /* observability only */ }
    throw error;
  }
}

module.exports = {
  verifyPostPublished,
  verifyLivePostPublished,
};
