'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const hostedBlock = (text, name) => text.slice(text.indexOf(`function ${name}`), text.indexOf('export default function', text.indexOf(`function ${name}`)));

test('hosted navigation and top-level surfaces branch away from local runtime behavior', () => {
  const dashboard = source('dashboard-v2', 'src', 'pages', 'Dashboard.jsx');
  const scheduler = source('dashboard-v2', 'src', 'pages', 'Scheduler.jsx');
  const topbar = source('dashboard-v2', 'src', 'layout', 'Topbar.jsx');
  const notifications = source('dashboard-v2', 'src', 'components', 'DesktopNotifications.jsx');
  const sidebar = source('dashboard-v2', 'src', 'layout', 'Sidebar.jsx');

  assert.match(dashboard, /if \(api\.isCloudReadOnly\(\)\) return <HostedDashboard/);
  assert.match(scheduler, /if \(api\.isCloudReadOnly\(\)\) return <HostedScheduler/);
  assert.match(topbar, /if \(api\.isCloudReadOnly\(\)\) return <HostedTopbar/);
  assert.match(notifications, /if \(api\.isCloudReadOnly\(\)\) return null/);
  assert.match(sidebar, /cloudReadOnly && item\.localOnly/);
});

test('hosted dashboard, schedules, and topbar use cloud-native wording without local execution controls', () => {
  const dashboard = hostedBlock(source('dashboard-v2', 'src', 'pages', 'Dashboard.jsx'), 'HostedDashboard');
  const scheduler = hostedBlock(source('dashboard-v2', 'src', 'pages', 'Scheduler.jsx'), 'HostedScheduler');
  const topbar = hostedBlock(source('dashboard-v2', 'src', 'layout', 'Topbar.jsx'), 'HostedTopbar');

  assert.match(dashboard, /CLOUD WORKSPACE/);
  assert.doesNotMatch(dashboard, /getDashboardSummary|createChromium|createFacebookSession|createCampaignPreflight|profile/i);
  assert.match(scheduler, /Definițiile de programare sunt păstrate în cloud/);
  assert.doesNotMatch(scheduler, /getRuntimeConfig|getFacebookProfiles|getRobotStatus|runNow|Profil Facebook/i);
  assert.match(topbar, /Cloud workspace/);
  assert.doesNotMatch(topbar, /getHistory|getRobotStatus|openDesktopOverlay|Settings/);
});

test('cloud campaign editors suppress global local profile and queue-launch controls', () => {
  for (const page of ['Properties.jsx', 'Jobs.jsx']) {
    const text = source('dashboard-v2', 'src', 'pages', page);
    assert.match(text, /const cloudReadOnly = api\.isCloudReadOnly\(\)/);
    assert.match(text, /!cloudReadOnly && <label>/);
    assert.match(text, /cloudReadOnly \? 'Previzualizare campanie'/);
    assert.match(text, /!cloudReadOnly && <button className="secondary-button" onClick=\{\(\) => handleSave\('queue'\)\}/);
  }
  const campaigns = source('dashboard-v2', 'src', 'pages', 'Campaigns.jsx');
  assert.match(campaigns, /!cloudReadOnly && <ProfileStartModal/);
  assert.match(campaigns, /!cloudReadOnly && <button onClick=\{\(\) => handleRunCampaign/);
});

test('hosted status distinguishes Cloud BFF from the temporary Local Agent bridge', async () => {
  const status = source('dashboard-v2', 'src', 'layout', 'StatusBar.jsx');
  assert.match(status, /label="Cloud BFF"/);
  assert.match(status, /label="Local Agent"/);
  assert.match(status, /bridge temporar pentru un singur agent/);
  const mode = await import('../dashboard-v2/src/services/dashboardDataMode.js');
  assert.throws(() => mode.assertCloudReadOnlyRequest(mode.DASHBOARD_DATA_MODES.CLOUD_READ_ONLY, 'GET', '/health'), /machine-local API access/);
  assert.doesNotThrow(() => mode.assertCloudReadOnlyRequest(mode.DASHBOARD_DATA_MODES.LOCAL, 'GET', '/health'));
});
