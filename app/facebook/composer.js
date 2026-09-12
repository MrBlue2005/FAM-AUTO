'use strict';

function failure(code, message) { return Object.assign(new Error(message), { code }); }

// These are the reviewed group-composer entry labels seen in Facebook's
// Romanian and English UI. They intentionally are exact strings: broad text
// matching would make a comment or another publishing surface eligible.
const COMPOSER_ENTRY_LABELS = Object.freeze([
  'Scrie ceva...',
  'Scrie ceva',
  'Write something...',
  'Write something',
]);

const GROUP_COMPOSER_STRUCTURAL_SELECTOR = '[role="main"] [data-pagelet="GroupFeed"] [role="textbox"][contenteditable="true"][aria-label]';
const COMPOSER_EDITOR_SELECTOR = '[contenteditable="true"][role="textbox"], textarea';
const COMPOSER_TRANSITION_TIMEOUT_MS = 10000;
const COMPOSER_TRANSITION_POLL_MS = 100;

async function visibleEnabledCandidates(locator) {
  const candidates = [];
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) candidates.push(candidate);
  }
  return candidates;
}

async function findComposerOpener(page) {
  const labelled = [];
  for (const label of COMPOSER_ENTRY_LABELS) {
    for (const role of ['button', 'textbox']) {
      labelled.push(...await visibleEnabledCandidates(page.getByRole(role, { name: label, exact: true })));
    }
  }
  if (labelled.length === 1) return labelled[0];
  if (labelled.length > 1) throw failure('FACEBOOK_COMPOSER_OPENER_AMBIGUOUS', 'The group composer opener is ambiguous.');

  // The fallback is deliberately bounded to Facebook's GroupFeed creation
  // area. It is never a generic page-wide contenteditable search, so comment
  // boxes and unrelated dialogs remain ineligible.
  const structural = await visibleEnabledCandidates(page.locator(GROUP_COMPOSER_STRUCTURAL_SELECTOR));
  if (structural.length === 1) return structural[0];
  if (structural.length > 1) throw failure('FACEBOOK_COMPOSER_OPENER_AMBIGUOUS', 'The group composer opener is ambiguous.');
  throw failure('FACEBOOK_COMPOSER_OPENER_MISSING', 'The group composer opener is unavailable.');
}

async function sameDomNode(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left.evaluate !== 'function') return false;
  return left.evaluate((node, other) => node === other, right).catch(() => false);
}

async function composerContract(handle) {
  const attachedPromise = typeof handle?.evaluate === 'function'
    ? handle.evaluate((node) => node.isConnected).catch(() => false)
    : Promise.resolve(false);
  const visiblePromise = typeof handle?.isVisible === 'function'
    ? handle.isVisible().catch(() => false)
    : Promise.resolve(false);
  const [attached, visible] = await Promise.all([
    attachedPromise,
    visiblePromise,
  ]);
  if (attached !== true || visible !== true) return 'inactive';
  const editors = handle.locator?.(COMPOSER_EDITOR_SELECTOR);
  const count = await editors?.count?.().catch(() => 0);
  if (count === 1) return 'eligible';
  return count > 1 ? 'ambiguous' : 'not-composer';
}

async function snapshotComposerDialogs(page) {
  const dialogs = page.getByRole('dialog');
  const records = [];
  const count = await dialogs.count();
  for (let index = 0; index < count; index += 1) {
    const locator = dialogs.nth(index);
    const handle = await locator.elementHandle?.().catch(() => null);
    if (!handle) continue;
    records.push({ handle, locator, contract: await composerContract(handle) });
  }
  return records;
}

async function findBeforeRecord(before, postRecord) {
  for (const record of before) {
    if (await sameDomNode(record.handle, postRecord.handle)) return record;
  }
  return null;
}

async function transitionResult(before, after) {
  const candidates = [];
  let ambiguous = false;
  let removed = 0;
  for (const record of before) {
    let retained = false;
    for (const post of after) {
      if (await sameDomNode(record.handle, post.handle)) { retained = true; break; }
    }
    if (!retained) removed += 1;
  }
  for (const post of after) {
    const prior = await findBeforeRecord(before, post);
    const transitioned = !prior || prior.contract !== post.contract;
    if (post.contract === 'ambiguous' && transitioned) ambiguous = true;
    if (post.contract === 'eligible' && (!prior || prior.contract !== 'eligible')) candidates.push({ post, prior });
  }
  if (ambiguous || candidates.length > 1) return { kind: 'ambiguous' };
  if (!candidates.length) return { kind: 'none' };
  const candidate = candidates[0];
  if (!candidate.prior) return { kind: removed > 0 ? 'replacement' : 'new', record: candidate.post };
  return { kind: 'reuse', record: candidate.post };
}

async function waitForComposerTransition(page, before, options = {}) {
  const timeoutMs = Number.isFinite(options.transitionTimeoutMs) ? options.transitionTimeoutMs : COMPOSER_TRANSITION_TIMEOUT_MS;
  const pollMs = Number.isFinite(options.transitionPollMs) ? options.transitionPollMs : COMPOSER_TRANSITION_POLL_MS;
  const started = Date.now();
  do {
    const result = await transitionResult(before, await snapshotComposerDialogs(page));
    if (result.kind !== 'none') return result;
    if (Date.now() - started >= timeoutMs) break;
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(pollMs);
    else await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (true);
  return { kind: 'none' };
}

async function openComposer(page, options = {}) {
  const trace = typeof options.trace === 'function' ? options.trace : () => {};
  // The real publisher supplies this immediately after canonical target
  // verification. Do not discover a composer when that target proof fails.
  if (typeof options.assertTargetReady === 'function') options.assertTargetReady();
  try {
    const composerButton = await findComposerOpener(page);
    trace('COMPOSER_OPENER_FOUND');
    const before = await snapshotComposerDialogs(page);

    await composerButton.click();
    const transition = await waitForComposerTransition(page, before, options);
    if (transition.kind === 'none') {
      trace('COMPOSER_OPEN_TIMEOUT');
      throw failure('FACEBOOK_COMPOSER_OPEN_FAILED', 'The selected group composer opener did not open a composer.');
    }
    trace('COMPOSER_TRANSITION_OBSERVED');
    if (transition.kind === 'ambiguous') {
      trace('COMPOSER_TRANSITION_AMBIGUOUS');
      throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The opened Facebook composer cannot be uniquely identified.');
    }
    if (transition.kind === 'new') trace('COMPOSER_UNIQUE_NEW');
    if (transition.kind === 'replacement') trace('COMPOSER_UNIQUE_REPLACEMENT');
    if (transition.kind === 'reuse') trace('COMPOSER_UNIQUE_REUSE');
    const { locator, handle } = transition.record;
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    if (!handle) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The opened Facebook composer cannot be retained.');

    trace('COMPOSER_OPENED');
    console.log('Composerul a fost deschis.');
    return { handle, locator };
  } catch (error) {
    if (error?.code === 'FACEBOOK_COMPOSER_OPENER_AMBIGUOUS') trace('COMPOSER_OPENER_AMBIGUOUS');
    else if (error?.code === 'FACEBOOK_COMPOSER_UNVERIFIED') trace('COMPOSER_TRANSITION_AMBIGUOUS');
    else trace('COMPOSER_OPEN_FAILED');
    throw error;
  }
}

module.exports = {
  COMPOSER_ENTRY_LABELS,
  COMPOSER_EDITOR_SELECTOR,
  GROUP_COMPOSER_STRUCTURAL_SELECTOR,
  findComposerOpener,
  snapshotComposerDialogs,
  transitionResult,
  openComposer,
};
