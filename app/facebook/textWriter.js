async function writePostText(page, text, preparedComposer = null) {
  const handle = preparedComposer?.handle;
  const field = handle
    ? preparedComposer?.editor
    : page.getByRole('textbox').last(); // Legacy Local Studio path only.
  if (handle && !field) throw Object.assign(new Error('The prepared composer text field was not retained.'), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
  if (typeof field.waitFor === 'function') await field.waitFor({ state: 'visible', timeout: 30000 });
  else await field.waitForElementState?.('visible', { timeout: 30000 });
  console.log('Introduc textul prin paste pentru a evita autofill/tag-uri Facebook.');
  await field.click();
  await page.evaluate(async (value) => { await navigator.clipboard.writeText(value); }, text);
  await page.keyboard.press('Control+V');
  console.log('Text introdus.');
}

module.exports = { writePostText };
