const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataPath } = require('../config/storagePaths');

class LocalAgentCredentials {
  constructor(options = {}) { this.filePath = options.filePath || path.join(dataPath, 'localAgentCredentials.json'); }
  load() { return fs.existsSync(this.filePath) ? JSON.parse(fs.readFileSync(this.filePath, 'utf8')) : null; }
  ensure(agentId) {
    const current = this.load();
    if (current?.agent_id === agentId && current.agent_secret) return current;
    const credentials = { version: 1, agent_id: agentId, agent_secret: crypto.randomBytes(32).toString('base64url'), created_at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
    return credentials;
  }
}

module.exports = { LocalAgentCredentials };
