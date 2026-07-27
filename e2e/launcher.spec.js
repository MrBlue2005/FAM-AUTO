const { test, expect } = require('@playwright/test');

test('launcher exposes the two studio applications', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Alege aplicația pe care vrei să o deschizi' })).toBeVisible();
  await expect(page.getByRole('link', { name: /RX PROPULSE TOOL/ })).toHaveAttribute('href', '/dashboard');
  await expect(page.locator('.launcher-app-logo-red')).toHaveCount(1);
  await expect(page.locator('.launcher-app-logo-green')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /RX CREATIVE Tool/ })).toHaveAttribute('href', 'http://127.0.0.1:3100');
});

test('launcher stays centered and keeps the studio footer visible', async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 768 });
  await page.goto('/');

  const cards = page.locator('.launcher-grid');
  const footer = page.locator('.launcher-footer');
  const cardsBox = await cards.boundingBox();
  const footerBox = await footer.boundingBox();

  expect(cardsBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(cardsBox.y).toBeGreaterThan(180);
  expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(768);
});
