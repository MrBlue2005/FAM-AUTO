const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');

const protocolName = 'rx-ai-overlay';
const appUserModelId = 'com.rxai.overlay';
const appIconPath = path.join(__dirname, 'build', 'icon.png');

if (process.platform === 'win32') {
  app.setAppUserModelId(appUserModelId);
}

const sizePresets = {
  compact: {
    width: 620,
    height: 580,
  },
  medium: {
    width: 780,
    height: 640,
  },
  large: {
    width: 940,
    height: 720,
  },
};

const defaultSettings = {
  apiUrl: 'http://127.0.0.1:3000/api',
  apiKey: '',
  sizePreset: 'medium',
  width: sizePresets.medium.width,
  height: sizePresets.medium.height,
  opacity: 0.92,
  alwaysOnTop: true,
  notifications: {
    errors: true,
    warnings: true,
    success: false,
    status: true,
  },
};

let overlayWindow = null;

function clamp(number, min, max) {
  return Math.min(Math.max(Number(number), min), max);
}

function isSafeExternalUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'overlay-settings.json');
}

function normalizeSettings(settings = {}) {
  const sizePreset = sizePresets[settings.sizePreset]
    ? settings.sizePreset
    : defaultSettings.sizePreset;
  const presetSize = sizePresets[sizePreset];

  return {
    ...defaultSettings,
    ...settings,
    sizePreset,
    width: presetSize.width,
    height: presetSize.height,
    opacity: clamp(settings.opacity || defaultSettings.opacity, 0.35, 1),
    alwaysOnTop: settings.alwaysOnTop !== false,
    notifications: {
      ...defaultSettings.notifications,
      ...(settings.notifications || {}),
    },
  };
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings(defaultSettings);
  }
}

function writeSettings(nextSettings) {
  const settings = normalizeSettings(nextSettings);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  return settings;
}

function applyWindowSettings(settings) {
  if (!overlayWindow) return;

  const nextSettings = normalizeSettings(settings);
  const bounds = overlayWindow.getBounds();

  overlayWindow.setOpacity(nextSettings.opacity);
  overlayWindow.setAlwaysOnTop(nextSettings.alwaysOnTop, 'screen-saver');
  overlayWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: nextSettings.width,
    height: nextSettings.height,
  });
}

function registerProtocol() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(protocolName, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    return;
  }

  app.setAsDefaultProtocolClient(protocolName);
}

function createOverlayWindow() {
  const settings = readSettings();
  const rendererUrl = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).toString();

  overlayWindow = new BrowserWindow({
    width: settings.width,
    height: settings.height,
    minWidth: sizePresets.compact.width,
    minHeight: sizePresets.compact.height,
    transparent: true,
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  overlayWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  overlayWindow.loadURL(rendererUrl);

  overlayWindow.once('ready-to-show', () => {
    applyWindowSettings(settings);
    overlayWindow.show();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function showOverlayWindow() {
  if (!overlayWindow) {
    createOverlayWindow();
    return;
  }

  if (overlayWindow.isMinimized()) {
    overlayWindow.restore();
  }

  overlayWindow.show();
  overlayWindow.focus();
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showOverlayWindow);

  app.whenReady().then(() => {
    registerProtocol();
    createOverlayWindow();

    app.on('activate', showOverlayWindow);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('overlay:get-settings', () => readSettings());

ipcMain.handle('overlay:save-settings', (_event, settings) => {
  const savedSettings = writeSettings(settings);
  applyWindowSettings(savedSettings);
  return savedSettings;
});

ipcMain.handle('overlay:minimize', () => {
  overlayWindow?.minimize();
});

ipcMain.handle('overlay:close', () => {
  overlayWindow?.close();
});

ipcMain.handle('overlay:open-external', (_event, url) => {
  if (!isSafeExternalUrl(url)) return false;
  shell.openExternal(url);
  return true;
});

ipcMain.handle('overlay:notify', (_event, payload = {}) => {
  if (!Notification.isSupported()) return false;

  const notification = new Notification({
    title: payload.title || 'R.X. AI Overlay',
    body: payload.body || '',
    urgency: payload.urgency || 'normal',
    icon: appIconPath,
  });

  notification.show();
  return true;
});
