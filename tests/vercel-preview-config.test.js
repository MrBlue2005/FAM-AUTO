'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');

test('Vercel preview routes API paths to the catch-all function before the SPA fallback', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(config.buildCommand, 'npm ci --prefix dashboard-v2 --include=dev && npm --prefix dashboard-v2 run build');
  assert.equal(config.outputDirectory, 'dashboard-v2/dist');
  assert.deepEqual(config.routes, [
    { src: '/api', dest: '/api/[...path].js' },
    { src: '/api/(.*)', dest: '/api/[...path].js' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ]);
  const destination = (pathname) => pathname === '/api' || pathname.startsWith('/api/')
    ? '/api/[...path].js' : '/index.html';
  assert.equal(destination('/api/auth/session'), '/api/[...path].js');
  assert.equal(destination('/api/unknown'), '/api/[...path].js');
  assert.equal(destination('/some/dashboard/deep/link'), '/index.html');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'api', '[...path].js')));
});
