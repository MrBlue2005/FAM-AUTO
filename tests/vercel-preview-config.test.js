'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');

test('Vercel preview configuration builds the dashboard and preserves filesystem API routing before SPA fallback', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(config.buildCommand, 'npm --prefix dashboard-v2 run build');
  assert.equal(config.outputDirectory, 'dashboard-v2/dist');
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'api', '[...path].js')));
});
