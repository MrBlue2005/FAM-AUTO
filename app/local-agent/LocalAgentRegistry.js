const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { dataPath, profilesPath } = require('../config/storagePaths');
const { createIdentity } = require('./identity');
const { normalizeExpectedFacebookAccountId } = require('./FacebookIdentityConfig');

const PROFILE_STATES = Object.freeze({
  READY: 'READY',
  BUSY: 'BUSY',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR',
  NEEDS_LOGIN: 'NEEDS_LOGIN',
});

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

class LocalAgentRegistry {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(dataPath, 'localAgentRegistry.json');
    this.profilesRoot = options.profilesRoot || profilesPath;
    this.now = options.now || (() => new Date());
    this.createId = options.createId || createIdentity;
  }

  read() {
    if (!fs.existsSync(this.filePath)) return null;
    const text = fs.readFileSync(this.filePath, 'utf8');
    return text.trim() ? JSON.parse(text) : null;
  }

  resolveRuntimePath(profile) {
    const configuredPath = profile?.profilePath || 'chrome-profile';
    return path.isAbsolute(configuredPath)
      ? path.resolve(configuredPath)
      : path.resolve(this.profilesRoot, configuredPath);
  }

  load(runtimeProfiles = []) {
    const now = this.now().toISOString();
    const existing = this.read();
    const registry = existing || {
      version: 1,
      agent: {
        agentId: this.createId('agent'),
        displayName: `RX Agent - ${os.hostname()}`,
        createdAt: now,
      },
      profiles: [],
    };

    registry.version = 1;
    registry.agent = registry.agent || {
      agentId: this.createId('agent'),
      displayName: `RX Agent - ${os.hostname()}`,
      createdAt: now,
    };
    registry.profiles = Array.isArray(registry.profiles) ? registry.profiles : [];

    for (const runtimeProfile of runtimeProfiles) {
      const legacyProfileId = String(runtimeProfile.id || 'main');
      const localProfilePath = this.resolveRuntimePath(runtimeProfile);
      const expectedFacebookAccountId = normalizeExpectedFacebookAccountId(runtimeProfile.expectedFacebookAccountId);
      const normalizedLocalPath = normalizePath(localProfilePath);
      let entry = registry.profiles.find((profile) =>
        normalizePath(profile.localProfilePath) === normalizedLocalPath
      );

      if (!entry) {
        entry = registry.profiles.find((profile) =>
          (profile.legacyProfileIds || [profile.legacyProfileId]).filter(Boolean).includes(legacyProfileId)
        );
      }

      if (!entry) {
        entry = {
          profileId: this.createId('profile'),
          legacyProfileIds: [legacyProfileId],
          displayName: runtimeProfile.label || legacyProfileId,
          localProfilePath,
          status: PROFILE_STATES.READY,
          adoptedAt: now,
          updatedAt: now,
        };
        registry.profiles.push(entry);
      } else {
        entry.legacyProfileIds = [...new Set([
          ...(entry.legacyProfileIds || [entry.legacyProfileId]).filter(Boolean),
          legacyProfileId,
        ])];
        delete entry.legacyProfileId;
        entry.displayName = runtimeProfile.label || entry.displayName || legacyProfileId;
        entry.localProfilePath = localProfilePath;
        entry.status = entry.status || PROFILE_STATES.READY;
        entry.updatedAt = now;
      }
      if (expectedFacebookAccountId) entry.expectedFacebookAccountId = expectedFacebookAccountId;
      else delete entry.expectedFacebookAccountId;
    }

    atomicWriteJson(this.filePath, registry);
    return registry;
  }

  getProfileByRuntimeId(runtimeProfileId, runtimeProfiles = []) {
    const registry = this.load(runtimeProfiles);
    return registry.profiles.find((profile) =>
      (profile.legacyProfileIds || []).includes(String(runtimeProfileId))
    ) || null;
  }

  getProfile(profileId, runtimeProfiles = []) {
    return this.load(runtimeProfiles).profiles.find((profile) => profile.profileId === profileId) || null;
  }

  getSafeMetadata(runtimeProfiles = [], busyProfileIds = []) {
    const registry = this.load(runtimeProfiles);
    const busy = new Set(busyProfileIds);
    return {
      agent_id: registry.agent.agentId,
      display_name: registry.agent.displayName,
      status: busy.size ? 'BUSY' : 'ONLINE',
      profiles: registry.profiles.map((profile) => ({
        profile_id: profile.profileId,
        display_name: profile.displayName,
        status: busy.has(profile.profileId) ? PROFILE_STATES.BUSY : profile.status,
      })),
    };
  }
}

module.exports = { LocalAgentRegistry, PROFILE_STATES };
