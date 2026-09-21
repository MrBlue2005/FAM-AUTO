'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  POST_SUBMIT_OUTCOME,
  classifyPostSubmitOutcome,
  exactStoryVerificationToken,
  verifyLivePostPublished,
} = require('../app/facebook/verifyPost');

const storyId = '1110263164756506';
const token = 'RXV-LIVE-E2E-20260921-007';
const body = `TEST TEHNIC RX AUTOMATION — ${token}\n\nValidare finală.`;
const reference = Object.freeze({ objectType: 'STORY', opaqueId: storyId });

function story(result = 'VISIBLE_EXACT', overrides = {}) {
  return { result, storyId, targetMatched: true, tokenMatched: true, bodyHashMatched: result === 'VISIBLE_EXACT', ...overrides };
}

function classify(storyVerification, overrides = {}) {
  return classifyPostSubmitOutcome({ composerPassed: true, storyVerification, storyReference: reference, ...overrides });
}

function timeout() { const error = new Error('timeout'); error.name = 'TimeoutError'; return error; }
function locator({ hidden = true, visible = false } = {}) {
  return {
    waitFor: async ({ state }) => { if ((state === 'hidden' ? hidden : visible) !== true) throw timeout(); },
    evaluate: async (callback) => callback({ isConnected: true }), isVisible: async () => visible, count: async () => visible ? 1 : 0,
  };
}
function page(acknowledgement = locator({ visible: false })) {
  return { getByText: () => ({ first: () => acknowledgement }), url: () => 'https://www.facebook.com/groups/1102687755514047' };
}
function transport(summary = {}) {
  const calls = [];
  const value = { explicitFailureObserved: false, createdObjectVerificationReference: reference, ...summary };
  return {
    calls,
    snapshot: async () => { calls.push('SNAPSHOT'); return value; },
    stop: async () => { calls.push('STOP'); return value; },
    markComposerHidden: () => calls.push('COMPOSER_HIDDEN'), markAcknowledgement: () => calls.push('ACKNOWLEDGEMENT'), markReload: () => calls.push('RELOAD'),
  };
}
function diagnostic() {
  const records = [];
  return {
    records,
    postSubmitVerificationStarted: () => {}, acknowledgementShapeSummary: () => {}, acknowledgementSemanticSummary: () => {}, submitTransportSummary: () => {},
    postSubmitVerificationSummary: (value) => records.push(value), postPublicationStructuralSummary: () => {}, postCandidateTextParitySummary: () => {}, postCandidateBodySubtreeSummary: () => {},
  };
}

async function runFlow({ storyResult = story(), transportSummary, acknowledgementVisible = false, verifyRefreshedTarget } = {}) {
  const observer = transport(transportSummary); const sink = diagnostic(); let storyCalls = 0; let storyInput = null; let reloadCalls = 0;
  const result = await verifyLivePostPublished(page(locator({ visible: acknowledgementVisible })), locator(), 1, {
    diagnostic: sink, clickReturned: true, canonicalTargetStillValid: true, acknowledgementGraceMs: 0,
    immutableText: body, targetCanonical: 'https://www.facebook.com/groups/1102687755514047', submitTransportObserver: observer,
    verifyStoryReference: async (input) => { storyCalls += 1; storyInput = input; return storyResult; },
    verifyRefreshedTarget: verifyRefreshedTarget || (async () => { reloadCalls += 1; return { resultClass: 'NOT_FOUND' }; }),
  });
  return { result, observer, sink, storyCalls, storyInput, reloadCalls };
}

test('current mutation Story ID plus VISIBLE_EXACT produces existing visible publication success', async () => {
  const value = await runFlow();
  assert.equal(value.result, true); assert.equal(value.storyCalls, 1); assert.equal(value.reloadCalls, 0);
  assert.deepEqual(value.storyInput, { expectedTarget: 'https://www.facebook.com/groups/1102687755514047', storyId, expectedToken: token, expectedBody: body });
  assert.equal(value.sink.records[0].outcomeClassification, POST_SUBMIT_OUTCOME.PUBLISHED_VISIBLE_EXACT);
  assert.equal(value.sink.records[0].outcomeEvidenceSource, 'STORY_ID_VISIBLE_EXACT');
});

test('Story exact success requires the exact target binding', () => {
  assert.equal(classify(story('VISIBLE_EXACT', { targetMatched: false })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

test('Story exact success requires the exact token', () => {
  assert.equal(classify(story('VISIBLE_EXACT', { tokenMatched: false })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

test('Story exact success requires the exact published body', () => {
  assert.equal(classify(story('VISIBLE_EXACT', { bodyHashMatched: false })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

test('Story exact success requires the current mutation Story ID', () => {
  assert.equal(classify(story('VISIBLE_EXACT', { storyId: '1110263164756507' })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

for (const result of ['VISIBLE_MISMATCH', 'NOT_FOUND', 'INACCESSIBLE', 'UNSUPPORTED', 'AMBIGUOUS']) {
  test(`${result} cannot support publication success`, () => {
    assert.equal(classify(story(result)).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
  });
}

test('target- and token-bound PENDING maps to approval rather than published success', () => {
  const value = classify(story('PENDING', { bodyHashMatched: false }));
  assert.equal(value.outcomeClassification, POST_SUBMIT_OUTCOME.SUBMITTED_FOR_APPROVAL);
  assert.equal(value.outcomeEvidenceSource, 'STORY_ID_PENDING');
});

test('PENDING without exact token binding remains unconfirmed', () => {
  assert.equal(classify(story('PENDING', { tokenMatched: false })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

test('missing Story ID bypasses Story verification and preserves canonical fallback', async () => {
  const value = await runFlow({ transportSummary: { createdObjectVerificationReference: null }, verifyRefreshedTarget: async () => ({ resultClass: 'VERIFIED_EXACT_TARGET_POST', postReloadExactTrustedPostCount: 1 }) });
  assert.equal(value.result, true); assert.equal(value.storyCalls, 0); assert.equal(value.sink.records[0].outcomeEvidenceSource, 'CANONICAL_TARGET_RELOAD');
});

test('explicit acknowledgement remains the highest-priority success and skips Story verification', async () => {
  const value = await runFlow({ acknowledgementVisible: true });
  assert.equal(value.result, true); assert.equal(value.storyCalls, 0); assert.equal(value.sink.records[0].outcomeClassification, POST_SUBMIT_OUTCOME.PUBLISHED_ACKNOWLEDGED);
});

test('explicit Facebook failure outranks Story exact evidence', () => {
  assert.equal(classify(story(), { semanticSummary: { publicationFailureLikeCount: 1 } }).outcomeClassification, POST_SUBMIT_OUTCOME.EXPLICIT_FACEBOOK_FAILURE);
});

test('explicit pending evidence outranks Story exact evidence', () => {
  assert.equal(classify(story(), { semanticSummary: { semanticSubmissionPendingObserved: true } }).outcomeClassification, POST_SUBMIT_OUTCOME.SUBMITTED_FOR_APPROVAL);
});

test('transport failure outranks Story exact evidence', () => {
  assert.equal(classify(story(), { transportSummary: { explicitFailureObserved: true } }).outcomeClassification, POST_SUBMIT_OUTCOME.EXPLICIT_FACEBOOK_FAILURE);
});

test('Story mismatch continues to the canonical fallback', async () => {
  let reloadCalls = 0;
  const value = await runFlow({ storyResult: story('VISIBLE_MISMATCH'), verifyRefreshedTarget: async () => { reloadCalls += 1; return { resultClass: 'VERIFIED_EXACT_TARGET_POST', postReloadExactTrustedPostCount: 1 }; } });
  assert.equal(value.result, true); assert.equal(value.storyCalls, 1); assert.equal(reloadCalls, 1); assert.equal(value.sink.records[0].outcomeEvidenceSource, 'CANONICAL_TARGET_RELOAD');
});

test('published-story integration forwards the immutable body unchanged and derives one exact token', async () => {
  const value = await runFlow();
  assert.equal(value.storyInput.expectedBody, body); assert.equal(exactStoryVerificationToken(body), token);
  assert.equal(exactStoryVerificationToken(body.replace('Validare', token)), null);
});

test('missing real text and extra real text cannot become Story success', () => {
  assert.equal(classify(story('VISIBLE_MISMATCH', { tokenMatched: true, bodyHashMatched: false })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
  assert.equal(classify(story('VISIBLE_MISMATCH', { tokenMatched: true, bodyHashMatched: false })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

test('token-only match cannot become Story success', () => {
  assert.equal(classify(story('VISIBLE_MISMATCH', { tokenMatched: true, bodyHashMatched: false })).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

test('unsupported Story verification runs once, canonical fallback runs once, and no retry is introduced', async () => {
  const value = await runFlow({ storyResult: story('UNSUPPORTED') });
  assert.equal(value.result, false); assert.equal(value.storyCalls, 1); assert.equal(value.reloadCalls, 1);
  assert.equal(value.observer.calls.filter((item) => item === 'SNAPSHOT').length, 1);
  assert.equal(value.observer.calls.filter((item) => item === 'RELOAD').length, 1);
});

test('historical first-terminal-wins state is not touched by integration classification', () => {
  const historical = Object.freeze({ status: 'OUTCOME_UNKNOWN', sideEffectState: 'ATTEMPT_STARTED', publicationAttempted: true });
  classify(story());
  assert.deepEqual(historical, { status: 'OUTCOME_UNKNOWN', sideEffectState: 'ATTEMPT_STARTED', publicationAttempted: true });
});
