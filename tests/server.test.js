const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const rootPath = path.join(__dirname, '..');

function passwordScrypt(password) {
  const salt = crypto.randomBytes(16);
  const options = { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64, options).toString('hex')}`;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url, child, getOutput) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server stopped early with ${child.exitCode}.\n${getOutput()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production test server did not become ready.\n${getOutput()}`);
}

test('production server requires auth and shuts down cleanly', { timeout: 60000 }, async () => {
  const port = await freePort();
const password = 'production-test-password';
  const passwordHash = passwordScrypt(password);
  const overlayToken = crypto.createHmac('sha256', passwordHash)
    .update('rx-propulse-overlay-v1')
    .digest('hex');
  const storageRoot = path.join(rootPath, '.tmp', 'server-test', String(port));
  let output = '';
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: rootPath,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      AUTH_ENABLED: 'true',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_SCRYPT: passwordHash,
      RX_DATA_PATH: path.join(storageRoot, 'data'),
      RX_LOGS_PATH: path.join(storageRoot, 'logs'),
      RX_UPLOADS_PATH: path.join(storageRoot, 'uploads'),
      RX_PROFILES_PATH: path.join(storageRoot, 'profiles'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8000); });

  try {
    await waitFor(`http://127.0.0.1:${port}/readyz`, child, () => output);
    if (fs.existsSync(path.join(rootPath, 'dashboard-v2', 'dist', 'index.html'))) {
      const dashboard = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(dashboard.status, 200);
      assert.match(await dashboard.text(), /<div id="root"><\/div>/);
      assert.match(dashboard.headers.get('content-security-policy'), /default-src 'self'/);
    }
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/properties`);
    assert.equal(unauthorized.status, 401);
    const unauthorizedMedia = await fetch(`http://127.0.0.1:${port}/uploads/private-file.png`);
assert.equal(unauthorizedMedia.status, 401);
    const overlayStatus = await fetch(`http://127.0.0.1:${port}/api/overlay/status`, {
      headers: { 'x-overlay-token': overlayToken },
    });
    assert.equal(overlayStatus.status, 200);
    const overlayTokenCannotReadOtherApis = await fetch(`http://127.0.0.1:${port}/api/properties`, {
      headers: { 'x-overlay-token': overlayToken },
    });
    assert.equal(overlayTokenCannotReadOtherApis.status, 401);

    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /rx_session=.*HttpOnly.*SameSite=Strict.*Secure/i);
    const loginBody = await login.json();
    assert.equal(loginBody.username, 'admin');
    assert.equal(loginBody.role, 'admin');
    assert.equal('token' in loginBody, false);

    const sessionCookie = setCookie.split(';')[0];
    const authorized = await fetch(`http://127.0.0.1:${port}/api/properties`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(authorized.status, 200);
    const csrfRejected = await fetch(`http://127.0.0.1:${port}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      body: '[]',
    });
    assert.equal(csrfRejected.status, 403);
    const csrfAccepted = await fetch(`http://127.0.0.1:${port}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: '[]',
    });
    assert.equal(csrfAccepted.status, 200);
    const authorizedMedia = await fetch(`http://127.0.0.1:${port}/uploads/private-file.png`, {
      headers: { cookie: setCookie.split(';')[0] },
    });
    assert.equal(authorizedMedia.status, 404);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    const exit = await new Promise((resolve) => {
      if (child.exitCode !== null) resolve({ code: child.exitCode, signal: child.signalCode });
      else child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (process.platform === 'win32') assert.equal(exit.signal, 'SIGTERM');
    else assert.equal(exit.code, 0);
  }
});
