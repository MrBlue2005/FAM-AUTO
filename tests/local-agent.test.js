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
const { TaskMediaMaterializer, createTaskMediaMaterializerForUploads } = require('../app/local-agent/TaskMediaMaterializer');
const { CloudAgentService } = require('../app/local-agent/CloudAgentService');
const { LocalAgentCredentials } = require('../app/local-agent/LocalAgentCredentials');
const { bootstrapLocalAgent, validateHostedAgentConfig } = require('../app/local-agent/bootstrap');
const { createChromiumSafePreflightExecutor } = require('../app/local-agent/ChromiumSafePreflightExecutor');
const { detectSessionState } = require('../app/local-agent/FacebookSessionReadinessExecutor');
const { LIVE_CAMPAIGN_EXECUTION_TASK_TYPE, LIVE_EXECUTION_MODE, createLiveCampaignExecutionExecutor } = require('../app/local-agent/LiveCampaignExecutionExecutor');
const { createRealFacebookPublisherAdapter } = require('../app/local-agent/RealFacebookPublisherAdapter');
const { normalizeExpectedFacebookAccountId } = require('../app/local-agent/FacebookIdentityConfig');
const { getAuthenticatedFacebookAccountId } = require('../app/local-agent/FacebookSessionIdentity');
const { verifyLivePostPublished } = require('../app/facebook/verifyPost');

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

test('trusted profile-bound Facebook identity is canonical, local-only, and never enters task snapshots', () => {
  const root = temporaryDirectory('facebook-identity-config');
  const registry = new LocalAgentRegistry({ filePath: path.join(root, 'registry.json'), profilesRoot: root });
  const runtimeProfiles = [
    { ...profile('reviewed', 'Reviewed', 'reviewed'), expectedFacebookAccountId: ' 100000000000001 ' },
    profile('unconfigured', 'Unconfigured', 'unconfigured'),
  ];
  const reviewed = registry.getProfileByRuntimeId('reviewed', runtimeProfiles);
  const unconfigured = registry.getProfileByRuntimeId('unconfigured', runtimeProfiles);
  assert.equal(reviewed.expectedFacebookAccountId, '100000000000001');
  assert.equal(unconfigured.expectedFacebookAccountId, undefined);
  assert.throws(() => normalizeExpectedFacebookAccountId('any account'), { code: 'FACEBOOK_IDENTITY_CONFIG_INVALID' });
  assert.throws(() => normalizeExpectedFacebookAccountId(100000000000001), { code: 'FACEBOOK_IDENTITY_CONFIG_INVALID' });
  const fixture = snapshotFixture({ config: { ...snapshotFixture().input.config, facebookProfiles: runtimeProfiles } });
  const task = createTaskSnapshots(fixture.input)[0];
  assert.doesNotMatch(JSON.stringify(task), /expectedFacebookAccountId|100000000000001/);
  assert.doesNotMatch(JSON.stringify(registry.getSafeMetadata(runtimeProfiles)), /expectedFacebookAccountId|100000000000001/);
});

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

test('HTTP agent media materialization stays below the configured uploads root', () => {
  const root = temporaryDirectory('agent-media-root'); const materializer = createTaskMediaMaterializerForUploads(root);
  assert.equal(materializer.root, path.join(root, 'cloud-task-media'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-http-agent.js'), 'utf8'), /mediaMaterializer:\s*createTaskMediaMaterializerForUploads\(uploadsPath\)/);
});

test('Chromium safe preflight uses only an isolated registered profile and returns a safe result', async () => {
  const root = temporaryDirectory('chromium-safe'); const profileRoot = path.join(root, 'profiles'); const profilePath = path.join(profileRoot, 'synthetic'); const calls = [];
  const registry = { getProfile: () => ({ profileId: 'profile_synthetic', status: 'READY', localProfilePath: profilePath }) };
  const executor = createChromiumSafePreflightExecutor(registry, () => [], { enabled: true, profilesRoot: profileRoot, launchPersistentContext: async (receivedPath, options) => { calls.push({ receivedPath, options }); return { pages: () => [], newPage: async () => ({ goto: async (url) => { assert.equal(url, 'about:blank'); }, url: () => 'about:blank' }), close: async () => { calls.push({ closed: true }); } }; } });
  const result = await executor({ task_type: 'CHROMIUM_SAFE_PREFLIGHT', profile_id: 'profile_synthetic', payload: { mode: 'CHROMIUM_SAFE_PREFLIGHT', publishEnabled: false, url: 'https://facebook.com/' } });
  assert.deepEqual(result, { preflight_passed: true, chromium_launched: true, page_ready: true, safe_navigation: true, browser_closed: true, profile_lock_released: true, publishEnabled: false, blockers: [] });
  assert.equal(calls[0].receivedPath, profilePath); assert.equal(calls[0].options.headless, true); assert.equal(calls.some((entry) => entry.closed), true);
});

test('Chromium safe preflight rejects disabled mode and profiles outside its isolated root before launch', async () => {
  const root = temporaryDirectory('chromium-reject'); let launched = false;
  const outside = { getProfile: () => ({ status: 'READY', localProfilePath: path.join(root, '..', 'operational') }) };
  const task = { task_type: 'CHROMIUM_SAFE_PREFLIGHT', profile_id: 'profile_synthetic', payload: { mode: 'CHROMIUM_SAFE_PREFLIGHT', publishEnabled: false } };
  await assert.rejects(createChromiumSafePreflightExecutor(outside, () => [], { enabled: true, profilesRoot: path.join(root, 'profiles'), launchPersistentContext: async () => { launched = true; } })(task), { code: 'SYNTHETIC_PROFILE_ROOT_INVALID' });
  await assert.rejects(createChromiumSafePreflightExecutor(outside, () => [], { enabled: false, profilesRoot: path.join(root, 'profiles') })(task), { code: 'CHROMIUM_PREFLIGHT_DISABLED' });
  assert.equal(launched, false);
});

test('Chromium safe preflight closes the isolated browser after launch failure during page setup', async () => {
  const root = temporaryDirectory('chromium-cleanup'); let closed = false;
  const registry = { getProfile: () => ({ status: 'READY', localProfilePath: path.join(root, 'profiles', 'synthetic') }) };
  const executor = createChromiumSafePreflightExecutor(registry, () => [], { enabled: true, profilesRoot: path.join(root, 'profiles'), launchPersistentContext: async () => ({ pages: () => [], newPage: async () => { throw new Error('page failed'); }, close: async () => { closed = true; } }) });
  await assert.rejects(executor({ task_type: 'CHROMIUM_SAFE_PREFLIGHT', profile_id: 'profile_synthetic', payload: { mode: 'CHROMIUM_SAFE_PREFLIGHT', publishEnabled: false } }), /page failed/);
  assert.equal(closed, true);
});
test('Facebook session readiness detection is conservative', () => { assert.equal(detectSessionState('<button aria-label="Account menu">Facebook menu</button>'), 'AUTHENTICATED'); assert.equal(detectSessionState('<input name="email"><input name="pass">'), 'UNAUTHENTICATED'); assert.equal(detectSessionState('checkpoint'), 'INDETERMINATE'); assert.equal(detectSessionState('<input name="email">Facebook menu'), 'INDETERMINATE'); });

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

function liveFixture(overrides = {}) {
  return {
    task_id: 'live_task', task_type: LIVE_CAMPAIGN_EXECUTION_TASK_TYPE, agent_id: 'agent_live', profile_id: 'profile_live', lease_id: 'lease_live', side_effect_state: 'NOT_ATTEMPTED',
    payload: { mode: LIVE_EXECUTION_MODE, publishEnabled: true, execution_config: { publishEnabled: true }, campaign: { campaign_id: 'campaign_live' }, post: { post_id: 'post_live', day: 1, text: 'immutable snapshot' }, target: { target_id: 'target_live', url: 'https://example.test/group' }, media: [], local_media_paths: [] },
    ...overrides,
  };
}

function liveSeamFixture(overrides = {}) {
  const calls = [];
  const publisher = {
    prepare: async () => calls.push('PREPARE'),
    verifyReady: async () => { calls.push('READY'); return { sessionReady: true, targetReady: true, composerReady: true }; },
    submit: async () => calls.push('SUBMIT'),
    verifyOutcome: async () => { calls.push('VERIFY'); return { verified: true }; },
    ...overrides.publisher,
  };
  const transport = {
    agentId: 'agent_live',
    renewLease: async () => calls.push('LEASE'),
    markSideEffectAttemptStarted: async () => calls.push('MARK_ATTEMPT'),
    markSideEffectVerifiedSuccess: async () => calls.push('MARK_VERIFIED'),
    ...overrides.transport,
  };
  const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher });
  return { calls, publisher, transport, execute };
}

test('live executor seam is mock-only, persists marker before submit, and completes only after verified success', async () => {
  const { calls, transport, execute } = liveSeamFixture(); const trace = [];
  const result = await execute(liveFixture(), { transport, trace: (event) => trace.push(event) });
  assert.equal(result.sideEffectState, 'VERIFIED_SUCCESS');
  assert.deepEqual(calls, ['PREPARE', 'READY', 'LEASE', 'MARK_ATTEMPT', 'SUBMIT', 'VERIFY', 'MARK_VERIFIED']);
  assert.deepEqual(trace, ['PREPARE_COMPLETE', 'PUBLISHER_READY', 'LEASE_VALID', 'ATTEMPT_STARTED_PERSISTED', 'SUBMIT_CALLED', 'VERIFY_SUCCESS', 'VERIFIED_SUCCESS_PERSISTED']);
  assert.ok(calls.indexOf('MARK_ATTEMPT') < calls.indexOf('SUBMIT'));
  await assert.rejects(createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: false })(liveFixture()), { code: 'LIVE_EXECUTION_DISABLED' });
  await assert.rejects(createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true })(liveFixture()), { code: 'LIVE_EXECUTION_NOT_IMPLEMENTED' });
});

test('live executor seam fails before publish on pre-marker or marker failure and resolves post-marker ambiguity safely', async () => {
  let fixture = liveSeamFixture({ publisher: { prepare: async () => { throw Object.assign(new Error('bad snapshot'), { code: 'SNAPSHOT_INVALID' }); } } });
  await assert.rejects(fixture.execute(liveFixture(), { transport: fixture.transport }), { code: 'SNAPSHOT_INVALID' }); assert.equal(fixture.calls.includes('SUBMIT'), false);
  fixture = liveSeamFixture({ transport: { markSideEffectAttemptStarted: async () => { throw Object.assign(new Error('marker failed'), { code: 'MARKER_FAILED' }); } } });
  await assert.rejects(fixture.execute(liveFixture(), { transport: fixture.transport }), { code: 'MARKER_FAILED' }); assert.equal(fixture.calls.includes('SUBMIT'), false);
  fixture = liveSeamFixture({ publisher: { submit: async () => { fixture.calls.push('SUBMIT'); throw new Error('disconnect'); } } });
  await assert.rejects(fixture.execute(liveFixture(), { transport: fixture.transport }), { code: 'EXECUTION_OUTCOME_UNKNOWN' }); assert.equal(fixture.calls.filter((call) => call === 'SUBMIT').length, 1);
  fixture = liveSeamFixture({ publisher: { verifyOutcome: async () => { fixture.calls.push('VERIFY'); return { verified: false }; } } });
  await assert.rejects(fixture.execute(liveFixture(), { transport: fixture.transport }), { code: 'EXECUTION_OUTCOME_UNKNOWN' }); assert.equal(fixture.calls.filter((call) => call === 'SUBMIT').length, 1);
  fixture = liveSeamFixture({ publisher: { verifyOutcome: async () => { fixture.calls.push('VERIFY'); throw new Error('verification timeout'); } } });
  await assert.rejects(fixture.execute(liveFixture(), { transport: fixture.transport }), { code: 'EXECUTION_OUTCOME_UNKNOWN' }); assert.equal(fixture.calls.filter((call) => call === 'SUBMIT').length, 1);
  fixture = liveSeamFixture({ transport: { markSideEffectVerifiedSuccess: async () => { throw new Error('persist failed'); } } });
  await assert.rejects(fixture.execute(liveFixture(), { transport: fixture.transport }), { code: 'EXECUTION_OUTCOME_UNKNOWN' }); assert.equal(fixture.calls.filter((call) => call === 'SUBMIT').length, 1);
  fixture = liveSeamFixture(); let checks = 0;
  const cancelled = await fixture.execute(liveFixture(), { transport: fixture.transport, isCancellationRequested: async () => (++checks >= 3) }); assert.equal(cancelled.cancelled, true); assert.equal(fixture.calls.includes('SUBMIT'), false);
});

test('live executor reconnect states never resubmit and CloudAgentService holds the profile lock through completion persistence', async () => {
  let fixture = liveSeamFixture();
  await assert.rejects(fixture.execute(liveFixture({ side_effect_state: 'ATTEMPT_STARTED' }), { transport: fixture.transport }), { code: 'EXECUTION_OUTCOME_UNKNOWN' }); assert.equal(fixture.calls.includes('SUBMIT'), false);
  fixture = liveSeamFixture();
  const recovered = await fixture.execute(liveFixture({ side_effect_state: 'VERIFIED_SUCCESS' }), { transport: fixture.transport }); assert.equal(recovered.recoveredVerifiedSuccess, true); assert.equal(fixture.calls.includes('SUBMIT'), false);

  fixture = liveSeamFixture(); const events = []; const task = liveFixture();
  const transport = {
    ...fixture.transport,
    heartbeat: async () => {}, claimNextTask: async () => ({ task }), getCancellationState: async () => ({ cancellation_requested: false }), reportRunning: async () => events.push('RUNNING'), reportCompletion: async () => events.push('COMPLETION_PERSISTED'), reportFailure: async () => events.push('FAILED'), reportOutcomeUnknown: async () => events.push('OUTCOME_UNKNOWN'),
  };
  const service = new CloudAgentService({
    transport, registry: { getSafeMetadata: () => ({ agent_id: 'agent_live' }) },
    executor: { runProfile: async (_profileId, handler, details) => { details.onAcquired(); try { return await handler(); } finally { details.onReleased(); } } },
    executeTask: (executionTask, _cancel, context) => fixture.execute(executionTask, context),
    events: (event) => events.push(event),
  });
  await service.runOnce();
  const ordered = ['PROFILE_LOCK_ACQUIRED', 'PREPARE_COMPLETE', 'LEASE_VALID', 'ATTEMPT_STARTED_PERSISTED', 'SUBMIT_CALLED', 'VERIFY_SUCCESS', 'VERIFIED_SUCCESS_PERSISTED', 'COMPLETION_PERSISTED', 'TASK_COMPLETED', 'PROFILE_LOCK_RELEASED'];
  let prior = -1; for (const event of ordered) { const current = events.indexOf(event); assert.ok(current > prior, `${event} must follow ${ordered[prior] || 'start'}`); prior = current; }
  assert.equal(fixture.calls.filter((call) => call === 'SUBMIT').length, 1);
});

test('verified-success completion acknowledgement failure is outcome-unknown and never re-submits', async () => {
  const fixture = liveSeamFixture(); const events = []; const task = liveFixture();
  const transport = {
    ...fixture.transport,
    heartbeat: async () => {}, claimNextTask: async () => ({ task }), getCancellationState: async () => ({ cancellation_requested: false }), reportRunning: async () => {}, reportCompletion: async () => { throw new Error('completion timeout'); }, reportFailure: async () => events.push('FAILED'), reportOutcomeUnknown: async () => events.push('OUTCOME_UNKNOWN'),
  };
  const service = new CloudAgentService({
    transport, registry: { getSafeMetadata: () => ({ agent_id: 'agent_live' }) },
    executor: { runProfile: async (_profileId, handler, details) => { details.onAcquired(); try { return await handler(); } finally { details.onReleased(); } } },
    executeTask: (executionTask, _cancel, context) => fixture.execute(executionTask, context), events: () => {},
  });
  await assert.rejects(service.runOnce(), { code: 'EXECUTION_OUTCOME_UNKNOWN' });
  assert.deepEqual(events, ['OUTCOME_UNKNOWN']); assert.equal(fixture.calls.filter((call) => call === 'SUBMIT').length, 1);
});

function fakeFacebookPublisher(options = {}) {
  const calls = []; let clicks = 0; let closed = 0;
  const identitySequence = Array.isArray(options.identitySequence) ? options.identitySequence : [Object.hasOwn(options, 'actualIdentity') ? options.actualIdentity : '100000000000001'];
  let identityRead = 0; let urlRead = 0; let composerChecks = 0; let textChecks = 0; let mediaChecks = 0; let publishChecks = 0; let publishLookups = 0; let targetNavigated = false; let rootUrl = options.initialUrl || 'about:blank';
  const composer = { locator: { waitFor: async () => {} }, handle: {} };
  const context = {
    cookies: async (origins) => {
      calls.push(`IDENTITY_SOURCE:${origins?.[0] || ''}`);
      const identity = identitySequence[Math.min(identityRead++, identitySequence.length - 1)];
      if (Array.isArray(identity)) return identity;
      if (identity === null) return [];
      return [{ name: 'c_user', value: identity, domain: '.facebook.com' }];
    },
    close: async () => { closed += 1; calls.push('CLOSE_FAKE'); },
  };
  const page = {
    content: async () => options.sessionHtml || '<button aria-label="Account menu">Facebook menu</button>',
    goto: async (url, navigationOptions) => {
      calls.push(`ROOT_NAVIGATE:${url}`);
      assert.equal(navigationOptions?.waitUntil, 'domcontentloaded'); assert.equal(navigationOptions?.timeout, 30000);
      if (options.rootNavigationError) throw options.rootNavigationError;
      rootUrl = options.rootRedirectUrl || url;
    },
    url: () => targetNavigated ? (options.urlSequence || [options.actualUrl || 'https://www.facebook.com/groups/exact'])[Math.min(urlRead++, (options.urlSequence || [options.actualUrl || 'https://www.facebook.com/groups/exact']).length - 1)] : rootUrl,
    context: () => context,
    getByRole: () => ({ last: () => composer.locator }),
    getByText: () => ({ first: () => ({ waitFor: async () => {} }) }),
  };
  const button = { isEnabled: async () => true, click: async () => { clicks += 1; calls.push('CLICK'); if (options.clickError) throw new Error('click interrupted'); } };
  const adapter = createRealFacebookPublisherAdapter({ getProfile: () => ({ status: 'READY', legacyProfileIds: ['fake'], localProfilePath: 'never-used', displayName: 'Fake profile', expectedFacebookAccountId: '100000000000001' }) }, () => [], {
    openBrowser: async () => { calls.push('OPEN_FAKE'); return { page, context }; },
    openGroup: async () => { targetNavigated = true; calls.push('NAVIGATE_FAKE'); }, createPost: async () => { calls.push('PREPARE_POST'); return { composer }; },
    requirePreparedComposer: (prepared) => prepared?.composer || (() => { throw Object.assign(new Error('composer missing'), { code: 'FACEBOOK_COMPOSER_UNVERIFIED' }); })(),
    verifyComposer: async () => { composerChecks += 1; if (options.composerError && (!options.composerErrorAt || composerChecks >= options.composerErrorAt)) throw Object.assign(new Error('composer changed'), { code: options.composerError }); },
    verifyText: async () => { textChecks += 1; if (options.content?.textPresent === false && (!options.contentErrorAt || textChecks >= options.contentErrorAt)) throw Object.assign(new Error('content mismatch'), { code: 'FACEBOOK_CONTENT_MISMATCH' }); },
    verifyMedia: async () => { mediaChecks += 1; if (options.content?.mediaReady === false && (!options.contentErrorAt || mediaChecks >= options.contentErrorAt)) throw Object.assign(new Error('media mismatch'), { code: 'FACEBOOK_MEDIA_MISMATCH' }); },
    findPublishControl: async () => { publishLookups += 1; if (options.publishError && (!options.publishErrorAt || publishLookups >= options.publishErrorAt)) throw Object.assign(new Error('publish unavailable'), { code: options.publishError }); return button; },
    verifyPublishControl: async () => { publishChecks += 1; if (options.publishError && (!options.publishErrorAt || publishChecks >= options.publishErrorAt)) throw Object.assign(new Error('publish unavailable'), { code: options.publishError }); },
    verifyLivePostPublished: async () => options.verified === undefined ? true : options.verified,
  });
  return { adapter, calls, clicks: () => clicks, closed: () => closed };
}

test('real Facebook publisher adapter uses existing browser/navigation/composer seams but only submit can click', async () => {
  const fake = fakeFacebookPublisher(); const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  await fake.adapter.prepare(task); await fake.adapter.verifyReady(task);
  assert.equal(fake.clicks(), 0); assert.deepEqual(fake.calls.slice(0, 5), ['OPEN_FAKE', 'ROOT_NAVIGATE:https://www.facebook.com/', 'IDENTITY_SOURCE:https://www.facebook.com', 'NAVIGATE_FAKE', 'PREPARE_POST']);
  await fake.adapter.submit(task); assert.equal(fake.clicks(), 1);
  assert.deepEqual(await fake.adapter.verifyOutcome(task), { verified: true, state: 'VERIFIED_SUCCESS' });
  await fake.adapter.cleanup(); assert.equal(fake.closed(), 1);
});

test('real publisher establishes bounded Facebook-root session and identity before target preparation', async () => {
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  const fake = fakeFacebookPublisher({ initialUrl: 'about:blank' });
  await fake.adapter.prepare(task);
  assert.deepEqual(fake.calls.slice(0, 5), ['OPEN_FAKE', 'ROOT_NAVIGATE:https://www.facebook.com/', 'IDENTITY_SOURCE:https://www.facebook.com', 'NAVIGATE_FAKE', 'PREPARE_POST']);
  assert.ok(fake.calls.indexOf('ROOT_NAVIGATE:https://www.facebook.com/') < fake.calls.indexOf('NAVIGATE_FAKE'));
  await fake.adapter.cleanup();
});

test('real publisher fails closed on root login, checkpoint, challenge, unapproved redirect, or timeout before target, marker, or click', async () => {
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  const cases = [
    { sessionHtml: 'name="email"' },
    { sessionHtml: 'checkpoint' },
    { sessionHtml: 'security challenge' },
    { rootRedirectUrl: 'https://www.facebook.example/' },
    { rootNavigationError: new Error('navigation timeout') },
  ];
  for (const options of cases) {
    const fake = fakeFacebookPublisher(options); const markers = [];
    const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher: fake.adapter });
    await assert.rejects(execute(task, { transport: { agentId: 'agent_live', renewLease: async () => markers.push('LEASE'), markSideEffectAttemptStarted: async () => markers.push('MARK'), markSideEffectVerifiedSuccess: async () => markers.push('VERIFIED') } }), { code: 'FACEBOOK_SESSION_NOT_READY' });
    assert.equal(fake.calls.includes('NAVIGATE_FAKE'), false); assert.equal(fake.calls.includes('PREPARE_POST'), false);
    assert.deepEqual(markers, []); assert.equal(fake.clicks(), 0);
  }
});

test('real publisher rejects missing or mismatched root c_user before target, marker, or click', async () => {
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  for (const [options, code] of [[{ actualIdentity: null }, 'FACEBOOK_IDENTITY_UNVERIFIED'], [{ actualIdentity: '100000000000002' }, 'FACEBOOK_IDENTITY_MISMATCH']]) {
    const fake = fakeFacebookPublisher(options); const markers = [];
    const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher: fake.adapter });
    await assert.rejects(execute(task, { transport: { agentId: 'agent_live', renewLease: async () => markers.push('LEASE'), markSideEffectAttemptStarted: async () => markers.push('MARK'), markSideEffectVerifiedSuccess: async () => markers.push('VERIFIED') } }), { code });
    assert.equal(fake.calls.includes('NAVIGATE_FAKE'), false); assert.deepEqual(markers, []); assert.equal(fake.clicks(), 0);
  }
});

test('real publisher rejects rehearsal snapshots before browser launch, marker, or submit', async () => {
  let launches = 0; const calls = [];
  const adapter = createRealFacebookPublisherAdapter({ getProfile: () => ({ status: 'READY', expectedFacebookAccountId: '100000000000001' }) }, () => [], { openBrowser: async () => { launches += 1; } });
  const task = liveFixture({ payload: { ...liveFixture().payload, execution_config: { publishEnabled: true, rehearsal: true }, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  await assert.rejects(adapter.prepare(task), { code: 'LIVE_REHEARSAL_REAL_ADAPTER_FORBIDDEN' });
  assert.equal(launches, 0);
  const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher: adapter });
  await assert.rejects(execute(task, { transport: { agentId: 'agent_live', renewLease: async () => calls.push('LEASE'), markSideEffectAttemptStarted: async () => calls.push('MARK'), markSideEffectVerifiedSuccess: async () => calls.push('VERIFIED') } }), { code: 'LIVE_REHEARSAL_REAL_ADAPTER_FORBIDDEN' });
  assert.deepEqual(calls, []);
});

test('real adapter consumes only the composer returned by preparation, never a page-wide dialog lookup', async () => {
  const composerA = { handle: {}, locator: { waitFor: async () => {} } }; const calls = [];
  const context = { cookies: async () => [{ name: 'c_user', value: '100000000000001', domain: '.facebook.com' }], close: async () => {} };
  const page = { goto: async () => {}, content: async () => '<button aria-label="Account menu">Facebook menu</button>', context: () => context, url: () => 'https://www.facebook.com/groups/exact', getByRole: () => { throw new Error('page-wide dialog lookup is forbidden'); } };
  const adapter = createRealFacebookPublisherAdapter({ getProfile: () => ({ status: 'READY', legacyProfileIds: ['fake'], expectedFacebookAccountId: '100000000000001' }) }, () => [], {
    openBrowser: async () => ({ page, context }), openGroup: async () => {}, createPost: async () => ({ composer: composerA }),
    verifyComposer: async (composer) => { assert.equal(composer, composerA); calls.push('COMPOSER_A'); }, verifyText: async () => {}, verifyMedia: async () => {}, findPublishControl: async (composer) => { assert.equal(composer, composerA); return { isVisible: async () => true, isEnabled: async () => true, click: async () => {} }; }, verifyPublishControl: async () => {}, verifyLivePostPublished: async () => true,
  });
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { url: 'https://www.facebook.com/groups/exact' } } });
  await adapter.prepare(task); await adapter.verifyReady(task); await adapter.cleanup();
  assert.deepEqual(calls, ['COMPOSER_A', 'COMPOSER_A']);
});

test('real publisher rejects absent or task-injected Facebook identity before browser launch and marker persistence', async () => {
  let browserOpened = 0;
  const adapter = createRealFacebookPublisherAdapter({ getProfile: () => ({ status: 'READY', legacyProfileIds: ['fake'], localProfilePath: 'never-used', displayName: 'Fake profile' }) }, () => [], {
    openBrowser: async () => { browserOpened += 1; throw new Error('must not open'); },
  });
  const task = liveFixture({ payload: { ...liveFixture().payload, facebookAccountId: '999999999999999', target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  await assert.rejects(adapter.prepare(task), { code: 'FACEBOOK_IDENTITY_NOT_CONFIGURED' });
  assert.equal(browserOpened, 0);

  const calls = [];
  const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY', legacyProfileIds: ['fake'], localProfilePath: 'never-used' }) }, () => [], { enabled: true, publisher: adapter });
  await assert.rejects(execute(task, { transport: { agentId: 'agent_live', renewLease: async () => calls.push('LEASE'), markSideEffectAttemptStarted: async () => calls.push('MARK'), markSideEffectVerifiedSuccess: async () => calls.push('VERIFIED') } }), { code: 'FACEBOOK_IDENTITY_NOT_CONFIGURED' });
  assert.deepEqual(calls, []);
});

test('real publisher verifies only the active Facebook c_user identity and fails closed on ambiguity or change', async () => {
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  let fake = fakeFacebookPublisher({ actualIdentity: '100000000000002' });
  await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_IDENTITY_MISMATCH' }); assert.equal(fake.clicks(), 0);
  fake = fakeFacebookPublisher({ actualIdentity: null });
  await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_IDENTITY_UNVERIFIED' }); assert.equal(fake.clicks(), 0);
  fake = fakeFacebookPublisher({ actualIdentity: 'not-a-facebook-id' });
  await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_IDENTITY_UNVERIFIED' }); assert.equal(fake.clicks(), 0);
  fake = fakeFacebookPublisher({ identitySequence: [[{ name: 'c_user', value: '100000000000001', domain: '.facebook.com' }, { name: 'c_user', value: '100000000000002', domain: '.facebook.com' }]] });
  await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_IDENTITY_UNVERIFIED' }); assert.equal(fake.clicks(), 0);
  fake = fakeFacebookPublisher({ sessionHtml: 'checkpoint' });
  await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_SESSION_NOT_READY' }); assert.equal(fake.clicks(), 0);
  fake = fakeFacebookPublisher({ sessionHtml: 'name="email"' });
  await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_SESSION_NOT_READY' }); assert.equal(fake.clicks(), 0);

  fake = fakeFacebookPublisher({ identitySequence: ['100000000000001', '100000000000001', '100000000000002'] });
  const calls = [];
  const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher: fake.adapter });
  await assert.rejects(execute(task, { transport: { agentId: 'agent_live', renewLease: async () => calls.push('LEASE'), markSideEffectAttemptStarted: async () => calls.push('MARK'), markSideEffectVerifiedSuccess: async () => calls.push('VERIFIED') } }), { code: 'FACEBOOK_IDENTITY_MISMATCH' });
  assert.deepEqual(calls, ['LEASE']); assert.equal(fake.clicks(), 0);
});

test('Facebook session identity extractor accepts only a canonical c_user cookie at Facebook origin', async () => {
  const origins = [];
  const page = { context: () => ({ cookies: async (requested) => { origins.push(...requested); return [{ name: 'c_user', value: '100000000000001', domain: '.facebook.com' }]; } }) };
  assert.equal(await getAuthenticatedFacebookAccountId(page), '100000000000001');
  assert.deepEqual(origins, ['https://www.facebook.com']);
  assert.equal(await getAuthenticatedFacebookAccountId({ context: () => ({ cookies: async () => [{ name: 'c_user', value: '100000000000001', domain: '.facebook.example' }] }) }), null);
  assert.equal(await getAuthenticatedFacebookAccountId({ context: () => ({ cookies: async () => [{ name: 'display_name', value: 'Not an ID', domain: '.facebook.com' }] }) }), null);
});

test('real Facebook adapter blocks challenge, wrong target, incomplete composer, and weak outcome without a real click', async () => {
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  let fake = fakeFacebookPublisher({ sessionHtml: 'checkpoint' }); await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_SESSION_NOT_READY' }); assert.equal(fake.clicks(), 0);
  fake = fakeFacebookPublisher({ actualUrl: 'https://www.facebook.com/groups/wrong' }); await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_TARGET_MISMATCH' }); assert.equal(fake.clicks(), 0);
  fake = fakeFacebookPublisher({ content: { textPresent: false, mediaReady: true } }); await assert.rejects(fake.adapter.prepare(task), { code: 'FACEBOOK_CONTENT_MISMATCH' }); assert.equal(fake.clicks(), 0); await fake.adapter.cleanup();
  fake = fakeFacebookPublisher({ verified: false }); await fake.adapter.prepare(task); await fake.adapter.verifyReady(task); await fake.adapter.submit(task); assert.deepEqual(await fake.adapter.verifyOutcome(task), { verified: false, state: 'AMBIGUOUS' }); assert.equal(fake.clicks(), 1); await fake.adapter.cleanup();
});

test('real adapter remains outside marker persistence and is ordered by the live executor without real browser primitives', async () => {
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  const fake = fakeFacebookPublisher(); const calls = []; let markerPersisted = false; const originalSubmit = fake.adapter.submit;
  fake.adapter.submit = async (liveTask) => { assert.equal(markerPersisted, true); calls.push('REAL_ADAPTER_SUBMIT'); return originalSubmit(liveTask); };
  const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher: fake.adapter });
  const transport = { agentId: 'agent_live', renewLease: async () => calls.push('LEASE'), markSideEffectAttemptStarted: async () => { markerPersisted = true; calls.push('MARK_ATTEMPT'); }, markSideEffectVerifiedSuccess: async () => calls.push('MARK_VERIFIED') };
  await execute(task, { transport, trace: (event) => calls.push(event) });
  assert.ok(calls.indexOf('ATTEMPT_STARTED_PERSISTED') < calls.indexOf('REAL_ADAPTER_SUBMIT'));
  assert.equal(fake.clicks(), 1); assert.equal(fake.closed(), 1);
  const markerFailure = fakeFacebookPublisher(); const blocked = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher: markerFailure.adapter });
  await assert.rejects(blocked(task, { transport: { ...transport, markSideEffectAttemptStarted: async () => { throw Object.assign(new Error('marker down'), { code: 'MARKER_FAILED' }); } } }), { code: 'MARKER_FAILED' }); assert.equal(markerFailure.clicks(), 0);
});

test('final cancellation after lease renewal prevents marker and submit', async () => {
  const fixture = liveSeamFixture({ publisher: { verifyAfterLeaseReadiness: async () => { fixture.calls.push('POST_LEASE_READY'); return { sessionReady: true, targetReady: true, composerReady: true }; } } });
  let checks = 0;
  const result = await fixture.execute(liveFixture(), { transport: fixture.transport, isCancellationRequested: async () => (++checks >= 3) });
  assert.equal(result.cancelled, true);
  assert.deepEqual(fixture.calls, ['PREPARE', 'READY', 'LEASE']);
  assert.equal(fixture.calls.includes('MARK_ATTEMPT'), false); assert.equal(fixture.calls.includes('SUBMIT'), false);
});

test('real adapter rechecks retained target, composer, text, media, and scoped control before marker without a click', async () => {
  const task = liveFixture({ payload: { ...liveFixture().payload, target: { target_id: 'target_live', url: 'https://www.facebook.com/groups/exact' } } });
  for (const options of [
    { urlSequence: ['https://www.facebook.com/groups/exact', 'https://www.facebook.com/groups/exact', 'https://www.facebook.com/groups/wrong'] },
    { composerError: 'FACEBOOK_COMPOSER_CHANGED', composerErrorAt: 3 },
    { content: { textPresent: false, mediaReady: true }, contentErrorAt: 3 },
    { content: { textPresent: true, mediaReady: false }, contentErrorAt: 3 },
    { publishError: 'FACEBOOK_PUBLISH_CONTROL_MISSING', publishErrorAt: 2 },
  ]) {
    const fake = fakeFacebookPublisher(options); const calls = [];
    const execute = createLiveCampaignExecutionExecutor({ getProfile: () => ({ status: 'READY' }) }, () => [], { enabled: true, publisher: fake.adapter });
    await assert.rejects(execute(task, { transport: { agentId: 'agent_live', renewLease: async () => calls.push('LEASE'), markSideEffectAttemptStarted: async () => calls.push('MARK'), markSideEffectVerifiedSuccess: async () => calls.push('VERIFIED') } }));
    assert.deepEqual(calls, ['LEASE']); assert.equal(fake.clicks(), 0);
  }
});

test('cancellation during post-lease readiness is caught by the second check before marker or submit', async () => {
  const fixture = liveSeamFixture({ publisher: { verifyAfterLeaseReadiness: async () => { fixture.calls.push('POST_LEASE_READY'); return { sessionReady: true, targetReady: true, composerReady: true }; } } });
  let checks = 0;
  const result = await fixture.execute(liveFixture(), { transport: fixture.transport, isCancellationRequested: async () => (++checks >= 4) });
  assert.equal(result.cancelled, true);
  assert.deepEqual(fixture.calls, ['PREPARE', 'READY', 'LEASE', 'POST_LEASE_READY']);
  assert.equal(fixture.calls.includes('MARK_ATTEMPT'), false); assert.equal(fixture.calls.includes('SUBMIT'), false);
});

test('post-lease readiness is ordered before the second cancellation check, marker, and submit', async () => {
  const fixture = liveSeamFixture({ publisher: { verifyAfterLeaseReadiness: async () => { fixture.calls.push('POST_LEASE_READY'); return { sessionReady: true, targetReady: true, composerReady: true }; } } });
  const result = await fixture.execute(liveFixture(), { transport: fixture.transport, isCancellationRequested: async () => false });
  assert.equal(result.sideEffectState, 'VERIFIED_SUCCESS');
  assert.deepEqual(fixture.calls, ['PREPARE', 'READY', 'LEASE', 'POST_LEASE_READY', 'MARK_ATTEMPT', 'SUBMIT', 'VERIFY', 'MARK_VERIFIED']);
});

test('strict live publication verification requires both acknowledgement and a closed composer', async () => {
  const wait = (ok) => async () => { if (!ok) throw new Error('not observed'); };
  const page = { getByText: () => ({ first: () => ({ waitFor: wait(true) }) }) };
  assert.equal(await verifyLivePostPublished(page, { waitFor: wait(true) }, 1), true);
  assert.equal(await verifyLivePostPublished(page, { waitFor: wait(false) }, 1), false);
  const noAcknowledgement = { getByText: () => ({ first: () => ({ waitFor: wait(false) }) }) };
  assert.equal(await verifyLivePostPublished(noAcknowledgement, { waitFor: wait(true) }, 1), false);
});
