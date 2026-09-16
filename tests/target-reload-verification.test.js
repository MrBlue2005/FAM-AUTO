'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RESULT, classifyRefreshedTargetCandidates, verifyRefreshedTargetPost } = require('../app/facebook/targetReloadVerification');
const { verifyLivePostPublished } = require('../app/facebook/verifyPost');

const TEXT = 'Exact immutable smoke body\nSecond line';
function candidate(overrides = {}) {
  return {
    candidateFamily: 'ARTICLE_ROLE', visible: true, attached: true,
    hasNestedArticleTextSurface: false, hasAuthorHeaderTextSurface: false, hasActionControlTextSurface: false,
    textViews: { currentReader: { value: TEXT }, textContent: { value: TEXT }, innerText: { value: TEXT }, visualText: { value: TEXT }, descendantTextBlocks: { value: TEXT } },
    descendantTexts: [{ value: TEXT, visible: true, attached: true }],
    bodySubtrees: [{ value: TEXT, visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', hasDirectTextNode: true, hasDescendantText: false, hasInteractiveDescendant: false, hasArticleDescendant: false, readSucceeded: true }],
    ...overrides,
  };
}

test('target reload classifier accepts only one structurally exact, trusted-new post', () => {
  const result = classifyRefreshedTargetCandidates([candidate()], TEXT, { trustedNewness: true });
  assert.equal(result.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
});

test('target reload classifier fails closed for zero, duplicate, historical, comment, hidden, detached, nested, and substring-only candidates', () => {
  assert.equal(classifyRefreshedTargetCandidates([], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates([candidate(), candidate()], TEXT, { trustedNewness: true }).resultClass, RESULT.AMBIGUOUS);
  assert.equal(classifyRefreshedTargetCandidates([candidate()], TEXT).resultClass, RESULT.DUPLICATE_UNRESOLVED);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ textViews: { currentReader: { value: '' }, textContent: { value: '' }, innerText: { value: '' }, visualText: { value: '' }, descendantTextBlocks: { value: TEXT } }, bodySubtrees: [] })], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ visible: false })], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ attached: false })], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ hasNestedArticleTextSurface: true })], TEXT, { trustedNewness: true }).resultClass, RESULT.STRUCTURE_UNTRUSTED);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ textViews: { currentReader: { value: `prefix ${TEXT}` }, textContent: { value: `prefix ${TEXT}` }, innerText: { value: `prefix ${TEXT}` }, visualText: { value: `prefix ${TEXT}` }, descendantTextBlocks: { value: `prefix ${TEXT}` } }, bodySubtrees: [] })], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
});

test('target reload accepts isolated header/action and contiguous body structures only with trusted newness', () => {
  assert.equal(classifyRefreshedTargetCandidates([candidate({ hasAuthorHeaderTextSurface: true, hasActionControlTextSurface: true })], TEXT, { trustedNewness: true }).resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
  const split = candidate({ bodySubtrees: [
    { value: 'Exact immutable smoke body', visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', readSucceeded: true },
    { value: 'Second line', visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', readSucceeded: true },
  ] });
  assert.equal(classifyRefreshedTargetCandidates([split], TEXT, { trustedNewness: true }).resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
});

test('target reload performs one canonical navigation and rejects before/after target mismatches and navigation failure', async () => {
  let navigations = 0;
  const page = { url: () => 'https://www.facebook.com/groups/exact', goto: async () => { navigations += 1; } };
  const verify = (actual, expected) => { if (actual !== expected) throw new Error('wrong target'); };
  const result = await verifyRefreshedTargetPost(page, { targetCanonical: 'https://www.facebook.com/groups/exact', verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [candidate()], trustedNewness: true });
  assert.equal(result.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST); assert.equal(navigations, 1);
  assert.equal((await verifyRefreshedTargetPost({ ...page, url: () => 'https://www.facebook.com/groups/wrong' }, { targetCanonical: 'https://www.facebook.com/groups/exact', verifyTarget: verify, immutableText: TEXT })).resultClass, RESULT.TARGET_MISMATCH);
  assert.equal((await verifyRefreshedTargetPost({ ...page, goto: async () => { throw new Error('timeout'); } }, { targetCanonical: 'https://www.facebook.com/groups/exact', verifyTarget: verify, immutableText: TEXT })).resultClass, RESULT.NAVIGATION_FAILED);
});

test('acknowledgement remains a valid success path and target fallback requires hidden composer, click return, and one attempt', async () => {
  const wait = (ok) => async () => { if (!ok) throw Object.assign(new Error('miss'), { name: 'TimeoutError' }); };
  const page = { getByText: () => ({ first: () => ({ waitFor: wait(true), count: async () => 1 }) }), evaluate: async () => ({ all: 0, visible: 0 }) };
  assert.equal(await verifyLivePostPublished(page, { waitFor: wait(true), evaluate: async () => false, isVisible: async () => false }, 1, { clickReturned: true, canonicalTargetStillValid: true }), true);
  let fallbackCalls = 0;
  const noAck = { getByText: () => ({ first: () => ({ waitFor: wait(false), count: async () => 0 }) }), evaluate: async () => ({ all: 0, visible: 0 }) };
  assert.equal(await verifyLivePostPublished(noAck, { waitFor: wait(true), evaluate: async () => false, isVisible: async () => false }, 1, { clickReturned: true, canonicalTargetStillValid: true, acknowledgementGraceMs: 0, verifyRefreshedTarget: async () => { fallbackCalls += 1; return { resultClass: RESULT.VERIFIED_EXACT_TARGET_POST }; } }), true);
  assert.equal(fallbackCalls, 1);
  assert.equal(await verifyLivePostPublished(noAck, { waitFor: wait(true), evaluate: async () => false, isVisible: async () => false }, 1, { clickReturned: false, canonicalTargetStillValid: true, acknowledgementGraceMs: 0, verifyRefreshedTarget: async () => { fallbackCalls += 1; return { resultClass: RESULT.VERIFIED_EXACT_TARGET_POST }; } }), false);
  assert.equal(fallbackCalls, 1);
  assert.equal(await verifyLivePostPublished(noAck, { waitFor: wait(false), evaluate: async () => false, isVisible: async () => false }, 1, { clickReturned: true, canonicalTargetStillValid: true, acknowledgementGraceMs: 0, verifyRefreshedTarget: async () => ({ resultClass: RESULT.VERIFIED_EXACT_TARGET_POST }) }), false);
});
