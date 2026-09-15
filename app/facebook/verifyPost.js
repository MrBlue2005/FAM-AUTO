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

function failurePredicate(composer, acknowledgement) {
  if (composer.passed && acknowledgement.passed) return 'NONE';
  if (!composer.passed && !acknowledgement.passed) return 'BOTH_FAILED';
  return composer.passed ? 'ACKNOWLEDGEMENT_NOT_OBSERVED' : 'COMPOSER_NOT_HIDDEN';
}

// Diagnostics are observational only. The two existing Playwright waits, their
// timeout, and the strict AND success requirement remain exactly unchanged.
async function verifyLivePostPublished(page, composerDialog, timeout = 120000, options = {}) {
  const diagnostic = options.diagnostic; const now = typeof options.now === 'function' ? options.now : () => Date.now(); const startedAt = now();
  try { diagnostic?.postSubmitVerificationStarted?.({ verificationTimeoutMs: timeout, composerHiddenPredicateEnabled: true, acknowledgementPredicateEnabled: true }); } catch { /* observability only */ }
  try {
    const successMessage = page.getByText(/postarea (ta )?(a fost|este acum) publicat[ăa]|your post (was|is now) published/i).first();
    // Starts without awaiting: this cannot delay, replace, or broaden either
    // existing verification predicate.
    const acknowledgementShapes = createAcknowledgementShapeObserver(page, { now, capture: options.captureAcknowledgementShapes, schedule: options.scheduleAcknowledgementObservation, cancel: options.cancelAcknowledgementObservation });
    acknowledgementShapes.start();
    const [composer, acknowledgement] = await Promise.all([waitPredicate(composerDialog, 'hidden', timeout), waitPredicate(successMessage, 'visible', timeout)]);
    const [composerState, acknowledgementState] = await Promise.all([observeComposerState(composerDialog), observeAcknowledgement(successMessage, acknowledgement.passed)]);
    const elapsed = Math.max(0, now() - startedAt);
    const summary = { clickReturned: options.clickReturned === true, verificationStarted: true, verificationElapsedMs: elapsed, verificationElapsedBucket: elapsedBucket(elapsed), ...composerState, ...acknowledgementState, canonicalTargetStillValid: options.canonicalTargetStillValid === true, composerHiddenPredicate: composer.result, acknowledgementPredicate: acknowledgement.result, successPredicate: composer.passed && acknowledgement.passed ? 'BOTH_PREDICATES_PASSED' : 'NOT_SATISFIED', failurePredicate: failurePredicate(composer, acknowledgement) };
    try { diagnostic?.postSubmitVerificationSummary?.(summary); } catch { /* observability only */ }
    const acknowledgementShapeSummary = acknowledgementShapes.stop();
    try { diagnostic?.acknowledgementShapeSummary?.(acknowledgementShapeSummary); } catch { /* observability only */ }
    const acknowledgementSemanticSummary = acknowledgementShapes.semanticSummary();
    try { diagnostic?.acknowledgementSemanticSummary?.(acknowledgementSemanticSummary); } catch { /* observability only */ }
    return composer.passed && acknowledgement.passed;
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
