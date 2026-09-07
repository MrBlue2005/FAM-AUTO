const crypto = require('crypto');

function createIdentity(prefix) {
  const timestamp = Date.now().toString(36).toUpperCase().padStart(9, '0');
  const entropy = crypto.randomBytes(10).toString('hex').toUpperCase();
  return `${prefix}_${timestamp}${entropy}`;
}

module.exports = { createIdentity };
