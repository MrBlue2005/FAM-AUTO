const { ProfileLockManager } = require('./ProfileLockManager');

class LocalAgentExecutor {
  constructor(options = {}) {
    this.lockManager = options.lockManager || new ProfileLockManager();
  }

  async runProfile(profileId, handler, details = {}) {
    return this.lockManager.runExclusive(profileId, details, handler);
  }
}

module.exports = { LocalAgentExecutor };
