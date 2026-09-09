'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('Devices renders safe workload/readiness without new execution controls', async () => {
  const page = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'pages', 'Devices.jsx'), 'utf8');
  const readiness = await import('../dashboard-v2/src/services/deviceReadiness.js');
  assert.equal(readiness.readinessMessage(['DEVICE_STALE']), 'Heartbeat-ul dispozitivului a expirat.');
  assert.equal(readiness.readinessTone('READY'), 'active'); assert.equal(readiness.readinessTone('PROFILE_BUSY'), 'warning');
  assert.equal(readiness.deviceSelectionLabel({ displayName: 'RX Agent', deviceId: 'agent_12345678' }), 'RX Agent · 12345678');
  assert.match(page, /device\.workload/); assert.match(page, /device\.readiness/); assert.match(page, /profile\.busy/); assert.match(page, /profile\.readinessState/); assert.match(page, /workloadLabel/);
  assert.match(page, /deviceSelectionLabel\(device\)/);
  assert.doesNotMatch(page, /retry|cancel|delete|reassign/i);
  assert.match(page, /useHostedDeviceProfileSelection\(devices\)/); assert.match(page, /deviceId: selection\.selectedDeviceId/); assert.match(page, /profileId: selection\.selectedProfileId/);
});
