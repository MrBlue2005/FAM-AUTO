'use strict';

const crypto = require('crypto');

const targets = {
  agent: 'agent_0MTT7WJ1G63C9E6C3DF7568ADCE61',
  profile: 'profile_0MTT7WJ1KE0AE5FD81754B96F9656',
};

for (const [name, id] of Object.entries(targets)) {
  const normalized = id.trim();
  const fingerprint = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  process.stdout.write(`${name}Length=${normalized.length}\n${name}Fingerprint=${fingerprint}\n`);
}
