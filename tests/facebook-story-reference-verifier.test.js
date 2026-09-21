'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_STORY_REFERENCE_CANDIDATES,
  MAX_STORY_REFERENCE_NODES,
  STORY_REFERENCE_RESULT,
  storyReferenceUrls,
  verifyFacebookStoryReference,
} = require('../app/facebook/storyReferenceVerifier');

const target = 'https://www.facebook.com/groups/1102687755514047';
const storyId = '1110263164756506';
const token = 'RXV-LIVE-E2E-20260921-007';
const body = `TEST TEHNIC RX AUTOMATION — ${token}\n\nValidare finală.`;

function observation(overrides = {}) {
  return { routeSupported: true, targetMatched: true, storyPathMatched: true, storyBoundCandidateCount: 1, visibleStoryBoundCandidateCount: 1, exactTokenCandidateCount: 1, exactBodyCandidateCount: 1, nodesInspected: 24, ...overrides };
}

function fixture(values) {
  const calls = []; const queue = [...values];
  const page = {
    goto: async (url) => { calls.push(['goto', url]); },
    evaluate: async () => { throw new Error('default capture must be replaced'); },
    waitForTimeout: async () => { calls.push(['wait']); },
    click: async () => { throw new Error('mutation unavailable'); },
    fill: async () => { throw new Error('mutation unavailable'); },
    type: async () => { throw new Error('mutation unavailable'); },
  };
  const capture = async (_page, input) => ({ ...queue.shift(), pathClass: input.pathClass });
  return { page, calls, capture };
}

const verify = async (values, overrides = {}) => {
  const f = fixture(values);
  const result = await verifyFacebookStoryReference(f.page, { expectedTarget: target, storyId, expectedToken: token, expectedBody: body, ...overrides }, { capture: f.capture, settleMs: 0, now: () => Date.parse('2026-09-21T20:00:00Z') });
  return { result, calls: f.calls };
};

test('Story ID resolves to the exact intended target-bound post', async () => {
  const { result } = await verify([observation()]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.VISIBLE_EXACT); assert.equal(result.targetMatched, true); assert.equal(result.bodyHashMatched, true);
});

test('Story ID resolving outside the intended target is unsupported', async () => {
  const { result } = await verify([observation({ targetMatched: false })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.UNSUPPORTED);
});

test('visible Story ID with wrong exact body or token is a mismatch', async () => {
  const { result } = await verify([observation({ exactBodyCandidateCount: 0 })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.VISIBLE_MISMATCH); assert.equal(result.bodyHashMatched, false);
});

test('unresolved permalink can resolve on the target-bound pending surface', async () => {
  const first = observation({ storyBoundCandidateCount: 0, visibleStoryBoundCandidateCount: 0, exactTokenCandidateCount: 0, exactBodyCandidateCount: 0 });
  const pending = observation({ storyPathMatched: false, pendingSignal: true });
  const { result, calls } = await verify([first, pending]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.PENDING); assert.equal(result.pending, true); assert.equal(calls.filter(([name]) => name === 'goto').length, 2);
});

test('explicit not-found surface remains distinct', async () => {
  const { result } = await verify([observation({ storyBoundCandidateCount: 0, visibleStoryBoundCandidateCount: 0, explicitNotFound: true })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.NOT_FOUND);
});

test('explicit inaccessible surface remains distinct', async () => {
  const { result } = await verify([observation({ storyBoundCandidateCount: 0, visibleStoryBoundCandidateCount: 0, explicitInaccessible: true })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.INACCESSIBLE);
});

test('unsupported route remains distinct', async () => {
  const { result } = await verify([observation({ routeSupported: false })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.UNSUPPORTED);
});

test('multiple visible Story-bound candidates fail closed as ambiguous', async () => {
  const { result } = await verify([observation({ storyBoundCandidateCount: 2, visibleStoryBoundCandidateCount: 2 })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.AMBIGUOUS);
});

test('malformed Story IDs are rejected before navigation', async () => {
  const f = fixture([]);
  await assert.rejects(verifyFacebookStoryReference(f.page, { expectedTarget: target, storyId: '../bad', expectedToken: token, expectedBody: body }, { capture: f.capture }), { code: 'FACEBOOK_STORY_ID_INVALID' });
  assert.equal(f.calls.length, 0);
});

test('canonical target binding is required before URL derivation', () => {
  assert.throws(() => storyReferenceUrls('https://evil.example/groups/1102687755514047', storyId), { code: 'FACEBOOK_TARGET_INVALID' });
  assert.equal(storyReferenceUrls(target, storyId).permalinkUrl, `${target}/posts/${storyId}/`);
});

test('verifier invokes no Facebook mutation methods', async () => {
  const { calls } = await verify([observation()]);
  assert.deepEqual([...new Set(calls.map(([name]) => name))].sort(), ['goto', 'wait']);
});

test('verifier has no task-state mutation dependency', async () => {
  const historical = Object.freeze({ status: 'OUTCOME_UNKNOWN', sideEffectState: 'ATTEMPT_STARTED' });
  await verify([observation()]); assert.deepEqual(historical, { status: 'OUTCOME_UNKNOWN', sideEffectState: 'ATTEMPT_STARTED' });
});

test('verifier exposes no publish path', async () => {
  const { result } = await verify([observation()]);
  assert.equal('publish' in result, false); assert.equal('click' in result, false); assert.equal('task' in result, false);
});

test('evidence is bounded and contains no observed Facebook text', async () => {
  const { result } = await verify([observation({ storyBoundCandidateCount: 999, visibleStoryBoundCandidateCount: 0, nodesInspected: 9999, boundsExceeded: true })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.AMBIGUOUS); assert.equal(result.evidence.storyBoundCandidateCount, MAX_STORY_REFERENCE_CANDIDATES); assert.equal(result.evidence.nodesInspected, MAX_STORY_REFERENCE_NODES);
  assert.deepEqual(Object.keys(result).sort(), ['bodyHashMatched', 'evidence', 'expectedBodySha256', 'pathClass', 'pending', 'result', 'storyId', 'targetMatched', 'tokenMatched', 'verifiedAt', 'visible']);
});

test('historical OUTCOME_UNKNOWN remains unchanged by visible mismatch research', async () => {
  const task = { status: 'OUTCOME_UNKNOWN', publicationAttempted: true, sideEffectState: 'ATTEMPT_STARTED' };
  const before = JSON.stringify(task); const { result } = await verify([observation({ exactBodyCandidateCount: 0 })]);
  assert.equal(result.result, STORY_REFERENCE_RESULT.VISIBLE_MISMATCH); assert.equal(JSON.stringify(task), before);
});
