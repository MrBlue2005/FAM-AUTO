const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const appUserModelId = 'com.rxai.studio.launcher';
const studioUrl = 'http://127.0.0.1:5173';
const startupWelcome = process.argv.includes('--startup');
const serviceDefinitions = [
  { id: 'api', name: 'API Robot', url: 'http://127.0.0.1:3000/readyz' },
  { id: 'dashboard', name: 'Dashboard', url: 'http://127.0.0.1:5173/' },
  { id: 'generator', name: 'Generator descrieri', url: 'http://127.0.0.1:3100/' },
];

let mainWindow = null;
let starting = false;
let stopping = false;
let startupWindowShownAt = 0;

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
    await shell.openExternal(studioUrl);
    closeStartupWelcomeAfterLaunch();
    return { ...current, reused: true };
  }

  starting = true;
  sendStatus({ ...current, starting: true });

  try {
    const root = resolveStudioRoot();
    const child = spawn('node', ['--env-file-if-exists=.env', 'scripts/start-studio.js'], {
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
    await shell.openExternal(studioUrl);
    closeStartupWelcomeAfterLaunch();
    return ready;
  } catch (error) {
    throw new Error(`Pornirea Studio a esuat: ${error.message}`);
  } finally {
    starting = false;
    sendStatus(await getStatus());
  }
}

function closeStartupWelcomeAfterLaunch() {
  if (!startupWelcome) return;
  const minimumWelcomeMs = 2600;
  const elapsed = Date.now() - startupWindowShownAt;
  const delay = Math.max(900, minimumWelcomeMs - elapsed);

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  }, delay);
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
    const child = spawn('node', ['scripts/stop-studio.js'], {
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
    height: 610,
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
    startupWindowShownAt = Date.now();
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
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());
