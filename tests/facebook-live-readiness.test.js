'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalFacebookGroupTarget,
  verifyCanonicalFacebookGroupTarget,
  normalizeComposerText,
  verifyComposerText,
  contentMismatchDiagnostic,
  CONTENT_HASH_PREFIX_LENGTH,
  inspectComposerMedia,
  findScopedPublishControl,
} = require('../app/local-agent/FacebookLiveReadiness');

function item(options = {}) {
  return {
    textContent: async () => options.text || '', getAttribute: async (name) => options[name] || null,
    isVisible: async () => options.visible !== false, isEnabled: async () => options.enabled !== false,
    isEditable: async () => options.editable !== false, evaluate: async () => options.attached !== false,
    inputValue: async () => { if (options.input === undefined) throw new Error('not input'); return options.input; },
  };
}
function collection(items) { return { count: async () => items.length, nth: (index) => items[index], first: () => items[0], allTextContents: async () => items.map((entry) => entry.text || '') }; }
function composerModel(options = {}) {
  const attachments = options.attachments || [];
  const selectors = {
    'img, video': collection(attachments),
    '[aria-busy="true"], [role="progressbar"]': collection(options.busy ? [item()] : []),
    '[role="alert"]': collection(options.alerts || []),
    'button, [role="button"]': collection(options.buttons || []),
  };
  const handle = { evaluate: async () => options.attached !== false, isVisible: async () => options.visible !== false, locator: (selector) => selectors[selector] || collection([]) };
  return { handle, locator: {}, editor: options.editor || item({ input: options.text ?? 'immutable snapshot' }) };
}
const task = (paths = []) => ({ payload: { post: { text: 'immutable snapshot' }, local_media_paths: paths } });

test('canonical group target permits only exact www.facebook.com group paths and a trailing slash', () => {
  assert.equal(canonicalFacebookGroupTarget('https://www.facebook.com/groups/12345/'), 'https://www.facebook.com/groups/12345');
  assert.throws(() => canonicalFacebookGroupTarget('https://facebook.com/groups/12345'), { code: 'FACEBOOK_TARGET_INVALID' });
  assert.throws(() => canonicalFacebookGroupTarget('https://www.facebook.com.evil.test/groups/12345'), { code: 'FACEBOOK_TARGET_INVALID' });
  assert.throws(() => canonicalFacebookGroupTarget('https://www.facebook.com/groups/12345?x=1'), { code: 'FACEBOOK_TARGET_INVALID' });
  assert.throws(() => verifyCanonicalFacebookGroupTarget('https://www.facebook.com/groups/99999', 'https://www.facebook.com/groups/12345'), { code: 'FACEBOOK_TARGET_MISMATCH' });
});

test('composer text uses only harmless normalization and rejects missing, changed, or extra text', async () => {
  assert.equal(normalizeComposerText('  A\r\nB\u00a0 '), 'A\nB');
  await verifyComposerText(composerModel({ text: ' immutable snapshot ' }), 'immutable snapshot');
  await assert.rejects(verifyComposerText(composerModel({ text: 'changed' }), 'immutable snapshot'), { code: 'FACEBOOK_CONTENT_MISMATCH' });
  await assert.rejects(verifyComposerText(composerModel({ text: 'immutable snapshot extra' }), 'immutable snapshot'), { code: 'FACEBOOK_CONTENT_MISMATCH' });
});

test('content mismatch diagnostics preserve current normalization semantics without emitting on exact or equivalent text', async () => {
  const records = [];
  const diagnostic = { contentMismatchSummary: (value) => records.push(value) };
  await verifyComposerText(composerModel({ text: 'immutable snapshot' }), 'immutable snapshot', { diagnostic });
  await verifyComposerText(composerModel({ text: 'A\nB' }), 'A\r\nB', { diagnostic });
  await verifyComposerText(composerModel({ text: 'A B' }), 'A\u00a0B', { diagnostic });
  await verifyComposerText(composerModel({ text: 'Caf\u00e9' }), 'Cafe\u0301', { diagnostic });
  await verifyComposerText(composerModel({ text: ' immutable snapshot ' }), 'immutable snapshot', { diagnostic });
  assert.equal(records.length, 0);
});

test('content mismatch diagnostics distinguish empty, duplicated, and one-character text without retaining content', async () => {
  const records = [];
  const diagnostic = { contentMismatchSummary: (value) => records.push(value) };
  await assert.rejects(verifyComposerText(composerModel({ text: '' }), 'private expected text', { diagnostic }), { code: 'FACEBOOK_CONTENT_MISMATCH' });
  await assert.rejects(verifyComposerText(composerModel({ text: 'abab' }), 'ab', { diagnostic }), { code: 'FACEBOOK_CONTENT_MISMATCH' });
  await assert.rejects(verifyComposerText(composerModel({ text: 'abce' }), 'abcd', { diagnostic }), { code: 'FACEBOOK_CONTENT_MISMATCH' });
  assert.equal(records[0].lengthRelation, 'EMPTY');
  assert.equal(records[1].lengthRelation, 'DOUBLE_LENGTH');
  assert.equal(records[2].lengthRelation, 'EXACT_LENGTH');
  assert.notEqual(records[2].expectedSha256Prefix, records[2].actualSha256Prefix);
  assert.equal(records[2].expectedSha256Prefix.length, CONTENT_HASH_PREFIX_LENGTH);
  assert.equal(records[2].insertionMethod, 'CLIPBOARD_PASTE');
  assert.equal(records[2].verificationReadCount, 1);
  assert.equal(records[2].verificationReadTiming, 'FIRST_VERIFICATION_READ');
  assert.doesNotMatch(JSON.stringify(records), /private expected text|abab|abce|abcd/);
});

test('content mismatch diagnostics record bounded structural counters and stage hashes only', () => {
  const expectedText = '  PRIVATE_EXPECTED\r\nB\u00a0 ';
  const actualText = ' PRIVATE_ACTUAL\nB  X  ';
  const result = contentMismatchDiagnostic(expectedText, actualText);
  assert.equal(result.expectedLineCount, 2);
  assert.equal(result.actualLineCount, 2);
  assert.equal(result.expectedNewlineCount, 1);
  assert.equal(result.actualNewlineCount, 1);
  assert.equal(result.expectedLeadingWhitespaceCount, 2);
  assert.equal(result.actualLeadingWhitespaceCount, 1);
  assert.equal(result.expectedTrailingWhitespaceCount, 2);
  assert.equal(result.actualTrailingWhitespaceCount, 2);
  assert.equal(result.normalizationStages.raw.expected.length, expectedText.length);
  assert.equal(result.normalizationStages.final.expected.sha256Prefix.length, CONTENT_HASH_PREFIX_LENGTH);
  assert.deepEqual(Object.keys(result.normalizationStages), ['raw', 'nfc', 'crlfToLf', 'nbspToSpace', 'final']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_EXPECTED|PRIVATE_ACTUAL/);
});

test('media requires exact count, ready state, and exposed filename ordering', async () => {
  const exact = composerModel({ attachments: [item({ 'data-filename': 'one.jpg' }), item({ 'data-file-name': 'two.png' })] });
  await inspectComposerMedia(exact, task(['C:/safe/one.jpg', 'C:/safe/two.png']));
  await assert.rejects(inspectComposerMedia(composerModel({ attachments: [item({ 'data-filename': 'wrong.jpg' }), item({ 'data-file-name': 'two.png' })] }), task(['C:/safe/one.jpg', 'C:/safe/two.png'])), { code: 'FACEBOOK_MEDIA_MISMATCH' });
  await assert.rejects(inspectComposerMedia(composerModel({ attachments: [item()] , busy: true }), task(['C:/safe/one.jpg'])), { code: 'FACEBOOK_MEDIA_NOT_READY' });
  await assert.rejects(inspectComposerMedia(composerModel({ attachments: [], alerts: [item({ text: 'Upload failed' })] }), task(['C:/safe/one.jpg'])), { code: 'FACEBOOK_MEDIA_MISMATCH' });
});

test('publish control is exactly one visible enabled control inside the retained composer', async () => {
  const outside = item({ text: 'Post' });
  const inside = item({ text: 'Post' });
  assert.equal(await findScopedPublishControl(composerModel({ buttons: [inside] })), inside);
  await assert.rejects(findScopedPublishControl(composerModel({ buttons: [] })), { code: 'FACEBOOK_PUBLISH_CONTROL_MISSING' });
  await assert.rejects(findScopedPublishControl(composerModel({ buttons: [inside, outside] })), { code: 'FACEBOOK_PUBLISH_CONTROL_AMBIGUOUS' });
  await assert.rejects(findScopedPublishControl(composerModel({ buttons: [item({ text: 'Post', enabled: false })] })), { code: 'FACEBOOK_PUBLISH_CONTROL_MISSING' });
});
