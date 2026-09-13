'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COMPOSER_EDITOR_SELECTOR, COMPOSER_ROOT_SELECTOR, GROUP_COMPOSER_STRUCTURAL_SELECTOR, openComposer } = require('../app/facebook/composer');

function node(id, editors = 0, options = {}) {
  const attached = options.attached !== false;
  return {
    id,
    editors,
    visible: options.visible !== false,
    attached,
    isConnected: attached,
    role: options.role === undefined ? 'dialog' : options.role,
    ariaModal: options.ariaModal === true,
    pagelet: options.pagelet || '',
    ariaLabel: options.ariaLabel || '',
    actionRegion: options.actionRegion !== false,
    editorOptions: options.editorOptions || {},
    getAttribute(name) {
      return ({ role: this.role, 'aria-modal': this.ariaModal ? 'true' : '', 'data-pagelet': this.pagelet, 'aria-label': this.ariaLabel, 'data-testid': '' })[name] || '';
    },
    closest() { return null; },
    querySelector() { return this.actionRegion ? {} : null; },
  };
}

function collection(items) { return { count: async () => items.length, nth: (index) => items[index] }; }

function fakePage(options = {}) {
  const state = { roots: options.before || [], clicked: 0, ticks: 0, applied: false };
  const calls = { targetChecks: 0, structuralLookups: 0, roleLookups: [] };
  const applyAfter = () => {
    if (!state.applied && state.ticks >= (options.delayTicks || 0)) {
      state.applied = true;
      state.roots = options.after || state.roots;
    }
  };
  const editorFor = (root, index) => {
    const config = Array.isArray(root.editorOptions) ? (root.editorOptions[index] || {}) : root.editorOptions;
    const editor = {
      visible: config.visible !== false,
      enabled: config.enabled !== false,
      editable: config.editable !== false,
      isContentEditable: config.isContentEditable === undefined ? config.contenteditable !== false : config.isContentEditable === true,
      getAttribute(name) {
        return ({ 'contenteditable': config.contenteditable === false ? 'false' : 'true', role: config.role === undefined ? 'textbox' : config.role, 'aria-label': config.ariaLabel || '', placeholder: config.placeholder || '', 'data-testid': config.testId || '', 'data-pagelet': config.pagelet || '', 'data-lexical-editor': config.lexical === true ? 'true' : '' })[name] || '';
      },
      closest(selector) { return config.lexical === true && /lexical|ProseMirror/.test(String(selector || '')) ? {} : null; },
      tagName: config.tagName || 'DIV',
    };
    const locator = { isVisible: async () => editor.visible, isEnabled: async () => editor.enabled, isEditable: async () => editor.editable, evaluate: async (fn) => fn(editor) };
    locator.elementHandle = async () => locator;
    return locator;
  };
  const handleFor = (value) => ({
    _node: value,
    evaluate: async (fn, arg) => fn(value, arg?._node),
    isVisible: async () => value.visible,
    locator: (selector) => {
      assert.equal(selector, COMPOSER_EDITOR_SELECTOR);
      return collection(Array.from({ length: value.editors }, (_, index) => editorFor(value, index)));
    },
  });
  const rootLocator = (value) => ({
    elementHandle: async () => handleFor(value),
    waitFor: async () => { if (!value.visible) throw new Error('hidden'); },
  });
  const opener = (entry = {}) => ({
    isVisible: async () => entry.visible !== false,
    isEnabled: async () => entry.enabled !== false,
    click: async () => { state.clicked += 1; options.onClick?.(state); applyAfter(); },
  });
  const labelled = options.labelled || {};
  const page = {
    getByRole: (role, roleOptions = {}) => {
      calls.roleLookups.push({ role, name: roleOptions.name, exact: roleOptions.exact });
      return collection((labelled[`${role}:${roleOptions.name}`] || []).map(opener));
    },
    locator: (selector) => {
      if (selector === COMPOSER_ROOT_SELECTOR) return { count: async () => state.roots.length, nth: (index) => rootLocator(state.roots[index]) };
      assert.equal(selector, GROUP_COMPOSER_STRUCTURAL_SELECTOR);
      calls.structuralLookups += 1;
      return collection((options.structural || []).map(opener));
    },
    waitForTimeout: async () => { state.ticks += 1; applyAfter(); },
  };
  return { page, state, calls };
}

function openerOptions(fixture, extra = {}) {
  return { assertTargetReady: () => { fixture.calls.targetChecks += 1; }, transitionPollMs: 0, ...extra };
}

test('reviewed Romanian and English group opener labels each bind one appended composer', async () => {
  for (const [label, role] of [['Scrie ceva...', 'button'], ['Write something...', 'button']]) {
    const old = node('old');
    const fixture = fakePage({ before: [old], after: [old, node('new', 1)], labelled: { [`${role}:${label}`]: [{}] } });
    const stages = [];
    const composer = await openComposer(fixture.page, { ...openerOptions(fixture), trace: (stage) => stages.push(stage) });
    assert.equal(composer.handle._node.id, 'new'); assert.equal(fixture.state.clicked, 1);
    assert.deepEqual(stages, ['COMPOSER_OPENER_FOUND', 'COMPOSER_TRANSITION_OBSERVED', 'COMPOSER_ROOT_CANDIDATE_OBSERVED', 'COMPOSER_UNIQUE_NEW', 'COMPOSER_ROOT_UNIQUE_NEW', 'COMPOSER_EDITOR_BOUND', 'COMPOSER_OPENED']);
  }
});

test('the bounded GroupFeed structural opener works only when no reviewed label exists', async () => {
  const old = node('old');
  const fixture = fakePage({ before: [old], after: [old, node('new', 1)], structural: [{}] });
  const composer = await openComposer(fixture.page, openerOptions(fixture));
  assert.equal(composer.handle._node.id, 'new'); assert.equal(fixture.calls.structuralLookups, 1);
});

test('comment fields plus hidden or disabled openers are ignored', async () => {
  for (const labelled of [
    { 'textbox:Write a comment...': [{}] },
    { 'button:Scrie ceva...': [{ visible: false }] },
    { 'button:Write something...': [{ enabled: false }] },
  ]) {
    const fixture = fakePage({ before: [node('old')], labelled });
    await assert.rejects(openComposer(fixture.page, openerOptions(fixture, { transitionTimeoutMs: 0 })), { code: 'FACEBOOK_COMPOSER_OPENER_MISSING' });
    assert.equal(fixture.state.clicked, 0);
  }
});

test('ambiguous opener candidates fail closed before any click', async () => {
  const fixture = fakePage({ labelled: { 'button:Scrie ceva...': [{}, {}] } }); const stages = [];
  await assert.rejects(openComposer(fixture.page, { ...openerOptions(fixture), trace: (stage) => stages.push(stage) }), { code: 'FACEBOOK_COMPOSER_OPENER_AMBIGUOUS' });
  assert.equal(fixture.state.clicked, 0); assert.deepEqual(stages, ['COMPOSER_OPENER_AMBIGUOUS']);
});

test('one removed dialog plus one new composer is a unique replacement transition', async () => {
  const fixture = fakePage({ before: [node('old-shell')], after: [node('composer', 1)], labelled: { 'button:Scrie ceva...': [{}] } }); const stages = [];
  const composer = await openComposer(fixture.page, { ...openerOptions(fixture), trace: (stage) => stages.push(stage) });
  assert.equal(composer.handle._node.id, 'composer'); assert.ok(stages.includes('COMPOSER_UNIQUE_REPLACEMENT'));
});

test('same total dialog count with one replaced composer node passes', async () => {
  const persistent = node('persistent-shell');
  const fixture = fakePage({ before: [persistent, node('removed-shell')], after: [persistent, node('composer', 1)], labelled: { 'textbox:Scrie ceva': [{}] } });
  const composer = await openComposer(fixture.page, openerOptions(fixture));
  assert.equal(composer.handle._node.id, 'composer');
});

test('a same-node transition passes only when the dialog becomes a unique composer contract', async () => {
  const shell = node('reused-shell');
  const fixture = fakePage({
    before: [shell],
    after: [shell],
    labelled: { 'button:Write something...': [{}] },
    // Snapshot records the non-composer shell before the reviewed opener
    // click, then this exact DOM node becomes the one eligible composer.
    onClick: () => { shell.editors = 1; },
  });
  const stages = [];
  const composer = await openComposer(fixture.page, { ...openerOptions(fixture), trace: (stage) => stages.push(stage) });
  assert.equal(composer.handle._node.id, 'reused-shell'); assert.ok(stages.includes('COMPOSER_UNIQUE_REUSE'));
});

test('ambiguous mutations and multiple composer transitions fail closed', async () => {
  const ambiguousMutation = fakePage({ before: [node('shell')], after: [node('shell', 2)], labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(ambiguousMutation.page, openerOptions(ambiguousMutation)), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });

  const multiple = fakePage({ before: [node('old')], after: [node('old'), node('one', 1), node('two', 1)], labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(multiple.page, openerOptions(multiple)), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });

  const newAndTransformed = fakePage({ before: [node('shell'), node('old')], after: [node('shell', 1), node('old'), node('new', 1)], labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(newAndTransformed.page, openerOptions(newAndTransformed)), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
});

test('zero composer transitions and unrelated modal changes fail safely', async () => {
  const old = node('old');
  const zero = fakePage({ before: [old], after: [old], labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(zero.page, openerOptions(zero, { transitionTimeoutMs: 0 })), { code: 'FACEBOOK_COMPOSER_OPEN_FAILED' });

  const unrelated = fakePage({ before: [node('old')], after: [node('old'), node('unrelated-modal')], labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(unrelated.page, openerOptions(unrelated, { transitionTimeoutMs: 0 })), { code: 'FACEBOOK_COMPOSER_OPEN_FAILED' });
});

test('delayed appearance inside the bounded window passes and after-timeout appearance fails', async () => {
  const delayedOld = node('old');
  const delayed = fakePage({ before: [delayedOld], after: [delayedOld, node('composer', 1)], delayTicks: 1, labelled: { 'button:Scrie ceva...': [{}] } });
  assert.equal((await openComposer(delayed.page, openerOptions(delayed, { transitionTimeoutMs: 10 }))).handle._node.id, 'composer');

  const lateOld = node('old');
  const tooLate = fakePage({ before: [lateOld], after: [lateOld, node('composer', 1)], delayTicks: 2, labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(tooLate.page, openerOptions(tooLate, { transitionTimeoutMs: 0 })), { code: 'FACEBOOK_COMPOSER_OPEN_FAILED' });
});

test('the observed post-click non-plus-one dialog count succeeds when one composer transition is unique', async () => {
  // Mirrors the failed smoke: a role=dialog transition happened but total
  // cardinality was not before + 1. One old shell disappears while one new,
  // eligible composer appears, so identity comparison can bind it safely.
  const persistent = node('persistent');
  const fixture = fakePage({ before: [persistent, node('old-shell')], after: [persistent, node('composer', 1)], labelled: { 'button:Scrie ceva...': [{}] } });
  const composer = await openComposer(fixture.page, openerOptions(fixture));
  assert.equal(composer.handle._node.id, 'composer');
});

test('failed canonical target proof prevents discovery and clicking', async () => {
  const fixture = fakePage({ labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(fixture.page, { assertTargetReady: () => { throw Object.assign(new Error('wrong target'), { code: 'FACEBOOK_TARGET_MISMATCH' }); } }), { code: 'FACEBOOK_TARGET_MISMATCH' });
  assert.equal(fixture.state.clicked, 0); assert.equal(fixture.calls.roleLookups.length, 0);
});

test('a non-dialog aria-modal overlay with one bounded post editor is an observed valid transition', async () => {
  const old = node('old-shell');
  const overlay = node('facebook-overlay', 1, { role: '', ariaModal: true, pagelet: '' });
  const fixture = fakePage({ before: [old], after: [old, overlay], labelled: { 'button:Scrie ceva...': [{}] } });
  const stages = [];
  const composer = await openComposer(fixture.page, { ...openerOptions(fixture), trace: (stage) => stages.push(stage) });
  assert.equal(composer.handle._node.id, 'facebook-overlay');
  assert.ok(stages.includes('COMPOSER_ROOT_CANDIDATE_OBSERVED'));
  assert.ok(stages.includes('COMPOSER_ROOT_UNIQUE_NEW'));
  assert.ok(stages.includes('COMPOSER_EDITOR_BOUND'));
});

test('a Facebook-like composer layer without dialog role or aria-modal is accepted only through its composer pagelet transition', async () => {
  const old = node('old-shell');
  const layer = node('composer-layer', 1, { role: '', pagelet: 'CometComposerRoot' });
  const fixture = fakePage({ before: [old], after: [old, layer], labelled: { 'button:Write something...': [{}] } });
  assert.equal((await openComposer(fixture.page, openerOptions(fixture))).handle._node.id, 'composer-layer');
});

test('root-scoped alternate Facebook editor shapes retain exactly one editor handle', async () => {
  const cases = [
    ['contenteditable without role', { role: '', contenteditable: true }],
    ['inherited role textbox', { role: 'textbox', contenteditable: false, isContentEditable: true }],
    ['Lexical editable', { role: '', contenteditable: false, isContentEditable: true, lexical: true }],
    ['textarea', { tagName: 'TEXTAREA', contenteditable: false, isContentEditable: false }],
  ];
  for (const [label, editorOptions] of cases) {
    const fixture = fakePage({ before: [node('old')], after: [node(label, 1, { editorOptions })], labelled: { 'button:Scrie ceva...': [{}] } });
    const composer = await openComposer(fixture.page, openerOptions(fixture));
    assert.ok(composer.editor, label);
    assert.equal(composer.handle._node.id, label);
  }
});

test('hidden, disabled, non-editable, outside-root comment, and duplicate alternate editors fail closed', async () => {
  const rejected = [
    node('hidden-alt', 1, { editorOptions: { role: '', visible: false } }),
    node('disabled-alt', 1, { editorOptions: { role: '', enabled: false } }),
    node('not-editable-alt', 1, { editorOptions: { role: '', editable: false } }),
    node('comment-outside-root', 1, { editorOptions: { role: '', ariaLabel: 'Write a comment...' } }),
  ];
  for (const root of rejected) {
    const fixture = fakePage({ before: [node('old')], after: [node('old'), root], labelled: { 'button:Scrie ceva...': [{}] } });
    await assert.rejects(openComposer(fixture.page, openerOptions(fixture, { transitionTimeoutMs: 0 })), { code: 'FACEBOOK_COMPOSER_OPEN_FAILED' });
  }
  const duplicate = fakePage({ before: [node('old')], after: [node('old'), node('two-alt', 2, { editorOptions: [{ role: '' }, { lexical: true, role: '', contenteditable: false, isContentEditable: true }] })], labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(duplicate.page, openerOptions(duplicate)), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
});

test('comment, reply, search, hidden, and unrelated modal textboxes are never composer roots', async () => {
  const cases = [
    node('comment', 1, { editorOptions: { ariaLabel: 'Write a comment...' } }),
    node('reply', 1, { editorOptions: { ariaLabel: 'Reply' } }),
    node('search', 1, { ariaLabel: 'Search', actionRegion: false, editorOptions: { ariaLabel: 'Search' } }),
    node('hidden', 1, { visible: false }),
    node('unrelated', 1, { ariaLabel: 'Settings', actionRegion: false, editorOptions: { ariaLabel: 'Title' } }),
  ];
  for (const root of cases) {
    const fixture = fakePage({ before: [node('old')], after: [node('old'), root], labelled: { 'button:Scrie ceva...': [{}] } });
    await assert.rejects(openComposer(fixture.page, openerOptions(fixture, { transitionTimeoutMs: 0 })), { code: 'FACEBOOK_COMPOSER_OPEN_FAILED' });
    assert.equal(fixture.state.clicked, 1);
  }
});
