'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { verifyLivePostPublished } = require('../app/facebook/verifyPost');
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
    postSubmitClickStarted: (value) => records.push({ stage: 'CLICK_START', value }),
    postSubmitClickReturned: (value) => records.push({ stage: 'CLICK_RETURNED', value }),
    postSubmitClickFailed: (value) => records.push({ stage: 'CLICK_FAILED', value }),
  };
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
