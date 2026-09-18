'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BASELINE_RESULT,
  RESULT,
  captureTargetCandidates,
  classifyPreClickBaseline,
  classifyRefreshedTargetCandidates,
  summary,
} = require('../app/facebook/targetReloadVerification');
const {
  BODY_EXTRACTION_RESULT,
  BODY_DESCENT_ADMISSION_SOURCES,
  diagnoseArticleBodySubtrees,
} = require('../app/facebook/acknowledgementDiagnostics');
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
      if (value === '[role="comment"]' || value === '[role=comment]') return this.role === 'comment';
      if (value === 'a') return this.tagName === 'A';
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
  return new FakeElement('div', { ...options, value, role: options.control ? 'button' : (options.role || '') }, children);
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

test('G5.7FJ descendant admission addresses the detached race when bounded capture retains the signal', async () => {
  const root = candidate([exact({ visible: false, attached: false })], { innerText: 'unrelated', textContent: 'unrelated' });
  const captured = await capture(root);
  const baselineResult = baseline(captured);
  const reloadResult = terminal(captured);
  assert.equal(rawKnowledge(root).detachedBodySignalCount, 1);
  assert.equal(baselineResult.baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL);
  assert.equal(baselineResult.bodyDescentAttempted, true);
  assert.equal(baselineResult.bodyDescentResult, BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY);
  assert.equal(reloadResult.bodyExtractionResult, BODY_EXTRACTION_RESULT.BODY_SUBSTRING_ONLY);
  assert.equal(reloadResult.bodyDescentAttempted, true);
  assert.equal(reloadResult.bodyDescentResult, BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY);
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

function rootWithoutBody(children, options = {}) {
  return candidate(children, { innerText: options.innerText ?? 'root shell', textContent: options.textContent ?? 'root shell' });
}

function plausibilityFixtures() {
  const comment = node(TEXT, { directText: true, role: 'comment' });
  const nestedArticle = new FakeElement('article', { role: 'article', innerText: TEXT, textContent: TEXT }, [exact()]);
  const hiddenExact = exact({ visible: false });
  const detachedExact = exact({ attached: false });
  const controls = Array.from({ length: 24 }, () => other({ control: true }));
  return {
    A: rootWithoutBody([node('', { directText: true, innerText: '', textContent: TEXT })]),
    B: rootWithoutBody([node('', { directText: true, innerText: TEXT, textContent: 'descendant shell' })]),
    C: rootWithoutBody([exact()]),
    D: rootWithoutBody([wrapper([exact()])], { innerText: 'short hydrated root', textContent: 'short hydrated root' }),
    E: rootWithoutBody([hiddenExact]),
    F: rootWithoutBody([detachedExact]),
    G: rootWithoutBody([exact()]),
    H: rootWithoutBody([node(`prefix ${TEXT} suffix`, { directText: true })]),
    I: rootWithoutBody([comment]),
    J: rootWithoutBody([nestedArticle]),
    K: rootWithoutBody([exact(), exact()]),
    L: rootWithoutBody([...controls, exact()]),
    M: rootWithoutBody([other()]),
  };
}

test('G5.7FJ production descendant admission classifies fixtures A-M without fabricating root parity', async () => {
  const expected = {
    A: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    B: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    C: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    D: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    E: BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY,
    F: BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY,
    G: BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION,
    H: BODY_DESCENT_RESULT.BODY_SIGNAL_LOST,
    I: BODY_DESCENT_RESULT.COMMENT_REPLY_BOUNDARY,
    J: BODY_DESCENT_RESULT.INDEPENDENT_ARTICLE_BOUNDARY,
    K: BODY_DESCENT_RESULT.BODY_SIGNAL_SPLIT_AMBIGUOUS,
    L: null,
    M: null,
  };

  for (const [name, root] of Object.entries(plausibilityFixtures())) {
    const snapshot = (await capture(root)).candidates[0];
    const result = diagnoseArticleBodySubtrees(snapshot, TEXT);
    assert.equal(result.candidateRootBodySignal, false, `${name} truthful root parity`);
    if (expected[name] === null) {
      assert.equal(result.bodyDescentAttempted === true, false, `${name} bounded no-admission`);
      assert.equal(result.bodyDescentAdmissionSource, BODY_DESCENT_ADMISSION_SOURCES.NONE, `${name} admission source`);
      assert.equal(result.bodyIsolationClass, 'NO_BODY_SIGNAL', `${name} bounded no-signal classification`);
    } else {
      assert.equal(result.candidateDescendantBodySignal, true, `${name} descendant signal`);
      assert.equal(result.bodyDescentAdmissionSource, BODY_DESCENT_ADMISSION_SOURCES.DESCENDANT, `${name} admission source`);
      assert.equal(result.bodyDescentAttempted, true, `${name} production admission`);
      assert.equal(result.bodyDescentResult, expected[name], `${name} production terminal`);
    }
  }
});

test('G5.7FJ protected two-root race shape reaches hidden boundary through production reload admission', async () => {
  const clean = (await capture(rootWithoutBody([other()]))).candidates[0];
  const raced = (await capture(rootWithoutBody([repeated(4, exact({ visible: false }))]))).candidates[0];
  const discovery = { candidates: [raced, clean], discovery: { discoveryComplete: true, candidateCapReached: false } };
  const result = classifyRefreshedTargetCandidates(discovery, TEXT, { trustedNewness: true });
  assert.equal(result.bodyDescentAdmissionSource, BODY_DESCENT_ADMISSION_SOURCES.DESCENDANT);
  assert.equal(result.bodyDescentResult, BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY);
  assert.equal(result.bodyDescentDepth, 5);
  assert.equal(result.bodyDescentUniqueBranchSteps, 5);
  assert.equal(result.resultClass, RESULT.NOT_FOUND);
  assert.equal(result.structurallyTrustedExactCandidateCount, 0);
});

test('G5.7FJ production descendant admission leaves every unsafe exact descendant fail closed', async () => {
  const rows = plausibilityFixtures();
  const staleHiddenDuplicate = rootWithoutBody([exact(), exact({ visible: false })]);
  const interactiveExact = rootWithoutBody([node(TEXT, { directText: true, control: true })]);
  const unrelatedSibling = rootWithoutBody([other()]);
  const unsafe = {
    comment: rows.I,
    reply: node(TEXT, { directText: true, role: 'comment' }),
    hidden: rows.E,
    detached: rows.F,
    embedded: rows.J,
    interactive: interactiveExact,
    duplicateBranches: rows.K,
    staleHiddenDuplicate,
    unrelatedSibling,
    nestedUnsafeContent: rows.J,
  };
  for (const [name, root] of Object.entries(unsafe)) {
    const canonical = root.tagName === 'ARTICLE' ? root : rootWithoutBody([root]);
    const snapshot = (await capture(canonical)).candidates[0];
    const result = diagnoseArticleBodySubtrees(snapshot, TEXT);
    const classified = classifyRefreshedTargetCandidates([snapshot], TEXT, { trustedNewness: true });
    assert.notEqual(result.bodyDescentResult, BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION, `${name} descent`);
    assert.notEqual(classified.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST, `${name} classifier`);
  }
});

test('G5.7FJ baseline N-T shares descendant admission without contaminating clean zero', async () => {
  const rows = plausibilityFixtures();
  const clean = (await capture(rootWithoutBody([other()]))).candidates[0];
  const exactDescendant = (await capture(rootWithoutBody([exact()]))).candidates[0];
  const hiddenDescendant = (await capture(rootWithoutBody([exact({ visible: false })]))).candidates[0];
  const captured = async (root) => (await capture(root)).candidates[0];
  assert.equal(classifyPreClickBaseline([clean], TEXT).baselineResultClass, BASELINE_RESULT.ZERO, 'N');
  assert.equal(classifyPreClickBaseline([exactDescendant], TEXT).baselineResultClass, BASELINE_RESULT.ONE, 'O');
  assert.equal(classifyPreClickBaseline([hiddenDescendant], TEXT).baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL, 'P');
  assert.equal(classifyPreClickBaseline([await captured(rows.I)], TEXT).baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL, 'Q');
  assert.equal(classifyPreClickBaseline([await captured(rows.J)], TEXT).baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL, 'R');
  assert.equal(classifyPreClickBaseline([await captured(rows.K)], TEXT).baselineResultClass, BASELINE_RESULT.UNTRUSTED_BODY_SIGNAL, 'S');
  assert.equal(classifyPreClickBaseline([clean], TEXT).baselineImmutableBodySignalCandidateCount, 0, 'T');
});

test('G5.7FJ reload U-X preserves strict hidden failure, trusted newness, and duplicate ambiguity', async () => {
  const rows = plausibilityFixtures();
  const captured = async (root) => (await capture(root)).candidates[0];
  const zeroCandidate = await captured(rows.M);
  const exactCandidate = await captured(rows.G);
  const hiddenCandidate = await captured(rootWithoutBody([repeated(4, exact({ visible: false }))]));
  const protectedResult = classifyRefreshedTargetCandidates([hiddenCandidate, zeroCandidate], TEXT, { trustedNewness: true });
  assert.equal(protectedResult.bodyDescentResult, BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY, 'U');
  assert.equal(protectedResult.structurallyTrustedExactCandidateCount, 0, 'U trusted');
  const exactResult = classifyRefreshedTargetCandidates([exactCandidate], TEXT, { trustedNewness: true });
  assert.equal(exactResult.resultClass, RESULT.VERIFIED_EXACT_TARGET_POST, 'V');
  assert.equal(exactResult.structurallyTrustedExactCandidateCount, 1, 'V trusted');
  const baseline = classifyPreClickBaseline({ candidates: [zeroCandidate], discovery: { discoveryComplete: true, candidateCapReached: false } }, TEXT);
  const transition = summary({ ...baseline, ...exactResult });
  assert.equal(transition.newnessTransitionClass, 'ZERO_TO_ONE', 'W');
  assert.equal(transition.trustedNewnessEstablished, true, 'W trusted');
  assert.equal(classifyRefreshedTargetCandidates([exactCandidate, exactCandidate], TEXT, { trustedNewness: true }).resultClass, RESULT.AMBIGUOUS, 'X');
});

test('G5.7FJ admission diagnostics keep root and descendant evidence distinct', async () => {
  const rootOnly = candidate([], { innerText: TEXT, textContent: TEXT });
  const both = candidate([exact()], { innerText: TEXT, textContent: TEXT });
  const rootResult = diagnoseArticleBodySubtrees((await capture(rootOnly)).candidates[0], TEXT);
  const bothResult = diagnoseArticleBodySubtrees((await capture(both)).candidates[0], TEXT);
  assert.equal(rootResult.bodyDescentAdmissionSource, BODY_DESCENT_ADMISSION_SOURCES.ROOT);
  assert.equal(rootResult.candidateRootBodySignal, true);
  assert.equal(rootResult.candidateDescendantBodySignal, false);
  assert.equal(bothResult.bodyDescentAdmissionSource, BODY_DESCENT_ADMISSION_SOURCES.BOTH);
  assert.equal(bothResult.candidateRootBodySignal, true);
  assert.equal(bothResult.candidateDescendantBodySignal, true);
});
