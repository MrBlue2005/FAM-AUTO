'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { ProfileLockManager } = require('../app/local-agent/ProfileLockManager');
const {
  DEFAULT_PREVIEW_URL,
  EXPECTED_TARGET_ID,
  EXPECTED_USERNAME,
  HOSTED_READ_PATHS,
  QA_PROFILE_ID,
  createQaPreviewBrowser,
  defaultProfileDirectory,
} = require('../app/qa/QaPreviewBrowser');

function ready(overrides = {}) {
  return {
    authenticated: true,
    username: EXPECTED_USERNAME,
    campaignVisibility: 1,
    safeTargetVisible: true,
    targetId: EXPECTED_TARGET_ID,
    targetGroup: '1102687755514047',
    assignmentCount: 1,
    managedProfileAssignmentMatched: true,
    activeTasks: 0,
    profileConflicts: 0,
    code: 'QA_SESSION_READY',
    ...overrides,
  };
}

function fixture(t, state = ready()) {
  const ownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-qa-browser-'));
  const profileDirectory = path.join(ownedRoot, 'profile');
  const calls = [];
  const page = { goto: async (url) => calls.push({ goto: url }), url: () => DEFAULT_PREVIEW_URL };
  const launchPersistentContext = async (directory, options) => {
    calls.push({ directory, options });
    return { pages: () => [page], close: async () => calls.push({ closed: true }) };
  };
  const lockManager = new ProfileLockManager({ lockDirectory: path.join(ownedRoot, 'locks') });
  const browser = createQaPreviewBrowser({ ownedRoot, profileDirectory, launchPersistentContext, lockManager, readHostedState: async () => state, pollIntervalMs: 1, bootstrapTimeoutMs: 25 });
  t.after(() => fs.rmSync(ownedRoot, { recursive: true, force: true }));
  return { browser, calls, ownedRoot, profileDirectory, lockManager };
}

test('dedicated QA profile uses the application local-data convention', () => {
  assert.match(defaultProfileDirectory().replace(/\\/g, '/'), /app\/data\/qa-preview-browser$/);
});

test('dedicated QA profile is Git-ignored', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /app\/data\/qa-preview-browser\//);
});

test('dedicated QA profile is not the normal Chrome profile', () => {
  assert.doesNotMatch(defaultProfileDirectory(), /Google[\\/]Chrome[\\/]User Data/i);
});

test('bootstrap launches a headed persistent context', async (t) => {
  const { browser, calls, profileDirectory } = fixture(t);
  await browser.bootstrap();
  const launch = calls.find((call) => call.directory);
  assert.equal(launch.directory, profileDirectory);
  assert.equal(launch.options.headless, false);
});

test('verification reuses the identical profile directory', async (t) => {
  const { browser, calls, profileDirectory } = fixture(t);
  await browser.bootstrap();
  await browser.verify();
  const launches = calls.filter((call) => call.directory);
  assert.equal(launches.length, 2);
  assert.equal(launches[0].directory, profileDirectory);
  assert.equal(launches[1].directory, profileDirectory);
  assert.equal(launches[1].options.headless, true);
});

test('concurrent ownership of the QA profile is rejected', (t) => {
  const { lockManager } = fixture(t);
  const first = lockManager.acquire(QA_PROFILE_ID);
  assert.throws(() => lockManager.acquire(QA_PROFILE_ID), { code: 'PROFILE_BUSY' });
  first.release();
});

test('unauthenticated and expired sessions fail closed', async (t) => {
  const { browser } = fixture(t, { authenticated: false, code: 'QA_SESSION_EXPIRED' });
  await assert.rejects(browser.verify(), { code: 'QA_SESSION_EXPIRED' });
});

test('the exact qa_user_b4 identity is accepted', async (t) => {
  const { browser } = fixture(t);
  assert.equal((await browser.verify()).username, 'qa_user_b4');
});

for (const campaignVisibility of [1, 3, 10]) {
  test(`campaign visibility ${campaignVisibility} is accepted with the exact target and assignment`, async (t) => {
    const { browser } = fixture(t, ready({ campaignVisibility }));
    assert.equal((await browser.verify()).campaignVisibility, campaignVisibility);
  });
}

for (const [name, overrides] of [
  ['missing safe target', { safeTargetVisible: false }],
  ['wrong target identity', { targetId: 'wrong-target-id' }],
  ['wrong target group', { targetGroup: '9999999999999999' }],
  ['missing managed-profile assignment', { assignmentCount: 0, managedProfileAssignmentMatched: false }],
  ['ambiguous managed-profile assignment', { assignmentCount: 2, managedProfileAssignmentMatched: false }],
]) {
  test(`${name} is rejected even with multiple visible campaigns`, async (t) => {
    const { browser } = fixture(t, ready({ campaignVisibility: 3, ...overrides }));
    await assert.rejects(browser.verify(), { code: 'QA_HOSTED_SCOPE_MISMATCH' });
  });
}

test('an active task remains a hard failure with multiple visible campaigns', async (t) => {
  const { browser } = fixture(t, ready({ campaignVisibility: 3, activeTasks: 1 }));
  await assert.rejects(browser.verify(), { code: 'QA_PROFILE_NOT_IDLE' });
});

test('a profile conflict remains a hard failure with multiple visible campaigns', async (t) => {
  const { browser } = fixture(t, ready({ campaignVisibility: 3, profileConflicts: 1 }));
  await assert.rejects(browser.verify(), { code: 'QA_PROFILE_NOT_IDLE' });
});

test('a wrong authenticated identity is rejected', async (t) => {
  const { browser } = fixture(t, ready({ username: 'another_user', code: 'QA_IDENTITY_MISMATCH' }));
  await assert.rejects(browser.verify(), { code: 'QA_IDENTITY_MISMATCH' });
});

test('browser close preserves the persistent profile and releases its lock', async (t) => {
  const { browser, profileDirectory, lockManager } = fixture(t);
  fs.mkdirSync(profileDirectory, { recursive: true });
  const marker = path.join(profileDirectory, 'persistent-marker');
  fs.writeFileSync(marker, 'local browser state');
  await browser.verify();
  assert.equal(fs.readFileSync(marker, 'utf8'), 'local browser state');
  const reacquired = lockManager.acquire(QA_PROFILE_ID);
  reacquired.release();
});

test('QA browser navigation is restricted to the configured Preview', async (t) => {
  const { browser, calls } = fixture(t);
  await browser.verify();
  assert.deepEqual(calls.filter((call) => call.goto).map((call) => call.goto), [DEFAULT_PREVIEW_URL]);
  assert.equal(calls.some((call) => /facebook\.com/i.test(call.goto || '')), false);
});

test('hosted preflight surface contains only read endpoints', () => {
  assert.ok(HOSTED_READ_PATHS.every((requestPath) => requestPath === '/api/auth/status' || requestPath.startsWith('/api/cloud-read/')));
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'qa', 'QaPreviewBrowser.js'), 'utf8');
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('QA browser exposes no cookie extraction or storage-state export API', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'qa', 'QaPreviewBrowser.js'), 'utf8');
  assert.doesNotMatch(source, /context\.cookies|storageState|document\.cookie|cookie database|encrypted_value/i);
});

test('QA browser contains no Facebook navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'qa', 'QaPreviewBrowser.js'), 'utf8');
  assert.doesNotMatch(source, /facebook\.com/i);
});

test('QA browser contains no historical task mutation path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'qa', 'QaPreviewBrowser.js'), 'utf8');
  assert.doesNotMatch(source, /live_execution_37775a0fb8af62fc3373da1eef866086/);
});

test('safe results contain no authentication material', async (t) => {
  const { browser } = fixture(t);
  const serialized = JSON.stringify(await browser.verify());
  assert.doesNotMatch(serialized, /rx_session|cookie|authorization|bearer|password|token|secret/i);
});

test('explicit reset deletes only the dedicated QA profile', async (t) => {
  const { browser, profileDirectory, ownedRoot } = fixture(t);
  fs.mkdirSync(profileDirectory, { recursive: true });
  fs.writeFileSync(path.join(profileDirectory, 'state'), 'x');
  fs.writeFileSync(path.join(ownedRoot, 'unrelated'), 'keep');
  await browser.reset();
  assert.equal(fs.existsSync(profileDirectory), false);
  assert.equal(fs.readFileSync(path.join(ownedRoot, 'unrelated'), 'utf8'), 'keep');
});
