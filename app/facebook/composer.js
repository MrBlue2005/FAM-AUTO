async function openComposer(page) {
  const composerButton = page.getByRole('button', { name: 'Scrie ceva...' });
  const dialogs = page.getByRole('dialog');
  const beforeCount = await dialogs.count();

  await composerButton.waitFor({ state: 'visible', timeout: 30000 });
  await composerButton.click();

  // Bind to the single dialog opened by this click; do not select a generic
  // first/last dialog after the fact. Legacy callers may ignore this return.
  await page.waitForFunction((count) => document.querySelectorAll('[role="dialog"]').length === count + 1, beforeCount, { timeout: 10000 });
  const afterCount = await dialogs.count();
  if (afterCount !== beforeCount + 1) throw Object.assign(new Error('The opened Facebook composer cannot be uniquely identified.'), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
  const locator = dialogs.nth(beforeCount);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  const handle = await locator.elementHandle();
  if (!handle) throw Object.assign(new Error('The opened Facebook composer cannot be retained.'), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });

  console.log('Composerul a fost deschis.');
  return { handle, locator };
}

module.exports = { openComposer };
