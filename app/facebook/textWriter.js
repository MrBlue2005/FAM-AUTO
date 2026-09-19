const CLIPBOARD_PASTE = 'CLIPBOARD_PASTE';
const RETAINED_EDITOR_FILL = 'FILL';
const RETAINED_EDITOR_SHIFT_ENTER = 'RETAINED_EDITOR_SHIFT_ENTER';

function failure(code, message) { return Object.assign(new Error(message), { code }); }

function multilineLines(value) {
  const lines = String(value ?? '').split(/\r\n?|\n/);
  // Verification keeps its long-standing trim semantics. Do not manufacture a
  // trailing soft break for a source terminator that the immutable comparison
  // deliberately ignores.
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

async function writeRetainedMultilineText(field, text) {
  const lines = multilineLines(text);
  const normalizedText = lines.join('\n');
  // Facebook's Lexical editor may collapse adjacent soft breaks created by
  // repeated Shift+Enter. Playwright fill is a supported contenteditable
  // action and submits the complete newline sequence through the exact paired
  // retained Locator, allowing Lexical to process intentional blank lines as
  // one atomic input rather than adjacent soft-break key events.
  if (normalizedText.includes('\n\n')) {
    if (typeof field.fill !== 'function') {
      throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The retained Facebook composer cannot accept blank-line text.');
    }
    try {
      await field.fill(normalizedText);
      return RETAINED_EDITOR_FILL;
    } catch {
      throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The retained Facebook composer cannot accept blank-line text.');
    }
  }
  if (typeof field.pressSequentially !== 'function' || typeof field.press !== 'function') {
    throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The retained Facebook composer cannot accept multiline text.');
  }
  for (let index = 0; index < lines.length; index += 1) {
    try {
      if (lines[index]) await field.pressSequentially(lines[index]);
      // Shift+Enter is the reviewed Facebook composer line-break action. It is
      // issued through the exact retained editor, never page-wide keyboard state.
      if (index < lines.length - 1) await field.press('Shift+Enter');
    } catch {
      throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The retained Facebook composer cannot accept multiline text.');
    }
  }
  return RETAINED_EDITOR_SHIFT_ENTER;
}

async function writePostText(page, text, preparedComposer = null) {
  const handle = preparedComposer?.handle;
  const retainedEditor = preparedComposer?.editor;
  // Live preparation retains an editor pair.  Keyboard input must use the
  // paired Locator, not the ElementHandle retained for DOM identity checks.
  // The unpaired branch preserves the legacy Local Studio caller contract.
  const retainedEditorLocator = retainedEditor?.handle
    ? retainedEditor.locator
    : retainedEditor;
  const field = handle
    ? retainedEditorLocator
    : page.getByRole('textbox').last(); // Legacy Local Studio path only.
  if (handle && !field) throw Object.assign(new Error('The prepared composer text field was not retained.'), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });
  if (typeof field.waitFor === 'function') await field.waitFor({ state: 'visible', timeout: 30000 });
  else await field.waitForElementState?.('visible', { timeout: 30000 });
  await field.click();

  if (handle && /\r\n?|\n/.test(String(text ?? ''))) {
    console.log('Introduc text multiline pe editorul retinut.');
    const insertionMethod = await writeRetainedMultilineText(field, text);
    console.log('Text introdus.');
    return { insertionMethod };
  }

  console.log('Introduc textul prin paste pentru a evita autofill/tag-uri Facebook.');
  await page.evaluate(async (value) => { await navigator.clipboard.writeText(value); }, text);
  await page.keyboard.press('Control+V');
  console.log('Text introdus.');
  return { insertionMethod: CLIPBOARD_PASTE };
}

module.exports = {
  CLIPBOARD_PASTE,
  RETAINED_EDITOR_FILL,
  RETAINED_EDITOR_SHIFT_ENTER,
  writePostText,
};
