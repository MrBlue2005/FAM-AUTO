'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BASELINE_RESULT, RESULT, CAPTURE_STAGE_RESULT, ROOT_READER_PARITY_CLASS,
  captureTargetCandidates, classifyPreClickBaseline, classifyRefreshedTargetCandidates, summary,
} = require('../app/facebook/targetReloadVerification');

const TEXT = 'Exact immutable smoke body\nSecond line';
class FakeTextNode { constructor(value) { this.nodeType = 3; this.nodeValue = value; } }
class FakeElement {
  constructor(tagName = 'div', options = {}, children = []) {
    this.tagName = tagName.toUpperCase(); this.role = options.role || ''; this.innerText = options.innerText ?? options.value ?? '';
    this.textContent = options.textContent ?? options.value ?? ''; this.visible = options.visible !== false; this.isConnected = options.attached !== false;
    this.directText = options.directText === true; this.attrs = options.attrs || {}; this.parentElement = null; this.children = children; this.queryOrder = options.queryOrder;
    children.forEach((child) => { child.parentElement = this; });
  }
  get childNodes() { return this.directText ? [new FakeTextNode(this.textContent), ...this.children] : [...this.children]; }
  getAttribute(name) { return name === 'role' ? this.role : this.attrs[name] || null; }
  matches(selector) {
    return String(selector).split(',').some((part) => {
      const value = part.trim().toLowerCase();
      if (value === this.tagName.toLowerCase()) return true;
      const role = /^\[role=["']?([^"'\]]+)/.exec(value)?.[1]; if (role) return this.role === role;
      if (value.startsWith('[data-commentid]')) return Boolean(this.attrs['data-commentid']);
      if (value.startsWith('[data-testid*="comment"]')) return String(this.attrs['data-testid'] || '').includes('comment');
      if (value.startsWith('[data-testid*="reply"]')) return String(this.attrs['data-testid'] || '').includes('reply');
      return false;
    });
  }
  closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; }
  querySelectorAll(selector) {
    if (selector === 'div,span,p,section' && this.queryOrder) return this.queryOrder;
    const rows = []; const visit = (node) => { for (const child of node.children) { if (child.matches(selector)) rows.push(child); visit(child); } }; visit(this); return rows;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
  getBoundingClientRect() { return this.visible && this.isConnected ? { width: 100, height: 20 } : { width: 0, height: 0 }; }
}
class FakeDocument { constructor(roots) { this.roots = roots; this.shell = new FakeElement('main'); roots.forEach((root) => { if (!root.parentElement) root.parentElement = this.shell; }); } querySelectorAll() { return this.roots; } }
const block = (value = 'other', options = {}) => new FakeElement('div', { value, directText: true, ...options });
const article = (children = [], options = {}) => new FakeElement(options.tagName || 'article', { role: options.role ?? 'article', innerText: options.innerText ?? 'other', textContent: options.textContent ?? options.innerText ?? 'other', ...options }, children);
function bodyAt(ordinal, count = ordinal) { return article(Array.from({ length: count }, (_, index) => block(index + 1 === ordinal ? TEXT : `other ${index}`))); }
function withDom(roots, callback) {
  const saved = { document: global.document, getComputedStyle: global.getComputedStyle, Element: global.Element, Node: global.Node };
  global.document = new FakeDocument(roots); global.getComputedStyle = (node) => ({ display: node.visible ? 'block' : 'none', visibility: node.visible ? 'visible' : 'hidden', opacity: node.visible ? '1' : '0' }); global.Element = FakeElement; global.Node = { TEXT_NODE: 3 };
  try { return callback(); } finally { Object.assign(global, saved); }
}
async function capture(roots, options = {}) {
  const page = { evaluate: async (fn, argument) => withDom(roots, () => fn(argument)) };
  return captureTargetCandidates(page, { immutableText: TEXT, ...options });
}
const detail = (value, index = 0) => value.captureDiagnostics.candidates[index];

test('G5.7FR synthetic capture-stage matrix A-P is bounded, privacy-safe, and diagnostic-only', async () => {
  const A = await capture([article([block(TEXT)], { innerText: TEXT, textContent: TEXT })]);
  assert.equal(A.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.ROOT_SIGNAL_FOUND, 'A');
  assert.equal(detail(A).rootReaderParityClass, ROOT_READER_PARITY_CLASS.BOTH_SIGNAL, 'A parity');

  const B = await capture([]); assert.equal(B.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.ROOT_SELECTOR_ZERO, 'B');
  const capped = Array.from({ length: 16 }, (_, index) => article([], { innerText: `scaffold ${index}` })); capped.push(article([block(TEXT)], { innerText: TEXT }));
  const C = await capture(capped); assert.equal(C.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.ROOT_SELECTOR_CAP_REACHED, 'C'); assert.equal(C.captureDiagnostics.rootSelectorMatchCount, 17, 'C count');

  const commentRoots = Array.from({ length: 14 }, () => { const root = article(); const wrapper = new FakeElement('div', { role: 'comment' }, [root]); void wrapper; return root; });
  const D = await capture([article(), article(), ...commentRoots, article([block(TEXT)], { innerText: TEXT })]);
  assert.equal(D.captureDiagnostics.rootCountAfterAllEligibilityFiltering, 2, 'D'); assert.equal(D.captureDiagnostics.rootSelectorCapReached, true, 'D cap');

  const E = await capture([article([], { innerText: 'other', textContent: TEXT })]);
  assert.equal(detail(E).rootReaderParityClass, ROOT_READER_PARITY_CLASS.TEXTCONTENT_ONLY_SIGNAL, 'E'); assert.equal(E.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.ROOT_REPRESENTATION_MISMATCH, 'E stage');
  const F = await capture([article()]); assert.equal(detail(F).rootReaderParityClass, ROOT_READER_PARITY_CLASS.NO_SIGNAL_SAME_LENGTH, 'F'); assert.equal(F.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.NO_SIGNAL_IN_SELECTED_ROOT, 'F stage');

  for (const [label, ordinal, expectedWindow] of [['G', 1, 'first'], ['H', 24, 'first'], ['I', 25, 'second'], ['J', 64, 'second']]) {
    const value = await capture([bodyAt(ordinal, 64)]); const row = detail(value);
    assert.equal(row.firstBodySignalRawOrdinal, ordinal, label); assert.equal(row.bodySignalInWindow1To24, expectedWindow === 'first', `${label} first`); assert.equal(row.bodySignalInWindow25To64, expectedWindow === 'second', `${label} second`);
    if (ordinal > 24) assert.equal(value.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.DESCENDANT_SIGNAL_REDUCED_OUT, `${label} stage`);
  }
  const K = await capture([bodyAt(65, 65)]); assert.equal(detail(K).bodySignalBeyond64Known, false, 'K'); assert.equal(detail(K).bodySignalBeyond64, 'UNKNOWN', 'K unknown');

  const fillers = Array.from({ length: 23 }, (_, index) => block(`other ${index}`)); const parent = block('other parent'); const child = block(TEXT); parent.children = [child]; child.parentElement = parent;
  const rootL = article([...fillers, parent]); rootL.queryOrder = [...fillers, child, parent];
  const L = await capture([rootL]); assert.equal(detail(L).parentLinksMissingBecauseParentOutsideReducedSet, 1, 'L');

  const M = await capture([article([], { innerText: `Exact immutable\u200B smoke body\nSecond line`, textContent: TEXT })]);
  assert.equal(detail(M).containsZeroWidthChar, true, 'M char'); assert.equal(detail(M).rootReaderParityClass, ROOT_READER_PARITY_CLASS.TEXTCONTENT_ONLY_SIGNAL, 'M parity');

  const comment = article(); const commentWrapper = new FakeElement('div', { role: 'comment' }, [comment]); void commentWrapper;
  const N = await capture([comment]); assert.equal(N.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.NO_ELIGIBLE_ROOTS, 'N');
  const composer = article(); const dialogRoot = article(); const dialog = new FakeElement('div', { role: 'dialog' }, [dialogRoot]); void dialog;
  const O = await capture([composer, dialogRoot], { composerHandle: composer }); assert.equal(O.captureDiagnostics.rootCountAfterAllEligibilityFiltering, 0, 'O'); assert.equal(O.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.NO_ELIGIBLE_ROOTS, 'O stage');

  const P = await captureTargetCandidates({ evaluate: async () => { throw new Error('synthetic'); } }, { immutableText: TEXT });
  assert.equal(P.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.CAPTURE_EVALUATION_ERROR, 'P');
  assert.equal(classifyPreClickBaseline(P, TEXT).baselineResultClass, BASELINE_RESULT.SAFE_EVALUATION_ERROR, 'P baseline');
  assert.equal(classifyRefreshedTargetCandidates(P, TEXT, { trustedNewness: true }).resultClass, RESULT.SAFE_EVALUATION_ERROR, 'P reload');

  const baselineA = classifyPreClickBaseline(A, TEXT); const reloadA = classifyRefreshedTargetCandidates(A, TEXT, { trustedNewness: true });
  assert.deepEqual(Object.keys(baselineA.baselineCaptureDiagnostics).sort(), Object.keys(reloadA.captureDiagnostics).sort(), 'baseline/reload schema parity');
  assert.equal(reloadA.discoveryComplete, true); assert.equal(reloadA.candidateCapReached, false);
  const retained = summary({ ...baselineA, ...reloadA });
  assert.equal(retained.discoveryComplete, true); assert.equal(retained.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.ROOT_SIGNAL_FOUND);
  assert.doesNotMatch(JSON.stringify(retained), new RegExp(TEXT.split('\n')[0], 'i'));
});

test('G5.7FR real-failure-shaped diagnostics distinguish cap exclusion, root-reader loss, and post-24 reduction loss without verifier behavior change', async () => {
  const scaffolds = [article(), article()];
  const cappedRoots = [...scaffolds, ...Array.from({ length: 14 }, () => { const root = article(); const parent = new FakeElement('div', { role: 'comment' }, [root]); void parent; return root; }), article([block(TEXT)], { innerText: TEXT })];
  const outsideCap = await capture(cappedRoots);
  const rootLost = await capture([...scaffolds, article()]);
  const reducedOut = await capture([...scaffolds, bodyAt(25, 25)]);
  assert.equal(outsideCap.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.ROOT_SELECTOR_CAP_REACHED);
  assert.equal(rootLost.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.NO_SIGNAL_IN_SELECTED_ROOT);
  assert.equal(reducedOut.captureDiagnostics.captureStageResult, CAPTURE_STAGE_RESULT.DESCENDANT_SIGNAL_REDUCED_OUT);
  assert.equal(classifyRefreshedTargetCandidates(outsideCap, TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates(rootLost, TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
  assert.equal(classifyRefreshedTargetCandidates(reducedOut, TEXT, { trustedNewness: true }).resultClass, RESULT.NOT_FOUND);
});
