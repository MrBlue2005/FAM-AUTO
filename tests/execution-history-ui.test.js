'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('execution history UI gives managed users a scoped history without device inventory or task mutation controls', async () => {
  const history = await import('../dashboard-v2/src/services/executionHistory.js');
  const page = source('dashboard-v2', 'src', 'pages', 'Executions.jsx');
  const sidebar = source('dashboard-v2', 'src', 'layout', 'Sidebar.jsx');
  const app = source('dashboard-v2', 'src', 'App', 'App.jsx');
  const api = source('dashboard-v2', 'src', 'services', 'api.js');
  assert.equal(history.executionStatusView('COMPLETED').tone, 'active'); assert.equal(history.executionStatusView('FAILED').tone, 'inactive'); assert.equal(history.executionStatusView('OUTCOME_UNKNOWN').tone, 'warning');
  assert.match(history.failureMessage({ outcomeUnknown: true }), /verificare manuală/i);
  assert.deepEqual(history.profilesForDevice([{ deviceId: 'a', profiles: [{ profileId: 'p' }] }], 'a'), [{ profileId: 'p' }]);
  assert.equal(history.deviceOptionLabel({ displayName: 'PC', deviceId: 'agent_12345678' }), 'PC · 12345678');
  assert.match(sidebar, /id: 'executions', label: 'Execuțiile mele'/); assert.match(app, /activePage === 'executions'/); assert.match(app, /isManagedUser/); assert.match(page, /if \(!isAdmin && !isManagedUser\)\s*return/);
  assert.match(page, /devicesFromTasks/); assert.match(page, /isAdmin\s*\? await api\.getDevices\(\)/); assert.match(page, /Execuțiile mele/);
  assert.match(page, /api\.getCloudTasks/); assert.match(page, /api\.getCloudTask/); assert.match(page, /deviceOptionLabel/); assert.match(page, /profilesForDevice/); assert.match(source('dashboard-v2', 'src', 'services', 'executionHistory.js'), /OUTCOME_UNKNOWN/);
  assert.match(api, /getCloudTasks:/); assert.match(api, /cloudRead\(`\/tasks\?/); assert.match(api, /getCloudTask:/);
  assert.match(page, /getMyExecutionTargets/); assert.match(page, /createCampaignPreflightTask/); assert.doesNotMatch(page, /Retry|Cancel|Delete|Reassign|Publish|createChromiumSafePreflightTask/i);
  assert.doesNotMatch(page, /payload|lease|credential|secret|signed URL|profilePath/i);
});
