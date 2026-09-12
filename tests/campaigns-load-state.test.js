'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const servicePath = path.join(__dirname, '..', 'dashboard-v2', 'src', 'services', 'campaignsLoadState.js');
const pagePath = path.join(__dirname, '..', 'dashboard-v2', 'src', 'pages', 'Campaigns.jsx');
const load = () => import(`${pathToFileURL(servicePath).href}?test=${Date.now()}`);

const property = { id: 'property-1', name: 'Synthetic Cloud Preflight Fixture', active: true, posts: [{ day: 1 }], folderId: 'folder-1' };
const job = { id: 'job-1', title: 'Synthetic Job', active: false, posts: [] };
const folder = { id: 'folder-1', name: 'Synthetic Folder' };
const client = (overrides = {}) => ({
  getProperties: async () => [property],
  getJobs: async () => [job],
  getCampaignFolders: async () => [folder],
  ...overrides,
});

test('Campaigns load state renders a successful one-property aggregate', async () => {
  const { CAMPAIGN_LOAD_STATUS, buildCampaignRows, loadCampaignsState } = await load();
  const result = await loadCampaignsState(client({ getJobs: async () => [] }));
  assert.equal(result.status, CAMPAIGN_LOAD_STATUS.SUCCESS);
  const campaigns = buildCampaignRows(result.data.properties, result.data.jobs);
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].title, 'Synthetic Cloud Preflight Fixture');
});

test('Campaigns permits a true successful empty state only after all reads succeed', async () => {
  const { CAMPAIGN_LOAD_STATUS, buildCampaignRows, loadCampaignsState } = await load();
  const result = await loadCampaignsState(client({ getProperties: async () => [], getJobs: async () => [], getCampaignFolders: async () => [] }));
  assert.equal(result.status, CAMPAIGN_LOAD_STATUS.SUCCESS);
  assert.deepEqual(buildCampaignRows(result.data.properties, result.data.jobs), []);
});

for (const failingRead of ['getProperties', 'getJobs', 'getCampaignFolders']) {
  test(`Campaigns treats a rejected ${failingRead} read as an error, never an empty aggregate`, async () => {
    const { CAMPAIGN_LOAD_STATUS, loadCampaignsState } = await load();
    const result = await loadCampaignsState(client({ [failingRead]: async () => { throw new Error('request failed'); } }));
    assert.deepEqual(result, { status: CAMPAIGN_LOAD_STATUS.ERROR, data: null });
  });
}

test('Campaigns treats an auth-style rejection as a load error and retry can recover', async () => {
  const { CAMPAIGN_LOAD_STATUS, loadCampaignsState } = await load();
  let attempts = 0;
  const retryingClient = client({ getProperties: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Session is invalid or expired.');
    return [property];
  } });
  assert.equal((await loadCampaignsState(retryingClient)).status, CAMPAIGN_LOAD_STATUS.ERROR);
  const recovered = await loadCampaignsState(retryingClient);
  assert.equal(recovered.status, CAMPAIGN_LOAD_STATUS.SUCCESS);
  assert.equal(recovered.data.properties[0].name, property.name);
});

test('Campaigns preserves existing filters after a successful load', async () => {
  const { buildCampaignRows, filterCampaignRows } = await load();
  const campaigns = buildCampaignRows([property], [job]);
  const filters = { search: 'fixture', typeFilter: 'real_estate', statusFilter: 'active', folderFilter: 'folder-1' };
  assert.deepEqual(filterCampaignRows(campaigns, filters).map((row) => row.id), ['property-1']);
});

test('Campaigns page gates empty data behind successful load and offers safe retry', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /campaignLoadStatus === CAMPAIGN_LOAD_STATUS\.ERROR/);
  assert.match(page, /Nu am putut încărca campaniile\./);
  assert.match(page, /Încearcă din nou/);
  assert.match(page, /campaignLoadStatus === CAMPAIGN_LOAD_STATUS\.SUCCESS/);
  assert.match(page, /filteredCampaigns\.length === 0/);
});
