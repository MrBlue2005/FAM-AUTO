const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { dataPath } = require('../config/storagePaths');

function dpapi(mode, value) {
  const prefix = 'Add-Type -AssemblyName System.Security;';
  const script = mode === 'protect'
    ? `${prefix}$bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`
    : `${prefix}$bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([Console]::In.ReadToEnd()),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($bytes)`;
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], { input: value, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || result.error) throw new Error('Windows DPAPI operation failed.');
  return result.stdout.trim();
}

class LocalAgentCredentials {
  constructor(options = {}) { this.filePath = options.filePath || path.join(dataPath, 'localAgentCredentials.json'); this.platform = options.platform || process.platform; this.dpapi = options.dpapi || dpapi; }
  read() { return fs.existsSync(this.filePath) ? JSON.parse(fs.readFileSync(this.filePath, 'utf8')) : null; }
  write(credentials) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(credentials, null, 2), { mode: 0o600 }); try { fs.chmodSync(temporary, 0o600); } catch {}
    fs.renameSync(temporary, this.filePath); return credentials;
  }
  decode(record) { return record.protection === 'dpapi-current-user' ? this.dpapi('unprotect', record.protected_secret) : record.agent_secret; }
  protect(agentId, secret, createdAt = new Date().toISOString()) {
    if (this.platform === 'win32') return { version: 2, agent_id: agentId, protection: 'dpapi-current-user', protected_secret: this.dpapi('protect', secret), created_at: createdAt };
    return { version: 2, agent_id: agentId, protection: 'file-permissions', agent_secret: secret, created_at: createdAt };
  }
  load() { const record = this.read(); if (!record) return null; return { ...record, agent_secret: this.decode(record) }; }
  ensure(agentId) {
    const current = this.load();
    if (current?.agent_id === agentId && current.agent_secret) {
      if (current.protection !== 'dpapi-current-user' && this.platform === 'win32') this.write(this.protect(agentId, current.agent_secret, current.created_at));
      return this.load();
    }
    const secret = crypto.randomBytes(32).toString('base64url'); this.write(this.protect(agentId, secret)); return this.load();
  }
  stageRotation(agentId, secret = crypto.randomBytes(32).toString('base64url')) {
    const current = this.read() || this.protect(agentId, this.ensure(agentId).agent_secret); const pending = this.protect(agentId, secret, current.created_at);
    current.pending = pending; this.write(current); return secret;
  }
  commitRotation() {
    const current = this.read(); if (!current?.pending) throw new Error('No pending agent credential rotation.');
    const next = { ...current.pending, rotated_at: new Date().toISOString() }; this.write(next); return this.load();
  }
}

module.exports = { LocalAgentCredentials, dpapi };
