'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

async function ui() {
  return import('../dashboard-v2/src/services/hostedCampaignPreflight.js');
}

test('routed preflight browser contract contains only reviewed intent and preserves revision guards', async () => {
  const { campaignPreflightRequestBody } = await ui();
  const body = campaignPreflightRequestBody({
    kind: 'property', campaignId: 'campaign-A', day: '2', targetId: 'target-A', deviceId: 'agent-A', profileId: 'profile-A', campaignRevision: 4, postRevision: 3,
    taskType: 'FACEBOOK_GROUP_POST', publishEnabled: true, payload: { forbidden: true }, profilePath: 'C:/forbidden', capability: 'claimed',
  });
  assert.deepEqual(body, { kind: 'property', campaignId: 'campaign-A', day: 2, targetId: 'target-A', deviceId: 'agent-A', profileId: 'profile-A', campaignRevision: 4, postRevision: 3 });
  assert.equal(JSON.stringify(body).match(/taskType|publishEnabled|payload|path|capability/i), null);
});

test('routed preflight readiness and safe server errors require explicit recovery without fallback', async () => {
  const { canRequestRoutedPreflight, routedPreflightErrorMessage, requiresExplicitReselection } = await ui();
  const intent = { campaignId: 'campaign-A', day: '2', targetId: 'target-A' };
  assert.equal(canRequestRoutedPreflight({ readiness: 'READY_FOR_PREFLIGHT' }, intent), true);
  for (const state of ['NO_DEVICE', 'DEVICE_OFFLINE', 'NO_PROFILE', 'PROFILE_NOT_READY']) assert.equal(canRequestRoutedPreflight({ readiness: state }, intent), false);
  const messages = {
    DEVICE_NOT_FOUND: 'Dispozitivul nu mai este disponibil.', DEVICE_OFFLINE: 'Dispozitivul este offline.', DEVICE_STALE: 'Conexiunea dispozitivului nu mai este actuală.',
    PROFILE_NOT_FOUND: 'Profilul nu mai este disponibil.', PROFILE_NOT_READY: 'Profilul nu este pregătit.', PROFILE_OWNERSHIP_MISMATCH: 'Profilul nu aparține dispozitivului selectat.', CONFLICTING_WORK: 'Profilul este ocupat de o altă execuție.',
  };
  for (const [code, message] of Object.entries(messages)) assert.equal(routedPreflightErrorMessage({ code }), message);
  for (const code of ['DEVICE_NOT_FOUND', 'DEVICE_OFFLINE', 'DEVICE_STALE', 'PROFILE_NOT_FOUND', 'PROFILE_NOT_READY', 'PROFILE_OWNERSHIP_MISMATCH']) assert.equal(requiresExplicitReselection({ code }), true);
  assert.equal(requiresExplicitReselection({ code: 'CONFLICTING_WORK' }), false);
});

test('ADMIN Devices UI wires the existing selection hook to a pending-safe routed preflight and safe readback', () => {
  const devices = source('dashboard-v2', 'src', 'pages', 'Devices.jsx');
  const api = source('dashboard-v2', 'src', 'services', 'api.js');
  assert.match(devices, /useHostedDeviceProfileSelection\(devices\)/);
  assert.match(devices, /canRequestRoutedPreflight\(selection, preflightIntent\)/);
  assert.match(devices, /deviceId: selection\.selectedDeviceId/);
  assert.match(devices, /profileId: selection\.selectedProfileId/);
  assert.match(devices, /disabled=\{!preflightReady \|\| preflightBusy \|\| Boolean\(preflightTask\)\}/);
  assert.match(devices, /requiresExplicitReselection\(issueError\)/);
  assert.match(devices, /selection\.clearSelection\(\)/);
  assert.match(devices, /api\.getCampaignPreflightTask/);
  assert.match(devices, /preflightTask\.result\.mediaCount/);
  assert.match(devices, /Fără publicare/);
  assert.match(api, /campaignPreflightRequestBody\(intent\)/);
  assert.doesNotMatch(devices, /taskType:|publishEnabled:|payload:|profilePath:|operator token|signed URL/i);
});

test('USER remains excluded from Devices UI while the server routes USER preflight through assignment authorization', () => {
  const devices = source('dashboard-v2', 'src', 'pages', 'Devices.jsx');
  const remote = source('server', 'cloud-remote-task-api.js');
  assert.match(devices, /if \(!isAdmin\) return/);
  assert.match(remote, /listManagedUserExecutionTargets/);
  assert.match(remote, /EXECUTION_TARGET_NOT_AUTHORIZED/);
});
