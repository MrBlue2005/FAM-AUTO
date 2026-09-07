const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { dataPath } = require('../config/storagePaths');

class ProfileBusyError extends Error {
  constructor(profileId, holder = null) {
    super(`Profile ${profileId} is already executing another task.`);
    this.name = 'ProfileBusyError';
    this.code = 'PROFILE_BUSY';
    this.reason = 'PROFILE_BUSY';
    this.profileId = profileId;
    this.holder = holder;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

class ProfileLockManager {
  constructor(options = {}) {
    this.lockDirectory = options.lockDirectory || path.join(dataPath, 'local-agent-locks');
    this.pid = options.pid || process.pid;
  }

  lockPath(profileId) {
    const digest = crypto.createHash('sha256').update(String(profileId)).digest('hex');
    return path.join(this.lockDirectory, `${digest}.lock`);
  }

  acquire(profileId, details = {}) {
    fs.mkdirSync(this.lockDirectory, { recursive: true });
    const lockPath = this.lockPath(profileId);
    const token = crypto.randomBytes(12).toString('hex');
    const holder = {
      profile_id: profileId,
      pid: this.pid,
      task_id: details.taskId || null,
      acquired_at: new Date().toISOString(),
      token,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle;
      try {
        handle = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(handle, JSON.stringify(holder), 'utf8');
        let released = false;
        return {
          holder,
          release: () => {
            if (released) return;
            released = true;
            fs.closeSync(handle);
            try {
              const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
              if (current.token === token) fs.unlinkSync(lockPath);
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
          },
        };
      } catch (error) {
        if (handle) fs.closeSync(handle);
        if (error.code !== 'EEXIST') throw error;
        let current = null;
        let lockAge = 0;
        try {
          current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          lockAge = Date.now() - fs.statSync(lockPath).mtimeMs;
        } catch {}
        const confirmedDeadOwner = Number.isInteger(Number(current?.pid)) && !isProcessAlive(Number(current.pid));
        const abandonedUnreadableLock = !current?.pid && lockAge > 120000;
        if (attempt === 0 && (confirmedDeadOwner || abandonedUnreadableLock)) {
          try { fs.unlinkSync(lockPath); } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') throw unlinkError;
          }
          continue;
        }
        throw new ProfileBusyError(profileId, current);
      }
    }
    throw new ProfileBusyError(profileId);
  }

  async runExclusive(profileId, details, handler) {
    const lock = this.acquire(profileId, details);
    try {
      return await handler();
    } finally {
      lock.release();
    }
  }
}

module.exports = { ProfileBusyError, ProfileLockManager, isProcessAlive };
