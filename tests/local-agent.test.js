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
const { CloudAgentService } = require('../app/local-agent/CloudAgentService');
const { LocalAgentCredentials } = require('../app/local-agent/LocalAgentCredentials');
const { bootstrapLocalAgent, validateHostedAgentConfig } = require('../app/local-agent/bootstrap');

function temporaryDirectory(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rx-${name}-`));
}

function hostedAgentEnvironment(overrides = {}) {
  return {
    RX_AGENT_TRANSPORT_MODE: 'HTTP',
    RX_AGENT_CLOUD_URL: 'https://rccefdsmvtsnpsaouzba.supabase.co/functions/v1/agent-protocol',
    RX_AGENT_REFERENCE_ALLOW_HTTP: 'false',
    ...overrides,
  };
}

function testDpapi(mode, value) {
  return mode === 'protect'
    ? Buffer.from(value, 'utf8').toString('base64url')
    : Buffer.from(value, 'base64url').toString('utf8');
}

test('fresh hosted bootstrap creates only an independent registry, DPAPI credential, and safe storage roots', () => {
  const root = temporaryDirectory('bootstrap-fresh');
  const data = path.join(root, 'data');
  const directories = [data, path.join(root, 'logs'), path.join(root, 'uploads'), path.join(root, 'profiles')];
  const registry = new LocalAgentRegistry({ filePath: path.join(data, 'localAgentRegistry.json'), profilesRoot: path.join(root, 'profiles') });
  const credentials = new LocalAgentCredentials({ filePath: path.join(data, 'localAgentCredentials.json'), platform: 'win32', dpapi: testDpapi });
  const result = bootstrapLocalAgent({ environment: hostedAgentEnvironment(), validateConfig: validateHostedAgentConfig, registry, credentials, ensureStoragePaths: () => directories.forEach((directory) => fs.mkdirSync(directory, { recursive: true })) });

  assert.match(result.agentId, /^agent_/);
  assert.equal(result.credentialProtection, 'dpapi-current-user');
  assert.ok(directories.every((directory) => fs.statSync(directory).isDirectory()));
  assert.equal(registry.load([]).profiles.length, 0);
  assert.equal(fs.existsSync(path.join(data, 'properties')), false);
  assert.equal(fs.existsSync(path.join(data, 'jobs')), false);
  assert.equal(fs.existsSync(path.join(root, 'uploads', 'synthetic-media')), false);
  const storedCredential = JSON.parse(fs.readFileSync(path.join(data, 'localAgentCredentials.json'), 'utf8'));
  assert.equal(storedCredential.protection, 'dpapi-current-user');
  assert.equal('agent_secret' in storedCredential, false);
});

test('bootstrap preserves a configured machine identity and does not overwrite its credential', () => {
  const root = temporaryDirectory('bootstrap-existing');
  const data = path.join(root, 'data');
  const registry = new LocalAgentRegistry({ filePath: path.join(data, 'localAgentRegistry.json'), profilesRoot: path.join(root, 'profiles') });
  const credentials = new LocalAgentCredentials({ filePath: path.join(data, 'localAgentCredentials.json'), platform: 'win32', dpapi: testDpapi });
  const options = { environment: hostedAgentEnvironment(), validateConfig: validateHostedAgentConfig, registry, credentials, ensureStoragePaths: () => fs.mkdirSync(data, { recursive: true }) };
  const first = bootstrapLocalAgent(options);
  const before = fs.readFileSync(path.join(data, 'localAgentCredentials.json'), 'utf8');
  const second = bootstrapLocalAgent(options);
  assert.equal(second.agentId, first.agentId);
  assert.equal(fs.readFileSync(path.join(data, 'localAgentCredentials.json'), 'utf8'), before);
});

test('new machines receive distinct credentials and agent identities instead of portable credential reuse', () => {
  const createMachine = () => {
    const root = temporaryDirectory('bootstrap-machine'); const data = path.join(root, 'data');
    const registry = new LocalAgentRegistry({ filePath: path.join(data, 'localAgentRegistry.json'), profilesRoot: path.join(root, 'profiles') });
    const credentials = new LocalAgentCredentials({ filePath: path.join(data, 'localAgentCredentials.json'), platform: 'win32', dpapi: testDpapi });
    return { result: bootstrapLocalAgent({ environment: hostedAgentEnvironment(), validateConfig: validateHostedAgentConfig, registry, credentials, ensureStoragePaths: () => fs.mkdirSync(data, { recursive: true }) }), credential: credentials.load().agent_secret };
  };
  const first = createMachine(); const second = createMachine();
  assert.notEqual(first.result.agentId, second.result.agentId);
  assert.notEqual(first.credential, second.credential);
});

test('hosted bootstrap rejects missing, insecure, and reference-only cloud configuration before writing identity files', () => {
  assert.throws(() => validateHostedAgentConfig(hostedAgentEnvironment({ RX_AGENT_TRANSPORT_MODE: 'LOCAL' })), /RX_AGENT_TRANSPORT_MODE=HTTP/);
  assert.throws(() => validateHostedAgentConfig(hostedAgentEnvironment({ RX_AGENT_CLOUD_URL: '' })), /RX_AGENT_CLOUD_URL/);
  assert.throws(() => validateHostedAgentConfig(hostedAgentEnvironment({ RX_AGENT_CLOUD_URL: 'http://127.0.0.1:8787', RX_AGENT_REFERENCE_ALLOW_HTTP: 'true' })), /must be false/);
  const root = temporaryDirectory('bootstrap-invalid'); const data = path.join(root, 'data');
  const registry = new LocalAgentRegistry({ filePath: path.join(data, 'localAgentRegistry.json'), profilesRoot: root });
  const credentials = new LocalAgentCredentials({ filePath: path.join(data, 'localAgentCredentials.json'), platform: 'win32', dpapi: testDpapi });
  assert.throws(() => bootstrapLocalAgent({ environment: hostedAgentEnvironment({ RX_AGENT_CLOUD_URL: '' }), validateConfig: validateHostedAgentConfig, registry, credentials, ensureStoragePaths: () => fs.mkdirSync(data, { recursive: true }) }), /RX_AGENT_CLOUD_URL/);
  assert.equal(fs.existsSync(path.join(data, 'localAgentRegistry.json')), false);
  assert.equal(fs.existsSync(path.join(data, 'localAgentCredentials.json')), false);
});

test('tracked agent template contains only persistent non-secret hosted configuration', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(template, /^RX_AGENT_TRANSPORT_MODE=HTTP$/m);
  assert.match(template, /^RX_AGENT_CLOUD_URL=https:\/\/rccefdsmvtsnpsaouzba\.supabase\.co\/functions\/v1\/agent-protocol$/m);
  assert.match(template, /^RX_AGENT_REFERENCE_ALLOW_HTTP=false$/m);
  assert.doesNotMatch(template, /^RX_AGENT_ENROLLMENT_TOKEN=.+$/m);
  assert.doesNotMatch(template, /^RX_AGENT_SECRET=.+$/m);
  assert.doesNotMatch(template, /^SUPABASE_SERVICE_ROLE_KEY=.+$/m);
});

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

test('task media materializer rejects a hash mismatch without leaving a partial file or touching sibling task data', async () => {
  const root = temporaryDirectory('media-negative'); const sibling = path.join(root, 'task_sibling'); fs.mkdirSync(sibling); fs.writeFileSync(path.join(sibling, 'keep'), 'safe');
  const materializer = new TaskMediaMaterializer({ root, retries: 0, fetchImpl: async () => new Response(Buffer.from('wrong'), { status: 200 }) });
  await assert.rejects(materializer.materialize({ task_id: 'task_bad_hash' }, { media: [{ media_id: 'media_bad', ordinal: 0, sha256: 'a'.repeat(64), byte_size: 5, download_url: 'https://fixture/bad' }] }), { code: 'MEDIA_HASH_MISMATCH' });
  assert.equal(fs.existsSync(path.join(root, 'task_bad_hash')), false); assert.equal(fs.readFileSync(path.join(sibling, 'keep'), 'utf8'), 'safe');
});

test('task media materializer rejects unsafe task and media identifiers before writing', async () => {
  const root = temporaryDirectory('media-path'); const materializer = new TaskMediaMaterializer({ root });
  await assert.rejects(materializer.materialize({ task_id: '../escape' }, { media: [] }), { code: 'MEDIA_MANIFEST_INVALID' });
  await assert.rejects(materializer.materialize({ task_id: 'task_safe' }, { media: [{ media_id: '../escape', ordinal: 0, sha256: 'a'.repeat(64), byte_size: 1, download_url: 'https://fixture/x' }] }), { code: 'MEDIA_MANIFEST_INVALID' });
});

function cloudMediaFixture(mediaId = 'media_runtime', bytes = Buffer.from('runtime-media')) {
  return { media_id: mediaId, ordinal: 0, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byte_size: bytes.length, mime_type: 'image/png', download_url: 'https://fixture/media' };
}

function cloudTaskFixture(taskId, profileId, media = []) {
  return { task_id: taskId, profile_id: profileId, lease_id: `lease_${taskId}`, task_type: 'TEST', payload: { media: media.map(({ media_id, ordinal, sha256, byte_size, mime_type }) => ({ media_id, ordinal, sha256, byte_size, mime_type })) } };
}

function cloudRuntime({ task, materializer, getManifest, executeTask }) {
  const calls = { manifest: 0, running: 0, completed: 0, failed: 0, unknown: 0, executor: 0 };
  const transport = {
    claimNextTask: async () => ({ task }), getCancellationState: async () => ({ cancellation_requested: false }),
    getMediaManifest: async (...args) => { calls.manifest += 1; return getManifest(...args); },
    reportRunning: async () => { calls.running += 1; }, reportCompletion: async () => { calls.completed += 1; },
    reportFailure: async () => { calls.failed += 1; }, reportOutcomeUnknown: async () => { calls.unknown += 1; }, renewLease: async () => ({}),
  };
  const service = new CloudAgentService({ transport, mediaMaterializer: materializer, registry: { getSafeMetadata: () => ({ agent_id: 'agent_runtime' }) }, connectionManager: { heartbeat: async () => ({ ok: true }) }, executor: { runProfile: async (_profileId, handler) => handler() }, executeTask: async (...args) => { calls.executor += 1; return executeTask(...args); } });
  return { service, calls };
}

test('CloudAgentService bounds exhausted media-download retries and fails before RUNNING', async () => {
  const root = temporaryDirectory('media-exhaustion'); const item = cloudMediaFixture(); const task = cloudTaskFixture('task_download_exhausted', 'profile_download_exhausted', [item]); let fetches = 0;
  const materializer = new TaskMediaMaterializer({ root, retries: 1, fetchImpl: async () => { fetches += 1; return new Response(null, { status: 503 }); } });
  const { service, calls } = cloudRuntime({ task, materializer, getManifest: async () => ({ media: [item] }), executeTask: async () => ({}) });
  await assert.rejects(service.runOnce(), { code: 'MEDIA_DOWNLOAD_FAILED' });
  assert.deepEqual(calls, { manifest: 2, running: 0, completed: 0, failed: 1, unknown: 0, executor: 0 }); assert.equal(fetches, 4); assert.equal(fs.existsSync(path.join(root, task.task_id)), false);
});

test('interrupted media streams retry finitely and remove partial task output', async () => {
  const root = temporaryDirectory('media-interrupted'); const item = cloudMediaFixture(); const task = cloudTaskFixture('task_download_interrupted', 'profile_download_interrupted', [item]); let fetches = 0;
  const materializer = new TaskMediaMaterializer({ root, retries: 1, fetchImpl: async () => { fetches += 1; let sent = false; return new Response(new ReadableStream({ pull(controller) { if (!sent) { sent = true; controller.enqueue(Buffer.from('part')); } else controller.error(Object.assign(new Error('interrupted'), { code: 'MEDIA_DOWNLOAD_FAILED' })); } }), { status: 200 }); } });
  const { service, calls } = cloudRuntime({ task, materializer, getManifest: async () => ({ media: [item] }), executeTask: async () => ({}) });
  await assert.rejects(service.runOnce(), { code: 'MEDIA_DOWNLOAD_FAILED' });
  assert.equal(fetches, 4); assert.deepEqual(calls, { manifest: 2, running: 0, completed: 0, failed: 1, unknown: 0, executor: 0 }); assert.equal(fs.existsSync(path.join(root, task.task_id)), false);
});

test('CloudAgentService refreshes one unusable signed URL and executes once after a verified retry', async () => {
  const root = temporaryDirectory('media-refresh'); const bytes = Buffer.from('refreshed-media'); const item = cloudMediaFixture('media_refresh', bytes); const task = cloudTaskFixture('task_media_refresh', 'profile_media_refresh', [item]); let fetches = 0;
  const materializer = new TaskMediaMaterializer({ root, retries: 0, fetchImpl: async (url) => { fetches += 1; return url.endsWith('/stale') ? new Response(null, { status: 403 }) : new Response(bytes, { status: 200 }); } });
  const { service, calls } = cloudRuntime({ task, materializer, getManifest: async () => ({ media: [{ ...item, download_url: calls.manifest === 1 ? 'https://fixture/stale' : 'https://fixture/fresh' }] }), executeTask: async (executionTask) => { assert.equal(executionTask.payload.local_media_paths.length, 1); return { ok: true }; } });
  const result = await service.runOnce();
  assert.equal(result.result.ok, true); assert.deepEqual(calls, { manifest: 2, running: 1, completed: 1, failed: 0, unknown: 0, executor: 1 }); assert.equal(fetches, 2); assert.equal(fs.existsSync(path.join(root, task.task_id)), false);
});

test('CloudAgentService bypasses media acquisition for valid zero-media work', async () => {
  const task = cloudTaskFixture('task_zero_media', 'profile_zero_media'); const { service, calls } = cloudRuntime({ task, materializer: null, getManifest: async () => { throw new Error('must not request manifest'); }, executeTask: async () => ({ ok: true }) });
  const result = await service.runOnce();
  assert.equal(result.result.ok, true); assert.deepEqual(calls, { manifest: 0, running: 1, completed: 1, failed: 0, unknown: 0, executor: 1 });
});

test('executor failure after verified materialization is ordinary FAILED and cleans local media', async () => {
  const root = temporaryDirectory('media-executor-failure'); const bytes = Buffer.from('executor-failure-media'); const item = cloudMediaFixture('media_executor_failure', bytes); const task = cloudTaskFixture('task_executor_failure', 'profile_executor_failure', [item]);
  const materializer = new TaskMediaMaterializer({ root, retries: 0, fetchImpl: async () => new Response(bytes, { status: 200 }) });
  const { service, calls } = cloudRuntime({ task, materializer, getManifest: async () => ({ media: [item] }), executeTask: async () => { throw Object.assign(new Error('executor failed'), { code: 'EXECUTOR_FAILED' }); } });
  await assert.rejects(service.runOnce(), { code: 'EXECUTOR_FAILED' });
  assert.deepEqual(calls, { manifest: 1, running: 1, completed: 0, failed: 1, unknown: 0, executor: 1 }); assert.equal(fs.existsSync(path.join(root, task.task_id)), false);
});
