'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AGENT_HEARTBEAT_FRESHNESS_MS, listDevices } = require('../server/cloud-dashboard-read-api');

const now = Date.parse('2026-09-10T00:00:00.000Z');
const fresh = new Date(now - 1000).toISOString();
const stale = new Date(now - AGENT_HEARTBEAT_FRESHNESS_MS - 1).toISOString();

async function devices({ agents, profiles, tasks }) {
  return (await listDevices({ listControlPlaneAgents: async () => agents, listControlPlaneProfiles: async () => profiles, listActiveControlPlaneTasks: async () => tasks }, now)).devices;
}

test('device readiness separates ONLINE, READY, stale, offline, degraded, and no-profile states', async () => {
  const result = await devices({
    agents: [{ agent_id: 'ready', display_name: 'Ready', reported_status: 'ONLINE', last_seen_at: fresh }, { agent_id: 'stale', display_name: 'Stale', reported_status: 'ONLINE', last_seen_at: stale }, { agent_id: 'offline', display_name: 'Offline', reported_status: 'OFFLINE', last_seen_at: fresh }, { agent_id: 'degraded', display_name: 'Degraded', reported_status: 'DEGRADED', last_seen_at: fresh }, { agent_id: 'empty', display_name: 'Empty', reported_status: 'ONLINE', last_seen_at: fresh }],
    profiles: [{ profile_id: 'ready-profile', agent_id: 'ready', display_name: 'Ready profile', status: 'READY', last_seen_at: fresh }], tasks: [],
  });
  assert.deepEqual(result.map((device) => [device.deviceId, device.readiness.state, device.readiness.canAcceptPreflight]), [['ready', 'READY', true], ['stale', 'STALE', false], ['offline', 'OFFLINE', false], ['degraded', 'DEGRADED', false], ['empty', 'NO_READY_PROFILE', false]]);
});

test('workload counts only active tasks and marks only claimed/running profiles busy', async () => {
  const [device] = await devices({
    agents: [{ agent_id: 'agent', display_name: 'Agent', reported_status: 'ONLINE', last_seen_at: fresh }],
    profiles: [{ profile_id: 'busy', agent_id: 'agent', display_name: 'Busy', status: 'READY', last_seen_at: fresh }, { profile_id: 'free', agent_id: 'agent', display_name: 'Free', status: 'READY', last_seen_at: fresh }, { profile_id: 'unready', agent_id: 'agent', display_name: 'Unready', status: 'BUSY', last_seen_at: fresh }],
    tasks: [{ task_id: 'queued', agent_id: 'agent', profile_id: 'busy', task_type: 'PREFLIGHT', status: 'QUEUED' }, { task_id: 'claimed', agent_id: 'agent', profile_id: 'busy', task_type: 'PREFLIGHT', status: 'CLAIMED' }, { task_id: 'running', agent_id: 'agent', profile_id: 'other-agent-profile', task_type: 'PREFLIGHT', status: 'RUNNING' }, { task_id: 'terminal', agent_id: 'agent', profile_id: 'free', task_type: 'PREFLIGHT', status: 'COMPLETED' }],
  });
  assert.deepEqual(device.workload, { activeTaskCount: 3, queuedTaskCount: 1, claimedTaskCount: 1, runningTaskCount: 1, busyProfileCount: 1 });
  assert.equal(device.profiles.find((profile) => profile.profileId === 'busy').busy, true);
  assert.equal(device.profiles.find((profile) => profile.profileId === 'free').readinessState, 'READY');
  assert.equal(device.profiles.find((profile) => profile.profileId === 'unready').readinessState, 'PROFILE_NOT_READY');
  assert.equal(device.readiness.state, 'READY'); assert.equal(device.readiness.canAcceptPreflight, true);
  assert.ok(!JSON.stringify(device).match(/task_id|credential|lease|payload|path|secret/i));
});

test('a device with only busy or unready profiles cannot accept preflight', async () => {
  const result = await devices({ agents: [{ agent_id: 'busy', display_name: 'Busy', reported_status: 'ONLINE', last_seen_at: fresh }, { agent_id: 'not-ready', display_name: 'Not ready', reported_status: 'ONLINE', last_seen_at: fresh }], profiles: [{ profile_id: 'busy-profile', agent_id: 'busy', display_name: 'Busy profile', status: 'READY', last_seen_at: fresh }, { profile_id: 'bad-profile', agent_id: 'not-ready', display_name: 'Bad profile', status: 'BUSY', last_seen_at: fresh }], tasks: [{ agent_id: 'busy', profile_id: 'busy-profile', task_type: 'PREFLIGHT', status: 'RUNNING' }] });
  assert.deepEqual(result.map((device) => [device.readiness.state, device.readiness.reasonCodes]), [['BUSY', ['PROFILE_BUSY']], ['NO_READY_PROFILE', ['NO_READY_PROFILE']]]);
});
