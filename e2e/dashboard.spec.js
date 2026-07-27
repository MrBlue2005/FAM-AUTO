const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');

const apiBaseUrl = `${process.env.E2E_API_URL || 'http://127.0.0.1:3000/api'}/`;
const serviceBaseUrl = apiBaseUrl.replace(/\/api\/$/, '/');

async function apiJson(endpoint, options) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, options);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`API ${endpoint} failed (${response.status}): ${body}`);
  }

  return body ? JSON.parse(body) : null;
}

function smokeBackup() {
  const mediaPath = path.resolve(__dirname, '..', 'overlay-desktop', 'build', 'icon.png');

  return {
    format: 'rx-ai-studio-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    runtimeConfig: {
      campaignDay: 1,
      groupLimit: 1,
      startFromGroup: 1,
      skipGroupsPostedToday: true,
      publishEnabled: false,
      selectedPropertyIds: ['SMOKE_PROPERTY'],
      stopAfterCurrentGroup: false,
      campaignCategory: 'real_estate',
      facebookProfileId: 'main',
      facebookProfiles: [
        { id: 'main', label: 'Smoke profile', profilePath: 'chrome-profile-smoke', category: 'real_estate' },
        { id: 'jobs', label: 'Smoke jobs profile', profilePath: 'chrome-profile-jobs-smoke', category: 'jobs' },
      ],
      postingIdentityByCategory: { real_estate: 'default', jobs: 'jobs_page' },
      postingIdentityByProfile: {},
      queueExcludedTaskIds: [],
      queueRetryTaskIds: [],
      queueOrder: [],
      facebookPostingIdentities: [
        { id: 'default', label: 'Smoke identity', actorName: 'Smoke Test' },
        { id: 'jobs_page', label: 'Smoke jobs identity', actorName: 'Smoke Jobs Test' },
      ],
    },
    groups: [{
      id: 'SMOKE_GROUP',
      name: 'Smoke test group',
      url: 'https://www.facebook.com/groups/smoke-test',
      active: true,
      category: 'real_estate',
      overrideType: 'mixed',
    }],
    schedules: [],
    properties: [{
      id: 'SMOKE_PROPERTY',
      name: 'Smoke test property',
      active: true,
      transactionType: 'rent',
      facebookProfileId: 'main',
      posts: [{ day: 1, title: 'Smoke day 1', text: 'Smoke test property post', imagePath: mediaPath, media: [mediaPath] }],
    }],
    jobs: [{
      id: 'SMOKE_JOB',
      title: 'Smoke test job',
      company: 'Smoke Test',
      active: true,
      transactionType: 'job',
      campaignCategory: 'jobs',
      facebookProfileId: 'jobs',
      posts: [{ day: 1, title: 'Smoke job day 1', text: 'Smoke test job post', imagePath: mediaPath, media: [mediaPath] }],
    }],
    history: [],
    runs: [],
  };
}

test.beforeAll(async () => {
  await apiJson('backup/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(smokeBackup()),
  });
});

test('service health and persistent storage are ready', async () => {
  const [healthResponse, readinessResponse] = await Promise.all([
    fetch(`${serviceBaseUrl}healthz`),
    fetch(`${serviceBaseUrl}readyz`),
  ]);
  expect(healthResponse.ok).toBe(true);
  expect(readinessResponse.ok).toBe(true);
  await expect(readinessResponse.json()).resolves.toMatchObject({
    ok: true,
    storage: [
      { name: 'data', ready: true },
      { name: 'logs', ready: true },
      { name: 'uploads', ready: true },
      { name: 'profiles', ready: true },
    ],
  });
});

test('external upload volume keeps portable media references', async () => {
  const iconPath = path.resolve(__dirname, '..', 'overlay-desktop', 'build', 'icon.png');
  const form = new FormData();
  form.append('propertyId', 'SMOKE_PROPERTY');
  form.append('day', '1');
  form.append('files', new Blob([fs.readFileSync(iconPath)], { type: 'image/png' }), 'smoke-icon.png');

  const uploadResponse = await fetch(`${apiBaseUrl}media/upload`, { method: 'POST', body: form });
  expect(uploadResponse.ok).toBe(true);
  const upload = await uploadResponse.json();
  expect(upload.files[0].path).toMatch(/^app\/uploads\/SMOKE_PROPERTY\/day-1\//);

  const relative = upload.files[0].path.slice('app/uploads/'.length).split('/').map(encodeURIComponent).join('/');
  expect((await fetch(`${serviceBaseUrl}uploads/${relative}`)).ok).toBe(true);

  const deleteResponse = await fetch(`${apiBaseUrl}media`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: upload.files[0].path }),
  });
  expect(deleteResponse.ok).toBe(true);
});

test('isolated smoke campaign stays in test mode and passes preflight', async () => {
  const [config, properties, jobs, groups, queue, preflight] = await Promise.all([
    apiJson('runtime-config'),
    apiJson('properties'),
    apiJson('jobs'),
    apiJson('groups'),
    apiJson('queue/plan'),
    apiJson('preflight'),
  ]);

  expect(config).toMatchObject({ publishEnabled: false, groupLimit: 1, selectedPropertyIds: ['SMOKE_PROPERTY'] });
  expect(properties).toHaveLength(1);
  expect(jobs).toHaveLength(1);
  expect(groups).toHaveLength(1);
  expect(queue.summary).toMatchObject({ total: 1, active: 1, done: 0 });
  expect(queue.activeTasks[0]).toMatchObject({ campaignId: 'SMOKE_PROPERTY', groupId: 'SMOKE_GROUP', mode: 'Doar pregatire' });
  expect(preflight).toMatchObject({ ok: true, mode: 'test', summary: { total: 1, active: 1, errors: 0 } });
});

test('campaign schedules persist safely through the API', async () => {
  const profileListing = await apiJson('facebook-profiles');
  expect(profileListing.selectedProfileId).toBe('main');
  expect(profileListing.profiles).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'main', label: 'Smoke profile' }),
    expect.objectContaining({ id: 'jobs', label: 'Smoke jobs profile' }),
  ]));

  const created = await apiJson('schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke weekly schedule',
      enabled: false,
      daysOfWeek: [1, 3, 5],
      time: '09:30',
      campaignCategory: 'real_estate',
      campaignIds: ['SMOKE_PROPERTY'],
      facebookProfileId: 'main',
      campaignDay: 1,
      groupLimit: 1,
      startFromGroup: 1,
      publishEnabled: false,
      maxLateMinutes: 10,
    }),
  });
  expect(created).toMatchObject({ name: 'Smoke weekly schedule', enabled: false, skipGroupsPostedToday: true, publishEnabled: false, nextRunAt: null });

  const listing = await apiJson('schedules');
  expect(listing.schedules).toHaveLength(1);
  expect(listing.timezone).toBeTruthy();

  const removed = await apiJson(`schedules/${encodeURIComponent(created.id)}`, { method: 'DELETE' });
  expect(removed).toEqual({ ok: true, id: created.id });
});

test('dashboard CTA navigates to Live Feed', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' }).last()).toBeVisible();
  await page.getByRole('button', { name: /Deschide Live Feed/ }).click();
  await expect(page.getByRole('heading', { name: 'Live Feed' }).last()).toBeVisible();
});

test('property and job editors expose media workflows', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Proprietati' }).first().click();
  await expect(page.getByRole('button', { name: /Trage media aici/ })).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Alege din Media Library/ })).toHaveCount(3);
  await page.getByRole('button', { name: 'Joburi' }).first().click();
  await expect(page.getByRole('button', { name: /Preview Facebook/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Salveaza si mergi la Queue/ })).toBeVisible();
});

test('scheduler page exposes weekly and safety controls', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Programari' }).click();
  await expect(page.getByRole('heading', { name: 'Programari campanii' }).last()).toBeVisible();
  await expect(page.getByText('Zilele saptamanii')).toBeVisible();
  await expect(page.getByLabel('Profil Facebook')).toHaveValue('main');
  await expect(page.getByRole('option', { name: 'Smoke profile' })).toBeAttached();
  await expect(page.getByRole('option', { name: 'TEST - doar pregatire' })).toBeAttached();
  await expect(page.getByLabel('Exclude grupurile in care s-a publicat deja astazi.')).toBeChecked();
  await expect(page.getByRole('button', { name: /Creeaza programarea/ })).toBeVisible();
});

test('smoke property, job, and queue are visible in the dashboard', async ({ page }) => {
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Proprietati' }).first().click();
  await expect(page.getByText('Smoke test property', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Joburi' }).first().click();
  await expect(page.getByText('Smoke test job', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Queue' }).first().click();
  const queueTask = page.getByRole('article').filter({ hasText: 'SMOKE_GROUP' });
  await expect(queueTask.getByText('Smoke test property', { exact: true })).toBeVisible();
  await expect(queueTask.getByText('Smoke test group', { exact: true })).toBeVisible();
  await expect(queueTask.getByText('Doar pregatire', { exact: true })).toBeVisible();
});

test('sidebar scrolls to Propulse Control and Settings on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('/dashboard');

  const sidebarNav = page.locator('.sidebar-nav');
  const dimensions = await sidebarNav.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await sidebarNav.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const settingsBox = await page.getByRole('button', { name: 'Settings' }).boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(560);
});
test('overlay button confirms a fast desktop launch without opening duplicates', async ({ page }) => {
  let launchRequests = 0;
  await page.route(`${apiBaseUrl}overlay/desktop/open`, async (route) => {
    launchRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, mode: 'unpacked-exe', pid: 1234 }),
    });
  });

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Overlay' }).click();
  await expect(page.getByText('RX Propulse Overlay a fost deschis.')).toBeVisible();
  expect(launchRequests).toBe(1);
});
