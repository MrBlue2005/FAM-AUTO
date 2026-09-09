'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const devices = [
  { deviceId: 'agent-office', displayName: 'PC Birou', online: true, reportedStatus: 'ONLINE', profiles: [{ profileId: 'profile-office', displayName: 'Profil birou', status: 'READY', ready: true }] },
  { deviceId: 'agent-home', displayName: 'PC Acasă', online: true, reportedStatus: 'BUSY', profiles: [{ profileId: 'profile-home', displayName: 'Profil acasă', status: 'BUSY', ready: false }] },
  { deviceId: 'agent-stale', displayName: 'PC Vechi', online: false, reportedStatus: 'OFFLINE', profiles: [{ profileId: 'profile-stale', displayName: 'Profil vechi', status: 'READY', ready: true }] },
];

async function selection() {
  return import('../dashboard-v2/src/services/hostedDeviceSelection.js');
}

test('hosted device selection requires an explicit device and never auto-selects', async () => {
  const { resolveHostedDeviceProfileSelection, DEVICE_PROFILE_READINESS } = await selection();
  const zero = resolveHostedDeviceProfileSelection([], {});
  const many = resolveHostedDeviceProfileSelection(devices, {});
  assert.equal(zero.readiness, DEVICE_PROFILE_READINESS.NO_DEVICE);
  assert.equal(many.selectedDeviceId, null); assert.equal(many.selectedProfileId, null);
});

test('hosted device selection filters profiles by owner and rejects cross-device pairs', async () => {
  const { resolveHostedDeviceProfileSelection, DEVICE_PROFILE_READINESS } = await selection();
  const valid = resolveHostedDeviceProfileSelection(devices, { deviceId: 'agent-office', profileId: 'profile-office' });
  const crossDevice = resolveHostedDeviceProfileSelection(devices, { deviceId: 'agent-office', profileId: 'profile-home' });
  assert.equal(valid.readiness, DEVICE_PROFILE_READINESS.READY_FOR_PREFLIGHT);
  assert.equal(crossDevice.selectedProfileId, null); assert.equal(crossDevice.readiness, DEVICE_PROFILE_READINESS.NO_PROFILE);
});

test('device/profile changes invalidate stale selections without fallback', async () => {
  const { resolveHostedDeviceProfileSelection, DEVICE_PROFILE_READINESS } = await selection();
  const changedDevice = resolveHostedDeviceProfileSelection(devices, { deviceId: 'agent-home', profileId: 'profile-office' });
  const offline = resolveHostedDeviceProfileSelection(devices, { deviceId: 'agent-stale', profileId: 'profile-stale' });
  const unready = resolveHostedDeviceProfileSelection(devices, { deviceId: 'agent-home', profileId: 'profile-home' });
  const removedDevice = resolveHostedDeviceProfileSelection(devices.filter((device) => device.deviceId !== 'agent-office'), { deviceId: 'agent-office', profileId: 'profile-office' });
  const removedProfile = resolveHostedDeviceProfileSelection([{ ...devices[0], profiles: [] }], { deviceId: 'agent-office', profileId: 'profile-office' });
  assert.equal(changedDevice.selectedProfileId, null); assert.equal(changedDevice.readiness, DEVICE_PROFILE_READINESS.NO_PROFILE);
  assert.equal(offline.readiness, DEVICE_PROFILE_READINESS.DEVICE_OFFLINE);
  assert.equal(unready.readiness, DEVICE_PROFILE_READINESS.PROFILE_NOT_READY);
  assert.equal(removedDevice.readiness, DEVICE_PROFILE_READINESS.NO_DEVICE);
  assert.equal(removedProfile.readiness, DEVICE_PROFILE_READINESS.NO_PROFILE);
});

test('selection module is hosted-only and contains no runtime or credential fields', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-v2', 'src', 'services', 'hostedDeviceSelection.js'), 'utf8');
  assert.doesNotMatch(source, /facebookProfileId|localhost|runtimeConfig|credential|token|cookie|path|lease|task/i);
  const { resolveHostedDeviceProfileSelection } = await selection();
  assert.equal(resolveHostedDeviceProfileSelection(devices.slice(0, 1), { deviceId: 'agent-office', profileId: 'profile-office' }).selectedDevice.displayName, 'PC Birou');
});
