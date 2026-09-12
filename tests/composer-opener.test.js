'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GROUP_COMPOSER_STRUCTURAL_SELECTOR, openComposer } = require('../app/facebook/composer');

function candidate({ visible = true, enabled = true, onClick = () => {} } = {}) {
  return {
    isVisible: async () => visible,
    isEnabled: async () => enabled,
    click: async () => onClick(),
  };
}

function collection(items) {
  return { count: async () => items.length, nth: (index) => items[index] };
}

function composerPage({ labelled = {}, structural = [], newDialogs = 1 } = {}) {
  const calls = { clicks: 0, roleLookups: [], structuralLookups: 0, targetChecks: 0 };
  const initialDialog = { label: 'existing', waitFor: async () => {}, elementHandle: async () => ({ label: 'existing-handle' }) };
  const created = Array.from({ length: newDialogs }, (_, index) => ({ label: `created-${index}`, waitFor: async () => {}, elementHandle: async () => ({ label: `created-handle-${index}` }) }));
  let dialogs = [initialDialog];
  const wrap = (entry) => candidate({ ...entry, onClick: () => { calls.clicks += 1; dialogs = [initialDialog, ...created]; } });
  const page = {
    getByRole: (role, options = {}) => {
      if (role === 'dialog') return { count: async () => dialogs.length, nth: (index) => dialogs[index] };
      calls.roleLookups.push({ role, name: options.name, exact: options.exact });
      return collection((labelled[`${role}:${options.name}`] || []).map(wrap));
    },
    locator: (selector) => {
      assert.equal(selector, GROUP_COMPOSER_STRUCTURAL_SELECTOR);
      calls.structuralLookups += 1;
      return collection(structural.map(wrap));
    },
    waitForFunction: async () => {
      if (dialogs.length === 1) throw new Error('no new dialog');
    },
  };
  return { page, calls };
}

test('target-scoped composer opener accepts Romanian and English reviewed labels', async () => {
  for (const [label, role] of [['Scrie ceva...', 'button'], ['Write something...', 'button']]) {
    const fixture = composerPage({ labelled: { [`${role}:${label}`]: [{}] } });
    const stages = [];
    const composer = await openComposer(fixture.page, { assertTargetReady: () => { fixture.calls.targetChecks += 1; }, trace: (stage) => stages.push(stage) });
    assert.equal(composer.handle.label, 'created-handle-0');
    assert.equal(fixture.calls.targetChecks, 1);
    assert.equal(fixture.calls.clicks, 1);
    assert.deepEqual(stages, ['COMPOSER_OPENER_FOUND', 'COMPOSER_OPENED']);
  }
});

test('target-scoped composer opener accepts the reviewed GroupFeed structural entry only when no label exists', async () => {
  const fixture = composerPage({ structural: [{}] });
  const composer = await openComposer(fixture.page, { assertTargetReady: () => { fixture.calls.targetChecks += 1; } });
  assert.equal(composer.handle.label, 'created-handle-0');
  assert.equal(fixture.calls.targetChecks, 1);
  assert.equal(fixture.calls.structuralLookups, 1);
});

test('unrelated comment textboxes and hidden or disabled opener candidates are ignored', async () => {
  const unrelated = composerPage({ labelled: { 'textbox:Write a comment...': [{}] } });
  await assert.rejects(openComposer(unrelated.page), { code: 'FACEBOOK_COMPOSER_OPENER_MISSING' });
  assert.equal(unrelated.calls.clicks, 0);

  const hidden = composerPage({ labelled: { 'button:Scrie ceva...': [{ visible: false }] } });
  await assert.rejects(openComposer(hidden.page), { code: 'FACEBOOK_COMPOSER_OPENER_MISSING' });
  assert.equal(hidden.calls.clicks, 0);

  const disabled = composerPage({ labelled: { 'button:Write something...': [{ enabled: false }] } });
  await assert.rejects(openComposer(disabled.page), { code: 'FACEBOOK_COMPOSER_OPENER_MISSING' });
  assert.equal(disabled.calls.clicks, 0);
});

test('multiple group-opener candidates fail closed without a click', async () => {
  const fixture = composerPage({ labelled: { 'button:Scrie ceva...': [{}, {}] } });
  const stages = [];
  await assert.rejects(openComposer(fixture.page, { trace: (stage) => stages.push(stage) }), { code: 'FACEBOOK_COMPOSER_OPENER_AMBIGUOUS' });
  assert.equal(fixture.calls.clicks, 0);
  assert.deepEqual(stages, ['COMPOSER_OPENER_AMBIGUOUS']);
});

test('the returned composer is exactly the one new dialog created by the selected opener', async () => {
  const fixture = composerPage({ labelled: { 'textbox:Scrie ceva': [{}] } });
  const composer = await openComposer(fixture.page);
  assert.deepEqual(composer.handle, { label: 'created-handle-0' });
  assert.equal(fixture.calls.clicks, 1);
});

test('zero or multiple new dialogs fail closed after the opener click', async () => {
  const zero = composerPage({ labelled: { 'button:Scrie ceva...': [{}] }, newDialogs: 0 });
  await assert.rejects(openComposer(zero.page), { code: 'FACEBOOK_COMPOSER_OPEN_FAILED' });
  assert.equal(zero.calls.clicks, 1);

  const multiple = composerPage({ labelled: { 'button:Scrie ceva...': [{}] }, newDialogs: 2 });
  await assert.rejects(openComposer(multiple.page), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
  assert.equal(multiple.calls.clicks, 1);
});

test('a failed canonical-target assertion prevents opener discovery and click', async () => {
  const fixture = composerPage({ labelled: { 'button:Scrie ceva...': [{}] } });
  await assert.rejects(openComposer(fixture.page, { assertTargetReady: () => { throw Object.assign(new Error('wrong target'), { code: 'FACEBOOK_TARGET_MISMATCH' }); } }), { code: 'FACEBOOK_TARGET_MISMATCH' });
  assert.equal(fixture.calls.clicks, 0);
  assert.equal(fixture.calls.roleLookups.length, 0);
});
