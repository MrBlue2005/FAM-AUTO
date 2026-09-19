'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { dataPath } = require('../config/storagePaths');
const { ProfileLockManager } = require('../local-agent/ProfileLockManager');

const DEFAULT_PREVIEW_URL = 'https://fam-auto-3mcb9vhmq-rx-d568.vercel.app';
const EXPECTED_USERNAME = 'qa_user_b4';
const EXPECTED_AGENT_ID = 'agent_0MTRNCJFGC273ED0CF17400D69857';
const EXPECTED_PROFILE_ID = 'profile_0MTRNCJFG908121EBA82A7B1F2173';
const EXPECTED_TARGET_ID = '73ac2c2e-a4a3-410b-a4ac-1dd964680c5f';
const EXPECTED_TARGET_NAME = 'RX real smoke test target';
const EXPECTED_GROUP_ID = '1102687755514047';
const QA_PROFILE_ID = 'qa-preview-browser';
const HOSTED_READ_PATHS = Object.freeze([
  '/api/auth/status',
  '/api/cloud-read/preflight-sources',
  '/api/cloud-read/groups',
  '/api/cloud-read/my-execution-targets',
]);

class QaSessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QaSessionError';
    this.code = code;
  }
}

function defaultProfileDirectory() {
  return path.join(dataPath, 'qa-preview-browser');
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertOwnedProfilePath(profileDirectory, ownedRoot) {
  const root = normalized(ownedRoot);
  const candidate = normalized(profileDirectory);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new QaSessionError('QA_PROFILE_PATH_INVALID', 'QA browser profile must stay inside the application-owned local data directory.');
  }
}

async function defaultHostedStateReader(page, expected) {
  return page.evaluate(async (configuration) => {
    const get = async (requestPath) => {
      const response = await fetch(requestPath, { method: 'GET', credentials: 'include', cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, body };
    };

    const auth = await get('/api/auth/status');
    if (!auth.ok || auth.body?.authenticated !== true) {
      return { authenticated: false, code: 'QA_SESSION_EXPIRED' };
    }
    if (auth.body?.username !== configuration.username) {
      return { authenticated: true, username: String(auth.body?.username || ''), code: 'QA_IDENTITY_MISMATCH' };
    }

    const [sources, groups, assignments] = await Promise.all([
      get('/api/cloud-read/preflight-sources'),
      get('/api/cloud-read/groups'),
      get('/api/cloud-read/my-execution-targets'),
    ]);
    if (![sources, groups, assignments].every((result) => result.ok)) {
      return { authenticated: true, username: configuration.username, code: 'QA_HOSTED_READ_FAILED' };
    }

    const visibleTargets = Array.isArray(sources.body?.targets) ? sources.body.targets : [];
    const visibleCampaigns = Array.isArray(sources.body?.campaigns) ? sources.body.campaigns : [];
    const visibleGroups = Array.isArray(groups.body) ? groups.body : [];
    const assignedTargets = Array.isArray(assignments.body?.targets) ? assignments.body.targets : [];
    const canonicalTarget = visibleTargets.filter((target) => target?.targetId === configuration.targetId && target?.name === configuration.targetName);
    const matchingGroup = visibleGroups.filter((target) => target?.name === configuration.targetName && String(target?.url || '').includes(configuration.groupId));
    const matchingAssignments = assignedTargets.filter((target) => target?.deviceId === configuration.agentId && target?.profileId === configuration.profileId);

    return {
      authenticated: true,
      username: configuration.username,
      campaignVisibility: visibleCampaigns.length,
      safeTargetVisible: canonicalTarget.length === 1 && matchingGroup.length === 1,
      targetId: configuration.targetId,
      targetGroup: configuration.groupId,
      assignmentCount: matchingAssignments.length,
      managedProfileAssignmentMatched: matchingAssignments.length === 1,
      activeTasks: matchingAssignments.reduce((count, target) => count + (Number(target?.activeTaskCount) || 0), 0),
      profileConflicts: matchingAssignments.filter((target) => target?.profileConflict === true).length,
      code: 'QA_SESSION_READY',
    };
  }, expected);
}

function expectedState() {
  return {
    username: EXPECTED_USERNAME,
    agentId: EXPECTED_AGENT_ID,
    profileId: EXPECTED_PROFILE_ID,
    targetId: EXPECTED_TARGET_ID,
    targetName: EXPECTED_TARGET_NAME,
    groupId: EXPECTED_GROUP_ID,
  };
}

function validateState(state) {
  if (!state?.authenticated || state.code === 'QA_SESSION_EXPIRED') {
    throw new QaSessionError('QA_SESSION_EXPIRED', 'The QA Preview application session is not authenticated; run npm run qa:auth.');
  }
  if (state.code === 'QA_IDENTITY_MISMATCH' || state.username !== EXPECTED_USERNAME) {
    throw new QaSessionError('QA_IDENTITY_MISMATCH', `The QA Preview session is not authenticated as ${EXPECTED_USERNAME}.`);
  }
  if (state.code !== 'QA_SESSION_READY') {
    throw new QaSessionError(state.code || 'QA_HOSTED_READ_FAILED', 'The authenticated hosted read-only preflight could not be completed.');
  }
  if (state.campaignVisibility !== 1 || !state.safeTargetVisible || state.assignmentCount !== 1 || !state.managedProfileAssignmentMatched) {
    throw new QaSessionError('QA_HOSTED_SCOPE_MISMATCH', 'The authenticated QA session does not expose the expected target and assignment.');
  }
  if (state.activeTasks !== 0 || state.profileConflicts !== 0) {
    throw new QaSessionError('QA_PROFILE_NOT_IDLE', 'The expected QA profile has active work.');
  }
  return Object.freeze({ ...state });
}

function createQaPreviewBrowser(options = {}) {
  const ownedRoot = options.ownedRoot || dataPath;
  const profileDirectory = options.profileDirectory || defaultProfileDirectory();
  const previewUrl = String(options.previewUrl || process.env.RX_QA_PREVIEW_URL || DEFAULT_PREVIEW_URL).replace(/\/$/, '');
  const launchPersistentContext = options.launchPersistentContext || chromium.launchPersistentContext.bind(chromium);
  const readHostedState = options.readHostedState || defaultHostedStateReader;
  const lockManager = options.lockManager || new ProfileLockManager();
  const pollIntervalMs = Number(options.pollIntervalMs || 1000);
  const bootstrapTimeoutMs = Number(options.bootstrapTimeoutMs || 15 * 60 * 1000);
  assertOwnedProfilePath(profileDirectory, ownedRoot);

  const run = async ({ bootstrap }) => lockManager.runExclusive(QA_PROFILE_ID, { taskId: bootstrap ? 'qa-auth-bootstrap' : 'qa-session-verify' }, async () => {
    fs.mkdirSync(profileDirectory, { recursive: true });
    let context;
    try {
      context = await launchPersistentContext(profileDirectory, { headless: !bootstrap });
      const page = context.pages().length ? context.pages()[0] : await context.newPage();
      await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      if (!bootstrap) return validateState(await readHostedState(page, expectedState()));

      const deadline = Date.now() + bootstrapTimeoutMs;
      while (Date.now() < deadline) {
        if (new URL(page.url()).origin === new URL(previewUrl).origin) {
          const state = await readHostedState(page, expectedState()).catch(() => null);
          if (state?.code === 'QA_IDENTITY_MISMATCH') return validateState(state);
          if (state?.authenticated) return validateState(state);
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      throw new QaSessionError('QA_AUTH_TIMEOUT', 'Interactive QA authentication did not complete before the bootstrap timeout.');
    } finally {
      if (context) await context.close().catch(() => {});
    }
  });

  return {
    profileDirectory,
    bootstrap: () => run({ bootstrap: true }),
    verify: () => run({ bootstrap: false }),
    reset: () => lockManager.runExclusive(QA_PROFILE_ID, { taskId: 'qa-session-reset' }, async () => {
      assertOwnedProfilePath(profileDirectory, ownedRoot);
      fs.rmSync(profileDirectory, { recursive: true, force: true });
      return { reset: true };
    }),
  };
}

module.exports = {
  DEFAULT_PREVIEW_URL,
  EXPECTED_AGENT_ID,
  EXPECTED_GROUP_ID,
  EXPECTED_PROFILE_ID,
  EXPECTED_TARGET_ID,
  EXPECTED_USERNAME,
  HOSTED_READ_PATHS,
  QA_PROFILE_ID,
  QaSessionError,
  assertOwnedProfilePath,
  createQaPreviewBrowser,
  defaultHostedStateReader,
  defaultProfileDirectory,
  validateState,
};
