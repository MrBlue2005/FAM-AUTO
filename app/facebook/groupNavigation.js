async function openGroup(page, groupUrl) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🌐 Deschid grupul (${attempt}/${maxAttempts}): ${groupUrl}`);

      await page.goto(groupUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      await page.waitForTimeout(2500);

      console.log('✅ Grup încărcat.');
      return;
    } catch (error) {
      console.log(`⚠️ Încercarea ${attempt} a eșuat: ${error.message}`);

      if (attempt === maxAttempts) {
        throw new Error(`Nu am putut deschide grupul după ${maxAttempts} încercări: ${error.message}`);
      }

      await page.waitForTimeout(5000);
    }
  }
}

module.exports = {
  openGroup,
};