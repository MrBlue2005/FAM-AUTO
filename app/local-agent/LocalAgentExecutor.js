const { ProfileLockManager } = require('./ProfileLockManager');

class LocalAgentExecutor {
  constructor(options = {}) {
    this.lockManager = options.lockManager || new ProfileLockManager();
  }

  async runProfile(profileId, handler, details = {}) {
    const lock = this.lockManager.acquire(profileId, details);
    try {
      if (typeof details.onAcquired === 'function') details.onAcquired();
      return await handler();
    } finally {
      try { lock.release(); }
      finally { if (typeof details.onReleased === 'function') details.onReleased(); }
    }
  }
}

module.exports = { LocalAgentExecutor };
