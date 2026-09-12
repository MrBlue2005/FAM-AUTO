'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalFacebookGroupTarget,
  verifyCanonicalFacebookGroupTarget,
  normalizeComposerText,
  verifyComposerText,
  inspectComposerMedia,
  findScopedPublishControl,
} = require('../app/local-agent/FacebookLiveReadiness');

function item(options = {}) {
  return {
    textContent: async () => options.text || '', getAttribute: async (name) => options[name] || null,
    isVisible: async () => options.visible !== false, isEnabled: async () => options.enabled !== false,
    inputValue: async () => { if (options.input === undefined) throw new Error('not input'); return options.input; },
  };
}
function collection(items) { return { count: async () => items.length, nth: (index) => items[index], first: () => items[0], allTextContents: async () => items.map((entry) => entry.text || '') }; }
function composerModel(options = {}) {
  const attachments = options.attachments || [];
  const selectors = {
    '[contenteditable="true"][role="textbox"], textarea': collection(options.editors || [item({ input: options.text ?? 'immutable snapshot' })]),
    'img, video': collection(attachments),
    '[aria-busy="true"], [role="progressbar"]': collection(options.busy ? [item()] : []),
    '[role="alert"]': collection(options.alerts || []),
    'button, [role="button"]': collection(options.buttons || []),
  };
  const handle = { evaluate: async () => options.attached !== false, isVisible: async () => options.visible !== false, locator: (selector) => selectors[selector] || collection([]) };
  return { handle, locator: {} };
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
