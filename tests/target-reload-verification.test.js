'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RESULT, BASELINE_RESULT, classifyRefreshedTargetCandidates, classifyPreClickBaseline, capturePreClickBaseline, verifyRefreshedTargetPost } = require('../app/facebook/targetReloadVerification');
const { BODY_EXTRACTION_RESULT, diagnoseArticleBodySubtrees } = require('../app/facebook/acknowledgementDiagnostics');
const { verifyLivePostPublished } = require('../app/facebook/verifyPost');

const TEXT = 'Exact immutable smoke body\nSecond line';
function discovery(candidates, options = {}) { return { candidates, discovery: { discoveryComplete: options.discoveryComplete !== false, candidateCapReached: options.candidateCapReached === true } }; }
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
function bodyNode(overrides = {}, children = []) {
  return { value: '', visible: true, attached: true, articleRelation: 'DESCENDANT_OF_SELECTED_POST', hasDirectTextNode: false, hasDescendantText: true, hasInteractiveDescendant: false, hasArticleDescendant: false, readSucceeded: true, children, ...overrides };
}
function repeatedBodyWrappers(count, leaf) {
  let current = leaf;
  for (let index = 0; index < count; index += 1) current = bodyNode({ value: `wrapper ${TEXT}` }, [current]);
  return current;
}
function flattenBodyTree(root) {
  const rows = [];
  const visit = (node, parentBlockIndex = null, depth = 1) => {
    const blockIndex = rows.length + 1;
    rows.push({ ...node, parentBlockIndex, depthRelativeToCandidate: depth, children: undefined });
    for (const child of node.children || []) visit(child, blockIndex, depth + 1);
  };
  visit(root);
  return rows;
}

test('target reload classifier accepts only one structurally exact, trusted-new post', () => {
  const result = classifyRefreshedTargetCandidates([candidate()], TEXT, { trustedNewness: true });
  assert.equal(result.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
});

test('pre-click baseline excludes the retained composer, comments, hidden/detached, and substring-only surfaces without authorizing incomplete discovery', () => {
  const composer = candidate({ composerDescendant: true });
  const comment = candidate({ commentOrReply: true });
  const hidden = candidate({ visible: false });
  const detached = candidate({ attached: false });
  const substring = candidate({ bodySubtrees: [{ value: `prefix ${TEXT}`, visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', hasDirectTextNode: true, hasDescendantText: false, hasInteractiveDescendant: false, hasArticleDescendant: false, readSucceeded: true }] });
  const result = classifyPreClickBaseline(discovery([composer, comment, hidden, detached, substring]), TEXT);
  assert.equal(result.baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL);
  assert.equal(result.baselineExactTrustedPostCount, 0);
  assert.equal(result.composerExcludedFromBaseline, true);
  assert.equal(result.commentsExcludedFromBaseline, true);
});

test('pre-click baseline counts exact trusted body structures but fails closed for nested ambiguity', () => {
  assert.equal(classifyPreClickBaseline(discovery([candidate()]), TEXT).baselineResultClass, BASELINE_RESULT.ONE);
  assert.equal(classifyPreClickBaseline(discovery([candidate(), candidate()]), TEXT).baselineResultClass, BASELINE_RESULT.MULTIPLE);
  assert.equal(classifyPreClickBaseline(discovery([candidate({ hasNestedArticleTextSurface: true })]), TEXT).baselineResultClass, BASELINE_RESULT.UNAVAILABLE);
  const contiguous = candidate({ bodySubtrees: [
    { value: 'Exact immutable smoke body', visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', readSucceeded: true },
    { value: 'Second line', visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', readSucceeded: true },
  ] });
  assert.equal(classifyPreClickBaseline(discovery([contiguous]), TEXT).baselineResultClass, BASELINE_RESULT.ONE);
});

test('G5.7EV shares bounded unique-body descent between baseline and target reload', async () => {
  const exactLeaf = bodyNode({ value: TEXT, hasDirectTextNode: true, hasDescendantText: false });
  const wrapperCandidate = candidate({ bodySubtrees: flattenBodyTree(repeatedBodyWrappers(20, exactLeaf)) });
  assert.equal(classifyPreClickBaseline(discovery([wrapperCandidate]), TEXT).baselineResultClass, BASELINE_RESULT.ONE);

  const inseparable = candidate({ bodySubtrees: flattenBodyTree(repeatedBodyWrappers(2, bodyNode({ value: `wrapper ${TEXT}`, hasInteractiveDescendant: true }))) });
  assert.equal(classifyPreClickBaseline(discovery([inseparable]), TEXT).baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL);

  const clean = candidate({ textViews: { currentReader: { value: 'other' }, textContent: { value: 'other' }, innerText: { value: 'other' }, visualText: { value: 'other' }, descendantTextBlocks: { value: 'other' } }, descendantTexts: [], bodySubtrees: [] });
  const zero = classifyPreClickBaseline(discovery([clean]), TEXT);
  assert.equal(zero.baselineResultClass, BASELINE_RESULT.ZERO);
  const page = { url: () => 'https://www.facebook.com/groups/exact', goto: async () => {} };
  const verified = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: (actual, expected) => { if (actual !== expected) throw new Error('wrong target'); }, immutableText: TEXT, captureCandidates: async () => [wrapperCandidate], trustedNewness: true, preClickBaseline: zero });
  assert.equal(verified.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
  const duplicate = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: () => {}, immutableText: TEXT, captureCandidates: async () => [wrapperCandidate, wrapperCandidate], trustedNewness: true, preClickBaseline: zero });
  assert.equal(duplicate.resultClass, RESULT.AMBIGUOUS);
});

test('pre-click baseline authorizes only a complete observed feed with no body signal and fails closed for unresolved discovery', () => {
  const clean = candidate({ textViews: { currentReader: { value: 'other' }, textContent: { value: 'other' }, innerText: { value: 'other' }, visualText: { value: 'other' }, descendantTextBlocks: { value: 'other' } }, descendantTexts: [{ value: 'other', visible: true, attached: true }], bodySubtrees: [{ value: 'other', visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', hasDirectTextNode: true, hasDescendantText: false, hasInteractiveDescendant: false, hasArticleDescendant: false, readSucceeded: true }] });
  assert.equal(classifyPreClickBaseline(discovery([clean]), TEXT).baselineResultClass, BASELINE_RESULT.ZERO);
  assert.equal(classifyPreClickBaseline(discovery([candidate({ composerDescendant: true }), clean]), TEXT).baselineResultClass, BASELINE_RESULT.ZERO);
  assert.equal(classifyPreClickBaseline(discovery([]), TEXT).baselineResultClass, BASELINE_RESULT.NO_CANDIDATES);
  const unresolved = candidate({ bodySubtrees: [{ value: TEXT, visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', hasDirectTextNode: true, hasDescendantText: false, hasInteractiveDescendant: true, hasArticleDescendant: false, readSucceeded: true }] });
  assert.equal(classifyPreClickBaseline(discovery([unresolved]), TEXT).baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL);
  assert.equal(classifyPreClickBaseline(discovery(Array.from({ length: 16 }, () => clean), { candidateCapReached: true }), TEXT).baselineResultClass, BASELINE_RESULT.INCOMPLETE_DISCOVERY);
  assert.equal(classifyPreClickBaseline([...Array.from({ length: 16 }, () => clean), candidate()], TEXT).baselineResultClass, BASELINE_RESULT.INCOMPLETE_DISCOVERY);
  assert.equal(classifyPreClickBaseline(discovery([clean], { discoveryComplete: false }), TEXT).baselineResultClass, BASELINE_RESULT.INCOMPLETE_DISCOVERY);
  assert.equal(classifyPreClickBaseline(discovery([candidate({ commentOrReply: true })]), TEXT).baselineResultClass, BASELINE_RESULT.NO_CANDIDATES);
});

test('pre-click baseline treats capture failure and an initially empty delayed feed as non-zero-authorizing states', async () => {
  const page = { url: () => 'https://www.facebook.com/groups/exact' };
  const verify = (actual, expected) => { if (actual !== expected) throw new Error('wrong target'); };
  const delayed = await capturePreClickBaseline(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => discovery([]) });
  assert.equal(delayed.baselineResultClass, BASELINE_RESULT.NO_CANDIDATES);
  const broken = candidate(); Object.defineProperty(broken, 'bodySubtrees', { get() { throw new Error('safe fixture failure'); } });
  assert.equal(classifyPreClickBaseline(discovery([broken]), TEXT).baselineResultClass, BASELINE_RESULT.SAFE_EVALUATION_ERROR);
});

test('same-target baseline requires a 0 to 1 transition before target reload can establish trusted newness', async () => {
  const page = { url: () => 'https://www.facebook.com/groups/exact', goto: async () => {} };
  const verify = (actual, expected) => { if (actual !== expected) throw new Error('wrong target'); };
  const zero = classifyPreClickBaseline(discovery([candidate({ textViews: { currentReader: { value: 'other' }, textContent: { value: 'other' }, innerText: { value: 'other' }, visualText: { value: 'other' }, descendantTextBlocks: { value: 'other' } }, descendantTexts: [], bodySubtrees: [] })]), TEXT);
  const one = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [candidate()], trustedNewness: zero.baselineResultClass === BASELINE_RESULT.ZERO, preClickBaseline: zero });
  assert.equal(one.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
  assert.equal(one.trustedNewnessEstablished, true);
  assert.equal(one.newnessTransitionClass, 'ZERO_TO_ONE');
  const noBaseline = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [candidate()], trustedNewness: true });
  assert.equal(noBaseline.resultClass, RESULT.DUPLICATE_UNRESOLVED);
  const zeroToZero = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [], trustedNewness: true, preClickBaseline: zero });
  assert.notEqual(zeroToZero.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
  assert.equal(zeroToZero.newnessTransitionClass, 'ZERO_TO_ZERO');
  const multiple = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [candidate(), candidate()], trustedNewness: true, preClickBaseline: zero });
  assert.equal(multiple.resultClass, RESULT.AMBIGUOUS);
  assert.equal(multiple.newnessTransitionClass, 'ZERO_TO_MULTIPLE');
  const preexisting = classifyPreClickBaseline(discovery([candidate()]), TEXT);
  const unresolved = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [candidate()], trustedNewness: false, preClickBaseline: preexisting });
  assert.equal(unresolved.resultClass, RESULT.DUPLICATE_UNRESOLVED);
  assert.equal(unresolved.newnessTransitionClass, 'NONZERO_BASELINE');
});

test('baseline target mismatch and evaluation failure fail closed before any attempt', async () => {
  const verify = (actual, expected) => { if (actual !== expected) throw new Error('wrong target'); };
  const wrong = await capturePreClickBaseline({ url: () => 'https://www.facebook.com/groups/wrong' }, { targetCanonical: 'https://www.facebook.com/groups/exact', verifyTarget: verify, immutableText: TEXT });
  assert.equal(wrong.baselineResultClass, BASELINE_RESULT.TARGET_MISMATCH);
  const unavailable = await capturePreClickBaseline({ url: () => 'https://www.facebook.com/groups/exact' }, { targetCanonical: 'https://www.facebook.com/groups/exact', verifyTarget: verify, immutableText: TEXT });
  assert.equal(unavailable.baselineResultClass, BASELINE_RESULT.SAFE_EVALUATION_ERROR);
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

test('target reload accepts same-canonical-root body wrappers but rejects independent nested articles', () => {
  const sameRoot = candidate({ bodySubtrees: [{
    value: TEXT, visible: true, attached: true, depthRelativeToCandidate: 2, tagFamily: 'DIV', hasDirectTextNode: true,
    hasDescendantText: false, hasInteractiveDescendant: false, hasArticleDescendant: false,
    articleRelation: 'DESCENDANT_OF_SELECTED_POST', nestedArticle: true, independentNestedArticle: false, readSucceeded: true,
  }] });
  assert.equal(classifyRefreshedTargetCandidates([sameRoot], TEXT, { trustedNewness: true }).resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
  const embedded = candidate({
    hasNestedArticleTextSurface: true,
    bodySubtrees: [{ value: TEXT, visible: true, attached: true, depthRelativeToCandidate: 2, tagFamily: 'DIV', articleRelation: 'INDEPENDENT_NESTED_ARTICLE', nestedArticle: true, independentNestedArticle: true, readSucceeded: true }],
  });
  assert.equal(classifyRefreshedTargetCandidates([embedded], TEXT, { trustedNewness: true }).resultClass, RESULT.STRUCTURE_UNTRUSTED);
});

test('trusted body extraction accepts only structurally isolated article body blocks', () => {
  const bodyOnly = diagnoseArticleBodySubtrees(candidate(), TEXT);
  assert.equal(bodyOnly.bodyExtractionResult, BODY_EXTRACTION_RESULT.EXACT_BODY_DIRECT);
  const headerAndBody = diagnoseArticleBodySubtrees(candidate({ hasAuthorHeaderTextSurface: true }), TEXT);
  assert.equal(headerAndBody.bodyExtractionResult, BODY_EXTRACTION_RESULT.EXACT_BODY_AFTER_STRUCTURAL_UI_EXCLUSION);
  const bodyAndActions = diagnoseArticleBodySubtrees(candidate({ hasActionControlTextSurface: true }), TEXT);
  assert.equal(bodyAndActions.bodyExtractionResult, BODY_EXTRACTION_RESULT.EXACT_BODY_AFTER_STRUCTURAL_UI_EXCLUSION);
  const combined = diagnoseArticleBodySubtrees(candidate({ hasAuthorHeaderTextSurface: true, hasActionControlTextSurface: true }), TEXT);
  assert.equal(combined.bodyExtractionResult, BODY_EXTRACTION_RESULT.EXACT_BODY_AFTER_STRUCTURAL_UI_EXCLUSION);
  const contiguous = diagnoseArticleBodySubtrees(candidate({ bodySubtrees: [
    { value: 'Exact immutable smoke body', visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', readSucceeded: true },
    { value: 'Second line', visible: true, attached: true, depthRelativeToCandidate: 1, tagFamily: 'DIV', readSucceeded: true },
  ] }), TEXT);
  assert.equal(contiguous.bodyExtractionResult, BODY_EXTRACTION_RESULT.EXACT_BODY_CONTIGUOUS_BLOCKS);
  const excludedCommentText = diagnoseArticleBodySubtrees(candidate({ bodySubtrees: [{ value: TEXT, visible: true, attached: true, structuralUiExcluded: true, readSucceeded: true }] }), TEXT);
  assert.equal(excludedCommentText.bodyExtractionResult, BODY_EXTRACTION_RESULT.BODY_SUBSTRING_ONLY);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ commentOrReply: true })], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ hasNestedArticleTextSurface: true })], TEXT, { trustedNewness: true }).resultClass, RESULT.STRUCTURE_UNTRUSTED);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ visible: false })], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates([candidate({ attached: false })], TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
});

test('structural UI exclusion establishes only a trusted 0-to-1 target reload transition', async () => {
  const page = { url: () => 'https://www.facebook.com/groups/exact', goto: async () => {} };
  const verify = (actual, expected) => { if (actual !== expected) throw new Error('wrong target'); };
  const zero = classifyPreClickBaseline(discovery([candidate({ textViews: { currentReader: { value: 'other' }, textContent: { value: 'other' }, innerText: { value: 'other' }, visualText: { value: 'other' }, descendantTextBlocks: { value: 'other' } }, descendantTexts: [], bodySubtrees: [] })]), TEXT);
  const isolated = candidate({ hasAuthorHeaderTextSurface: true, hasActionControlTextSurface: true });
  const verified = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [isolated], trustedNewness: true, preClickBaseline: zero });
  assert.equal(verified.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
  assert.equal(verified.bodyExtractionResult, BODY_EXTRACTION_RESULT.EXACT_BODY_AFTER_STRUCTURAL_UI_EXCLUSION);
  assert.equal(verified.bodyExactAfterUiExclusionCount, 1);
  const nonzero = classifyPreClickBaseline([isolated], TEXT);
  const closed = await verifyRefreshedTargetPost(page, { targetCanonical: page.url(), verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [isolated], trustedNewness: false, preClickBaseline: nonzero });
  assert.equal(closed.resultClass, RESULT.DUPLICATE_UNRESOLVED);
});

test('target reload performs one canonical navigation and rejects before/after target mismatches and navigation failure', async () => {
  let navigations = 0;
  const page = { url: () => 'https://www.facebook.com/groups/exact', goto: async () => { navigations += 1; } };
  const verify = (actual, expected) => { if (actual !== expected) throw new Error('wrong target'); };
  const baseline = classifyPreClickBaseline(discovery([candidate({ textViews: { currentReader: { value: 'other' }, textContent: { value: 'other' }, innerText: { value: 'other' }, visualText: { value: 'other' }, descendantTextBlocks: { value: 'other' } }, descendantTexts: [], bodySubtrees: [] })]), TEXT);
  const result = await verifyRefreshedTargetPost(page, { targetCanonical: 'https://www.facebook.com/groups/exact', verifyTarget: verify, immutableText: TEXT, captureCandidates: async () => [candidate()], trustedNewness: true, preClickBaseline: baseline });
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
