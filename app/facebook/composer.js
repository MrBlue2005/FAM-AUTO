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

async function openComposer(page, options = {}) {
  const trace = typeof options.trace === 'function' ? options.trace : () => {};
  // The real publisher supplies this immediately after canonical target
  // verification. Do not discover a composer when that target proof fails.
  if (typeof options.assertTargetReady === 'function') options.assertTargetReady();
  try {
    const composerButton = await findComposerOpener(page);
    trace('COMPOSER_OPENER_FOUND');
    const dialogs = page.getByRole('dialog');
    const beforeCount = await dialogs.count();

    await composerButton.click();

    try {
      // Do not re-acquire a generic dialog. The only accepted composer is the
      // single dialog created by this exact opener click.
      await page.waitForFunction((count) => document.querySelectorAll('[role="dialog"]').length !== count, beforeCount, { timeout: 10000 });
    } catch {
      throw failure('FACEBOOK_COMPOSER_OPEN_FAILED', 'The selected group composer opener did not open a composer.');
    }
    const afterCount = await dialogs.count();
    if (afterCount !== beforeCount + 1) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The opened Facebook composer cannot be uniquely identified.');
    const locator = dialogs.nth(beforeCount);
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    const handle = await locator.elementHandle();
    if (!handle) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The opened Facebook composer cannot be retained.');

    trace('COMPOSER_OPENED');
    console.log('Composerul a fost deschis.');
    return { handle, locator };
  } catch (error) {
    trace(error?.code === 'FACEBOOK_COMPOSER_OPENER_AMBIGUOUS' ? 'COMPOSER_OPENER_AMBIGUOUS' : 'COMPOSER_OPEN_FAILED');
    throw error;
  }
}

module.exports = {
  COMPOSER_ENTRY_LABELS,
  GROUP_COMPOSER_STRUCTURAL_SELECTOR,
  findComposerOpener,
  openComposer,
};
