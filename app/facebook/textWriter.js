async function writePostText(page, text, preparedComposer = null) {
  const handle = preparedComposer?.handle;
  const textbox = handle
    ? handle.locator('[contenteditable="true"][role="textbox"], textarea')
    : page.getByRole('textbox').last(); // Legacy Local Studio path only.
  if (handle && await textbox.count() !== 1) throw Object.assign(new Error('The prepared composer text field is ambiguous.'), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
  const field = handle ? textbox.first() : textbox;
  await field.waitFor({ state: 'visible', timeout: 30000 });
  console.log('Introduc textul prin paste pentru a evita autofill/tag-uri Facebook.');
  await field.click();
  await page.evaluate(async (value) => { await navigator.clipboard.writeText(value); }, text);
  await page.keyboard.press('Control+V');
  console.log('Text introdus.');
}

module.exports = { writePostText };
