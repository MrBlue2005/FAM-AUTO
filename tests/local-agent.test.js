const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { LocalAgentRegistry } = require('../app/local-agent/LocalAgentRegistry');
const { LocalAgentExecutor } = require('../app/local-agent/LocalAgentExecutor');
const { LocalTaskTransport } = require('../app/local-agent/LocalTaskTransport');
const { ProfileLockManager } = require('../app/local-agent/ProfileLockManager');
const { TASK_STATUS, createTaskSnapshots } = require('../app/local-agent/TaskContract');
const { TaskMediaMaterializer } = require('../app/local-agent/TaskMediaMaterializer');

function temporaryDirectory(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rx-${name}-`));
}

function profile(id = 'main', label = 'Profil principal', profilePath = 'chrome-profile') {
  return { id, label, profilePath, category: 'real_estate', useSavedLoginIdentity: true };
}

function snapshotFixture(overrides = {}) {
  const campaign = {
    id: 'PROPERTY_1', name: 'Casa', active: true, transactionType: 'sale',
    posts: [{ day: 1, text: 'Descriere initiala', media: ['app/uploads/photo.jpg'] }],
    cookies: [{ name: 'session', value: 'must-not-travel' }],
  };
  const group = { id: 'GROUP_1', name: 'Grup', url: 'https://www.facebook.com/groups/test', active: true };
  const config = {
    campaignDay: 1, groupLimit: 1, startFromGroup: 1, publishEnabled: false,
    selectedPropertyIds: ['PROPERTY_1'], campaignCategory: 'real_estate',
    selectedGroupListCategory: 'Romania', facebookProfileId: 'main',
    facebookProfiles: [profile('main', 'Profil principal', 'C:\\secret\\chromium')],
  };
  return {
    campaign,
    group,
    input: {
      agentId: 'agent_FIXED', profileId: 'profile_FIXED', runtimeProfileId: 'main',
      config, properties: [campaign], jobs: [], groups: [group],
      queueTasks: [{
        id: 'main::PROPERTY_1::GROUP_1', campaignId: 'PROPERTY_1', groupId: 'GROUP_1',
        day: 1, postingIdentityId: 'default', retry: false,
      }],
      now: new Date('2026-09-07T10:00:00.000Z'),
      ...overrides,
    },
  };
}

test('agent_id persists when the local registry is reloaded', () => {
  const root = temporaryDirectory('agent-id');
  const filePath = path.join(root, 'registry.json');
  let counter = 0;
  const createId = (prefix) => `${prefix}_TEST_${++counter}`;
  const first = new LocalAgentRegistry({ filePath, profilesRoot: root, createId }).load([]);
  const second = new LocalAgentRegistry({ filePath, profilesRoot: root, createId }).load([]);
  assert.equal(first.agent.agentId, second.agent.agentId);
});

test('existing Chromium profile is adopted once and display name changes preserve profile_id', () => {
  const root = temporaryDirectory('profile-id');
  const filePath = path.join(root, 'registry.json');
  const registry = new LocalAgentRegistry({ filePath, profilesRoot: root });
  const adopted = registry.load([profile()]).profiles[0];
  const renamed = registry.load([profile('main', 'Nume schimbat')]).profiles[0];
  assert.equal(renamed.profileId, adopted.profileId);
  assert.equal(renamed.displayName, 'Nume schimbat');
  assert.equal(renamed.localProfilePath, adopted.localProfilePath);
});

test('two runtime aliases for the same Chromium directory share one immutable profile_id', () => {
  const root = temporaryDirectory('profile-alias');
  const registry = new LocalAgentRegistry({ filePath: path.join(root, 'registry.json'), profilesRoot: root });
  const state = registry.load([
    profile('main', 'Principal', 'same-profile'),
    profile('renamed-main', 'Principal nou', 'same-profile'),
  ]);
  assert.equal(state.profiles.length, 1);
  assert.deepEqual(state.profiles[0].legacyProfileIds.sort(), ['main', 'renamed-main']);
});

test('cloud-safe agent metadata excludes local paths and session-shaped profile fields', () => {
  const root = temporaryDirectory('safe-metadata');
  const registry = new LocalAgentRegistry({ filePath: path.join(root, 'registry.json'), profilesRoot: root });
  const metadata = registry.getSafeMetadata([{
    ...profile(), cookies: [{ name: 'session', value: 'secret' }], token: 'secret-token',
  }]);
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes('profilePath'), false);
  assert.equal(serialized.includes('cookies'), false);
  assert.equal(serialized.includes('secret-token'), false);
  assert.deepEqual(Object.keys(metadata.profiles[0]).sort(), ['display_name', 'profile_id', 'status']);
});

test('same-profile lock rejects concurrent execution with PROFILE_BUSY', () => {
  const lockDirectory = temporaryDirectory('same-lock');
  const first = new ProfileLockManager({ lockDirectory });
  const second = new ProfileLockManager({ lockDirectory });
  const lock = first.acquire('profile_1', { taskId: 'task_1' });
  assert.throws(() => second.acquire('profile_1', { taskId: 'task_2' }), (error) => error.code === 'PROFILE_BUSY');
  lock.release();
});

test('profile lock is released after successful execution', async () => {
  const lockDirectory = temporaryDirectory('success-lock');
  const lockManager = new ProfileLockManager({ lockDirectory });
  const executor = new LocalAgentExecutor({ lockManager });
  assert.equal(await executor.runProfile('profile_1', async () => 'ok'), 'ok');
  const reacquired = lockManager.acquire('profile_1');
  reacquired.release();
});

test('profile lock is released after execution failure', async () => {
  const lockDirectory = temporaryDirectory('failure-lock');
  const lockManager = new ProfileLockManager({ lockDirectory });
  const executor = new LocalAgentExecutor({ lockManager });
  await assert.rejects(executor.runProfile('profile_1', async () => { throw new Error('boom'); }), /boom/);
  const reacquired = lockManager.acquire('profile_1');
  reacquired.release();
});

test('a busy profile does not block a different profile', () => {
  const lockDirectory = temporaryDirectory('parallel-lock');
  const lockManager = new ProfileLockManager({ lockDirectory });
  const first = lockManager.acquire('profile_1');
  const second = lockManager.acquire('profile_2');
  second.release();
  first.release();
});

test('task payload is an immutable metadata snapshot and contains no Chromium path', () => {
  const fixture = snapshotFixture();
  const [task] = createTaskSnapshots(fixture.input);
  fixture.campaign.posts[0].text = 'Descriere editata ulterior';
  fixture.group.name = 'Grup redenumit';
  assert.equal(task.payload.campaign.posts[0].text, 'Descriere initiala');
  assert.equal(task.payload.group.name, 'Grup');
  assert.equal(JSON.stringify(task).includes('secret'), false);
  assert.equal(JSON.stringify(task).includes('must-not-travel'), false);
  assert.equal(task.status, TASK_STATUS.QUEUED);
  assert.equal(task.task_type, 'FACEBOOK_GROUP_POST');
});

test('local transport drives the complete task lifecycle without an external service', () => {
  const root = temporaryDirectory('transport');
  const fixture = snapshotFixture();
  const [task] = createTaskSnapshots(fixture.input);
  const transport = new LocalTaskTransport('RUN_TEST', { filePath: path.join(root, 'tasks.json') });
  transport.createRun({ agent_id: 'agent_FIXED', profiles: [] }, [task]);
  const claimed = transport.claimNextTask({ agentId: 'agent_FIXED', profileId: 'profile_FIXED' });
  assert.equal(claimed.status, TASK_STATUS.CLAIMED);
  assert.equal(claimed.attempts, 1);
  assert.equal(transport.reportRunning(task.task_id).status, TASK_STATUS.RUNNING);
  const completed = transport.reportCompletion(task.task_id, { processed: 1 });
  assert.equal(completed.status, TASK_STATUS.COMPLETED);
  assert.deepEqual(completed.result, { processed: 1 });
});

test('local transport records handled cancellation for every remaining profile task', () => {
  const root = temporaryDirectory('transport-cancel');
  const fixture = snapshotFixture();
  const tasks = createTaskSnapshots({ ...fixture.input, queueTasks: [
    ...fixture.input.queueTasks,
    { ...fixture.input.queueTasks[0], id: 'main::PROPERTY_1::GROUP_1::retry' },
  ] });
  const transport = new LocalTaskTransport('RUN_CANCEL', { filePath: path.join(root, 'tasks.json') });
  transport.createRun({ agent_id: 'agent_FIXED', profiles: [] }, tasks);
  const claimed = transport.claimNextTask({ agentId: 'agent_FIXED', profileId: 'profile_FIXED' });
  transport.cancelTask(claimed.task_id, { code: 'STOP_REQUESTED' });
  transport.cancelQueuedTasks({ agentId: 'agent_FIXED', profileId: 'profile_FIXED' }, { code: 'STOP_REQUESTED' });
  assert.ok(transport.read().tasks.every((task) => task.status === TASK_STATUS.CANCELLED));
});

test('an abandoned profile lock is recovered when its owner process is confirmed dead', () => {
  const lockDirectory = temporaryDirectory('stale-lock');
  const lockManager = new ProfileLockManager({ lockDirectory });
  fs.mkdirSync(lockDirectory, { recursive: true });
  fs.writeFileSync(lockManager.lockPath('profile_1'), JSON.stringify({
    profile_id: 'profile_1', pid: 2147483647, token: 'abandoned',
  }));
  const recovered = lockManager.acquire('profile_1');
  recovered.release();
});

test('task media materializer verifies ordered media and removes its isolated task directory', async () => {
  const root = temporaryDirectory('media'); const bytes = Buffer.from('synthetic-media'); const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const materializer = new TaskMediaMaterializer({ root, fetchImpl: async () => new Response(bytes, { status: 200 }) });
  const output = await materializer.materialize({ task_id: 'task_media_fixture' }, { media: [{ media_id: 'media_two', ordinal: 1, sha256, byte_size: bytes.length, download_url: 'https://fixture/2' }, { media_id: 'media_one', ordinal: 0, sha256, byte_size: bytes.length, download_url: 'https://fixture/1' }] });
  assert.match(output.localMediaPaths[0], /0000-media_one$/); await output.cleanup(); assert.equal(fs.existsSync(path.join(root, 'task_media_fixture')), false);
});
