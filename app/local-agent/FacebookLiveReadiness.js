'use strict';

const crypto = require('crypto');
const path = require('path');

const FACEBOOK_GROUP_ORIGIN = 'https://www.facebook.com';
const GROUP_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function failure(code, message) { return Object.assign(new Error(message), { code }); }

function canonicalFacebookGroupTarget(value, code = 'FACEBOOK_TARGET_INVALID') {
  let url;
  try { url = new URL(String(value || '')); } catch { throw failure(code, 'Facebook group target is invalid.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'www.facebook.com' || url.port || url.username || url.password || url.search || url.hash) {
    throw failure(code, 'Facebook group target is invalid.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'groups' || !GROUP_ID_PATTERN.test(parts[1])) {
    throw failure(code, 'Facebook group target is invalid.');
  }
  return `${FACEBOOK_GROUP_ORIGIN}/groups/${parts[1]}`;
}

function verifyCanonicalFacebookGroupTarget(actual, expected) {
  const expectedCanonical = canonicalFacebookGroupTarget(expected, 'FACEBOOK_TARGET_INVALID');
  const actualCanonical = canonicalFacebookGroupTarget(actual, 'FACEBOOK_TARGET_MISMATCH');
  if (actualCanonical !== expectedCanonical) throw failure('FACEBOOK_TARGET_MISMATCH', 'Facebook group target does not match the reviewed task target.');
}

function normalizeComposerText(value) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}

const CONTENT_HASH_PREFIX_LENGTH = 16;
const TEXT_INSERTION_METHOD = 'CLIPBOARD_PASTE';
const VERIFICATION_READ_TIMING = 'FIRST_VERIFICATION_READ';
// Clipboard paste updates Facebook's Lexical-backed editor asynchronously on
// some page shapes. Keep this deliberately short and bounded: it is only a
// pre-marker observation of the already-retained editor, never a retry or a
// new editor lookup.
const COMPOSER_TEXT_SETTLE_TIMEOUT_MS = 2000;
const COMPOSER_TEXT_SETTLE_POLL_INTERVAL_MS = 100;
const COMPOSER_TEXT_SETTLE_MAX_TIMEOUT_MS = 5000;
const CONTENTEDITABLE_VISUAL_TEXT = 'CONTENTEDITABLE_VISUAL_TEXT';
const TEXTAREA_VALUE = 'TEXTAREA_VALUE';
const INPUT_VALUE = 'INPUT_VALUE';
const RETAINED_COMPOSER_MEDIA_SELECTOR = 'img, video';
const MAX_MEDIA_DIAGNOSTIC_CANDIDATES = 12;

function composerTextStages(value) {
  const raw = String(value ?? '');
  const nfc = raw.normalize('NFC');
  const crlfToLf = nfc.replace(/\r\n?/g, '\n');
  const nbspToSpace = crlfToLf.replace(/\u00a0/g, ' ');
  return { raw, nfc, crlfToLf, nbspToSpace, final: nbspToSpace.trim() };
}

function sha256Prefix(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, CONTENT_HASH_PREFIX_LENGTH);
}

function whitespaceMetrics(value) {
  const text = String(value ?? '');
  return {
    lineCount: text.length ? text.split('\n').length : 0,
    newlineCount: (text.match(/\n/g) || []).length,
    leadingWhitespaceCount: (text.match(/^\s*/u) || [''])[0].length,
    trailingWhitespaceCount: (text.match(/\s*$/u) || [''])[0].length,
  };
}

function contentLengthRelation(expected, actual) {
  if (!actual.length) return 'EMPTY';
  if (expected.length && actual.length === expected.length * 2) return 'DOUBLE_LENGTH';
  if (actual.length === expected.length) return 'EXACT_LENGTH';
  return actual.length < expected.length ? 'SHORTER' : 'LONGER';
}

function contentMismatchDiagnostic(expectedValue, actualValue, options = {}) {
  const expected = composerTextStages(expectedValue);
  const actual = composerTextStages(actualValue);
  const stage = (value) => ({ length: value.length, sha256Prefix: sha256Prefix(value) });
  const expectedMetrics = whitespaceMetrics(expected.raw);
  const actualMetrics = whitespaceMetrics(actual.raw);
  return {
    expectedNormalizedLength: expected.final.length,
    actualNormalizedLength: actual.final.length,
    expectedSha256Prefix: sha256Prefix(expected.final),
    actualSha256Prefix: sha256Prefix(actual.final),
    expectedLineCount: expectedMetrics.lineCount,
    actualLineCount: actualMetrics.lineCount,
    expectedLeadingWhitespaceCount: expectedMetrics.leadingWhitespaceCount,
    actualLeadingWhitespaceCount: actualMetrics.leadingWhitespaceCount,
    expectedTrailingWhitespaceCount: expectedMetrics.trailingWhitespaceCount,
    actualTrailingWhitespaceCount: actualMetrics.trailingWhitespaceCount,
    expectedNewlineCount: expectedMetrics.newlineCount,
    actualNewlineCount: actualMetrics.newlineCount,
    lengthRelation: contentLengthRelation(expected.final, actual.final),
    insertionMethod: options.insertionMethod || TEXT_INSERTION_METHOD,
    reader: [CONTENTEDITABLE_VISUAL_TEXT, TEXTAREA_VALUE, INPUT_VALUE].includes(options.reader) ? options.reader : CONTENTEDITABLE_VISUAL_TEXT,
    visualLineBreakCount: Number.isSafeInteger(options.visualLineBreakCount) && options.visualLineBreakCount >= 0 ? options.visualLineBreakCount : 0,
    verificationReadCount: Number.isSafeInteger(options.verificationReadCount) && options.verificationReadCount > 0 ? options.verificationReadCount : 1,
    verificationReadTiming: options.verificationReadTiming || VERIFICATION_READ_TIMING,
    matchedOnReadNumber: Number.isSafeInteger(options.matchedOnReadNumber) && options.matchedOnReadNumber > 0 ? options.matchedOnReadNumber : null,
    settleDurationMs: Math.max(0, Math.min(COMPOSER_TEXT_SETTLE_MAX_TIMEOUT_MS, Number.isFinite(Number(options.settleDurationMs)) ? Math.trunc(Number(options.settleDurationMs)) : 0)),
    finalLengthRelation: contentLengthRelation(expected.final, actual.final),
    normalizationStages: {
      raw: { expected: { length: expected.raw.length }, actual: { length: actual.raw.length } },
      nfc: { expected: stage(expected.nfc), actual: stage(actual.nfc) },
      crlfToLf: { expected: stage(expected.crlfToLf), actual: stage(actual.crlfToLf) },
      nbspToSpace: { expected: stage(expected.nbspToSpace), actual: stage(actual.nbspToSpace) },
      final: { expected: stage(expected.final), actual: stage(actual.final) },
    },
  };
}

// This is intentionally a DOM-only reader for the exact ElementHandle paired
// with the retained composer.  textContent omits visual line boundaries from
// Lexical's block and <br> shapes, so it cannot verify an immutable multiline
// snapshot faithfully.
function visualPlainTextFromContenteditable(root) {
  // Kept inside the evaluated function because Playwright serializes this
  // reader into the browser context without module closures.
  const visualBlockTags = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
    'H6', 'HEADER', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'UL',
  ]);
  let output = '';
  let visualLineBreakCount = 0;
  const nodeType = (node) => Number(node?.nodeType);
  const tagName = (node) => String(node?.tagName || '').toUpperCase();
  const isBlock = (node) => visualBlockTags.has(tagName(node));
  const appendBoundary = () => {
    if (!output || output.endsWith('\n')) return;
    output += '\n';
    visualLineBreakCount += 1;
  };
  const hasVisibleText = (node) => {
    if (nodeType(node) === 3) return String(node.nodeValue || '').length > 0;
    if (nodeType(node) !== 1) return false;
    if (tagName(node) === 'BR') return true;
    return Array.from(node.childNodes || []).some(hasVisibleText);
  };
  const walkChildren = (parent) => {
    const children = Array.from(parent?.childNodes || []);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      walk(child);
      if (isBlock(child) && hasVisibleText(child) && children.slice(index + 1).some(hasVisibleText)) appendBoundary();
    }
  };
  const walk = (node) => {
    if (nodeType(node) === 3) {
      output += String(node.nodeValue || '');
      return;
    }
    if (nodeType(node) !== 1) return;
    if (tagName(node) === 'BR') {
      appendBoundary();
      return;
    }
    walkChildren(node);
  };
  walkChildren(root);
  return { text: output, visualLineBreakCount };
}

function requirePreparedComposer(prepared) {
  const composer = prepared?.composer;
  if (!composer?.handle || !composer?.locator) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The exact Facebook composer was not returned by preparation.');
  return composer;
}

async function ensureRetainedComposer(composer) {
  const handle = composer?.handle;
  if (!handle) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'Facebook composer cannot be retained.');
  const attached = await handle.evaluate?.((node) => node.isConnected).catch(() => false);
  const visible = await handle.isVisible?.().catch(() => false);
  if (attached !== true || visible !== true) throw failure('FACEBOOK_COMPOSER_CHANGED', 'Facebook composer changed before publication.');
  return handle;
}

async function readComposerText(composer) {
  await ensureRetainedComposer(composer);
  // Retain the ElementHandle for the DOM/readiness checks below.  Text entry
  // itself is deliberately performed through the paired Locator.
  const editor = composer?.editor?.handle || composer?.editor;
  if (!editor) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'Facebook composer text field was not retained.');
  const [attached, visible, editable] = await Promise.all([
    editor.evaluate?.((node) => node.isConnected).catch(() => false),
    editor.isVisible?.().catch(() => false),
    typeof editor.isEditable === 'function' ? editor.isEditable().catch(() => false) : Promise.resolve(false),
  ]);
  if (attached !== true || visible !== true || editable !== true) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'Facebook composer text field is unavailable.');
  const inputValue = await editor.inputValue?.().catch(() => undefined);
  if (inputValue !== undefined && inputValue !== null) {
    const tag = await editor.evaluate?.((node) => String(node?.tagName || '').toLowerCase()).catch(() => '');
    return { text: String(inputValue), reader: tag === 'textarea' ? TEXTAREA_VALUE : INPUT_VALUE, visualLineBreakCount: 0 };
  }
  const visual = await editor.evaluate?.(visualPlainTextFromContenteditable).catch(() => null);
  if (!visual || typeof visual.text !== 'string' || !Number.isSafeInteger(visual.visualLineBreakCount) || visual.visualLineBreakCount < 0) {
    throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'Facebook composer text cannot be read.');
  }
  return { text: visual.text, reader: CONTENTEDITABLE_VISUAL_TEXT, visualLineBreakCount: visual.visualLineBreakCount };
}

function boundedPositiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(maximum, Math.trunc(number)));
}

function postPasteSynchronizationOptions(options = {}) {
  const timeoutMs = boundedPositiveInteger(options.settleTimeoutMs, COMPOSER_TEXT_SETTLE_TIMEOUT_MS, COMPOSER_TEXT_SETTLE_MAX_TIMEOUT_MS);
  const pollIntervalMs = Math.max(1, boundedPositiveInteger(options.pollIntervalMs, COMPOSER_TEXT_SETTLE_POLL_INTERVAL_MS, COMPOSER_TEXT_SETTLE_MAX_TIMEOUT_MS));
  return {
    enabled: options.synchronizeAfterPaste === true,
    timeoutMs,
    pollIntervalMs,
    maxReads: timeoutMs === 0 ? 1 : Math.floor(timeoutMs / pollIntervalMs) + 1,
    wait: typeof options.wait === 'function' ? options.wait : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: typeof options.now === 'function' ? options.now : () => Date.now(),
  };
}

async function verifyComposerText(composer, expectedText, options = {}) {
  const expectedNormalized = normalizeComposerText(expectedText);
  const synchronization = postPasteSynchronizationOptions(options);
  const startedAt = synchronization.now();
  let actualText = '';
  let reader = CONTENTEDITABLE_VISUAL_TEXT;
  let visualLineBreakCount = 0;
  let verificationReadCount = 0;

  while (verificationReadCount < synchronization.maxReads) {
    const read = await readComposerText(composer);
    actualText = read.text;
    reader = read.reader;
    visualLineBreakCount = read.visualLineBreakCount;
    verificationReadCount += 1;
    if (expectedNormalized === normalizeComposerText(actualText)) {
      return {
        verificationReadCount,
        matchedOnReadNumber: verificationReadCount,
        settleDurationMs: Math.max(0, Math.min(synchronization.timeoutMs, synchronization.now() - startedAt)),
      };
    }
    if (!synchronization.enabled || verificationReadCount >= synchronization.maxReads) break;
    await synchronization.wait(synchronization.pollIntervalMs);
  }

  // This sink is deliberately optional and best-effort: emitting its fixed,
  // hashed final-read summary must never alter the exact mismatch behavior.
  const settleDurationMs = Math.max(0, Math.min(synchronization.timeoutMs, synchronization.now() - startedAt));
  try {
    options.diagnostic?.contentMismatchSummary?.(contentMismatchDiagnostic(expectedText, actualText, {
      ...options,
      verificationReadCount,
      matchedOnReadNumber: null,
      settleDurationMs,
      reader,
      visualLineBreakCount,
      verificationReadTiming: options.verificationReadTiming || (synchronization.enabled ? 'BOUNDED_POST_PASTE_SYNC' : VERIFICATION_READ_TIMING),
    }));
  } catch { /* observability only */ }
  throw failure('FACEBOOK_CONTENT_MISMATCH', 'Facebook composer text does not match the immutable task snapshot.');
}

function expectedMediaNames(task) {
  return (Array.isArray(task?.payload?.local_media_paths) ? task.payload.local_media_paths : []).map((item) => path.basename(String(item))).filter(Boolean);
}

function emptyMediaInspection(rawMediaSelectorCount, countOperationSucceeded, inspectionResult) {
  return {
    rawMediaSelectorCount: Number.isSafeInteger(rawMediaSelectorCount) && rawMediaSelectorCount >= 0 ? rawMediaSelectorCount : 0,
    visibleMediaCandidateCount: 0,
    possibleUploadAttachmentCount: 0,
    uiAvatarOrIconCount: 0,
    decorativeCount: 0,
    videoCandidateCount: 0,
    unknownCount: 0,
    countOperationSucceeded,
    inspectionResult,
    candidates: [],
  };
}

// Observability only: this is evaluated on the exact retained composer root,
// uses the same selector as policy, and intentionally returns no text, URLs,
// labels, class names, ids, filenames, or DOM paths.
async function inspectRetainedComposerMediaCandidates(handle, rawMediaSelectorCount) {
  if (!Number.isSafeInteger(rawMediaSelectorCount) || rawMediaSelectorCount < 0) {
    return emptyMediaInspection(rawMediaSelectorCount, false, 'COUNT_OPERATION_FAILED');
  }
  try {
    const inspection = await handle.evaluate((root, selector) => {
      const maxCandidates = 12;
      const bounded = (value) => Math.max(0, Math.min(1000, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0));
      const tag = (node) => node?.tagName === 'IMG' ? 'IMG' : node?.tagName === 'VIDEO' ? 'VIDEO' : 'OTHER';
      const scheme = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return 'NONE';
        if (raw.startsWith('blob:')) return 'BLOB';
        if (raw.startsWith('data:')) return 'DATA';
        if (raw.startsWith('https:')) return 'HTTPS';
        return 'OTHER';
      };
      const dimension = (value) => {
        if (!Number.isFinite(Number(value))) return 'UNKNOWN';
        const size = Number(value);
        if (size <= 0) return 'ZERO';
        if (size <= 48) return 'SMALL';
        if (size <= 256) return 'MEDIUM';
        return 'LARGE';
      };
      const visible = (node) => {
        try {
          const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
          const rect = node.getBoundingClientRect?.();
          return Boolean(node.isConnected && rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden' && style?.opacity !== '0');
        } catch { return false; }
      };
      const role = (node) => {
        const value = String(node.getAttribute?.('role') || '').toLowerCase();
        return ['', 'presentation', 'img', 'button'].includes(value) ? (value || null) : 'other';
      };
      const depth = (node) => {
        let current = node; let result = 0;
        while (current && current !== root && result < 1000) { current = current.parentElement; result += 1; }
        return bounded(result);
      };
      const candidates = Array.from(root.querySelectorAll(selector));
      const counts = {
        rawMediaSelectorCount: bounded(candidates.length), visibleMediaCandidateCount: 0,
        possibleUploadAttachmentCount: 0, uiAvatarOrIconCount: 0, decorativeCount: 0,
        videoCandidateCount: 0, unknownCount: 0,
      };
      const summarized = candidates.map((node) => {
        const tagName = tag(node);
        const visibleValue = visible(node);
        const srcScheme = scheme(node.getAttribute?.('src'));
        const naturalWidth = tagName === 'IMG' ? dimension(node.naturalWidth) : 'UNKNOWN';
        const naturalHeight = tagName === 'IMG' ? dimension(node.naturalHeight) : 'UNKNOWN';
        const ancestorButton = Boolean(node.closest?.('button, [role="button"]'));
        const ancestorPresentation = Boolean(node.closest?.('[role="presentation"], [aria-hidden="true"]'));
        const ancestorEditable = Boolean(node.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"]'));
        let mediaCategory = 'UNKNOWN_MEDIA_CANDIDATE';
        if (tagName === 'VIDEO') mediaCategory = 'VIDEO_CANDIDATE';
        else if (ancestorPresentation || node.getAttribute?.('aria-hidden') !== null) mediaCategory = 'DECORATIVE_OR_PRESENTATION';
        else if (srcScheme === 'BLOB' || srcScheme === 'DATA') mediaCategory = 'POSSIBLE_UPLOAD_ATTACHMENT';
        else if (ancestorButton || naturalWidth === 'SMALL' || naturalHeight === 'SMALL') mediaCategory = 'UI_AVATAR_OR_ICON';
        if (visibleValue) counts.visibleMediaCandidateCount += 1;
        if (mediaCategory === 'POSSIBLE_UPLOAD_ATTACHMENT') counts.possibleUploadAttachmentCount += 1;
        else if (mediaCategory === 'UI_AVATAR_OR_ICON') counts.uiAvatarOrIconCount += 1;
        else if (mediaCategory === 'DECORATIVE_OR_PRESENTATION') counts.decorativeCount += 1;
        else if (mediaCategory === 'VIDEO_CANDIDATE') counts.videoCandidateCount += 1;
        else counts.unknownCount += 1;
        return {
          tagName, visible: visibleValue, attached: node.isConnected === true,
          naturalWidth, naturalHeight, hasSrc: srcScheme !== 'NONE', srcScheme,
          hasAlt: node.hasAttribute?.('alt') === true, hasAriaHidden: node.hasAttribute?.('aria-hidden') === true,
          role: role(node), ancestorButton, ancestorPresentation, ancestorEditable,
          candidateDepth: depth(node), mediaCategory,
        };
      });
      return { ...counts, candidates: summarized.slice(0, maxCandidates) };
    }, RETAINED_COMPOSER_MEDIA_SELECTOR);
    return { ...emptyMediaInspection(rawMediaSelectorCount, true, 'OK'), ...inspection, rawMediaSelectorCount };
  } catch {
    return emptyMediaInspection(rawMediaSelectorCount, true, 'EVALUATION_FAILED');
  }
}

async function inspectComposerMedia(composer, task, options = {}) {
  const handle = await ensureRetainedComposer(composer);
  const expected = expectedMediaNames(task);
  // The ElementHandle is retained for exact DOM identity and structural
  // inspection. Playwright traversal/count APIs belong only to its paired
  // Locator, captured from the same accepted composer root.
  const rootLocator = composer?.locator;
  let attachments; let count;
  try {
    attachments = rootLocator?.locator?.(RETAINED_COMPOSER_MEDIA_SELECTOR);
    if (!attachments || typeof attachments.count !== 'function') throw new Error('retained composer locator unavailable');
    count = await attachments.count();
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('retained composer media count unavailable');
  } catch {
    try { await options.diagnostic?.zeroMediaInspectionSummary?.(await inspectRetainedComposerMediaCandidates(handle, -1)); } catch { /* observability only */ }
    throw failure('FACEBOOK_MEDIA_COUNT_UNAVAILABLE', 'Facebook composer media count is unavailable.');
  }
  try { await options.diagnostic?.zeroMediaInspectionSummary?.(await inspectRetainedComposerMediaCandidates(handle, count)); } catch { /* observability only */ }
  if (count !== expected.length) throw failure('FACEBOOK_MEDIA_MISMATCH', 'Facebook composer media does not match the immutable task snapshot.');
  const busy = await rootLocator?.locator?.('[aria-busy="true"], [role="progressbar"]').count?.().catch(() => 0);
  if (busy > 0) throw failure('FACEBOOK_MEDIA_NOT_READY', 'Facebook composer media is still processing.');
  const alerts = await rootLocator?.locator?.('[role="alert"]').allTextContents?.().catch(() => []);
  if ((alerts || []).some((value) => /upload.{0,30}(failed|error)|couldn.t upload/i.test(String(value)))) {
    throw failure('FACEBOOK_MEDIA_MISMATCH', 'Facebook composer media upload failed.');
  }
  // Facebook normally replaces local file identities with blob/CDN previews. If
  // an explicit filename attribute is exposed, require exact upload ordering;
  // otherwise count, ready-state, and the already hash-verified local input are
  // the strongest available evidence and are intentionally documented as such.
  const named = [];
  for (let index = 0; index < count; index += 1) {
    const attachment = attachments.nth(index);
    const name = await attachment.getAttribute?.('data-filename').catch(() => null)
      || await attachment.getAttribute?.('data-file-name').catch(() => null);
    if (name) named.push(String(name));
  }
  if (named.length && (named.length !== expected.length || named.some((name, index) => name !== expected[index]))) {
    throw failure('FACEBOOK_MEDIA_MISMATCH', 'Facebook composer media identity does not match the immutable task snapshot.');
  }
  return { attachmentCount: count, filenameEvidence: named.length === expected.length };
}

async function findScopedPublishControl(composer) {
  const handle = await ensureRetainedComposer(composer);
  const candidates = handle.locator?.('button, [role="button"]');
  const count = await candidates?.count?.().catch(() => 0);
  const matches = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const [text, label, visible] = await Promise.all([
      candidate.textContent?.().catch(() => ''),
      candidate.getAttribute?.('aria-label').catch(() => ''),
      candidate.isVisible?.().catch(() => false),
    ]);
    if (visible && /^(posteaz[ăa]|public[ăa]|post|publish)$/i.test(String(label || text || '').trim())) matches.push(candidate);
  }
  if (!matches.length) throw failure('FACEBOOK_PUBLISH_CONTROL_MISSING', 'Facebook publish control is unavailable.');
  if (matches.length !== 1) throw failure('FACEBOOK_PUBLISH_CONTROL_AMBIGUOUS', 'Facebook publish control is ambiguous.');
  const button = matches[0];
  if (typeof button.isEnabled === 'function' && !await button.isEnabled()) throw failure('FACEBOOK_PUBLISH_CONTROL_MISSING', 'Facebook publish control is unavailable.');
  return button;
}

async function ensureScopedPublishControl(button, composer) {
  await ensureRetainedComposer(composer);
  if (!button || typeof button.isVisible !== 'function' || !await button.isVisible().catch(() => false)
    || (typeof button.isEnabled === 'function' && !await button.isEnabled().catch(() => false))) {
    throw failure('FACEBOOK_PUBLISH_CONTROL_MISSING', 'Facebook publish control is unavailable.');
  }
}

module.exports = {
  FACEBOOK_GROUP_ORIGIN,
  canonicalFacebookGroupTarget,
  verifyCanonicalFacebookGroupTarget,
  normalizeComposerText,
  contentMismatchDiagnostic,
  CONTENT_HASH_PREFIX_LENGTH,
  TEXT_INSERTION_METHOD,
  CONTENTEDITABLE_VISUAL_TEXT,
  TEXTAREA_VALUE,
  INPUT_VALUE,
  RETAINED_COMPOSER_MEDIA_SELECTOR,
  VERIFICATION_READ_TIMING,
  COMPOSER_TEXT_SETTLE_TIMEOUT_MS,
  COMPOSER_TEXT_SETTLE_POLL_INTERVAL_MS,
  requirePreparedComposer,
  ensureRetainedComposer,
  visualPlainTextFromContenteditable,
  verifyComposerText,
  inspectComposerMedia,
  inspectRetainedComposerMediaCandidates,
  findScopedPublishControl,
  ensureScopedPublishControl,
};
