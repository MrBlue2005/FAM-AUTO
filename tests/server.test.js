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
    const sharedMediaPropertyCreated = await fetch(`http://127.0.0.1:${port}/api/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({
        id: 'SHARED_MEDIA_COPY', name: 'Property media copy', active: true,
        posts: [{
          day: 1,
          imagePath: 'app/uploads/SCHEDULE_FOLDER_PROPERTY/day-1/test-image.png',
          media: ['app/uploads/SCHEDULE_FOLDER_PROPERTY/day-1/test-image.png'],
        }],
      }),
    });
    assert.equal(sharedMediaPropertyCreated.status, 200);
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
    const runtimeBeforeRename = await fetch(`http://127.0.0.1:${port}/api/runtime-config`, {
      headers: { cookie: sessionCookie },
    }).then((response) => response.json());
    const runtimeConfigured = await fetch(`http://127.0.0.1:${port}/api/runtime-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({
        ...runtimeBeforeRename,
        campaignCategory: 'real_estate',
        selectedPropertyIds: ['SCHEDULE_FOLDER_PROPERTY'],
        queueExcludedTaskIds: ['main::SCHEDULE_FOLDER_PROPERTY::G1'],
        queueRetryTaskIds: ['SCHEDULE_FOLDER_PROPERTY::G2'],
        queueOrder: ['main::SCHEDULE_FOLDER_PROPERTY::G1'],
      }),
    });
    assert.equal(runtimeConfigured.status, 200);
    const originalMediaDirectory = path.join(storageRoot, 'uploads', 'SCHEDULE_FOLDER_PROPERTY', 'day-1');
    fs.mkdirSync(originalMediaDirectory, { recursive: true });
    fs.writeFileSync(path.join(originalMediaDirectory, 'test-image.png'), 'test-media');
    const propertyRenamed = await fetch(`http://127.0.0.1:${port}/api/properties/SCHEDULE_FOLDER_PROPERTY`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({
        id: 'PROPERTY_SHORT', name: 'Property folder test', active: true,
        posts: [{
          day: 1,
          imagePath: 'app/uploads/SCHEDULE_FOLDER_PROPERTY/day-1/test-image.png',
          media: ['app/uploads/SCHEDULE_FOLDER_PROPERTY/day-1/test-image.png'],
        }],
      }),
    });
    assert.equal(propertyRenamed.status, 200);
    const renamedProperty = await propertyRenamed.json();
    assert.equal(renamedProperty.id, 'PROPERTY_SHORT');
    assert.equal(renamedProperty.posts[0].imagePath, 'app/uploads/PROPERTY_SHORT/day-1/test-image.png');
    assert.equal(fs.existsSync(path.join(storageRoot, 'uploads', 'SCHEDULE_FOLDER_PROPERTY')), false);
    assert.equal(fs.existsSync(path.join(storageRoot, 'uploads', 'PROPERTY_SHORT', 'day-1', 'test-image.png')), true);
    const propertiesAfterRename = await fetch(`http://127.0.0.1:${port}/api/properties`, {
      headers: { cookie: sessionCookie },
    }).then((response) => response.json());
    assert.equal(propertiesAfterRename.some((item) => item.id === 'SCHEDULE_FOLDER_PROPERTY'), false);
    assert.equal(propertiesAfterRename.some((item) => item.id === 'PROPERTY_SHORT'), true);
    const sharedMediaProperty = propertiesAfterRename.find((item) => item.id === 'SHARED_MEDIA_COPY');
    assert.equal(sharedMediaProperty.posts[0].imagePath, 'app/uploads/PROPERTY_SHORT/day-1/test-image.png');
    assert.deepEqual(sharedMediaProperty.posts[0].media, ['app/uploads/PROPERTY_SHORT/day-1/test-image.png']);
    const runtimeAfterRename = await fetch(`http://127.0.0.1:${port}/api/runtime-config`, {
      headers: { cookie: sessionCookie },
    }).then((response) => response.json());
    assert.deepEqual(runtimeAfterRename.selectedPropertyIds, ['PROPERTY_SHORT']);
    assert.deepEqual(runtimeAfterRename.queueExcludedTaskIds, ['main::PROPERTY_SHORT::G1']);
    assert.deepEqual(runtimeAfterRename.queueRetryTaskIds, ['PROPERTY_SHORT::G2']);
    assert.deepEqual(runtimeAfterRename.queueOrder, ['main::PROPERTY_SHORT::G1']);
    const schedulesWithFolder = await fetch(`http://127.0.0.1:${port}/api/schedules`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(schedulesWithFolder.status, 200);
    const schedulesWithFolderBody = await schedulesWithFolder.json();
    assert.ok(schedulesWithFolderBody.folders.some((item) => item.id === folder.id));
    assert.deepEqual(schedulesWithFolderBody.schedules.find((item) => item.id === schedule.id).campaignIds, ['PROPERTY_SHORT']);
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
    const diagnosticGroups = await fetch(`http://127.0.0.1:${port}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify([{
        id: 'DIAGNOSTIC_GROUP', name: 'Diagnostic group', active: true,
        category: 'real_estate', groupListCategory: 'Romania', url: 'https://www.facebook.com/groups/diagnostic-test',
      }]),
    });
    assert.equal(diagnosticGroups.status, 200);
    const brokenPropertyCreated = await fetch(`http://127.0.0.1:${port}/api/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({
        id: 'BROKEN_MEDIA_PROPERTY', name: 'Broken media property', active: true, transactionType: 'sale', facebookProfileId: 'main',
        posts: [{ day: 1, text: 'Test', imagePath: 'app/uploads/missing/file.png', media: ['app/uploads/missing/file.png'] }],
      }),
    });
    assert.equal(brokenPropertyCreated.status, 200);
    const blockedScheduleCreated = await fetch(`http://127.0.0.1:${port}/api/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: JSON.stringify({
        name: 'Programare cu media lipsa', enabled: false, daysOfWeek: [1], time: '10:00',
        campaignCategory: 'real_estate', groupListCategory: 'Romania', campaignIds: ['BROKEN_MEDIA_PROPERTY'],
        facebookProfileId: 'main', campaignDay: 1, groupLimit: 1, startFromGroup: 1, publishEnabled: false,
      }),
    });
    assert.equal(blockedScheduleCreated.status, 201);
    const blockedSchedule = await blockedScheduleCreated.json();
    const blockedRun = await fetch(`http://127.0.0.1:${port}/api/schedules/${blockedSchedule.id}/run-now`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'x-rx-csrf': '1' },
      body: '{}',
    });
    assert.equal(blockedRun.status, 200);
    assert.equal((await blockedRun.json()).lastStatus, 'blocked');
    const scheduledDiagnostics = await fetch(`http://127.0.0.1:${port}/api/diagnostics`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(scheduledDiagnostics.status, 200);
    const scheduledDiagnosticsBody = await scheduledDiagnostics.json();
    assert.ok(scheduledDiagnosticsBody.issues.some((issue) =>
      issue.code === 'MEDIA_NOT_FOUND' && issue.scheduleName === 'Programare cu media lipsa'
    ));
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
