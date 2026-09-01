const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const appUserModelId = 'com.rxai.studio.launcher';
const studioUrl = 'http://127.0.0.1:5173';
const githubRepository = 'MrBlue2005/FAM-AUTO';
const latestReleaseApi = `https://api.github.com/repos/${githubRepository}/releases/latest`;
const releaseAssetPrefix = `https://github.com/${githubRepository}/releases/download/`;
const startupWelcome = process.argv.includes('--startup');
const serviceDefinitions = [
  { id: 'api', name: 'API Robot', url: 'http://127.0.0.1:3000/readyz' },
  { id: 'dashboard', name: 'Dashboard', url: 'http://127.0.0.1:5173/' },
  { id: 'generator', name: 'Generator descrieri', url: 'http://127.0.0.1:3100/' },
];

let mainWindow = null;
let starting = false;
let stopping = false;
let installingUpdate = false;

if (process.platform === 'win32') app.setAppUserModelId(appUserModelId);

function isStudioRoot(candidate) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
    return manifest.name === 'facebook-automation' && fs.existsSync(path.join(candidate, 'scripts', 'start-studio.js'));
  } catch {
    return false;
  }
}

function resolveStudioRoot() {
  const executableDirectory = path.dirname(process.execPath);
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const candidates = [
    process.env.RX_STUDIO_ROOT,
    path.resolve(__dirname, '..', '..'),
    portableDirectory && path.resolve(portableDirectory, '..', '..', '..'),
    path.resolve(executableDirectory, '..', '..', '..'),
    path.resolve(executableDirectory, '..', '..', '..', '..'),
    process.cwd(),
  ].filter(Boolean);

  const root = candidates.find(isStudioRoot);
  if (!root) {
    throw new Error('Folderul RX AI Studio nu a fost gasit. Pastreaza launcherul in folderul proiectului si reconstruieste-l.');
  }
  return root;
}

function resolveNodeExecutable(root) {
  const bundledNode = path.join(root, 'runtime', 'node', 'node.exe');
  if (process.platform === 'win32' && fs.existsSync(bundledNode)) return bundledNode;
  return process.env.RX_NODE_EXE || 'node';
}

function currentStudioVersion() {
  const manifest = JSON.parse(fs.readFileSync(path.join(resolveStudioRoot(), 'package.json'), 'utf8'));
  return String(manifest.version || '0.0.0');
}

function versionParts(value) {
  return String(value).replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

async function fetchLatestRelease() {
  const response = await fetch(latestReleaseApi, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RX-AI-Studio-Launcher',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub a raspuns cu status ${response.status}.`);
  return response.json();
}

function releaseUpdateInfo(release) {
  const currentVersion = currentStudioVersion();
  if (!release) return { currentVersion, available: false, noRelease: true };
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  const assetName = `RX-AI-Studio-Offline-Setup-${latestVersion}.exe`;
  const asset = (release.assets || []).find((item) => item.name === assetName);
  const available = isNewerVersion(latestVersion, currentVersion) && Boolean(asset);
  return {
    currentVersion,
    latestVersion,
    available,
    assetName: asset?.name,
    assetSize: asset?.size,
    releaseUrl: release.html_url,
    downloadUrl: asset?.browser_download_url,
    digest: asset?.digest,
  };
}

async function checkForUpdate() {
  return releaseUpdateInfo(await fetchLatestRelease());
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadAndInstallUpdate() {
  if (installingUpdate) throw new Error('Un update este deja in curs de descarcare.');
  installingUpdate = true;
  try {
    const update = await checkForUpdate();
    if (!update.available) throw new Error('Nu exista un update nou disponibil.');
    if (!update.downloadUrl?.startsWith(releaseAssetPrefix)) {
      throw new Error('Adresa pachetului de update nu este valida.');
    }
    const expectedDigest = String(update.digest || '');
    if (!/^sha256:[a-f0-9]{64}$/i.test(expectedDigest)) {
      throw new Error('Release-ul nu contine semnatura SHA-256 necesara instalarii sigure.');
    }

    const updateDirectory = path.join(os.tmpdir(), 'RX-AI-Studio-Updates');
    fs.mkdirSync(updateDirectory, { recursive: true });
    const installerPath = path.join(updateDirectory, update.assetName);
    const partialPath = `${installerPath}.download`;
    fs.rmSync(partialPath, { force: true });

    const response = await fetch(update.downloadUrl, {
      headers: { 'User-Agent': 'RX-AI-Studio-Launcher' },
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok || !response.body) throw new Error(`Descarcarea update-ului a esuat (${response.status}).`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partialPath));

    const actualHash = await sha256File(partialPath);
    const requiredHash = expectedDigest.slice('sha256:'.length).toLowerCase();
    if (actualHash.toLowerCase() !== requiredHash) {
      fs.rmSync(partialPath, { force: true });
      throw new Error('Verificarea SHA-256 a update-ului a esuat. Fisierul nu va fi rulat.');
    }
    fs.rmSync(installerPath, { force: true });
    fs.renameSync(partialPath, installerPath);

    const status = await getStatus();
    if (status.anyOnline) await stopStudio();
    const launchError = await shell.openPath(installerPath);
    if (launchError) throw new Error(`Installerul nu a putut porni: ${launchError}`);
    setTimeout(() => app.quit(), 1200);
    return { launched: true, version: update.latestVersion };
  } finally {
    installingUpdate = false;
  }
}

async function serviceOnline(service) {
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function getStatus() {
  const services = await Promise.all(serviceDefinitions.map(async (service) => ({
    ...service,
    online: await serviceOnline(service),
  })));
  return {
    services,
    allOnline: services.every((service) => service.online),
    anyOnline: services.some((service) => service.online),
    starting,
    stopping,
  };
}

function sendStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('studio:status-changed', status);
}

async function waitForStudio(timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getStatus();
    sendStatus(status);
    if (status.allOnline) return status;
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  throw new Error('Studio nu a pornit in 60 de secunde. Verifica instalarea Node.js si dependentele proiectului.');
}

async function startStudio() {
  const current = await getStatus();
  if (starting || stopping) return current;
  if (current.allOnline) {
    if (!startupWelcome) await shell.openExternal(studioUrl);
    return { ...current, reused: true };
  }

  starting = true;
  sendStatus({ ...current, starting: true });

  try {
    const root = resolveStudioRoot();
    const child = spawn(resolveNodeExecutable(root), ['--env-file-if-exists=.env', 'scripts/start-studio.js'], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        RX_STUDIO_BACKGROUND: '1',
      },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 400);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    child.unref();

    const ready = await waitForStudio();
    if (!startupWelcome) await shell.openExternal(studioUrl);
    return ready;
  } catch (error) {
    throw new Error(`Pornirea Studio a esuat: ${error.message}`);
  } finally {
    starting = false;
    sendStatus(await getStatus());
  }
}

async function waitForStudioStop(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getStatus();
    sendStatus(status);
    if (!status.anyOnline) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Unele servicii nu s-au oprit in 20 de secunde.');
}

async function stopStudio() {
  const current = await getStatus();
  if (!current.anyOnline) return current;
  if (starting || stopping) return current;

  stopping = true;
  sendStatus({ ...current, stopping: true });

  try {
    const root = resolveStudioRoot();
    const child = spawn(resolveNodeExecutable(root), ['scripts/stop-studio.js'], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
      env: process.env,
    });

    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Scriptul de oprire s-a inchis cu codul ${code}.`));
      });
    });

    return await waitForStudioStop();
  } catch (error) {
    throw new Error(`Oprirea Studio a esuat: ${error.message}`);
  } finally {
    stopping = false;
    sendStatus(await getStatus());
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 700,
    minWidth: 520,
    minHeight: 520,
    show: false,
    frame: false,
    fullscreen: startupWelcome,
    alwaysOnTop: startupWelcome,
    skipTaskbar: startupWelcome,
    transparent: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (startupWelcome) {
      mainWindow.setFullScreen(true);
      mainWindow.focus();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  void getStatus().then(sendStatus);
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', showWindow);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('studio:get-status', () => getStatus());
ipcMain.handle('studio:start', () => startStudio());
ipcMain.handle('studio:stop', () => stopStudio());
ipcMain.handle('studio:open', async () => {
  await shell.openExternal(studioUrl);
  return true;
});
ipcMain.handle('studio:is-startup-launch', () => startupWelcome);
ipcMain.handle('studio:check-update', () => checkForUpdate());
ipcMain.handle('studio:install-update', () => downloadAndInstallUpdate());
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());
