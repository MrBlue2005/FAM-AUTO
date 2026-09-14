'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { COMPOSER_EDITOR_SELECTOR, COMPOSER_ROOT_SELECTOR, GROUP_COMPOSER_STRUCTURAL_SELECTOR, createRootPair, eligibleEditors, inspectRootLocalEditorShapes, inspectRootLocalSelectorParity, openComposer, summarizeEditorShapes, summarizePreSelectorEditorShapes } = require('../app/facebook/composer');
const { createComposerAcquisitionDiagnosticSink, sanitizeCandidate, sanitizePreSelectorShapeSummary, sanitizeSelectorParity, sanitizeSelectorParitySummary, sanitizeContentMismatch } = require('../app/local-agent/ComposerAcquisitionDiagnostics');

function structuralNode(config = {}) {
  const attributes = {
    contenteditable: config.contenteditable,
    role: config.role,
    'data-lexical-editor': config.lexical === true ? 'true' : undefined,
    'aria-multiline': config.ariaMultiline === true ? 'true' : undefined,
    'aria-disabled': config.disabled === true ? 'true' : undefined,
    'aria-readonly': config.readOnly === true ? 'true' : undefined,
  };
  return {
    isConnected: config.attached !== false,
    isContentEditable: config.isContentEditable === true,
    disabled: config.disabled === true,
    readOnly: config.readOnly === true,
    tabIndex: config.tabIndex || 0,
    tagName: config.tagName || 'DIV',
    children: Array.from({ length: config.childElementCount || 0 }),
    ownerDocument: { designMode: 'off', defaultView: { getComputedStyle: () => ({ display: config.visible === false ? 'none' : 'block', visibility: 'visible' }) } },
    parentElement: { closest: () => config.ancestorEditable === true ? {} : null },
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    getAttribute: (name) => attributes[name] === undefined ? null : attributes[name],
    hasAttribute: (name) => attributes[name] !== undefined,
    querySelectorAll: () => Array.from({ length: config.descendantEditableCount || 0 }),
  };
}

function root(id, editors, options = {}) {
  const item = {
    id, editors, visible: options.visible !== false, attached: options.attached !== false, isConnected: options.attached !== false,
    role: options.role === undefined ? 'dialog' : options.role,
    ariaModal: options.ariaModal === true, pagelet: options.pagelet || '', actionRegion: options.actionRegion !== false, editorOptions: options.editorOptions || {},
    getAttribute(name) { return ({ role: this.role, 'aria-modal': this.ariaModal ? 'true' : '', 'data-pagelet': this.pagelet, 'aria-label': '', 'data-testid': '' })[name] || ''; },
    closest() { return null; }, querySelector() { return this.actionRegion ? {} : null; },
  };
  item.querySelectorAll = () => (options.preSelectorCandidates || []).map(structuralNode);
  return item;
}

function fakePage(before, after) {
  const state = { roots: before, clicked: 0, retainedRootLocatorCalls: 0 };
  const editor = (item, index) => {
    const config = Array.isArray(item.editorOptions) ? (item.editorOptions[index] || {}) : item.editorOptions;
    const node = {
      isContentEditable: config.isContentEditable === undefined ? config.contenteditable !== false : config.isContentEditable === true,
      getAttribute: (name) => ({ contenteditable: config.contenteditable === false ? 'false' : 'true', role: config.role === undefined ? 'textbox' : config.role, 'aria-label': config.ariaLabel || '', placeholder: '', 'data-testid': '', 'data-pagelet': '', 'data-lexical-editor': config.lexical === true ? 'true' : '' })[name] || '',
      closest: (selector) => config.lexical === true && /lexical|ProseMirror/.test(String(selector || '')) ? {} : null,
      tagName: config.tagName || 'DIV',
    };
    const locator = { isVisible: async () => config.visible !== false, isEnabled: async () => config.enabled !== false, isEditable: async () => config.editable !== false, evaluate: async (fn) => fn(node) };
    locator.elementHandle = async () => locator;
    return locator;
  };
  const handle = (item) => ({
    _node: item, evaluate: async (fn, arg) => fn(item, arg), isVisible: async () => item.visible,
  });
  const retainedRootLocator = (item) => ({
    elementHandle: async () => handle(item),
    waitFor: async () => { if (!item.visible) throw new Error('hidden'); },
    locator: (selector) => {
      state.retainedRootLocatorCalls += 1;
      assert.equal(selector, COMPOSER_EDITOR_SELECTOR);
      return { count: async () => item.editors, nth: (index) => editor(item, index) };
    },
  });
  const page = {
    getByRole: (role, options = {}) => ({ count: async () => role === 'button' && options.name === 'Scrie ceva...' ? 1 : 0, nth: () => ({ isVisible: async () => true, isEnabled: async () => true, click: async () => { state.clicked += 1; state.roots = after; } }) }),
    locator: (selector) => {
      if (selector === COMPOSER_ROOT_SELECTOR) return { count: async () => state.roots.length, nth: (index) => retainedRootLocator(state.roots[index]) };
      assert.equal(selector, GROUP_COMPOSER_STRUCTURAL_SELECTOR);
      return { count: async () => 0, nth: () => null };
    },
    waitForTimeout: async () => {},
  };
  return { page, state };
}

function recorder() {
  const records = [];
  return { records, diagnostic: {
    emit: (stage, reasonClass, evidence) => records.push({ stage, reasonClass, evidence }),
    summary: (stage, reasonClass, evidence) => records.push({ stage, reasonClass, evidence, summary: true }),
    shape: (candidates, summary) => records.push({ stage: 'EDITOR_SHAPE_SNAPSHOT', candidates, summary }),
    shapeSummary: (summary) => records.push({ stage: 'EDITOR_SHAPE_DIAGNOSTIC_SUMMARY', summary }),
    preSelectorShape: (candidates, summary) => records.push({ stage: 'PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT', candidates, summary }),
    preSelectorShapeSummary: (summary) => records.push({ stage: 'PRE_SELECTOR_EDITOR_SHAPE_SUMMARY', summary }),
  } };
}

async function acquire(before, after) {
  const fixture = fakePage(before, after); const capture = recorder();
  const run = openComposer(fixture.page, { diagnostic: capture.diagnostic, transitionTimeoutMs: 0, transitionPollMs: 0 });
  return { fixture, capture, run };
}

test('composer acquisition emits safe rejection classes for structural, zero-editor, multiple-editor, and no-transition failures', async () => {
  const cases = [
    { after: [root('old', 0), root('structural', 1, { actionRegion: false })], code: 'FACEBOOK_COMPOSER_OPEN_FAILED', stage: 'COMPOSER_ROOT_STRUCTURAL_REJECTED' },
    { after: [root('old', 0), root('zero', 0)], code: 'FACEBOOK_COMPOSER_OPEN_FAILED', stage: 'COMPOSER_ROOT_ZERO_EDITOR' },
    { after: [root('old', 0), root('multiple', 2)], code: 'FACEBOOK_COMPOSER_UNVERIFIED', stage: 'COMPOSER_ROOT_MULTIPLE_EDITORS' },
    { after: [root('old', 0)], code: 'FACEBOOK_COMPOSER_OPEN_FAILED', stage: 'COMPOSER_ROOT_NO_TRANSITION' },
  ];
  for (const item of cases) {
    const { capture, run } = await acquire([root('old', 0)], item.after);
    await assert.rejects(run, { code: item.code });
    assert.ok(capture.records.some((record) => record.stage === item.stage));
    assert.ok(capture.records.some((record) => record.stage === 'COMPOSER_ACQUISITION_FAILED' && record.summary));
  }
});

test('ambiguous and accepted transitions emit their distinct safe outcomes', async () => {
  const ambiguous = await acquire([root('old', 0)], [root('old', 0), root('one', 1), root('two', 1)]);
  await assert.rejects(ambiguous.run, { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
  assert.ok(ambiguous.capture.records.some((record) => record.stage === 'COMPOSER_ROOT_AMBIGUOUS'));

  const accepted = await acquire([root('old', 0)], [root('old', 0), root('accepted', 1)]);
  await accepted.run;
  assert.equal(accepted.fixture.state.clicked, 1);
  assert.ok(accepted.capture.records.some((record) => record.stage === 'COMPOSER_ROOT_ACCEPTED'));
  assert.ok(accepted.capture.records.some((record) => record.stage === 'COMPOSER_EDITOR_BOUND'));
});

test('a parity-positive editor is discovered only through its retained root Locator and is bound exactly once', async () => {
  const result = await acquire(
    [root('old', 0, { actionRegion: false })],
    [root('old', 0, { actionRegion: false }), root('modal', 1, {
      ariaModal: true,
      editorOptions: { role: 'textbox', contenteditable: true, lexical: true, isContentEditable: true },
      preSelectorCandidates: [{ tagName: 'DIV', role: 'textbox', contenteditable: 'true', hasDataLexicalEditor: true, isContentEditable: true, visible: true, attached: true }],
    })],
  );
  const composer = await result.run;
  assert.ok(composer.editor);
  assert.ok(result.fixture.state.retainedRootLocatorCalls > 0);
  assert.ok(result.capture.records.some((record) => record.stage === 'COMPOSER_ROOT_ACCEPTED'));
  assert.ok(result.capture.records.some((record) => record.stage === 'COMPOSER_EDITOR_BOUND'));
});

test('the observed visible modal with one alternate contenteditable editor is accepted and safely classified', async () => {
  const observed = await acquire(
    [root('old', 0, { actionRegion: false })],
    [root('old', 0, { actionRegion: false }), root('visible-modal', 1, { ariaModal: true, editorOptions: { role: '', contenteditable: true } })],
  );
  const composer = await observed.run;
  assert.ok(composer.editor);
  const observation = observed.capture.records.filter((record) => record.stage === 'COMPOSER_POST_CLICK_OBSERVATION').at(-1);
  assert.equal(observation.evidence.counters.rootsWithZeroEditor, 0);
  assert.equal(observation.evidence.counters.rootsWithOneEditor, 1);
  assert.equal(observation.evidence.flags.hasContentEditable, true);
  assert.equal(observation.evidence.flags.hasRoleTextbox, false);
  assert.ok(observed.capture.records.some((record) => record.stage === 'COMPOSER_ROOT_ACCEPTED'));
  assert.ok(observed.capture.records.some((record) => record.stage === 'COMPOSER_EDITOR_BOUND'));
});

test('per-task diagnostic files are isolated, whitelisted, and bounded', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-composer-diagnostic-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory, now: () => '2026-09-13T00:00:00.000Z', maxRecords: 3, maxBytes: 4096 });
    const first = sink.forTask('task_alpha'); const second = sink.forTask('task_beta');
    first.emit('COMPOSER_ROOT_ZERO_EDITOR', 'ZERO_ELIGIBLE_EDITOR', {
      counters: { potentialRootCount: 99999, forbiddenCounter: 1 },
      flags: { hasRoleDialog: true, forbiddenFlag: true },
      html: '<secret html>', text: 'private text', cookie: 'c_user=123', token: 'token', accountId: '123',
    });
    for (let index = 0; index < 10; index += 1) first.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index % 2 } });
    first.summary('COMPOSER_ACQUISITION_FAILED', 'NO_ELIGIBLE_TRANSITION', { counters: { potentialRootCount: 99999 } });
    second.emit('COMPOSER_DISCOVERY_START', 'DISCOVERY_STARTED');

    const alpha = fs.readFileSync(path.join(directory, 'task_alpha.json'), 'utf8');
    const beta = fs.readFileSync(path.join(directory, 'task_beta.json'), 'utf8');
    const alphaData = JSON.parse(alpha);
    assert.equal(alphaData.task_id, 'task_alpha'); assert.equal(JSON.parse(beta).task_id, 'task_beta');
    assert.ok(alphaData.records.length <= 4); assert.ok(Buffer.byteLength(alpha, 'utf8') <= 4096);
    assert.match(alpha, /COMPOSER_ACQUISITION_FAILED/);
    assert.match(alpha, /"potentialRootCount":1000/);
    assert.doesNotMatch(alpha, /secret html|private text|c_user|token|accountId|forbiddenCounter|forbiddenFlag/);
    assert.doesNotMatch(beta, /task_alpha/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('terminal acquisition evidence is retained when repeated snapshots approach the byte bound', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-composer-terminal-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory, now: () => '2026-09-13T00:00:00.000Z', maxRecords: 64, maxBytes: 1200 });
    const record = sink.forTask('task_terminal');
    for (let index = 0; index < 64; index += 1) record.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index }, flags: { hasRoleDialog: true, hasContentEditable: true } });
    record.summary('COMPOSER_ACQUISITION_FAILED', 'NO_ELIGIBLE_TRANSITION', { counters: { potentialRootCount: 1 } });
    const saved = fs.readFileSync(path.join(directory, 'task_terminal.json'), 'utf8');
    assert.ok(Buffer.byteLength(saved, 'utf8') <= 1200);
    assert.match(saved, /COMPOSER_ACQUISITION_FAILED/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('root-local editor shape records classify supported structural families without private fields', () => {
  const cases = [
    { role: 'textbox', reason: 'ROLE_ATTRIBUTE' },
    { contenteditable: 'true', reason: 'CONTENTEDITABLE_ATTRIBUTE' },
    { contenteditable: 'plaintext-only', reason: 'CONTENTEDITABLE_ATTRIBUTE' },
    { contenteditable: 'false', reason: 'CONTENTEDITABLE_ATTRIBUTE' },
    { ancestorEditable: true, reason: 'TABINDEX' },
    { hasDataLexicalEditor: true, reason: 'LEXICAL_ATTRIBUTE' },
    { tagName: 'textarea', reason: 'TEXTAREA_TAG' },
    { role: 'other', reason: 'ROLE_ATTRIBUTE' },
  ];
  for (const item of cases) {
    const candidate = sanitizeCandidate({ tagName: 'div', attached: true, visible: true, childElementCount: 9999, ...item, text: 'private', id: 'private', className: 'private', value: 'private' });
    assert.equal(candidate.reason, item.reason); assert.equal(candidate.childElementCount, 1000);
    assert.equal(Object.hasOwn(candidate, 'text'), false); assert.equal(Object.hasOwn(candidate, 'id'), false); assert.equal(Object.hasOwn(candidate, 'className'), false); assert.equal(Object.hasOwn(candidate, 'value'), false);
  }
});

test('editor-shape inspection is invoked only on the retained root handle, never through a page locator', async () => {
  let calls = 0;
  const retainedRoot = { evaluate: async (_callback, max) => { calls += 1; assert.equal(max, 12); return [{ tagName: 'div', role: 'textbox', contenteditable: 'inherited/absent', visible: true, attached: true, reason: 'ROLE_ATTRIBUTE' }]; } };
  const result = await inspectRootLocalEditorShapes(retainedRoot);
  assert.equal(calls, 1); assert.equal(result.candidates.length, 1); assert.equal(result.summary.roleTextboxCount, 1);
});

test('editor-shape snapshots are root-local payloads, bounded, and retain terminal summary', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-editor-shape-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 8, maxBytes: 12000, now: () => '2026-09-13T00:00:00.000Z' });
    const record = sink.forTask('root_only');
    const candidates = Array.from({ length: 20 }, (_, index) => ({ tagName: index === 0 ? 'textarea' : 'div', role: null, contenteditable: 'inherited/absent', visible: true, attached: true, reason: 'TABINDEX', innerText: 'never persist', selector: 'never persist' }));
    for (let index = 0; index < 6; index += 1) record.shape(candidates, { candidateCount: 20, textareaCount: 1 });
    record.shapeSummary({ candidateCount: 20, textareaCount: 1 });
    const saved = fs.readFileSync(path.join(directory, 'root_only.json'), 'utf8'); const data = JSON.parse(saved);
    assert.ok(data.records.filter((item) => item.stage === 'EDITOR_SHAPE_SNAPSHOT').length <= 3);
    assert.ok(data.records.some((item) => item.stage === 'EDITOR_SHAPE_DIAGNOSTIC_SUMMARY'));
    assert.ok(data.records.filter((item) => item.editorShapeCandidates).every((item) => item.editorShapeCandidates.length <= 12));
    assert.doesNotMatch(saved, /never persist|innerText|selector/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('pre-selector root-local shape is captured even when the editor selector returns zero', async () => {
  const result = await acquire(
    [root('old', 0, { actionRegion: false })],
    [root('old', 0, { actionRegion: false }), root('modal', 0, {
      ariaModal: true,
      // This bounded structural node is deliberately not matched by
      // COMPOSER_EDITOR_SELECTOR; the snapshot must still explain the miss.
      preSelectorCandidates: [{ tagName: 'DIV', tabIndex: 0, visible: true, attached: true }],
    })],
  );
  await assert.rejects(result.run, { code: 'FACEBOOK_COMPOSER_OPEN_FAILED' });
  const snapshot = result.capture.records.find((record) => record.stage === 'PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT');
  assert.equal(snapshot.candidates.length, 1);
  assert.equal(snapshot.candidates[0].tagName, 'div');
  assert.equal(snapshot.summary.candidateCount, 1);
  assert.equal(snapshot.summary.contenteditablePresentCount, 0);
  assert.ok(result.capture.records.some((record) => record.stage === 'PRE_SELECTOR_EDITOR_SHAPE_SUMMARY'));
  assert.ok(result.capture.records.some((record) => record.stage === 'COMPOSER_ACQUISITION_FAILED'));
});

test('pre-selector and eligibility diagnostics both persist when the selector accepts an editor', async () => {
  const result = await acquire(
    [root('old', 0, { actionRegion: false })],
    [root('old', 0, { actionRegion: false }), root('modal', 1, {
      ariaModal: true,
      editorOptions: { role: 'textbox', contenteditable: true, isContentEditable: true },
      preSelectorCandidates: [{ tagName: 'DIV', role: 'textbox', contenteditable: 'true', isContentEditable: true, visible: true, attached: true }],
    })],
  );
  await result.run;
  const preSelector = result.capture.records.find((record) => record.stage === 'PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT');
  const eligibility = result.capture.records.find((record) => record.stage === 'EDITOR_SHAPE_SNAPSHOT');
  assert.equal(preSelector.summary.roleTextboxCount, 1);
  assert.equal(eligibility.candidates[0].eligibilityRejectionReason, 'ACCEPTED');
  assert.ok(result.capture.records.some((record) => record.stage === 'PRE_SELECTOR_EDITOR_SHAPE_SUMMARY'));
});

test('pre-selector snapshot, summary, and terminal failure survive diagnostic log pressure without private data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-pre-selector-retention-'));
  try {
    // Even an erroneously tiny caller cap cannot discard the three protected
    // records needed to explain a reviewed selector miss.
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 1, maxBytes: 12000, now: () => '2026-09-13T00:00:00.000Z' });
    const record = sink.forTask('task_pre_selector');
    for (let index = 0; index < 12; index += 1) record.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index } });
    record.preSelectorShape([{ tagName: 'div', role: null, visible: true, attached: true, reason: 'TABINDEX', text: 'never persist', cookie: 'never persist' }], { candidateCount: 1, visibleCandidateCount: 1 });
    record.preSelectorShapeSummary({ candidateCount: 1, visibleCandidateCount: 1 });
    record.summary('COMPOSER_ACQUISITION_FAILED', 'NO_ELIGIBLE_TRANSITION', { counters: { potentialRootCount: 1 } });
    const saved = fs.readFileSync(path.join(directory, 'task_pre_selector.json'), 'utf8');
    const stages = JSON.parse(saved).records.map((item) => item.stage);
    assert.ok(stages.includes('PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT'));
    assert.ok(stages.includes('PRE_SELECTOR_EDITOR_SHAPE_SUMMARY'));
    assert.ok(stages.includes('COMPOSER_ACQUISITION_FAILED'));
    assert.ok(stages.length <= 4);
    assert.doesNotMatch(saved, /never persist|cookie/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('pre-selector summaries are fixed, bounded, and task-isolated', () => {
  const summary = sanitizePreSelectorShapeSummary({ candidateCount: 9999, roleTextboxCount: 2, unknown: 5 });
  assert.equal(summary.candidateCount, 1000);
  assert.equal(summary.roleTextboxCount, 2);
  assert.equal(Object.hasOwn(summary, 'unknown'), false);
  const source = [
    { tagName: 'div', role: 'textbox', contenteditable: 'true', isContentEditable: true, ariaMultiline: true, visible: true },
    { tagName: 'textarea', role: null, contenteditable: 'inherited/absent', ancestorEditable: true },
  ];
  const counts = summarizePreSelectorEditorShapes(source);
  assert.equal(counts.contenteditableTrueCount, 1);
  assert.equal(counts.textareaCount, 1);
  assert.equal(counts.ariaMultilineCount, 1);
});

function parityRoot({ domCount = 0, playwrightCount = 0, attached = true, visible = true, throwOnEvaluate = false, missingLocator = false } = {}) {
  let locatorCalls = 0;
  const branchCounts = {
    '[contenteditable="true"]': domCount,
    '[role="textbox"]': domCount,
    '[data-lexical-editor="true"]': domCount,
  };
  const handle = {
    evaluate: async (callback, selector) => {
      if (throwOnEvaluate) throw new Error('private runtime error');
      return callback({
        isConnected: attached,
        querySelectorAll: (value) => Array.from({ length: value === selector ? domCount : branchCounts[value] || 0 }),
      }, selector);
    },
    isVisible: async () => visible,
  };
  const locator = missingLocator ? null : {
    locator: (selector) => {
      locatorCalls += 1;
      assert.equal(selector, COMPOSER_EDITOR_SELECTOR);
      return { count: async () => playwrightCount };
    },
  };
  return {
    handle,
    locator,
    rootPair: createRootPair(locator, handle),
    locatorCalls: () => locatorCalls,
  };
}

test('same-root selector parity classifies equal, zero, and divergent counts', async () => {
  const cases = [
    [1, 1, 'BOTH_NONZERO_EQUAL'],
    [0, 0, 'BOTH_ZERO'],
    [1, 0, 'DOM_NONZERO_PLAYWRIGHT_ZERO'],
    [0, 1, 'DOM_ZERO_PLAYWRIGHT_NONZERO'],
    [2, 1, 'BOTH_NONZERO_DIFFERENT'],
  ];
  for (const [domCount, playwrightCount, expected] of cases) {
    const mock = parityRoot({ domCount, playwrightCount });
    const sample = await inspectRootLocalSelectorParity(mock.rootPair);
    assert.equal(sample.selectorParityResult, expected);
    assert.equal(sample.domNativeCount, domCount);
    assert.equal(sample.playwrightScopedCount, playwrightCount);
    assert.equal(sample.rootAttached, true);
    assert.equal(sample.rootVisible, true);
    assert.equal(sample.sameRootReference, true);
    assert.equal(mock.locatorCalls(), 1);
  }
});

test('same-root selector parity classifies unavailable roots and safe evaluation errors', async () => {
  const unavailable = await inspectRootLocalSelectorParity(null);
  assert.equal(unavailable.selectorParityResult, 'ROOT_UNAVAILABLE');
  assert.equal(unavailable.sameRootReference, false);
  const detached = await inspectRootLocalSelectorParity(parityRoot({ attached: false }).rootPair);
  assert.equal(detached.selectorParityResult, 'ROOT_UNAVAILABLE');
  assert.equal(detached.sameRootReference, true);
  const missingLocator = await inspectRootLocalSelectorParity(parityRoot({ missingLocator: true }).rootPair);
  assert.equal(missingLocator.selectorParityResult, 'ROOT_UNAVAILABLE');
  assert.equal(missingLocator.sameRootReference, false);
  const valid = parityRoot();
  const invalidPair = await inspectRootLocalSelectorParity({ handle: valid.handle, locator: valid.locator });
  assert.equal(invalidPair.selectorParityResult, 'ROOT_UNAVAILABLE');
  assert.equal(invalidPair.sameRootReference, false);
  const safeError = await inspectRootLocalSelectorParity(parityRoot({ throwOnEvaluate: true }).rootPair);
  assert.equal(safeError.selectorParityResult, 'SAFE_EVALUATION_ERROR');
  assert.equal(safeError.domNativeCount, 0);
  assert.equal(safeError.playwrightScopedCount, 0);
});

test('selector parity uses only the paired retained locator and never a generic reacquisition', async () => {
  const mock = parityRoot({ domCount: 1, playwrightCount: 1 });
  assert.equal(typeof mock.handle.locator, 'undefined');
  const sample = await inspectRootLocalSelectorParity(mock.rootPair);
  assert.equal(sample.sameRootReference, true);
  assert.equal(sample.selectorParityResult, 'BOTH_NONZERO_EQUAL');
  assert.equal(mock.locatorCalls(), 1);
});

test('selector parity records are bounded, private, and retain their terminal aggregate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-selector-parity-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 1, maxBytes: 12000, now: () => '2026-09-13T00:00:00.000Z' });
    const record = sink.forTask('selector_parity');
    for (let index = 0; index < 12; index += 1) record.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index } });
    record.selectorParity({ domNativeCount: 1, playwrightScopedCount: 0, rootAttached: true, rootVisible: true, sameRootReference: true, selectorParityResult: 'DOM_NONZERO_PLAYWRIGHT_ZERO', branchCounts: { contenteditableTrueCount: 1, roleTextboxCount: 1, lexicalSelectorCount: 1 }, text: 'never persist', selector: 'never persist' });
    record.selectorParitySummary({ samples: 1, domNonzeroPlaywrightZeroCount: 1, privateValue: 10 });
    record.summary('COMPOSER_ACQUISITION_FAILED', 'NO_ELIGIBLE_TRANSITION', {});
    const saved = fs.readFileSync(path.join(directory, 'selector_parity.json'), 'utf8');
    const data = JSON.parse(saved);
    assert.ok(data.records.some((item) => item.stage === 'EDITOR_SELECTOR_PARITY_SUMMARY'));
    assert.ok(data.records.some((item) => item.stage === 'COMPOSER_ACQUISITION_FAILED'));
    const parity = data.records.find((item) => item.stage === 'EDITOR_SELECTOR_PARITY_SNAPSHOT')?.selectorParity;
    assert.equal(parity?.sameRootReference, true);
    assert.equal(parity?.selectorParityResult, 'DOM_NONZERO_PLAYWRIGHT_ZERO');
    assert.equal(Object.hasOwn(parity || {}, 'text'), false);
    assert.doesNotMatch(saved, /never persist|privateValue/);
    const sanitized = sanitizeSelectorParity({ domNativeCount: 9999, selectorParityResult: 'untrusted', branchCounts: { roleTextboxCount: 2 }, cookie: 'never persist' });
    assert.equal(sanitized.domNativeCount, 1000);
    assert.equal(sanitized.selectorParityResult, 'SAFE_EVALUATION_ERROR');
    assert.equal(sanitized.branchCounts.roleTextboxCount, 2);
    assert.deepEqual(sanitizeSelectorParitySummary({ samples: 1, unknown: 9 }), { samples: 1, bothZeroCount: 0, bothNonzeroEqualCount: 0, bothNonzeroDifferentCount: 0, domNonzeroPlaywrightZeroCount: 0, domZeroPlaywrightNonzeroCount: 0, rootUnavailableCount: 0, safeEvaluationErrorCount: 0 });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('content mismatch terminal summary is fixed, private, and survives bounded diagnostic log pressure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-content-mismatch-retention-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory, maxRecords: 1, maxBytes: 12000, now: () => '2026-09-14T00:00:00.000Z' });
    const record = sink.forTask('content_mismatch');
    for (let index = 0; index < 12; index += 1) record.emit('COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', { counters: { potentialRootCount: index } });
    record.contentMismatchSummary({
      expectedNormalizedLength: 20, actualNormalizedLength: 0,
      expectedSha256Prefix: '0123456789abcdef', actualSha256Prefix: 'fedcba9876543210',
      expectedLineCount: 2, actualLineCount: 0,
      expectedLeadingWhitespaceCount: 1, actualLeadingWhitespaceCount: 0,
      expectedTrailingWhitespaceCount: 1, actualTrailingWhitespaceCount: 0,
      expectedNewlineCount: 1, actualNewlineCount: 0,
      lengthRelation: 'EMPTY', insertionMethod: 'CLIPBOARD_PASTE', verificationReadCount: 1,
      verificationReadTiming: 'BOUNDED_POST_PASTE_SYNC', matchedOnReadNumber: null,
      settleDurationMs: 2000, finalLengthRelation: 'EMPTY',
      normalizationStages: {
        raw: { expected: { length: 22 }, actual: { length: 0 } },
        nfc: { expected: { length: 22, sha256Prefix: '0123456789abcdef' }, actual: { length: 0, sha256Prefix: 'fedcba9876543210' } },
        crlfToLf: { expected: { length: 21, sha256Prefix: '0123456789abcdef' }, actual: { length: 0, sha256Prefix: 'fedcba9876543210' } },
        nbspToSpace: { expected: { length: 21, sha256Prefix: '0123456789abcdef' }, actual: { length: 0, sha256Prefix: 'fedcba9876543210' } },
        final: { expected: { length: 20, sha256Prefix: '0123456789abcdef' }, actual: { length: 0, sha256Prefix: 'fedcba9876543210' } },
      },
      text: 'PRIVATE_FACEBOOK_COMPOSER_TEXT', cookie: 'never persist',
    });
    const saved = fs.readFileSync(path.join(directory, 'content_mismatch.json'), 'utf8');
    const data = JSON.parse(saved);
    const summary = data.records.find((item) => item.stage === 'CONTENT_MISMATCH_DIAGNOSTIC_SUMMARY');
    assert.ok(summary);
    assert.equal(summary.contentMismatch.lengthRelation, 'EMPTY');
    assert.equal(summary.contentMismatch.insertionMethod, 'CLIPBOARD_PASTE');
    assert.equal(summary.contentMismatch.verificationReadTiming, 'BOUNDED_POST_PASTE_SYNC');
    assert.equal(summary.contentMismatch.matchedOnReadNumber, null);
    assert.equal(summary.contentMismatch.settleDurationMs, 2000);
    assert.equal(summary.contentMismatch.finalLengthRelation, 'EMPTY');
    assert.equal(summary.contentMismatch.normalizationStages.final.expected.length, 20);
    assert.ok(data.records.length <= 4);
    assert.doesNotMatch(saved, /PRIVATE_FACEBOOK_COMPOSER_TEXT|never persist|cookie/);
    const sanitized = sanitizeContentMismatch({ expectedNormalizedLength: 9999, unknown: 'private', lengthRelation: 'untrusted', insertionMethod: 'untrusted' });
    assert.equal(sanitized.expectedNormalizedLength, 1000);
    assert.equal(sanitized.lengthRelation, 'EXACT_LENGTH');
    assert.equal(sanitized.insertionMethod, 'OTHER_FIXED_METHOD');
    assert.equal(sanitized.matchedOnReadNumber, null);
    assert.equal(Object.hasOwn(sanitized, 'unknown'), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('content mismatch diagnostics retain the fixed retained-editor multiline insertion enum', () => {
  const sanitized = sanitizeContentMismatch({ insertionMethod: 'RETAINED_EDITOR_SHIFT_ENTER' });
  assert.equal(sanitized.insertionMethod, 'RETAINED_EDITOR_SHIFT_ENTER');
});

function eligibilityRoot(configs) {
  const locatorFor = (config = {}) => {
    const node = {
      isConnected: config.attached !== false,
      isContentEditable: config.isContentEditable === undefined ? config.contenteditable !== false : config.isContentEditable === true,
      disabled: config.disabled === true,
      readOnly: config.readOnly === true,
      tabIndex: config.tabIndex === undefined ? 0 : config.tabIndex,
      children: Array.from({ length: config.childElementCount || 0 }),
      ownerDocument: { designMode: 'off' },
      getAttribute: (name) => ({
        contenteditable: config.contenteditable === false ? 'false' : 'true',
        role: config.role === undefined ? 'textbox' : config.role,
        'aria-label': config.ariaLabel || '',
        placeholder: config.placeholder || '',
        'data-testid': config.testId || '',
        'data-pagelet': config.pagelet || '',
        'data-lexical-editor': config.lexical === true ? 'true' : '',
        'aria-multiline': config.ariaMultiline === true ? 'true' : '',
        'aria-disabled': config.ariaDisabled === true ? 'true' : '',
        'aria-readonly': config.ariaReadOnly === true ? 'true' : '',
      })[name] || '',
      hasAttribute: (name) => ['contenteditable', 'role'].includes(name) || (name === 'data-lexical-editor' && config.lexical === true),
      closest: (selector) => config.lexical === true && /lexical|ProseMirror/.test(String(selector || '')) ? {} : null,
      querySelectorAll: () => Array.from({ length: config.descendantEditableCount || 0 }),
      tagName: config.tagName || 'DIV',
      parentElement: { closest: () => config.ancestorEditable === true ? {} : null },
    };
    const result = {
      isVisible: async () => config.visible !== false,
      isEnabled: async () => config.enabled !== false,
      isEditable: async () => config.editable !== false,
      evaluate: async (callback) => {
        if (config.evaluateFails) throw new Error('detached');
        return callback(node);
      },
      elementHandle: async () => result,
    };
    return result;
  };
  return {
    locator: (selector) => {
      assert.equal(selector, COMPOSER_EDITOR_SELECTOR);
      return { count: async () => configs.length, nth: (index) => locatorFor(configs[index]) };
    },
  };
}

test('eligibility diagnostics report the first existing runtime rejection without changing accepted-editor selection', async () => {
  const observed = [];
  const candidates = await eligibleEditors(eligibilityRoot([
    // Candidate #10-style editor: inside the retained root, visible, enabled,
    // editable, textbox/contenteditable, and Lexical.
    { tagName: 'DIV', role: 'textbox', contenteditable: true, lexical: true, isContentEditable: true },
    { enabled: false },
    { editable: false },
    { ariaLabel: 'comment reply' },
    { role: 'other', contenteditable: false, isContentEditable: false },
    { visible: false },
    { evaluateFails: true },
  ]), { onCandidate: (candidate) => observed.push(candidate) });
  assert.equal(candidates.length, 1);
  assert.deepEqual(observed.map((candidate) => candidate.eligibilityRejectionReason), [
    'ACCEPTED', 'PLAYWRIGHT_NOT_ENABLED', 'PLAYWRIGHT_NOT_EDITABLE',
    'COMMENT_REPLY_SEARCH_EXCLUDED', 'NOT_POST_SHAPE', 'HIDDEN', 'OTHER_SAFE_REJECTION',
  ]);
  assert.equal(observed[0].role, 'textbox');
  assert.equal(observed[0].contenteditable, 'true');
  assert.equal(observed[0].hasDataLexicalEditor, true);
  assert.equal(observed[0].isContentEditable, true);
  assert.equal(observed[0].visible, true);
  assert.equal(observed[0].disabled, false);
  assert.equal(observed[0].readOnly, false);
});

test('editor eligibility summary is bounded and contains only fixed counters and enum data', () => {
  const summary = summarizeEditorShapes([
    { eligibilityRejectionReason: 'ACCEPTED', visible: true },
    { eligibilityRejectionReason: 'PLAYWRIGHT_NOT_ENABLED', visible: true },
    { eligibilityRejectionReason: 'PLAYWRIGHT_NOT_EDITABLE', visible: true },
    { eligibilityRejectionReason: 'COMMENT_REPLY_SEARCH_EXCLUDED', visible: true },
    { eligibilityRejectionReason: 'NOT_POST_SHAPE', visible: true },
    { eligibilityRejectionReason: 'HIDDEN', visible: false },
    { eligibilityRejectionReason: 'OTHER_SAFE_REJECTION', visible: true },
  ]);
  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.playwrightNotEnabledCount, 1);
  assert.equal(summary.playwrightNotEditableCount, 1);
  assert.equal(summary.commentReplySearchExcludedCount, 1);
  assert.equal(summary.notPostShapeCount, 1);
  assert.equal(summary.otherSafeRejectionCount, 2);
  assert.equal(summary.candidateCount, 7);
});

test('eligibility rejection enum is whitelisted and does not retain private candidate material', () => {
  const candidate = sanitizeCandidate({
    tagName: 'div', role: 'textbox', eligibilityRejectionReason: 'COMMENT_REPLY_SEARCH_EXCLUDED',
    ariaLabel: 'private label', text: 'private text', html: '<private>', id: 'private-id',
    className: 'private-class', value: 'private-value', url: 'https://private.invalid', cookie: 'c_user=1',
  });
  assert.equal(candidate.eligibilityRejectionReason, 'COMMENT_REPLY_SEARCH_EXCLUDED');
  assert.doesNotMatch(JSON.stringify(candidate), /private|c_user/);
  assert.equal(sanitizeCandidate({ eligibilityRejectionReason: 'not-an-enum' }).eligibilityRejectionReason, 'OTHER_SAFE_REJECTION');
});
