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
  CONTENTEDITABLE_VISUAL_TEXT,
  TEXTAREA_VALUE,
  visualPlainTextFromContenteditable,
  inspectComposerMedia,
  inspectRetainedComposerMediaCandidates,
  findScopedPublishControl,
} = require('../app/local-agent/FacebookLiveReadiness');

function item(options = {}) {
  const node = options.node || { nodeType: 1, tagName: options.tagName || 'TEXTAREA', childNodes: [], isConnected: options.attached !== false };
  return {
    textContent: async () => options.text || '', getAttribute: async (name) => options[name] || null,
    isVisible: async () => options.visible !== false, isEnabled: async () => options.enabled !== false,
    isEditable: async () => options.editable !== false, evaluate: async (callback) => callback(node),
    inputValue: async () => { if (options.input === undefined) throw new Error('not input'); return options.input; },
  };
}
function collection(items) { return { count: async () => items.length, nth: (index) => items[index], first: () => items[0], allTextContents: async () => items.map((entry) => entry.text || '') }; }
function composerModel(options = {}) {
  const attachments = options.attachments || [];
  const selectors = {
    'img, video': options.mediaCountThrows ? { count: async () => { throw new Error('count unavailable'); } } : collection(attachments),
    '[aria-busy="true"], [role="progressbar"]': collection(options.busy ? [item()] : []),
    '[role="alert"]': collection(options.alerts || []),
    'button, [role="button"]': collection(options.buttons || []),
  };
  const handle = { evaluate: async () => options.attached !== false, isVisible: async () => options.visible !== false };
  if (options.handleHasLocator !== false) handle.locator = (selector) => selectors[selector] || collection([]);
  const locator = { locator: (selector) => selectors[selector] || collection([]) };
  return { handle, locator, editor: options.editor || item({ input: options.text ?? 'immutable snapshot' }) };
}
function sequenceComposerModel(values) {
  let reads = 0;
  const editor = item({ input: '' });
  editor.inputValue = async () => values[Math.min(reads++, values.length - 1)];
  return { composer: composerModel({ editor }), reads: () => reads };
}
function textNode(value) { return { nodeType: 3, nodeValue: value }; }
function element(tagName, children = []) { return { nodeType: 1, tagName, childNodes: children, isConnected: true }; }
function visualEditor(root) {
  return item({
    node: root,
    tagName: 'DIV',
    input: undefined,
  });
}
function mediaInspectionHandle(configs, { throws = false } = {}) {
  const root = {
    isConnected: true,
    querySelectorAll: (selector) => {
      assert.equal(selector, 'img, video');
      return configs.map((config) => {
        const attributes = config.attributes || {};
        const node = {
          tagName: config.tagName || 'IMG', isConnected: config.attached !== false,
          naturalWidth: config.naturalWidth, naturalHeight: config.naturalHeight,
          ownerDocument: { defaultView: { getComputedStyle: () => ({ display: config.display || 'block', visibility: config.visibility || 'visible', opacity: config.opacity || '1' }) } },
          getBoundingClientRect: () => ({ width: config.width === undefined ? 24 : config.width, height: config.height === undefined ? 24 : config.height }),
          getAttribute: (name) => Object.hasOwn(attributes, name) ? attributes[name] : null,
          hasAttribute: (name) => Object.hasOwn(attributes, name),
          closest: (selectorValue) => {
            if (/button/.test(selectorValue) && config.ancestorButton) return {};
            if (/presentation|aria-hidden/.test(selectorValue) && config.ancestorPresentation) return {};
            if (/contenteditable/.test(selectorValue) && config.ancestorEditable) return {};
            return null;
          },
          parentElement: root,
        };
        return node;
      });
    },
  };
  return { evaluate: async (callback, selector) => { if (throws) throw new Error('private evaluation failure'); return callback(root, selector); } };
}
function pairedMediaComposer(configs, { countThrows = false } = {}) {
  const handle = mediaInspectionHandle(configs);
  handle.isVisible = async () => true;
  const attachments = countThrows ? { count: async () => { throw new Error('count unavailable'); } } : collection(configs.map(() => item()));
  return { handle, locator: { locator: (selector) => selector === 'img, video' ? attachments : collection([]) }, editor: item({ input: 'immutable snapshot' }) };
}
const immediateWait = async () => {};
const synchronized = { synchronizeAfterPaste: true, settleTimeoutMs: 20, pollIntervalMs: 10, wait: immediateWait };
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

test('retained contenteditable reader reconstructs only visual block and br line boundaries', async () => {
  assert.deepEqual(visualPlainTextFromContenteditable(element('DIV', [
    element('DIV', [textNode('line1')]),
    element('DIV', [textNode('line2')]),
    element('DIV', [textNode('line3')]),
  ])), { text: 'line1\nline2\nline3', visualLineBreakCount: 2 });
  assert.deepEqual(visualPlainTextFromContenteditable(element('DIV', [
    textNode('line1'), element('BR'), textNode('line2'),
  ])), { text: 'line1\nline2', visualLineBreakCount: 1 });
  assert.deepEqual(visualPlainTextFromContenteditable(element('DIV', [
    element('DIV', [textNode('line1'), element('BR')]),
    element('DIV', [textNode('line2')]),
  ])), { text: 'line1\nline2', visualLineBreakCount: 1 });
  assert.deepEqual(visualPlainTextFromContenteditable(element('DIV', [
    element('DIV', [element('SPAN', [textNode('abc')]), element('SPAN', [textNode('def')])]),
  ])), { text: 'abcdef', visualLineBreakCount: 0 });
  assert.deepEqual(visualPlainTextFromContenteditable(element('DIV', [
    element('DIV'), element('SPAN'), element('DIV', [textNode('only')]), element('DIV'),
  ])), { text: 'only', visualLineBreakCount: 0 });
});

test('Facebook Lexical 70/2/1 visible block shape passes immutable exact verification', async () => {
  const text = 'TEST RX AUTOMATION \u2014 12.09.2026\nTest tehnic de publicare RX AI Studio.';
  const root = element('DIV', [
    element('DIV', [textNode('TEST RX AUTOMATION \u2014 12.09.2026')]),
    element('DIV', [textNode('Test tehnic de publicare RX AI Studio.')]),
  ]);
  const editor = visualEditor(root);
  const composer = composerModel({ editor });
  const result = await verifyComposerText(composer, text);
  assert.equal(text.length, 70);
  assert.equal(result.matchedOnReadNumber, 1);
});

test('single-line retained contenteditable verification remains exact', async () => {
  const composer = composerModel({ editor: visualEditor(element('DIV', [element('SPAN', [textNode('immutable snapshot')])])) });
  const result = await verifyComposerText(composer, 'immutable snapshot');
  assert.equal(result.matchedOnReadNumber, 1);
});

test('textarea and input retain their value readers, while a visual wrong text still fails exactly', async () => {
  await verifyComposerText(composerModel({ editor: item({ input: 'A\nB', tagName: 'TEXTAREA' }) }), 'A\nB');
  await verifyComposerText(composerModel({ editor: item({ input: 'A\nB', tagName: 'INPUT' }) }), 'A\nB');
  const records = [];
  await assert.rejects(verifyComposerText(composerModel({ editor: visualEditor(element('DIV', [element('DIV', [textNode('A')]), element('DIV', [textNode('wrong')])])) }), 'A\nB', {
    diagnostic: { contentMismatchSummary: (value) => records.push(value) },
  }), { code: 'FACEBOOK_CONTENT_MISMATCH' });
  assert.equal(records[0].reader, CONTENTEDITABLE_VISUAL_TEXT);
  assert.equal(records[0].visualLineBreakCount, 1);
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
  assert.equal(records[2].reader, TEXTAREA_VALUE);
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

test('retained editor post-paste synchronization passes immediately when the first exact read is available', async () => {
  const { composer, reads } = sequenceComposerModel(['A\nB']);
  const result = await verifyComposerText(composer, 'A\nB', synchronized);
  assert.equal(result.verificationReadCount, 1);
  assert.equal(result.matchedOnReadNumber, 1);
  assert.ok(result.settleDurationMs >= 0 && result.settleDurationMs <= 20);
  assert.equal(reads(), 1);
});

test('retained editor post-paste synchronization waits only for a later exact newline state', async () => {
  const { composer, reads } = sequenceComposerModel(['AB', 'A\nB']);
  const result = await verifyComposerText(composer, 'A\nB', synchronized);
  assert.equal(result.verificationReadCount, 2);
  assert.equal(result.matchedOnReadNumber, 2);
  assert.equal(reads(), 2);
});

test('retained editor synchronization fails closed on stable missing newline and records only the final safe read summary', async () => {
  const records = [];
  const { composer, reads } = sequenceComposerModel(['AB']);
  await assert.rejects(verifyComposerText(composer, 'A\nB', { ...synchronized, diagnostic: { contentMismatchSummary: (value) => records.push(value) } }), { code: 'FACEBOOK_CONTENT_MISMATCH' });
  assert.equal(reads(), 3);
  assert.equal(records.length, 1);
  assert.equal(records[0].verificationReadCount, 3);
  assert.equal(records[0].matchedOnReadNumber, null);
  assert.equal(records[0].verificationReadTiming, 'BOUNDED_POST_PASTE_SYNC');
  assert.equal(records[0].lengthRelation, 'SHORTER');
  assert.equal(records[0].finalLengthRelation, 'SHORTER');
  assert.equal(records[0].expectedNewlineCount, 1);
  assert.equal(records[0].actualNewlineCount, 0);
  assert.doesNotMatch(JSON.stringify(records), /A\\nB|AB/);
});

test('retained editor synchronization accepts empty or shorter first reads only after the exact state appears', async () => {
  for (const firstRead of ['', 'A']) {
    const { composer, reads } = sequenceComposerModel([firstRead, 'AB']);
    const result = await verifyComposerText(composer, 'AB', synchronized);
    assert.equal(result.matchedOnReadNumber, 2);
    assert.equal(reads(), 2);
  }
});

test('retained editor synchronization rejects duplicated, longer, and one-character mismatched text without correction', async () => {
  for (const [actual, relation] of [['ABAB', 'DOUBLE_LENGTH'], ['ABC', 'LONGER'], ['AC', 'EXACT_LENGTH']]) {
    const records = [];
    const { composer } = sequenceComposerModel(['A', actual]);
    await assert.rejects(verifyComposerText(composer, 'AB', { ...synchronized, diagnostic: { contentMismatchSummary: (value) => records.push(value) } }), { code: 'FACEBOOK_CONTENT_MISMATCH' });
    assert.equal(records[0].lengthRelation, relation);
    assert.equal(records[0].finalLengthRelation, relation);
  }
});

test('retained editor synchronization preserves exact CRLF/LF normalization equality', async () => {
  const { composer, reads } = sequenceComposerModel(['A\nB']);
  const result = await verifyComposerText(composer, 'A\r\nB', synchronized);
  assert.equal(result.matchedOnReadNumber, 1);
  assert.equal(reads(), 1);
});

test('media requires exact count, ready state, and exposed filename ordering', async () => {
  const exact = composerModel({ attachments: [item({ 'data-filename': 'one.jpg' }), item({ 'data-file-name': 'two.png' })] });
  await inspectComposerMedia(exact, task(['C:/safe/one.jpg', 'C:/safe/two.png']));
  await assert.rejects(inspectComposerMedia(composerModel({ attachments: [item({ 'data-filename': 'wrong.jpg' }), item({ 'data-file-name': 'two.png' })] }), task(['C:/safe/one.jpg', 'C:/safe/two.png'])), { code: 'FACEBOOK_MEDIA_MISMATCH' });
  await assert.rejects(inspectComposerMedia(composerModel({ attachments: [item()] , busy: true }), task(['C:/safe/one.jpg'])), { code: 'FACEBOOK_MEDIA_NOT_READY' });
  await assert.rejects(inspectComposerMedia(composerModel({ attachments: [], alerts: [item({ text: 'Upload failed' })] }), task(['C:/safe/one.jpg'])), { code: 'FACEBOOK_MEDIA_MISMATCH' });
});

test('zero-media count uses the paired retained Locator when the ElementHandle has no Locator API', async () => {
  const records = [];
  const composer = pairedMediaComposer([]);
  assert.equal(typeof composer.handle.locator, 'undefined');
  await inspectComposerMedia(composer, task([]), { diagnostic: { zeroMediaInspectionSummary: async (value) => records.push(value) } });
  assert.equal(records.length, 1);
  assert.equal(records[0].rawMediaSelectorCount, 0);
  assert.equal(records[0].countOperationSucceeded, true);
  assert.equal(records[0].inspectionResult, 'OK');
});

test('paired retained Locator preserves fail-closed zero-media mismatch before any side effect', async () => {
  const records = [];
  const composer = pairedMediaComposer([{ naturalWidth: 24, naturalHeight: 24, attributes: { src: 'https://private.invalid/avatar' } }]);
  await assert.rejects(inspectComposerMedia(composer, task([]), { diagnostic: { zeroMediaInspectionSummary: async (value) => records.push(value) } }), { code: 'FACEBOOK_MEDIA_MISMATCH' });
  assert.equal(records.length, 1);
  assert.equal(records[0].rawMediaSelectorCount, 1);
  assert.equal(records[0].countOperationSucceeded, true);
});

test('paired retained Locator count errors fail closed with an explicit media-count classification', async () => {
  const records = [];
  await assert.rejects(inspectComposerMedia(pairedMediaComposer([], { countThrows: true }), task([]), {
    diagnostic: { zeroMediaInspectionSummary: async (value) => records.push(value) },
  }), { code: 'FACEBOOK_MEDIA_COUNT_UNAVAILABLE' });
  assert.equal(records.length, 1);
  assert.equal(records[0].countOperationSucceeded, false);
  assert.equal(records[0].inspectionResult, 'COUNT_OPERATION_FAILED');
});

test('retained-composer media diagnostics classify structural candidates without media policy decisions', async () => {
  const noMedia = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([]), 0);
  assert.equal(noMedia.rawMediaSelectorCount, 0);
  assert.equal(noMedia.countOperationSucceeded, true);
  assert.equal(noMedia.candidates.length, 0);

  const avatar = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([{ naturalWidth: 32, naturalHeight: 32, attributes: { src: 'https://private.invalid/avatar' } }]), 1);
  assert.equal(avatar.candidates[0].mediaCategory, 'UI_AVATAR_OR_ICON');
  assert.equal(avatar.uiAvatarOrIconCount, 1);

  const decorative = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([{ naturalWidth: 80, naturalHeight: 80, ancestorPresentation: true, attributes: { src: 'https://private.invalid/icon', 'aria-hidden': 'true' } }]), 1);
  assert.equal(decorative.candidates[0].mediaCategory, 'DECORATIVE_OR_PRESENTATION');
  assert.equal(decorative.decorativeCount, 1);

  const upload = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([{ naturalWidth: 640, naturalHeight: 480, attributes: { src: 'blob:private-upload' } }]), 1);
  assert.equal(upload.candidates[0].mediaCategory, 'POSSIBLE_UPLOAD_ATTACHMENT');
  assert.equal(upload.possibleUploadAttachmentCount, 1);

  const video = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([{ tagName: 'VIDEO', attributes: { src: 'data:private-video' } }]), 1);
  assert.equal(video.candidates[0].mediaCategory, 'VIDEO_CANDIDATE');
  assert.equal(video.videoCandidateCount, 1);

  const mixed = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([
    { naturalWidth: 32, naturalHeight: 32, attributes: { src: 'https://private.invalid/avatar' } },
    { naturalWidth: 640, naturalHeight: 480, attributes: { src: 'data:private-upload' } },
  ]), 2);
  assert.equal(mixed.uiAvatarOrIconCount, 1);
  assert.equal(mixed.possibleUploadAttachmentCount, 1);
  assert.equal(mixed.rawMediaSelectorCount, 2);
  assert.doesNotMatch(JSON.stringify(mixed), /private\.invalid|private-upload|src=|class|cookie/i);
});

test('retained-composer media diagnostics fail closed to fixed safe enums and never inspect outside the retained root', async () => {
  const countFailure = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([{ attributes: { src: 'blob:outside' } }]), -1);
  assert.equal(countFailure.countOperationSucceeded, false);
  assert.equal(countFailure.inspectionResult, 'COUNT_OPERATION_FAILED');
  assert.deepEqual(countFailure.candidates, []);
  const evaluationFailure = await inspectRetainedComposerMediaCandidates(mediaInspectionHandle([], { throws: true }), 1);
  assert.equal(evaluationFailure.countOperationSucceeded, true);
  assert.equal(evaluationFailure.inspectionResult, 'EVALUATION_FAILED');
  assert.deepEqual(evaluationFailure.candidates, []);
});

test('publish control is exactly one visible enabled control inside the retained composer', async () => {
  const outside = item({ text: 'Post' });
  const inside = item({ text: 'Post' });
  assert.equal(await findScopedPublishControl(composerModel({ buttons: [inside] })), inside);
  await assert.rejects(findScopedPublishControl(composerModel({ buttons: [] })), { code: 'FACEBOOK_PUBLISH_CONTROL_MISSING' });
  await assert.rejects(findScopedPublishControl(composerModel({ buttons: [inside, outside] })), { code: 'FACEBOOK_PUBLISH_CONTROL_AMBIGUOUS' });
  await assert.rejects(findScopedPublishControl(composerModel({ buttons: [item({ text: 'Post', enabled: false })] })), { code: 'FACEBOOK_PUBLISH_CONTROL_MISSING' });
});
