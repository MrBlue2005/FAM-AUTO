'use strict';

// Creates this machine's independent agent identity and DPAPI-protected secret.
// It never enrolls, prints, or persists an enrollment token.
const { bootstrapLocalAgent } = require('../app/local-agent/bootstrap');

const result = bootstrapLocalAgent();
console.log(`Local Agent bootstrap ready: ${result.agentId}`);
console.log('DPAPI credential storage is machine/user-bound. Obtain a one-time enrollment token separately, then run npm.cmd run agent:http.');
