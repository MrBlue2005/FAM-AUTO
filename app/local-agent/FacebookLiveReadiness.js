'use strict';

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

async function readExactComposerText(composer) {
  const handle = await ensureRetainedComposer(composer);
  const editors = handle.locator?.('[contenteditable="true"][role="textbox"], textarea');
  const count = await editors?.count?.().catch(() => 0);
  if (count !== 1) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'Facebook composer text field is ambiguous.');
  const editor = editors.first();
  let text = await editor.inputValue?.().catch(() => null);
  if (text === null || text === undefined) text = await editor.textContent?.().catch(() => null);
  if (text === null || text === undefined) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'Facebook composer text cannot be read.');
  return normalizeComposerText(text);
}

async function verifyComposerText(composer, expectedText) {
  if (normalizeComposerText(expectedText) !== await readExactComposerText(composer)) {
    throw failure('FACEBOOK_CONTENT_MISMATCH', 'Facebook composer text does not match the immutable task snapshot.');
  }
}

function expectedMediaNames(task) {
  return (Array.isArray(task?.payload?.local_media_paths) ? task.payload.local_media_paths : []).map((item) => path.basename(String(item))).filter(Boolean);
}

async function inspectComposerMedia(composer, task) {
  const handle = await ensureRetainedComposer(composer);
  const expected = expectedMediaNames(task);
  const attachments = handle.locator?.('img, video');
  const count = await attachments?.count?.().catch(() => -1);
  if (count !== expected.length) throw failure('FACEBOOK_MEDIA_MISMATCH', 'Facebook composer media does not match the immutable task snapshot.');
  const busy = await handle.locator?.('[aria-busy="true"], [role="progressbar"]').count?.().catch(() => 0);
  if (busy > 0) throw failure('FACEBOOK_MEDIA_NOT_READY', 'Facebook composer media is still processing.');
  const alerts = await handle.locator?.('[role="alert"]').allTextContents?.().catch(() => []);
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
  requirePreparedComposer,
  ensureRetainedComposer,
  verifyComposerText,
  inspectComposerMedia,
  findScopedPublishControl,
  ensureScopedPublishControl,
};
