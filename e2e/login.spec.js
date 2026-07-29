const { test, expect } = require('@playwright/test');

const dashboardUrl = process.env.E2E_DASHBOARD_URL || 'http://127.0.0.1:5175';
const apiUrl = process.env.E2E_API_URL || 'http://127.0.0.1:3100/api';
const corsHeaders = {
  'access-control-allow-origin': dashboardUrl,
  'access-control-allow-credentials': 'true',
};

test('loginul protejează launcherul și nu expune tokenul în JavaScript', async ({ page }) => {
  let loggedIn = false;
  await page.route(`${apiUrl}/auth/status`, (route) => route.fulfill({
    contentType: 'application/json',
    headers: corsHeaders,
    body: JSON.stringify({
      enabled: true,
      authenticated: loggedIn,
      username: loggedIn ? 'admin' : null,
      role: loggedIn ? 'admin' : null,
    }),
  }));
  await page.route(`${apiUrl}/auth/login`, async (route) => {
    const credentials = route.request().postDataJSON();
    expect(credentials).toEqual({ username: 'admin', password: 'parola-locala-test-2026' });
    expect(route.request().headers()['x-rx-csrf']).toBe('1');
    loggedIn = true;
    await route.fulfill({
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ username: 'admin', role: 'admin', expiresAt: Date.now() + 60_000 }),
    });
  });

  await page.goto(dashboardUrl);
  await expect(page.locator('#login-title')).toHaveText('Bine ai revenit');
  await expect(page.locator('.launcher-grid')).toHaveCount(0);
  await page.getByLabel('Utilizator').fill('admin');
  await page.getByLabel('Parolă').fill('parola-locala-test-2026');
  await page.getByRole('button', { name: 'Intră în studio' }).click();
  await expect(page.locator('.launcher-grid')).toBeVisible();
  await expect(page.evaluate(() => Object.keys(localStorage).filter((key) => /token|session|auth/i.test(key)))).resolves.toEqual([]);
});
