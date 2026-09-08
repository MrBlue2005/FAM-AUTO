'use strict';

// Reads the supplied hash only from the environment and emits safe comparison
// metadata. It never prints the supplied hash or any password.
const { hostedAuthDiagnostic } = require('../server/hosted-bff');

if (typeof process.env.ADMIN_PASSWORD_SCRYPT !== 'string') {
  console.error('Set ADMIN_PASSWORD_SCRYPT in the environment before running this helper.');
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(hostedAuthDiagnostic(process.env)));
}
