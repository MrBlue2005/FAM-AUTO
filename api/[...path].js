'use strict';

// Vercel Node serverless catch-all for the same-origin /api/* BFF surface.
const { createHostedBffApp } = require('../server/hosted-bff');

module.exports = createHostedBffApp();
