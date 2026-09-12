const fs = require('fs');
const { resolveMediaReference } = require('../utils/mediaPath');

async function uploadImage(page, post, preparedComposer = null) {
  const files = post.media?.length ? post.media : [post.imagePath];
  const validFiles = files.filter(Boolean).map(resolveMediaReference);

  if (!validFiles.length) {
    throw new Error('Nu există media de încărcat.');
  }

  for (const file of validFiles) {
    if (!file || !fs.existsSync(file)) {
      throw new Error(`Media nu există: ${file}`);
    }
  }

  console.log(`📎 Pregătesc upload media: ${validFiles.join(', ')}`);

  const composerScope = preparedComposer?.handle || null;
  const photoVideoButtons = composerScope
    ? [
      composerScope.locator('button[aria-label*="Foto"], [role="button"][aria-label*="Foto"]').first(),
      composerScope.locator('button[aria-label*="Photo"], [role="button"][aria-label*="Photo"]').first(),
    ]
    : [
      page.getByRole('button', { name: /Foto\/video/i }),
      page.getByRole('button', { name: /Photo\/video/i }),
      page.getByRole('button', { name: /Fotografie\/video/i }),
      page.locator('[aria-label*="Foto"]').first(),
      page.locator('[aria-label*="Photo"]').first(),
    ];

  for (const button of photoVideoButtons) {
    try {
      await button.waitFor({ state: 'visible', timeout: 3000 });

      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 12000 }),
        button.click(),
      ]);

      await fileChooser.setFiles(validFiles);

      console.log('✅ Media a fost selectată prin file chooser.');
      console.log('⏳ Aștept procesarea media în composer...');

      await page.waitForTimeout(12000);

      console.log('✅ Media considerată atașată.');
      return;
    } catch (error) {
      console.log(`⚠️ Upload prin buton a eșuat: ${error.message}`);
    }
  }

  console.log('⚠️ Nu am prins file chooser-ul. Încerc o singură dată upload direct prin input.');

  const input = composerScope ? composerScope.locator('input[type="file"]') : page.locator('input[type="file"]').last();
  if (composerScope && await input.count() !== 1) throw Object.assign(new Error('The prepared composer upload input is ambiguous.'), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' });

  await (composerScope ? input.first() : input).waitFor({
    state: 'attached',
    timeout: 15000,
  });

  await (composerScope ? input.first() : input).setInputFiles(validFiles);

  console.log('✅ Media a fost trimisă prin input file.');
  console.log('⏳ Aștept procesarea media în composer...');

  await page.waitForTimeout(12000);

  console.log('✅ Media considerată atașată.');
}

module.exports = { uploadImage };
