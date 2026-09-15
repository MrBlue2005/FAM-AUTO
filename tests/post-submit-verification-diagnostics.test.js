'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { verifyLivePostPublished } = require('../app/facebook/verifyPost');
const { createAcknowledgementShapeObserver, classifyAcknowledgementSemanticText } = require('../app/facebook/acknowledgementDiagnostics');
const { submitScopedPublishControl } = require('../app/local-agent/RealFacebookPublisherAdapter');
const { createComposerAcquisitionDiagnosticSink } = require('../app/local-agent/ComposerAcquisitionDiagnostics');

function timeout() { const error = new Error('timeout'); error.name = 'TimeoutError'; return error; }
function locator({ hidden = true, visible = false, attached = true, count = 1 } = {}) {
  return {
    waitFor: async ({ state }) => {
      const passed = state === 'hidden' ? hidden : visible;
      if (!passed) throw timeout();
    },
    evaluate: async (callback) => callback({ isConnected: attached }),
    isVisible: async () => visible,
    count: async () => count,
  };
}
function page(acknowledgement) { return { getByText: () => ({ first: () => acknowledgement }) }; }
function diagnostic() {
  const records = [];
  return {
    records,
    postSubmitVerificationStarted: (value) => records.push({ stage: 'START', value }),
    postSubmitVerificationSummary: (value) => records.push({ stage: 'SUMMARY', value }),
    acknowledgementShapeSummary: (value) => records.push({ stage: 'ACK_SHAPE_SUMMARY', value }),
    acknowledgementSemanticSummary: (value) => records.push({ stage: 'ACK_SEMANTIC_SUMMARY', value }),
    postPublicationStructuralSummary: (value) => records.push({ stage: 'POST_PUBLICATION_STRUCTURAL_SUMMARY', value }),
    postSubmitClickStarted: (value) => records.push({ stage: 'CLICK_START', value }),
    postSubmitClickReturned: (value) => records.push({ stage: 'CLICK_RETURNED', value }),
    postSubmitClickFailed: (value) => records.push({ stage: 'CLICK_FAILED', value }),
  };
}

function acknowledgementCandidate(overrides = {}) {
  return {
    key: overrides.key || 'candidate', candidateFamily: 'OTHER_SAFE_ACK_SURFACE', tagName: 'DIV', role: null,
    visible: true, attached: true, ariaLive: 'NONE', textClassification: 'NON_MATCHING_TEXT_PRESENT',
    accessibilityClassification: 'EMPTY_OR_UNAVAILABLE', nestedTextPresent: false, candidateDepth: 4, ...overrides,
  };
}

async function acknowledgementSummary(snapshots) {
  let index = 0; let clock = 0;
  const observer = createAcknowledgementShapeObserver(null, {
    now: () => clock,
    capture: async () => ({ result: 'AVAILABLE', candidates: snapshots[index++] || [] }),
    schedule: () => 0, cancel: () => {},
  });
  while (index < snapshots.length) { await observer.observe(); clock += 1000; }
  const shape = observer.stop();
  return { shape, semantic: observer.semanticSummary() };
}
function summary(records) { return records.find((record) => record.stage === 'SUMMARY')?.value; }
function assertSummary(records, expected) {
  const actual = summary(records); assert.ok(actual);
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, key);
}

test('post-submit summary records strict success without changing both-predicate semantics', async () => {
  const sink = diagnostic();
  assert.equal(await verifyLivePostPublished(page(locator({ visible: true })), locator({ hidden: true, visible: false }), 120000, { diagnostic: sink, clickReturned: true, canonicalTargetStillValid: true }), true);
  assertSummary(sink.records, {
    clickReturned: true, canonicalTargetStillValid: true, composerState: 'ATTACHED_HIDDEN',
    acknowledgementClassification: 'MATCH_FOUND', composerHiddenPredicate: 'PASSED', acknowledgementPredicate: 'PASSED',
    successPredicate: 'BOTH_PREDICATES_PASSED', failurePredicate: 'NONE',
  });
  assert.ok(sink.records.some((record) => record.stage === 'ACK_SEMANTIC_SUMMARY'));
});

test('post-submit summary distinguishes acknowledgement timeout from composer-hidden success', async () => {
  const sink = diagnostic();
  assert.equal(await verifyLivePostPublished(page(locator({ visible: false, count: 0 })), locator({ hidden: true, visible: false }), 120000, { diagnostic: sink }), false);
  assertSummary(sink.records, { composerHiddenPredicate: 'PASSED', acknowledgementPredicate: 'FAILED_TIMEOUT', failurePredicate: 'ACKNOWLEDGEMENT_NOT_OBSERVED', acknowledgementClassification: 'NONE' });
});

test('post-submit summary distinguishes a visible retained composer from acknowledgement success', async () => {
  const sink = diagnostic();
  assert.equal(await verifyLivePostPublished(page(locator({ visible: true })), locator({ hidden: false, visible: true }), 120000, { diagnostic: sink }), false);
  assertSummary(sink.records, { composerState: 'ATTACHED_VISIBLE', composerHiddenPredicate: 'FAILED_TIMEOUT', acknowledgementPredicate: 'PASSED', failurePredicate: 'COMPOSER_NOT_HIDDEN' });
});

test('post-submit summary records both predicate timeouts', async () => {
  const sink = diagnostic();
  assert.equal(await verifyLivePostPublished(page(locator({ visible: false, count: 0 })), locator({ hidden: false, visible: true }), 120000, { diagnostic: sink }), false);
  assertSummary(sink.records, { composerHiddenPredicate: 'FAILED_TIMEOUT', acknowledgementPredicate: 'FAILED_TIMEOUT', failurePredicate: 'BOTH_FAILED' });
});

test('a detached composer remains a passed hidden predicate and is classified safely', async () => {
  const sink = diagnostic();
  assert.equal(await verifyLivePostPublished(page(locator({ visible: true })), locator({ hidden: true, visible: false, attached: false }), 120000, { diagnostic: sink }), true);
  assertSummary(sink.records, { composerState: 'DETACHED', composerHiddenPredicate: 'PASSED', successPredicate: 'BOTH_PREDICATES_PASSED' });
});

test('click failure records CLICK_FAILED without starting verification', async () => {
  const sink = diagnostic();
  await assert.rejects(submitScopedPublishControl({ click: async () => { throw new Error('private Facebook failure'); } }, sink), /private Facebook failure/);
  assert.equal(sink.records.some((record) => record.stage === 'START'), false);
  assertSummary(sink.records, { clickReturned: false, verificationStarted: false, failurePredicate: 'CLICK_FAILED' });
});

test('click return emits only the fixed started and returned records', async () => {
  const sink = diagnostic(); let clicks = 0;
  assert.equal(await submitScopedPublishControl({ click: async () => { clicks += 1; } }, sink), true);
  assert.equal(clicks, 1);
  assert.deepEqual(sink.records.map((record) => record.stage), ['CLICK_START', 'CLICK_RETURNED']);
  assert.equal(sink.records[1].value.clickReturned, true);
});

test('verification setup errors retain only the fixed VERIFICATION_ERROR classification', async () => {
  const sink = diagnostic();
  await assert.rejects(verifyLivePostPublished({ getByText: () => { throw new Error('private page text'); } }, locator(), 120000, { diagnostic: sink, clickReturned: true }), /private page text/);
  assertSummary(sink.records, { failurePredicate: 'VERIFICATION_ERROR', composerHiddenPredicate: 'NOT_COMPLETED', acknowledgementPredicate: 'NOT_COMPLETED' });
});

test('post-submit sink redacts raw Facebook material and protects the terminal summary under pressure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-post-submit-diagnostic-'));
  try {
    const taskId = 'live_execution_post_submit_diagnostic';
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 4, maxBytes: 2048, now: () => '2026-09-15T00:00:00.000Z' }).forTask(taskId);
    for (let index = 0; index < 12; index += 1) sink.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index } });
    sink.postSubmitVerificationSummary({
      clickReturned: true, verificationStarted: true, verificationElapsedMs: 120000, verificationElapsedBucket: 'AT_OR_OVER_TIMEOUT',
      retainedComposerAttached: true, retainedComposerVisible: true, composerState: 'ATTACHED_VISIBLE',
      acknowledgementCandidateCount: 1, acknowledgementClassification: 'CANDIDATES_PRESENT_NO_MATCH', canonicalTargetStillValid: true,
      composerHiddenPredicate: 'FAILED_TIMEOUT', acknowledgementPredicate: 'FAILED_TIMEOUT', successPredicate: 'NOT_SATISFIED', failurePredicate: 'BOTH_FAILED',
      rawText: 'private Facebook text', url: 'https://facebook.example/private', ariaLabel: 'private label',
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, `${taskId}.json`), 'utf8'));
    const terminal = persisted.records.find((record) => record.stage === 'POST_SUBMIT_VERIFICATION_DIAGNOSTIC_SUMMARY');
    assert.ok(terminal); assert.equal(terminal.postSubmitVerification.failurePredicate, 'BOTH_FAILED');
    assert.doesNotMatch(JSON.stringify(persisted), /private Facebook text|facebook\.example|private label/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('acknowledgement observation classifies current text, status, alert, aria-live, accessibility-only and nested candidates without changing matcher parity', async () => {
  const { shape: summary } = await acknowledgementSummary([[
    acknowledgementCandidate({ key: 'text', candidateFamily: 'CURRENT_TEXT_MATCH', textClassification: 'MATCHES_CURRENT_ACK_PATTERN' }),
    acknowledgementCandidate({ key: 'status', candidateFamily: 'ROLE_STATUS', role: 'status' }),
    acknowledgementCandidate({ key: 'alert', candidateFamily: 'ROLE_ALERT', role: 'alert' }),
    acknowledgementCandidate({ key: 'live', candidateFamily: 'ARIA_LIVE_REGION', ariaLive: 'POLITE' }),
    acknowledgementCandidate({ key: 'accessibility', accessibilityClassification: 'MATCHES_CURRENT_ACK_PATTERN' }),
    acknowledgementCandidate({ key: 'nested', nestedTextPresent: true }),
  ]]);
  assert.equal(summary.totalDistinctCandidatesObserved, 6);
  assert.equal(summary.currentMatcherWouldHaveMatched, true); assert.equal(summary.exactCurrentMatcherResult, 'MATCHED');
  assert.equal(summary.roleStatusObservationCount, 1); assert.equal(summary.roleAlertObservationCount, 1); assert.equal(summary.ariaLiveObservationCount, 1);
  assert.equal(summary.accessibilityPatternMatchObservationCount, 1); assert.equal(summary.candidates.find((item) => item.candidateFamily === 'CURRENT_TEXT_MATCH').textClassification, 'MATCHES_CURRENT_ACK_PATTERN');
  assert.equal(summary.candidates.find((item) => item.nestedTextPresent).nestedTextPresent, true);
});

test('acknowledgement observation records a transient candidate and excludes unrelated controls from the supplied structural discovery', async () => {
  const { shape: summary } = await acknowledgementSummary([[acknowledgementCandidate({ key: 'transient', candidateFamily: 'ROLE_STATUS', role: 'status' })], [], []]);
  assert.equal(summary.transientCandidateCount, 1); assert.equal(summary.totalDistinctCandidatesObserved, 1);
  const { shape: unrelated } = await acknowledgementSummary([[]]);
  assert.equal(unrelated.totalDistinctCandidatesObserved, 0); assert.equal(unrelated.exactCurrentMatcherResult, 'NO_MATCH');
});

test('acknowledgement-shape persistence redacts raw content and protects the bounded terminal summary', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-ack-shape-diagnostic-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 4, maxBytes: 2048, now: () => '2026-09-15T00:00:00.000Z' }).forTask('live_execution_ack_shape');
    for (let index = 0; index < 12; index += 1) sink.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index } });
    sink.acknowledgementShapeSummary({ totalDistinctCandidatesObserved: 1, currentPatternMatchObservationCount: 0, accessibilityPatternMatchObservationCount: 1, roleStatusObservationCount: 1, roleAlertObservationCount: 0, ariaLiveObservationCount: 1, transientCandidateCount: 1, candidatesVisibleAtVerificationStart: 1, candidatesObservedAfterVerificationStart: 0, structurallyAckLikeButPatternMismatchCount: 1, currentMatcherWouldHaveMatched: false, exactCurrentMatcherResult: 'NO_MATCH', candidates: [{ ...acknowledgementCandidate({ key: 'private', role: 'status', ariaLive: 'POLITE' }), rawText: 'private Facebook acknowledgement', ariaLabel: 'private accessible name', url: 'https://facebook.example/private' }] });
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'live_execution_ack_shape.json'), 'utf8'));
    const terminal = persisted.records.find((record) => record.stage === 'ACKNOWLEDGEMENT_SHAPE_DIAGNOSTIC_SUMMARY');
    assert.ok(terminal); assert.equal(terminal.acknowledgementShape.candidates[0].role, 'status');
    assert.doesNotMatch(JSON.stringify(persisted), /private Facebook acknowledgement|private accessible name|facebook\.example/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('acknowledgement semantic classifier recognizes Romanian and English publication success only with publication context', () => {
  const romanian = classifyAcknowledgementSemanticText('Postarea ta a fost publicată cu succes.', '');
  const english = classifyAcknowledgementSemanticText('Your post was published successfully.', '');
  assert.equal(romanian.semanticClassification, 'PUBLICATION_SUCCESS_LIKE');
  assert.equal(romanian.languageClassification, 'RO');
  assert.equal(english.semanticClassification, 'PUBLICATION_SUCCESS_LIKE');
  assert.equal(english.languageClassification, 'EN');
});

test('acknowledgement semantic classifier separates generic, unrelated, failure, error, and empty notices', () => {
  assert.equal(classifyAcknowledgementSemanticText('Operation completed successfully.', '').semanticClassification, 'GENERIC_SUCCESS_LIKE');
  assert.equal(classifyAcknowledgementSemanticText('You have a new notification.', '').semanticClassification, 'UNRELATED_NOTIFICATION_LIKE');
  assert.equal(classifyAcknowledgementSemanticText('Postarea nu s-a putut fi publicată.', '').semanticClassification, 'PUBLICATION_FAILURE_LIKE');
  assert.equal(classifyAcknowledgementSemanticText('Something went wrong.', '').semanticClassification, 'GENERIC_ERROR_LIKE');
  assert.equal(classifyAcknowledgementSemanticText('', '').semanticClassification, 'EMPTY_OR_UNAVAILABLE');
});

test('semantic observer retains role-alert aria-live publication success and its transient timing without changing matcher authority', async () => {
  const { semantic } = await acknowledgementSummary([[
    acknowledgementCandidate({
      key: 'alert', candidateFamily: 'ROLE_ALERT', role: 'alert', ariaLive: 'POLITE',
      semanticText: 'Your post was published successfully.',
    }),
  ], [], []]);
  assert.equal(semantic.publicationSuccessLikeCount, 1);
  assert.equal(semantic.roleAlertPublicationSuccessLikeCount, 1);
  assert.equal(semantic.ariaLivePublicationSuccessLikeCount, 1);
  assert.equal(semantic.transientPublicationSuccessLikeCount, 1);
  assert.equal(semantic.currentMatcherMatched, false);
  assert.equal(semantic.semanticPublicationSuccessObserved, true);
  assert.deepEqual(semantic.candidates[0], {
    candidateFamily: 'ROLE_ALERT', role: 'alert', ariaLive: 'POLITE', visible: true, attached: true,
    semanticClassification: 'PUBLICATION_SUCCESS_LIKE', languageClassification: 'EN',
    hasPublicationConcept: true, hasSuccessConcept: true, hasFailureConcept: false,
    hasPostObjectConcept: true, hasGroupConcept: false, hasRetryConcept: false, hasErrorConcept: false,
    firstObservedRelativeBucket: 'UNDER_1S', lastObservedRelativeBucket: 'UNDER_1S', observationCount: 1, transient: true,
  });
});

test('semantic acknowledgement persistence redacts text material and retains protected terminal summary under pressure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-ack-semantic-diagnostic-'));
  try {
    const taskId = 'live_execution_ack_semantic';
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 4, maxBytes: 2048, now: () => '2026-09-15T00:00:00.000Z' }).forTask(taskId);
    for (let index = 0; index < 12; index += 1) sink.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index } });
    sink.acknowledgementSemanticSummary({
      totalSemanticCandidates: 1, publicationSuccessLikeCount: 1, languageENObserved: true,
      publicationConceptObserved: true, successConceptObserved: true, postObjectConceptObserved: true,
      semanticPublicationSuccessObserved: true,
      candidates: [{
        candidateFamily: 'ROLE_ALERT', role: 'alert', ariaLive: 'POLITE', visible: true, attached: true,
        semanticClassification: 'PUBLICATION_SUCCESS_LIKE', languageClassification: 'EN',
        hasPublicationConcept: true, hasSuccessConcept: true, hasPostObjectConcept: true,
        firstObservedRelativeBucket: 'UNDER_1S', lastObservedRelativeBucket: 'UNDER_5S', observationCount: 2, transient: true,
        rawText: 'private acknowledgement token 123', normalizedText: 'private acknowledgement token 123', textHash: 'abc123', ariaLabel: 'private name', url: 'https://facebook.example/private',
      }],
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, `${taskId}.json`), 'utf8'));
    const terminal = persisted.records.find((record) => record.stage === 'ACKNOWLEDGEMENT_SEMANTIC_DIAGNOSTIC_SUMMARY');
    assert.ok(terminal); assert.equal(terminal.acknowledgementSemantic.publicationSuccessLikeCount, 1);
    assert.equal(terminal.acknowledgementSemantic.candidates[0].semanticClassification, 'PUBLICATION_SUCCESS_LIKE');
    assert.doesNotMatch(JSON.stringify(persisted), /private acknowledgement|token 123|abc123|private name|facebook\.example/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('post-publication structural summary classifies safe acknowledgement sources and containers', async () => {
  let index = 0; let clock = 0;
  const observer = createAcknowledgementShapeObserver(null, {
    now: () => clock,
    capture: async () => ({ result: 'AVAILABLE', candidates: [
      acknowledgementCandidate({ key: 'status', candidateFamily: 'ROLE_STATUS', role: 'status', accessibleNameSource: 'TEXT_CONTENT', textSource: 'DIRECT_TEXT_NODE', semanticContainer: 'STATUS_CONTAINER_LIKE' }),
      acknowledgementCandidate({ key: 'alert', candidateFamily: 'ROLE_ALERT', role: 'alert', accessibleNameSource: 'DESCENDANT_TEXT', textSource: 'DESCENDANT_TEXT', semanticContainer: 'ALERT_CONTAINER_LIKE', dialogAncestor: true, nearestSemanticAncestor: 'DIALOG' }),
      acknowledgementCandidate({ key: 'live', candidateFamily: 'ARIA_LIVE_REGION', ariaLive: 'POLITE', semanticContainer: 'LIVE_REGION_LIKE', liveRegionAncestor: true }),
      acknowledgementCandidate({ key: 'generic', semanticContainer: 'GENERIC_CONTAINER' }),
    ], articles: [] }), schedule: () => 0, cancel: () => {},
  });
  await observer.observe(); clock += 1000;
  const structural = observer.structuralSummary({ composerState: 'ATTACHED_HIDDEN', retainedComposerAttached: true, retainedComposerVisible: false, targetCanonicalValid: true, dialogCountBucket: 'ONE', visibleDialogCountBucket: 'ZERO' });
  assert.equal(structural.statusContainerLikeCount, 1); assert.equal(structural.alertContainerLikeCount, 1); assert.equal(structural.liveRegionLikeCount, 1);
  assert.equal(structural.accessibleNameFromTextCount, 2); assert.equal(structural.structuralSuccessEvidenceClass, 'COMPOSER_ONLY');
  assert.equal(structural.acknowledgementCandidates.find((candidate) => candidate.role === 'alert').nearestSemanticAncestor, 'DIALOG');
});

test('post-publication structural summary distinguishes new article structure, immutable text parity, wrong text, and pre-existing articles', async () => {
  let clock = 0; let index = 0;
  const observer = createAcknowledgementShapeObserver(null, {
    now: () => clock,
    capture: async () => ({ result: 'AVAILABLE', candidates: [], articles: [
      { key: 'existing', candidateFamily: 'ARTICLE_ROLE', visible: true, attached: true, containsTextSurface: true, containsMediaSurface: false, containsTimestampLikeSurface: true, containsActionBarLikeSurface: true, immutableTextExactMatch: false },
      ...(index++ ? [{ key: 'new-match', candidateFamily: 'POST_CONTAINER_LIKE', visible: true, attached: true, containsTextSurface: true, containsMediaSurface: false, containsTimestampLikeSurface: true, containsActionBarLikeSurface: true, immutableTextExactMatch: true }, { key: 'new-wrong', candidateFamily: 'ARTICLE_ROLE', visible: true, attached: true, containsTextSurface: true, containsMediaSurface: false, containsTimestampLikeSurface: false, containsActionBarLikeSurface: true, immutableTextExactMatch: false }] : []),
    ] }), schedule: () => 0, cancel: () => {},
  });
  await observer.observe(); clock += 1000; await observer.observe();
  const structural = observer.structuralSummary({ composerState: 'ATTACHED_HIDDEN' });
  assert.equal(structural.newArticleLikeCandidateObservedAfterClick, true);
  assert.equal(structural.immutableTextExactMatchCandidateCount, 1);
  assert.equal(structural.exactImmutableTextCandidateObservedAfterClick, true);
  assert.equal(structural.structuralSuccessEvidenceClass, 'IMMUTABLE_TEXT_POST_CANDIDATE');
  assert.equal(structural.articleCandidates.find((candidate) => candidate.candidateFamily === 'ARTICLE_ROLE').immutableTextExactMatch, false);
});

test('post-publication structural persistence redacts raw text and remains protected under pressure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-post-publication-structural-'));
  try {
    const taskId = 'live_execution_post_publication_structural';
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 4, maxBytes: 4096, now: () => '2026-09-15T00:00:00.000Z' }).forTask(taskId);
    for (let index = 0; index < 12; index += 1) sink.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index } });
    sink.postPublicationStructuralSummary({ ackSurfaceCount: 1, composerHiddenObserved: true, targetCanonicalStillValid: true, structuralSuccessEvidenceClass: 'COMPOSER_ONLY', pageState: { composerState: 'ATTACHED_HIDDEN' }, acknowledgementCandidates: [{ role: 'alert', rawText: 'private Facebook text', ariaLabel: 'private accessible name' }], articleCandidates: [{ candidateFamily: 'ARTICLE_ROLE', immutableTextExactMatch: true, rawText: 'private post text', hash: 'secret-hash' }] });
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, `${taskId}.json`), 'utf8'));
    const terminal = persisted.records.find((record) => record.stage === 'POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY');
    assert.ok(terminal); assert.equal(terminal.postPublicationStructural.structuralSuccessEvidenceClass, 'COMPOSER_ONLY');
    assert.doesNotMatch(JSON.stringify(persisted), /private Facebook text|private accessible name|private post text|secret-hash/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
