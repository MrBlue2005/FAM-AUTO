'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { COMPOSER_EDITOR_SELECTOR, COMPOSER_ROOT_SELECTOR, GROUP_COMPOSER_STRUCTURAL_SELECTOR, openComposer } = require('../app/facebook/composer');
const { createComposerAcquisitionDiagnosticSink } = require('../app/local-agent/ComposerAcquisitionDiagnostics');

function root(id, editors, options = {}) {
  return {
    id, editors, visible: options.visible !== false, attached: options.attached !== false, isConnected: options.attached !== false,
    role: options.role === undefined ? 'dialog' : options.role,
    ariaModal: options.ariaModal === true, pagelet: options.pagelet || '', actionRegion: options.actionRegion !== false, editorOptions: options.editorOptions || {},
    getAttribute(name) { return ({ role: this.role, 'aria-modal': this.ariaModal ? 'true' : '', 'data-pagelet': this.pagelet, 'aria-label': '', 'data-testid': '' })[name] || ''; },
    closest() { return null; }, querySelector() { return this.actionRegion ? {} : null; },
  };
}

function fakePage(before, after) {
  const state = { roots: before, clicked: 0 };
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
    _node: item, evaluate: async (fn, arg) => fn(item, arg?._node), isVisible: async () => item.visible,
    locator: (selector) => { assert.equal(selector, COMPOSER_EDITOR_SELECTOR); return { count: async () => item.editors, nth: (index) => editor(item, index) }; },
  });
  const page = {
    getByRole: (role, options = {}) => ({ count: async () => role === 'button' && options.name === 'Scrie ceva...' ? 1 : 0, nth: () => ({ isVisible: async () => true, isEnabled: async () => true, click: async () => { state.clicked += 1; state.roots = after; } }) }),
    locator: (selector) => {
      if (selector === COMPOSER_ROOT_SELECTOR) return { count: async () => state.roots.length, nth: (index) => ({ elementHandle: async () => handle(state.roots[index]), waitFor: async () => { if (!state.roots[index].visible) throw new Error('hidden'); } }) };
      assert.equal(selector, GROUP_COMPOSER_STRUCTURAL_SELECTOR);
      return { count: async () => 0, nth: () => null };
    },
    waitForTimeout: async () => {},
  };
  return { page, state };
}

function recorder() {
  const records = [];
  return { records, diagnostic: { emit: (stage, reasonClass, evidence) => records.push({ stage, reasonClass, evidence }), summary: (stage, reasonClass, evidence) => records.push({ stage, reasonClass, evidence, summary: true }) } };
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
    assert.ok(alphaData.records.length <= 3); assert.ok(Buffer.byteLength(alpha, 'utf8') <= 4096);
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
