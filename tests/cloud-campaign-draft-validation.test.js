'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path'); const { pathToFileURL } = require('node:url');

test('cloud campaign drafts may save text before their first media attachment while local validation remains strict', async () => {
  const module = await import(pathToFileURL(path.join(__dirname, '..', 'dashboard-v2', 'src', 'utils', 'campaignPostValidation.js')).href);
  const textOnly = [{ day: 1, text: 'Synthetic cloud post', active: true, media: [] }];
  assert.equal(module.firstInvalidCampaignPost(textOnly), textOnly[0]);
  assert.equal(module.firstInvalidCampaignPost(textOnly, { allowCloudDraftWithoutMedia: true }), undefined);
  assert.equal(module.firstInvalidCampaignPost([{ ...textOnly[0], text: '' }], { allowCloudDraftWithoutMedia: true }).day, 1);
});
