'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLIPBOARD_PASTE,
  RETAINED_EDITOR_SHIFT_ENTER,
  writePostText,
} = require('../app/facebook/textWriter');
const { normalizeComposerText, verifyComposerText } = require('../app/local-agent/FacebookLiveReadiness');

function retainedEditorFixture() {
  const calls = [];
  let value = '';
  const editor = {
    waitForElementState: async (state) => calls.push(`WAIT:${state}`),
    click: async () => calls.push('CLICK'),
    pressSequentially: async (text) => { calls.push(`TYPE:${text}`); value += text; },
    press: async (key) => {
      calls.push(`KEY:${key}`);
      if (key === 'Shift+Enter') value += '\n';
    },
    evaluate: async () => true,
    isVisible: async () => true,
    isEditable: async () => true,
    inputValue: async () => value,
  };
  const page = {
    evaluate: async (_fn, text) => { calls.push(`COPY:${text}`); value = text; },
    keyboard: { press: async (key) => calls.push(`PAGE_KEY:${key}`) },
    getByRole: () => { throw new Error('page-wide editor lookup is forbidden'); },
  };
  const composer = {
    handle: { evaluate: async () => true, isVisible: async () => true, locator: () => { throw new Error('composer editor reacquisition is forbidden'); } },
    editor,
  };
  return { calls, composer, editor, page, value: () => value };
}

test('one-line retained-editor text preserves the reviewed clipboard path', async () => {
  const fixture = retainedEditorFixture();
  const result = await writePostText(fixture.page, 'immutable snapshot', fixture.composer);
  await verifyComposerText(fixture.composer, 'immutable snapshot');
  assert.equal(result.insertionMethod, CLIPBOARD_PASTE);
  assert.deepEqual(fixture.calls, ['WAIT:visible', 'CLICK', 'COPY:immutable snapshot', 'PAGE_KEY:Control+V']);
});

test('multiline retained editor preserves the real 70/2/1 immutable structure without clipboard access', async () => {
  const fixture = retainedEditorFixture();
  const text = 'TEST RX AUTOMATION — 12.09.2026\nTest tehnic de publicare RX AI Studio.';
  const result = await writePostText(fixture.page, text, fixture.composer);
  const verification = await verifyComposerText(fixture.composer, text, { synchronizeAfterPaste: true, settleTimeoutMs: 20, pollIntervalMs: 10, wait: async () => {} });
  assert.equal(result.insertionMethod, RETAINED_EDITOR_SHIFT_ENTER);
  assert.equal(fixture.value().length, 70);
  assert.equal(fixture.value().split('\n').length, 2);
  assert.equal((fixture.value().match(/\n/g) || []).length, 1);
  assert.equal(verification.matchedOnReadNumber, 1);
  assert.deepEqual(fixture.calls, ['WAIT:visible', 'CLICK', 'TYPE:TEST RX AUTOMATION — 12.09.2026', 'KEY:Shift+Enter', 'TYPE:Test tehnic de publicare RX AI Studio.']);
  assert.equal(fixture.calls.some((call) => call.startsWith('COPY:') || call.startsWith('PAGE_KEY:')), false);
});

test('retained multiline insertion preserves CRLF, three-line, trailing-newline, and NFC comparison semantics', async () => {
  for (const text of ['A\r\nB', 'A\nB\nC', 'A\nB\n', 'Cafe\u0301\nB']) {
    const fixture = retainedEditorFixture();
    const result = await writePostText(fixture.page, text, fixture.composer);
    assert.equal(result.insertionMethod, RETAINED_EDITOR_SHIFT_ENTER);
    await verifyComposerText(fixture.composer, text);
    assert.equal(normalizeComposerText(fixture.value()), normalizeComposerText(text));
    assert.equal(fixture.value().includes('\r'), false);
    assert.equal(fixture.calls.filter((call) => call === 'KEY:Shift+Enter').length, Math.max(0, normalizeComposerText(text).split('\n').length - 1));
  }
});

test('retained multiline insertion neither duplicates nor collapses an internal blank line', async () => {
  const fixture = retainedEditorFixture();
  const text = 'first\n\nthird';
  await writePostText(fixture.page, text, fixture.composer);
  await verifyComposerText(fixture.composer, text);
  assert.equal(fixture.value(), text);
  assert.equal((fixture.value().match(/\n/g) || []).length, 2);
  assert.equal(fixture.calls.filter((call) => call === 'KEY:Shift+Enter').length, 2);
});

test('retained multiline insertion fails before exact verification when the retained editor cannot emit a line break', async () => {
  const fixture = retainedEditorFixture();
  fixture.editor.press = async () => { throw new Error('line break unavailable'); };
  await assert.rejects(writePostText(fixture.page, 'A\nB', fixture.composer), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
  assert.equal(fixture.calls.some((call) => call.startsWith('COPY:') || call.startsWith('PAGE_KEY:')), false);
});
