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
    const overlayControlWithoutCsrf = await fetch(`http://127.0.0.1:${port}/api/robot/pause-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-overlay-token': overlayToken },
      body: JSON.stringify({ profileId: 'main' }),
    });
    assert.equal(overlayControlWithoutCsrf.status, 403);
    const overlayProfileControl = await fetch(`http://127.0.0.1:${port}/api/robot/pause-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-overlay-token': overlayToken, 'x-rx-csrf': '1' },
      body: JSON.stringify({ profileId: 'main' }),
    });
    assert.equal(overlayProfileControl.status, 200);
    const overlayControlPreflight = await fetch(`http://127.0.0.1:${port}/api/robot/pause-profile`, {
      method: 'OPTIONS',
      headers: {
        origin: 'null',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-overlay-token,x-rx-csrf',
      },
    });
    assert.equal(overlayControlPreflight.status, 204);
    assert.equal(overlayControlPreflight.headers.get('access-control-allow-origin'), 'null');
    const overlayTokenCannotMutateOtherApis = await fetch(`http://127.0.0.1:${port}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-overlay-token': overlayToken, 'x-rx-csrf': '1' },
      body: '[]',
    });
    assert.equal(overlayTokenCannotMutateOtherApis.status, 401);

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
    const folderCreated = await fetch(`http://127.0.0.1:${port}/api/schedule-folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({ name: 'Programari internationale' }),
    });
    assert.equal(folderCreated.status, 201);
    const folder = await folderCreated.json();
    assert.match(folder.id, /^SCHEDULE_FOLDER_/);
    const propertyCreated = await fetch(`http://127.0.0.1:${port}/api/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({ id: 'SCHEDULE_FOLDER_PROPERTY', name: 'Property folder test', active: true, posts: [] }),
    });
    assert.equal(propertyCreated.status, 200);
    const scheduleCreated = await fetch(`http://127.0.0.1:${port}/api/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({
        name: 'Programare mutata in folder', enabled: false, daysOfWeek: [1], time: '09:00',
        campaignCategory: 'real_estate', campaignIds: ['SCHEDULE_FOLDER_PROPERTY'], facebookProfileId: 'main',
        campaignDay: 1, groupLimit: 1, startFromGroup: 1, publishEnabled: false,
      }),
    });
    assert.equal(scheduleCreated.status, 201);
    const schedule = await scheduleCreated.json();
    const scheduleMoved = await fetch(`http://127.0.0.1:${port}/api/schedules/${schedule.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({ ...schedule, folderId: folder.id }),
    });
    assert.equal(scheduleMoved.status, 200);
    assert.equal((await scheduleMoved.json()).folderId, folder.id);
    const schedulesWithFolder = await fetch(`http://127.0.0.1:${port}/api/schedules`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(schedulesWithFolder.status, 200);
    assert.ok((await schedulesWithFolder.json()).folders.some((item) => item.id === folder.id));
    const folderDeleted = await fetch(`http://127.0.0.1:${port}/api/schedule-folders/${folder.id}`, {
      method: 'DELETE',
      headers: { cookie: sessionCookie, 'x-rx-csrf': '1' },
    });
    assert.equal(folderDeleted.status, 200);
    const schedulesAfterFolderDelete = await fetch(`http://127.0.0.1:${port}/api/schedules`, {
      headers: { cookie: sessionCookie },
    });
    const restoredSchedule = (await schedulesAfterFolderDelete.json()).schedules.find((item) => item.id === schedule.id);
    assert.equal(restoredSchedule.folderId, null);
    const transferCreated = await fetch(`http://127.0.0.1:${port}/api/property-description-transfers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({
        sourceTitle: 'Proprietate test',
        transactionType: 'sale',
        descriptions: [
          { title: 'Comercial', text: 'Descriere comerciala' },
          { title: 'Emotional', text: 'Descriere emotionala' },
          { title: 'Premium', text: 'Descriere premium' },
        ],
      }),
    });
    assert.equal(transferCreated.status, 201);
    const transferReference = await transferCreated.json();
    assert.match(transferReference.id, /^[0-9a-f-]{36}$/i);
    const transferredDescriptions = await fetch(
      `http://127.0.0.1:${port}/api/property-description-transfers/${transferReference.id}`,
      { headers: { cookie: sessionCookie } }
    );
    assert.equal(transferredDescriptions.status, 200);
    const transferBody = await transferredDescriptions.json();
    assert.deepEqual(transferBody.descriptions.map((item) => item.day), [1, 2, 3]);
    assert.equal(transferBody.descriptions[2].text, 'Descriere premium');
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
