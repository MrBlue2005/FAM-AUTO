const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const {
  CONTINUOUS_MANIFEST_NAME,
  CONTINUOUS_RELEASE_TAG,
  continuousLauncherTarget,
  continuousUpdateInfo,
  continuousUpdateEnvironmentInfo,
  readGitCommit,
  stableReleaseUpdateInfo,
} = require('./update-client');

const appUserModelId = 'com.rxai.studio.launcher';
const studioUrl = 'http://127.0.0.1:5173';
const githubRepository = 'MrBlue2005/FAM-AUTO';
const latestReleaseApi = `https://api.github.com/repos/${githubRepository}/releases/latest`;
const continuousReleaseApi = `https://api.github.com/repos/${githubRepository}/releases/tags/${CONTINUOUS_RELEASE_TAG}`;
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

function currentStudioCommit() {
  const root = resolveStudioRoot();
  const repositoryCommit = readGitCommit(root);
  if (repositoryCommit) return repositoryCommit;
  const markerPaths = [
    path.join(root, '.rx-update-state.json'),
    path.join(root, 'runtime', 'offline-bundle.json'),
  ];
  for (const markerPath of markerPaths) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8').replace(/^\uFEFF/, ''));
      const commit = String(marker.commit || marker.sourceCommit || '');
      if (/^[a-f0-9]{40}$/i.test(commit)) return commit.toLowerCase();
    } catch {
      // A legacy install has no commit marker and receives the first continuous update.
    }
  }
  return null;
}

function continuousLauncherRelativePath() {
  const root = resolveStudioRoot();
  return continuousLauncherTarget({
    root,
    processExecutable: process.execPath,
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    sourceCheckout: fs.existsSync(path.join(root, '.git')),
  });
}

function withContinuousInstallCapability(update) {
  if (!update || update.kind !== 'continuous') return update;
  const sourceCheckout = fs.existsSync(path.join(resolveStudioRoot(), '.git'));
  return continuousUpdateEnvironmentInfo(update, {
    sourceCheckout,
    canAutoInstall: Boolean(continuousLauncherRelativePath()),
  });
}

async function fetchGithubJson(url, notFoundValue = null) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RX-AI-Studio-Launcher',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) return notFoundValue;
  if (!response.ok) throw new Error(`GitHub a raspuns cu status ${response.status}.`);
  return response.json();
}

async function fetchLatestRelease() {
  return fetchGithubJson(latestReleaseApi);
}

async function checkForUpdate() {
  const currentVersion = currentStudioVersion();
  const currentCommit = currentStudioCommit();
  const continuousRelease = await fetchGithubJson(continuousReleaseApi);
  let continuous = null;

  if (continuousRelease) {
    const manifestAsset = (continuousRelease.assets || []).find((asset) => asset.name === CONTINUOUS_MANIFEST_NAME);
    if (manifestAsset?.browser_download_url?.startsWith(releaseAssetPrefix)) {
      const manifest = await fetchGithubJson(`${manifestAsset.browser_download_url}?cache=${Date.now()}`);
      continuous = continuousUpdateInfo({
        release: continuousRelease,
        manifest,
        currentVersion,
        currentCommit,
      });
      continuous = withContinuousInstallCapability(continuous);
      if (continuous.sourceCheckout) return continuous;
      if (continuous.available) return continuous;
    }
  }

  const stable = stableReleaseUpdateInfo(await fetchLatestRelease(), currentVersion);
  if (stable.available) return stable;
  return continuous || stable;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadVerifiedUpdate(update, targetPath, expectedSha256) {
  if (!update.downloadUrl?.startsWith(releaseAssetPrefix)) {
    throw new Error('Adresa pachetului de update nu este valida.');
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error('Update-ul nu contine checksum-ul SHA-256 necesar instalarii sigure.');
  }
  if (update.digest && String(update.digest).toLowerCase() !== `sha256:${expectedSha256.toLowerCase()}`) {
    throw new Error('Checksum-ul GitHub nu coincide cu manifestul update-ului.');
  }
  if (update.expectedSize && update.assetSize !== update.expectedSize) {
    throw new Error('Dimensiunea asset-ului GitHub nu coincide cu manifestul update-ului.');
  }

  const partialPath = `${targetPath}.download`;
  fs.rmSync(partialPath, { force: true });
  const response = await fetch(`${update.downloadUrl}?cache=${Date.now()}`, {
    headers: { 'User-Agent': 'RX-AI-Studio-Launcher' },
    cache: 'no-store',
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`Descarcarea update-ului a esuat (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partialPath));

  if (update.expectedSize && fs.statSync(partialPath).size !== update.expectedSize) {
    fs.rmSync(partialPath, { force: true });
    throw new Error('Pachetul descarcat are o dimensiune diferita de manifest.');
  }
  const actualHash = await sha256File(partialPath);
  if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
    fs.rmSync(partialPath, { force: true });
    throw new Error('Verificarea SHA-256 a update-ului a esuat. Pachetul nu va fi aplicat.');
  }
  fs.rmSync(targetPath, { force: true });
  fs.renameSync(partialPath, targetPath);
  return targetPath;
}

async function launchContinuousUpdater(update, packagePath) {
  const root = resolveStudioRoot();
  const helperSource = path.join(root, 'scripts', 'apply-continuous-update.ps1');
  if (!fs.existsSync(helperSource)) throw new Error('Lipseste componenta locala care aplica update-ul continuu.');

  const relativeLauncherPath = continuousLauncherRelativePath();
  if (!relativeLauncherPath) {
    throw new Error('Aceasta copie ruleaza direct din repository. Actualizeaz-o prin Git; update-ul automat este disponibil in launcherul instalat.');
  }

  const helperPath = path.join(path.dirname(packagePath), `apply-update-${update.latestCommit.slice(0, 12)}.ps1`);
  fs.copyFileSync(helperSource, helperPath);
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', helperPath,
    '-InstallRoot', root,
    '-PackagePath', packagePath,
    '-ExpectedSha256', update.expectedSha256,
    '-ExpectedCommit', update.latestCommit,
    '-ParentProcessId', String(process.pid),
    '-RestartLauncherRelativePath', relativeLauncherPath,
  ], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 500);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  child.unref();
  setTimeout(() => app.quit(), 800);
  return { launched: true, kind: 'continuous', commit: update.latestCommit };
}

async function downloadAndInstallUpdate() {
  if (installingUpdate) throw new Error('Un update este deja in curs de descarcare.');
  installingUpdate = true;
  try {
    const update = await checkForUpdate();
    if (!update.available) throw new Error('Nu exista un update nou disponibil.');

    if (update.kind === 'continuous' && !update.canAutoInstall) {
      throw new Error('Aceasta copie ruleaza direct din repository. Actualizeaz-o prin Git; nu este necesar installerul automat.');
    }

    const updateDirectory = path.join(os.tmpdir(), 'RX-AI-Studio-Updates');
    fs.mkdirSync(updateDirectory, { recursive: true });
    const targetPath = path.join(updateDirectory, update.assetName);

    if (update.kind === 'continuous') {
      await downloadVerifiedUpdate(update, targetPath, update.expectedSha256);
      return launchContinuousUpdater(update, targetPath);
    }

    const expectedDigest = String(update.digest || '');
    if (!/^sha256:[a-f0-9]{64}$/i.test(expectedDigest)) {
      throw new Error('Release-ul nu contine semnatura SHA-256 necesara instalarii sigure.');
    }
    await downloadVerifiedUpdate(update, targetPath, expectedDigest.slice('sha256:'.length));

    const status = await getStatus();
    if (status.anyOnline) await stopStudio();
    const launchError = await shell.openPath(targetPath);
    if (launchError) throw new Error(`Installerul nu a putut porni: ${launchError}`);
    setTimeout(() => app.quit(), 1200);
    return { launched: true, kind: 'installer', version: update.latestVersion };
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
