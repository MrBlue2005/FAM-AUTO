async function writePostText(page, text) {
  const textbox = page.getByRole('textbox').last();

  await textbox.waitFor({
    state: 'visible',
    timeout: 30000,
  });

  console.log('⌨️ Introduc textul prin paste ca să evit autofill/tag-uri Facebook...');

  await textbox.click();

  await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value);
  }, text);

  await page.keyboard.press('Control+V');

  console.log('✅ Text introdus.');
}

module.exports = {
  writePostText,
};