'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BASELINE_RESULT,
  RESULT,
  captureTargetCandidates,
  classifyPreClickBaseline,
  classifyRefreshedTargetCandidates,
} = require('../app/facebook/targetReloadVerification');
const { BODY_EXTRACTION_RESULT } = require('../app/facebook/acknowledgementDiagnostics');
const { BODY_DESCENT_RESULT } = require('../app/facebook/uniqueBodyBranchDescent');

const TEXT = 'Exact immutable smoke body\nSecond line';
const LONGER = `header\n${TEXT}\nactions`;

class FakeTextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; }
}

class FakeElement {
  constructor(tagName, options = {}, children = []) {
    this.tagName = String(tagName).toUpperCase();
    this.role = options.role || '';
    this.innerText = options.innerText ?? options.value ?? '';
    this.textContent = options.textContent ?? options.value ?? '';
    this.visible = options.visible !== false;
    this.isConnected = options.attached !== false;
    this.directText = options.directText === true;
    this.parentElement = null;
    this.children = children;
    for (const child of children) child.parentElement = this;
  }

  get childNodes() {
    return this.directText ? [new FakeTextNode(this.textContent), ...this.children] : [...this.children];
  }

  getAttribute(name) { return name === 'role' ? this.role : null; }

  matches(selector) {
    return String(selector).split(',').some((part) => {
      const value = part.trim().toLowerCase();
      if (value === this.tagName.toLowerCase()) return true;
      if (value === '[role="article"]' || value === '[role=article]') return this.role === 'article';
      if (value === '[role="button"]' || value === '[role=button]') return this.role === 'button';
      return false;
    });
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }

  querySelectorAll(selector) {
    const rows = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) rows.push(child);
        visit(child);
      }
    };
    visit(this);
    return rows;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }

  getBoundingClientRect() { return this.visible && this.isConnected ? { width: 100, height: 20 } : { width: 0, height: 0 }; }
}

class FakeDocument {
  constructor(root) { this.root = root; this.shell = new FakeElement('main', {}, [root]); }
  querySelectorAll(selector) { return this.root.matches(selector) ? [this.root] : []; }
}

function node(value, options = {}, children = []) {
  return new FakeElement(options.control ? 'div' : 'div', { ...options, value, role: options.control ? 'button' : '' }, children);
}
const exact = (options = {}) => node(TEXT, { directText: true, ...options });
const other = (options = {}) => node('unrelated', { directText: true, ...options });
const wrapper = (children, options = {}) => node(LONGER, options, children);
function repeated(count, end) { let current = end; for (let index = 0; index < count; index += 1) current = wrapper([current]); return current; }
function candidate(children, options = {}) {
  return new FakeElement('article', {
    role: 'article',
    innerText: options.innerText ?? TEXT,
    textContent: options.textContent ?? options.innerText ?? TEXT,
  }, children);
}

function fixtures() {
  return {
    A: candidate([exact()]),
    B: candidate([other()], { innerText: 'unrelated', textContent: 'unrelated' }),
    C: candidate([exact({ visible: false })], { innerText: '', textContent: TEXT }),
    D: candidate([exact(), exact({ visible: false })], { innerText: TEXT, textContent: `${TEXT}\n${TEXT}` }),
    E: candidate([exact(), exact({ visible: false, attached: false })]),
    F: candidate([exact(), node('control', { visible: false, control: true })]),
    G: candidate([exact(), node('control', { visible: false, attached: false, control: true })]),
    H: candidate([repeated(5, exact({ visible: false }))], { innerText: LONGER, textContent: LONGER }),
    I: candidate([repeated(5, exact({ visible: false, attached: false }))], { innerText: LONGER, textContent: LONGER }),
    J: candidate([exact(), exact({ visible: false })], { innerText: TEXT, textContent: `${TEXT}\n${TEXT}` }),
    K: candidate([wrapper([exact({ visible: false })])], { innerText: LONGER, textContent: LONGER }),
    L: candidate([wrapper([exact(), exact({ visible: false })])], { innerText: LONGER, textContent: LONGER }),
  };
}

function withDom(root, callback) {
  const saved = { document: global.document, getComputedStyle: global.getComputedStyle, Element: global.Element, Node: global.Node };
  global.document = new FakeDocument(root);
  global.getComputedStyle = (element) => ({ display: element.visible ? 'block' : 'none', visibility: element.visible ? 'visible' : 'hidden', opacity: element.visible ? '1' : '0' });
  global.Element = FakeElement;
  global.Node = { TEXT_NODE: 3 };
  try { return callback(); }
  finally { Object.assign(global, saved); }
}

async function capture(root) {
  const page = {
    evaluate: async (productionCapture, argument) => withDom(root, () => productionCapture(argument)),
  };
  return captureTargetCandidates(page);
}

function rawKnowledge(root) {
  const rows = root.querySelectorAll('div,span,p,section');
  return {
    nodeCount: rows.length,
    bodySignalCount: rows.filter((item) => String(item.textContent).includes(TEXT)).length,
    hiddenBodySignalCount: rows.filter((item) => !item.visible && String(item.textContent).includes(TEXT)).length,
    detachedBodySignalCount: rows.filter((item) => !item.isConnected && String(item.textContent).includes(TEXT)).length,
  };
}

const terminal = (captured) => classifyRefreshedTargetCandidates(captured, TEXT, { trustedNewness: true });
const baseline = (captured) => classifyPreClickBaseline(captured, TEXT);

test('G5.7FC production capture retains bounded unsafe metadata for strict shared descent', async () => {
  const expected = {
    A: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    B: BODY_DESCENT_RESULT.SAFE_EVALUATION_ERROR,
    C: BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY,
    D: BODY_DESCENT_RESULT.BODY_SIGNAL_SPLIT_AMBIGUOUS,
    E: BODY_DESCENT_RESULT.BODY_SIGNAL_SPLIT_AMBIGUOUS,
    F: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    G: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    H: BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY,
    I: BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY,
    J: BODY_DESCENT_RESULT.BODY_SIGNAL_SPLIT_AMBIGUOUS,
    K: BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY,
    L: BODY_DESCENT_RESULT.BODY_SIGNAL_SPLIT_AMBIGUOUS,
  };

  for (const [name, root] of Object.entries(fixtures())) {
    const knowledge = rawKnowledge(root);
    const captured = await capture(root);
    const result = terminal(captured);
    assert.equal(result.bodyDescentResult, expected[name], name);
    assert.ok(captured.candidates[0].bodySubtrees.length <= 24, `${name} reduced bound`);
    if (knowledge.hiddenBodySignalCount) assert.ok(captured.candidates[0].bodySubtrees.some((block) => block.hidden), `${name} hidden metadata`);
    if (knowledge.detachedBodySignalCount) assert.ok(captured.candidates[0].bodySubtrees.some((block) => block.detached), `${name} detached metadata`);
  }
});

test('G5.7FC protected smoke shape reaches an explicit hidden boundary without trusted proof', async () => {
  const root = fixtures().H;
  const result = terminal(await capture(root));
  assert.equal(result.resultClass, RESULT.NOT_FOUND);
  assert.equal(result.bodyDescentResult, BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY);
  assert.equal(result.structurallyTrustedExactCandidateCount, 0);
});

test('G5.7FC bounded capture parity never promotes unsafe body evidence and makes duplicate baselines strict', async () => {
  const rows = fixtures();
  for (const name of ['C', 'D', 'E', 'H', 'I', 'J', 'K', 'L']) {
    const result = terminal(await capture(rows[name]));
    assert.notEqual(result.bodyDescentResult, BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION, name);
    assert.notEqual(result.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST, name);
  }
  for (const name of ['F', 'G']) assert.equal(terminal(await capture(rows[name])).bodyDescentResult, BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION, name);

  const expectedBaseline = {
    A: BASELINE_RESULT.ONE,
    B: BASELINE_RESULT.ZERO,
    C: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
    D: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
    E: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
    F: BASELINE_RESULT.ONE,
    G: BASELINE_RESULT.ONE,
    H: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
    I: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
    J: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
    K: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
    L: BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL,
  };
  for (const [name, root] of Object.entries(rows)) {
    assert.equal(baseline(await capture(root)).baselineResultClass, expectedBaseline[name], `${name} baseline`);
  }
});

test('G5.7FC capture parity preserves the detached-race plausibility limitation', async () => {
  const root = candidate([exact({ visible: false, attached: false })], { innerText: 'unrelated', textContent: 'unrelated' });
  const captured = await capture(root);
  const baselineResult = baseline(captured);
  const reloadResult = terminal(captured);
  assert.equal(rawKnowledge(root).detachedBodySignalCount, 1);
  assert.equal(baselineResult.baselineResultClass, BASELINE_RESULT.ZERO);
  assert.equal(baselineResult.bodyDescentAttempted, false);
  assert.equal(reloadResult.bodyExtractionResult, BODY_EXTRACTION_RESULT.BODY_NOT_FOUND);
  assert.equal(reloadResult.bodyDescentAttempted, false);
});

test('G5.7FC preserves source parent relationships through a hidden ancestor', async () => {
  const root = candidate([wrapper([exact()], { visible: false })], { innerText: LONGER, textContent: LONGER });
  const captured = await capture(root);
  const [parent, child] = captured.candidates[0].bodySubtrees;
  assert.equal(parent.hidden, true);
  assert.equal(child.parentSourceBlockIndex, parent.sourceBlockIndex);
  assert.equal(terminal(captured).bodyDescentResult, BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY);
});

test('G5.7FC reduced 24-block pressure fails closed without admitting a later exact body', async () => {
  const unsafeControls = Array.from({ length: 24 }, () => node('control', { visible: false, control: true }));
  const root = candidate([...unsafeControls, exact()], { innerText: TEXT, textContent: TEXT });
  const captured = await capture(root);
  const result = terminal(captured);
  assert.equal(captured.candidates[0].bodySubtrees.length, 24);
  assert.equal(result.bodyDescentResult, BODY_DESCENT_RESULT.NODE_LIMIT_REACHED);
  assert.notEqual(result.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST);
});
