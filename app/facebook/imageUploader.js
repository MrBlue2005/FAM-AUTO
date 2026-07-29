const fs = require('fs');
const { resolveMediaReference } = require('../utils/mediaPath');

async function uploadImage(page, post) {
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

  const photoVideoButtons = [
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

  const input = page.locator('input[type="file"]').last();

  await input.waitFor({
    state: 'attached',
    timeout: 15000,
  });

  await input.setInputFiles(validFiles);

  console.log('✅ Media a fost trimisă prin input file.');
  console.log('⏳ Aștept procesarea media în composer...');

  await page.waitForTimeout(12000);

  console.log('✅ Media considerată atașată.');
}

module.exports = { uploadImage };
