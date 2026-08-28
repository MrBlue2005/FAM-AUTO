const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { spawn } = require('child_process');
const { getUploadsRoot, normalizeMediaReference, resolveMediaReference } = require('../app/utils/mediaPath');
const { buildCampaignWorkbook } = require('../app/utils/excelReport');
const { ensureStoragePaths, storageStatus } = require('../app/config/storagePaths');

const DataManager = require('../app/core/DataManager');
const RobotManager = require('../app/core/RobotManager');
const ScheduleManager = require('../app/core/ScheduleManager');
const ProfileSetupManager = require('../app/facebook/profileSetupManager');
const {
  inferProfileCategory,
  normalizeCategory,
} = require('../app/utils/campaignCategory');
const {
  buildQueuePlan,
  getCampaignPreview,
  validateCampaigns,
  groupErrors,
  buildReport,
  buildPreflightReport,
  getTaskId,
} = require('../app/core/CampaignTools');
const { buildDiagnostics } = require('../app/core/Diagnostics');

const app = express();
const PORT = process.env.PORT == null || process.env.PORT === '' ? 3000 : Number(process.env.PORT);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.API_KEY || '';
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const OVERLAY_ACCESS_TOKEN = crypto.createHmac(
  'sha256',
  process.env.ADMIN_PASSWORD_SCRYPT || API_KEY || crypto.randomBytes(32)
).update('rx-propulse-overlay-v1').digest('hex');
const OVERLAY_ACCESS_ROUTES = new Set([
  'GET /overlay/status',
  'POST /robot/pause',
  'POST /robot/resume',
  'POST /robot/stop',
  'POST /robot/pause-profile',
  'POST /robot/resume-profile',
  'POST /robot/stop-profile',
]);
const authSessions = new Map();
const propertyDescriptionTransfers = new Map();
const PROPERTY_DESCRIPTION_TRANSFER_TTL_MS = 30 * 60 * 1000;
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean);
const dashboardDist = path.join(__dirname, '..', 'dashboard-v2', 'dist');
const overlayDesktopRoot = path.join(__dirname, '..', 'overlay-desktop');
const overlayDesktopExe = path.join(
  overlayDesktopRoot,
  'dist',
  'RX-AI-Overlay-0.1.0.exe'
);
const overlayDesktopUnpackedExe = path.join(
  overlayDesktopRoot,
  'dist',
  'win-unpacked',
  'R.X. AI Overlay.exe'
);
const overlayElectronBin = path.join(
  overlayDesktopRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

function requestCookie(req, name) {
  const cookies = String(req.get('cookie') || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(value.join('=')); }
      catch { return ''; }
    }
  }
  return '';
}

function requestSession(req, now = Date.now()) {
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = bearer || requestCookie(req, 'rx_session');
  const session = authSessions.get(token);
  return session && session.expiresAt >= now ? { token, session } : null;
}

function secureTokenMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
function parseScryptEncoding(encoded) {
  const value = String(encoded || '');
  const legacy = value.match(/^([a-f0-9]{32,}):([a-f0-9]{64,})$/i);
  if (legacy) return { saltHex: legacy[1], expectedHex: legacy[2], options: undefined };
  const versioned = value.match(/^scrypt\$(\d+)\$(\d+)\$(\d+)\$([a-f0-9]{32,})\$([a-f0-9]{64,})$/i);
  if (!versioned) return null;
  const N = Number(versioned[1]); const r = Number(versioned[2]); const p = Number(versioned[3]);
  if (N < 16384 || N > 131072 || (N & (N - 1)) !== 0 || r < 8 || r > 16 || p < 1 || p > 4) return null;
  return { saltHex: versioned[4], expectedHex: versioned[5], options: { N, r, p, maxmem: 256 * 1024 * 1024 } };
}

function validateEnvironment() {
  const errors = [];
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) errors.push('PORT trebuie sa fie intre 1 si 65535.');
  if (IS_PRODUCTION && !AUTH_ENABLED) errors.push('AUTH_ENABLED=true este obligatoriu in productie.');
  if (AUTH_ENABLED && !process.env.ADMIN_PASSWORD_SCRYPT) {
    errors.push('Configureaza ADMIN_PASSWORD_SCRYPT pentru autentificarea administratorului.');
  }
  if (process.env.ADMIN_PASSWORD_SCRYPT && !parseScryptEncoding(process.env.ADMIN_PASSWORD_SCRYPT)) {
    errors.push('ADMIN_PASSWORD_SCRYPT nu are un format Scrypt valid.');
  }
  if (process.env.OPERATOR_PASSWORD_SCRYPT && !parseScryptEncoding(process.env.OPERATOR_PASSWORD_SCRYPT)) {
    errors.push('OPERATOR_PASSWORD_SCRYPT nu are un format Scrypt valid.');
  }
  if (errors.length) throw new Error(`Configuratie server invalida:\n- ${errors.join('\n- ')}`);
}

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  next();
});
app.use(cors((req, callback) => {
  const origin = req.get('origin');
  const overlayPath = req.path.startsWith('/api') ? req.path.slice(4) : req.path;
  const requestedMethod = req.method === 'OPTIONS'
    ? req.get('access-control-request-method') || req.method
    : req.method;
  const electronOverlay = origin === 'null' && OVERLAY_ACCESS_ROUTES.has(`${requestedMethod} ${overlayPath}`);
  callback(null, {
    origin: !origin || electronOverlay || allowedOrigins.includes(origin),
    credentials: true,
  });
}));
app.use(express.json({ limit: '2mb' }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, status: 'alive', uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/readyz', (req, res) => {
  const storage = storageStatus();
  const ready = storage.every((item) => item.ready);
  res.status(ready ? 200 : 503).json({
    ok: ready,
    status: ready ? 'ready' : 'not-ready',
    storage: storage.map(({ name, ready: pathReady }) => ({ name, ready: pathReady })),
  });
});

const rateBuckets = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now(); const key = req.ip; const bucket = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 60000) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1; rateBuckets.set(key, bucket);
  if (bucket.count > 300) return res.status(429).json({ error: 'Prea multe requesturi. Incearca din nou peste un minut.' });
  const authRoute = req.path.startsWith('/auth/');
  const apiKeyAuthenticated = Boolean(API_KEY && req.get('x-api-key') === API_KEY);
  const overlayAuthenticated = OVERLAY_ACCESS_ROUTES.has(`${req.method} ${req.path}`)
    && secureTokenMatch(req.get('x-overlay-token'), OVERLAY_ACCESS_TOKEN);
  if (!AUTH_ENABLED && API_KEY && !apiKeyAuthenticated && !overlayAuthenticated) return res.status(401).json({ error: 'Cheie API invalida sau lipsa.' });
  if (AUTH_ENABLED && !authRoute) {
    const authenticatedSession = requestSession(req, now);
    if (!apiKeyAuthenticated && !overlayAuthenticated && !authenticatedSession) return res.status(401).json({ error: 'Sesiune invalida sau expirata.' });
    req.user = apiKeyAuthenticated
      ? { username: 'api-key', role: 'admin' }
      : overlayAuthenticated
        ? { username: 'desktop-overlay', role: 'operator' }
        : authenticatedSession.session;
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!apiKeyAuthenticated && mutation && req.get('x-rx-csrf') !== '1') {
      return res.status(403).json({ error: 'Cererea nu a trecut verificarea CSRF.' });
    }
    const operatorAction = ['/robot/', '/queue/'].some((route) => req.path.startsWith(route));
    if (mutation && !operatorAction && req.user.role !== 'admin') return res.status(403).json({ error: 'Aceasta actiune necesita rol de administrator.' });
  }
  return next();
});

const maintenanceTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (now - bucket.start > 2 * 60 * 1000) rateBuckets.delete(key);
  for (const [key, bucket] of loginBuckets) if (now - bucket.start > 16 * 60 * 1000) loginBuckets.delete(key);
  for (const [token, session] of authSessions) if (session.expiresAt < now) authSessions.delete(token);
  for (const [id, transfer] of propertyDescriptionTransfers) {
    if (transfer.expiresAt < now) propertyDescriptionTransfers.delete(id);
  }
}, 5 * 60 * 1000);
maintenanceTimer.unref?.();
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const startedAt = Date.now();
  res.on('finish', () => DataManager.addAuditEntry({ action: `${req.method} ${req.path}`, statusCode: res.statusCode, ok: res.statusCode < 400, durationMs: Date.now() - startedAt }));
  return next();
});

app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !RobotManager.isRunning()) return next();
  const protectedRoutes = ['/groups', '/properties', '/jobs', '/campaign-folders', '/media', '/backup/import', '/runtime-config'];
  if (!protectedRoutes.some((route) => req.path.startsWith(route))) return next();
  return res.status(409).json({ error: 'Datele campaniilor nu pot fi modificate cat timp robotul ruleaza.' });
});

const uploadRoot = getUploadsRoot();

app.use('/uploads', (req, res, next) => {
  if (!AUTH_ENABLED || requestSession(req) || (API_KEY && req.get('x-api-key') === API_KEY)) return next();
  return res.status(401).json({ error: 'Autentificare necesara pentru accesul la media.' });
}, express.static(uploadRoot), (req, res) => {
  res.status(404).json({ error: 'Fisier media inexistent.' });
});

function safeUploadSegment(value, fallback) {
  const sanitized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return sanitized || fallback;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const propertyId = safeUploadSegment(req.body.propertyId, 'TEMP');
    const day = safeUploadSegment(req.body.day, 'day');
    const folder = path.join(uploadRoot, propertyId, `day-${day}`);

    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    cb(null, folder);
  },

  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const accepted = file.mimetype.startsWith('image/')
      || ['video/mp4', 'video/quicktime'].includes(file.mimetype);
    cb(accepted ? null : new Error('Sunt acceptate doar imagini, MP4 si MOV.'), accepted);
  },
});

/* GROUPS */

app.get('/api/groups', (req, res) => {
  res.json(DataManager.getGroups());
});

app.post('/api/groups', (req, res) => {
  res.json(DataManager.saveGroups(req.body));
});

/* PROPERTIES */

app.get('/api/campaign-folders', (req, res) => {
  res.json(DataManager.getCampaignFolders());
});

app.post('/api/campaign-folders', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Numele folderului este obligatoriu.' });
  if (name.length > 80) return res.status(400).json({ error: 'Numele folderului poate avea cel mult 80 de caractere.' });

  const folders = DataManager.getCampaignFolders();
  if (folders.some((folder) => String(folder.name || '').localeCompare(name, 'ro', { sensitivity: 'accent' }) === 0)) {
    return res.status(409).json({ error: 'Exista deja un folder cu acest nume.' });
  }

  const folder = {
    id: `CAMPAIGN_FOLDER_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    name,
    createdAt: new Date().toISOString(),
  };
  DataManager.saveCampaignFolders([...folders, folder]);
  return res.status(201).json(folder);
});

app.delete('/api/campaign-folders/:folderId', (req, res) => {
  const folders = DataManager.getCampaignFolders();
  if (!folders.some((folder) => folder.id === req.params.folderId)) {
    return res.status(404).json({ error: 'Folderul nu exista.' });
  }
  DataManager.saveCampaignFolders(folders.filter((folder) => folder.id !== req.params.folderId));
  DataManager.removeCampaignFolderReferences(req.params.folderId);
  return res.json({ ok: true, id: req.params.folderId });
});

app.get('/api/properties', (req, res) => {
  res.json(DataManager.getProperties());
});

app.post('/api/properties', (req, res) => {
  try {
    res.json(DataManager.saveProperty(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/properties/:propertyId', (req, res) => {
  try {
    res.json(DataManager.updateProperty(req.params.propertyId, req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/property-description-transfers', (req, res) => {
  const descriptions = Array.isArray(req.body?.descriptions) ? req.body.descriptions : [];
  if (descriptions.length !== 3) {
    return res.status(400).json({ error: 'Transferul trebuie sa contina exact 3 descrieri.' });
  }

  const normalizedDescriptions = descriptions.map((item, index) => ({
    day: index + 1,
    title: String(item?.title || `Ziua ${index + 1}`).trim().slice(0, 180),
    text: String(item?.text || '').trim(),
  }));
  if (normalizedDescriptions.some((item) => item.text.length < 1 || item.text.length > 12000)) {
    return res.status(400).json({ error: 'Fiecare descriere trebuie sa contina intre 1 si 12000 de caractere.' });
  }

  const id = crypto.randomUUID();
  const expiresAt = Date.now() + PROPERTY_DESCRIPTION_TRANSFER_TTL_MS;
  propertyDescriptionTransfers.set(id, {
    id,
    descriptions: normalizedDescriptions,
    sourceTitle: String(req.body?.sourceTitle || '').trim().slice(0, 4000),
    transactionType: ['rent', 'sale'].includes(req.body?.transactionType)
      ? req.body.transactionType
      : null,
    createdAt: new Date().toISOString(),
    expiresAt,
  });

  return res.status(201).json({ id, expiresAt: new Date(expiresAt).toISOString() });
});

app.get('/api/property-description-transfers/:transferId', (req, res) => {
  const transfer = propertyDescriptionTransfers.get(req.params.transferId);
  if (!transfer || transfer.expiresAt < Date.now()) {
    propertyDescriptionTransfers.delete(req.params.transferId);
    return res.status(404).json({ error: 'Transferul nu exista sau a expirat.' });
  }
  return res.json(transfer);
});

app.delete('/api/properties/:propertyId', (req, res) => {
  res.json(DataManager.deleteProperty(req.params.propertyId));
});

/* JOBS */

app.get('/api/jobs', (req, res) => {
  res.json(DataManager.getJobs());
});

app.post('/api/jobs', (req, res) => {
  try {
    res.json(DataManager.saveJob(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/jobs/:jobId', (req, res) => {
  res.json(DataManager.deleteJob(req.params.jobId));
});

/* HISTORY */

app.get('/api/history', (req, res) => {
  res.json(DataManager.getHistory());
});

app.post('/api/history/clear-property/:propertyId', (req, res) => {
  res.json(DataManager.clearHistoryForProperty(req.params.propertyId));
});

app.post('/api/history/clear-all', (req, res) => {
  res.json(DataManager.clearAllHistory());
});

app.get('/api/property-logs', (req, res) => {
  const properties = DataManager.getProperties();
  const jobs = DataManager.getJobs();
  const history = DataManager.getHistory();

  const items = [
    ...properties.map((item) => ({
      id: item.id,
      name: item.name,
      type: 'property',
    })),
    ...jobs.map((item) => ({
      id: item.id,
      name: item.title,
      type: 'job',
    })),
  ];

  const logs = items.map((item) => {
    const itemHistory = history.filter(
      (historyItem) => historyItem.propertyId === item.id
    );

    return {
      propertyId: item.id,
      propertyName: item.name,
      itemType: item.type,
      prepared: itemHistory.filter((entry) => entry.status === 'prepared').length,
      posted: itemHistory.filter((entry) => entry.status === 'posted').length,
      skipped: itemHistory.filter((entry) => entry.status === 'skipped').length,
      errors: itemHistory.filter((entry) => entry.status === 'error').length,
      total: itemHistory.length,
      lastEntry: itemHistory[itemHistory.length - 1] || null,
    };
  });

  res.json(logs);
});

app.get('/api/dashboard/summary', (req, res) => {
  const properties = DataManager.getProperties();
  const jobs = DataManager.getJobs();
  const groups = DataManager.getGroups();
  const history = DataManager.getHistory();
  const config = DataManager.getRuntimeConfig();
  const robot = RobotManager.status();
  const queuePlan = buildQueuePlan({ config, properties, jobs, groups, history });
  const preflight = buildPreflightReport({ config, properties, jobs, groups, history });
  const today = new Date();
  const sevenDaysAgo = today.getTime() - 7 * 24 * 60 * 60 * 1000;

  function isToday(value) {
    if (!value) return false;

    const date = new Date(value);

    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  }

  const lastSevenDays = history.filter((entry) => new Date(entry.date).getTime() >= sevenDaysAgo);
  const postedLastSevenDays = lastSevenDays.filter((entry) => entry.status === 'posted').length;
  const completedLastSevenDays = lastSevenDays.filter((entry) =>
    ['posted', 'prepared', 'error'].includes(entry.status)
  ).length;

  res.json({
    activeProperties: properties.filter((property) => property.active).length,
    activeJobs: jobs.filter((job) => job.active).length,
    activeGroups: groups.filter((group) => group.active).length,
    postedToday: history.filter((entry) => entry.status === 'posted' && isToday(entry.date)).length,
    errorsToday: history.filter((entry) => entry.status === 'error' && isToday(entry.date)).length,
    robot,
    queue: queuePlan.summary,
    nextTasks: queuePlan.activeTasks.slice(0, 5),
    preflight,
    recentActivity: history.slice().reverse().slice(0, 6),
    successRate7d: completedLastSevenDays
      ? Math.round((postedLastSevenDays / completedLastSevenDays) * 100)
      : 0,
    actions7d: lastSevenDays.length,
    updatedAt: new Date().toISOString(),
  });
});

function secureScryptMatch(password, encoded) {
  const parsed = parseScryptEncoding(encoded);
  if (!parsed) return false;
  const { saltHex, expectedHex, options } = parsed;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(String(password || ''), Buffer.from(saltHex, 'hex'), expected.length, options);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const dummySalt = crypto.randomBytes(16);
const DUMMY_PASSWORD_SCRYPT = `scrypt$32768$8$1$${dummySalt.toString('hex')}$${crypto.scryptSync(
  crypto.randomBytes(32),
  dummySalt,
  64,
  { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
).toString('hex')}`;

const loginBuckets = new Map();

function allowLoginAttempt(req, username) {
  const now = Date.now();
  const key = `${req.ip}:${String(username || '').toLowerCase()}`;
  const bucket = loginBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 15 * 60 * 1000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  loginBuckets.set(key, bucket);
  return bucket.count <= 10;
}

app.use('/api/auth', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); return next(); });

app.get('/api/auth/status', (req, res) => {
  const authenticatedSession = requestSession(req);
  const session = authenticatedSession?.session;
  res.json({ enabled: AUTH_ENABLED, authenticated: !AUTH_ENABLED || Boolean(session), role: session?.role || null, username: session?.username || null });
});
app.post('/api/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ enabled: false, role: 'admin' });
  const username = String(req.body?.username || '');
  if (!allowLoginAttempt(req, username)) return res.status(429).json({ error: 'Prea multe incercari de autentificare. Reincearca peste 15 minute.' });
  const candidates = [
    { username: process.env.ADMIN_USERNAME || 'admin', scrypt: process.env.ADMIN_PASSWORD_SCRYPT, role: 'admin' },
    { username: process.env.OPERATOR_USERNAME || 'operator', scrypt: process.env.OPERATOR_PASSWORD_SCRYPT, role: 'operator' },
  ];
  const user = candidates.find((candidate) => candidate.username === username);
  const passwordMatches = secureScryptMatch(req.body?.password, user?.scrypt || DUMMY_PASSWORD_SCRYPT);
  if (!user || !passwordMatches) return res.status(401).json({ error: 'Utilizator sau parola incorecta.' });
  loginBuckets.delete(`${req.ip}:${username.toLowerCase()}`);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  authSessions.set(token, { username, role: user.role, expiresAt });
  res.setHeader('Set-Cookie', `rx_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${IS_PRODUCTION ? '; Secure' : ''}`);
  return res.json({ username, role: user.role, expiresAt });
});
app.post('/api/auth/logout', (req, res) => {
  const token = requestSession(req)?.token || String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  authSessions.delete(token);
  res.setHeader('Set-Cookie', `rx_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`);
  res.json({ ok: true });
});

function csvCell(value) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

app.get('/api/export/:type', (req, res) => {
  const type = req.params.type;
  let rows;
  if (type === 'history') rows = DataManager.getHistory();
  else if (type === 'properties') rows = DataManager.getProperties().map((item) => ({ id: item.id, name: item.name, active: item.active, transactionType: item.transactionType, posts: item.posts?.length || 0 }));
  else if (type === 'jobs') rows = DataManager.getJobs().map((item) => ({ id: item.id, title: item.title, company: item.company, active: item.active, posts: item.posts?.length || 0 }));
  else if (type === 'audit') rows = DataManager.getAuditLog();
  else return res.status(404).json({ error: 'Tip de export necunoscut.' });
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = ['\uFEFF' + headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rx-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

app.get('/api/audit', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 10), 500);
  res.json(DataManager.getAuditLog().slice(-limit).reverse());
});

app.get('/api/health', (req, res) => {
  const data = getCampaignToolData();
  const queuePlan = buildQueuePlan(data);
  const preflight = buildPreflightReport(data);
  const robot = RobotManager.status();

  res.json({
    ok: true,
    api: 'online',
    uptimeSeconds: Math.round(process.uptime()),
    robotStatus: robot.robotStatus || 'idle',
    queueActive: queuePlan.summary.active,
    preflightOk: preflight.ok,
    preflightErrors: preflight.summary.errors,
    facebookStatus: ['running', 'paused'].includes(robot.robotStatus) ? 'active' : 'standby',
    updatedAt: new Date().toISOString(),
  });
});

app.get('/api/live-feed', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 120, 20), 300);

  res.json({
    robot: RobotManager.status(),
    history: DataManager.getHistory().slice().reverse().slice(0, limit),
  });
});

/* RUNTIME CONFIG */

app.get('/api/runtime-config', (req, res) => {
  res.json(DataManager.getRuntimeConfig());
});

app.post('/api/runtime-config', (req, res) => {
  res.json(DataManager.saveRuntimeConfig(req.body));
});

app.get('/api/runtime-config/export', (req, res) => {
  const config = DataManager.getRuntimeConfig();

  res.setHeader('Content-Disposition', 'attachment; filename="runtimeConfig.json"');
  res.setHeader('Content-Type', 'application/json');

  res.send(JSON.stringify(config, null, 2));
});

app.post('/api/runtime-config/import', (req, res) => {
  try {
    res.json(DataManager.saveRuntimeConfig(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/facebook-profiles', (req, res) => {
  const config = DataManager.getRuntimeConfig();
  res.json({
    profiles: config.facebookProfiles || [],
    selectedProfileId: config.facebookProfileId || null,
  });
});

app.post('/api/facebook-profiles/:profileId/setup', async (req, res) => {
  try {
    const result = await ProfileSetupManager.startSetup(req.params.profileId);
    res.status(result.ok ? 200 : 404).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/facebook-profiles/:profileId/setup/finish', async (req, res) => {
  try {
    res.json(await ProfileSetupManager.finishSetup(req.params.profileId));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/backup/export', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="rx-ai-backup-${stamp}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(DataManager.createBackup(), null, 2));
});

app.post('/api/backup/import', (req, res) => {
  try { res.json(DataManager.restoreBackup(req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

/* CAMPAIGN TOOLS */

function getCampaignToolData() {
  return {
    config: DataManager.getRuntimeConfig(),
    properties: DataManager.getProperties(),
    jobs: DataManager.getJobs(),
    groups: DataManager.getGroups(),
    history: DataManager.getHistory(),
  };
}

app.get('/api/queue/plan', (req, res) => {
  const data = getCampaignToolData();
  res.json(buildQueuePlan(data));
});

app.post('/api/queue/exclude', (req, res) => {
  const config = DataManager.getRuntimeConfig();
  const taskId = req.body.taskId;
  const excluded = req.body.excluded === true;
  const taskIds = new Set(config.queueExcludedTaskIds || []);

  if (excluded) {
    taskIds.add(taskId);
  } else {
    taskIds.delete(taskId);
  }

  const savedConfig = DataManager.saveRuntimeConfig({
    ...config,
    queueExcludedTaskIds: Array.from(taskIds),
  });

  res.json(buildQueuePlan({ ...getCampaignToolData(), config: savedConfig }));
});

app.post('/api/queue/retry', (req, res) => {
  const config = DataManager.getRuntimeConfig();
  const taskId = req.body.taskId;
  const retry = req.body.retry === true;
  const taskIds = new Set(config.queueRetryTaskIds || []);

  if (retry) {
    taskIds.add(taskId);
  } else {
    taskIds.delete(taskId);
  }

  const savedConfig = DataManager.saveRuntimeConfig({
    ...config,
    queueRetryTaskIds: Array.from(taskIds),
  });

  res.json(buildQueuePlan({ ...getCampaignToolData(), config: savedConfig }));
});

app.post('/api/queue/reorder', (req, res) => {
  const config = DataManager.getRuntimeConfig();
  const savedConfig = DataManager.saveRuntimeConfig({
    ...config,
    queueOrder: Array.isArray(req.body.taskIds) ? req.body.taskIds : [],
  });

  res.json(buildQueuePlan({ ...getCampaignToolData(), config: savedConfig }));
});

app.get('/api/campaign-preview', (req, res) => {
  const data = getCampaignToolData();
  const category = normalizeCategory(req.query.category) || data.config.campaignCategory;
  const activeProfile = (data.config.facebookProfiles || []).find(
    (profile) => profile.id === data.config.facebookProfileId
  );
  const activeProfileMatchesCategory =
    activeProfile && inferProfileCategory(activeProfile) === category;
  const matchingProfile = (data.config.facebookProfiles || []).find(
    (profile) => inferProfileCategory(profile) === category
  );
  const config = {
    ...data.config,
    campaignCategory: category,
    facebookProfileId: activeProfileMatchesCategory
      ? data.config.facebookProfileId
      : matchingProfile?.id || data.config.facebookProfileId,
  };

  res.json(
    getCampaignPreview({
      ...data,
      config,
      campaignId: req.query.campaignId,
      day: req.query.day,
    })
  );
});

app.get('/api/validations', (req, res) => {
  res.json(validateCampaigns(getCampaignToolData()));
});

app.get('/api/preflight', (req, res) => {
  res.json(buildPreflightReport(getCampaignToolData()));
});

app.get('/api/diagnostics', (req, res) => {
  const data = getCampaignToolData();
  res.json(buildDiagnostics({
    ...data,
    preflight: buildPreflightReport(data),
    validations: validateCampaigns(data),
    queuePlan: buildQueuePlan(data),
  }));
});

app.get('/api/logs/errors', (req, res) => {
  res.json(groupErrors(DataManager.getHistory()));
});

app.get('/api/reports/latest', (req, res) => {
  res.json(buildReport(DataManager.getHistory()));
});

app.get('/api/reports/latest/export', (req, res) => {
  const report = buildReport(DataManager.getHistory());

  res.setHeader('Content-Disposition', 'attachment; filename="campaign-report.json"');
  res.setHeader('Content-Type', 'application/json');

  res.send(JSON.stringify(report, null, 2));
});

app.get('/api/reports/latest/excel', async (req, res) => {
  try {
    const range = ['all', '1', '7', '30'].includes(String(req.query.range))
      ? String(req.query.range)
      : 'all';
    const buffer = await buildCampaignWorkbook({ history: DataManager.getHistory(), range });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="rx-campaign-report-${stamp}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({ error: `Raportul Excel nu a putut fi generat: ${error.message}` });
  }
});

/* CAMPAIGN RUNS AND SAVED REPORTS */

function campaignRunPayload(run) {
  const history = DataManager.getCampaignRunHistory(run.id);
  return {
    ...run,
    totals: {
      total: history.length,
      posted: history.filter((entry) => entry.status === 'posted').length,
      prepared: history.filter((entry) => entry.status === 'prepared').length,
      skipped: history.filter((entry) => entry.status === 'skipped').length,
      errors: history.filter((entry) => entry.status === 'error').length,
    },
  };
}

app.get('/api/runs', (req, res) => {
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim().toLowerCase();
  const runs = DataManager.getCampaignRuns()
    .filter((run) => status === 'all' || run.status === status)
    .filter((run) => !search || `${run.id} ${(run.campaignIds || []).join(' ')} ${run.facebookProfileId || ''}`.toLowerCase().includes(search))
    .map(campaignRunPayload);
  res.json(runs);
});

app.get('/api/runs/:runId', (req, res) => {
  const run = DataManager.getCampaignRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Rularea nu exista.' });
  return res.json({ ...campaignRunPayload(run), history: DataManager.getCampaignRunHistory(run.id) });
});

app.get('/api/runs/:runId/excel', async (req, res) => {
  try {
    const run = DataManager.getCampaignRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Rularea nu exista.' });
    const buffer = await buildCampaignWorkbook({ history: DataManager.getCampaignRunHistory(run.id), range: 'all' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="rx-run-${run.id}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (error) {
    return res.status(500).json({ error: `Raportul Excel nu a putut fi generat: ${error.message}` });
  }
});

app.post('/api/runs/:runId/retry-errors', (req, res) => {
  const run = DataManager.getCampaignRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Rularea nu exista.' });
  const errors = DataManager.getCampaignRunHistory(run.id).filter((entry) => entry.status === 'error');
  if (!errors.length) return res.status(400).json({ error: 'Rularea nu contine erori de reincercat.' });

  const retryIds = Array.from(new Set(errors.map((entry) => getTaskId(entry.propertyId, entry.groupId, entry.facebookProfileId || run.facebookProfileId))));
  const currentConfig = DataManager.getRuntimeConfig();
  const retryConfig = {
    ...currentConfig,
    ...run.configSnapshot,
    selectedPropertyIds: Array.from(new Set(errors.map((entry) => entry.propertyId).filter(Boolean))),
    groupLimit: 'all',
    startFromGroup: 1,
    queueRetryTaskIds: retryIds,
    queueExcludedTaskIds: [],
    queueOrder: retryIds,
  };
  const plan = buildQueuePlan({
    config: retryConfig,
    properties: DataManager.getProperties(),
    jobs: DataManager.getJobs(),
    groups: DataManager.getGroups(),
    history: DataManager.getHistory(),
  });
  const retrySet = new Set(retryIds);
  retryConfig.queueExcludedTaskIds = plan.tasks.map((task) => task.id).filter((id) => !retrySet.has(id));
  DataManager.saveRuntimeConfig(retryConfig);
  return res.json({ ok: true, retryTaskIds: retryIds, excludedTaskIds: retryConfig.queueExcludedTaskIds, message: `${retryIds.length} taskuri cu erori au fost pregatite exclusiv pentru retry.` });
});

app.post('/api/runs/:runId/archive', (req, res) => {
  const run = DataManager.getCampaignRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Rularea nu exista.' });
  if (run.status === 'running') return res.status(409).json({ error: 'O rulare activa nu poate fi arhivata.' });
  return res.json(campaignRunPayload(DataManager.updateCampaignRun(run.id, { archived: req.body?.archived !== false })));
});

/* CAMPAIGN SCHEDULES */

app.get('/api/schedules', (req, res) => {
  res.json({ timezone: ScheduleManager.getSystemTimeZone(), schedules: ScheduleManager.list(), folders: ScheduleManager.listFolders() });
});

app.post('/api/schedule-folders', (req, res) => {
  try {
    res.status(201).json(ScheduleManager.createFolder(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/schedule-folders/:folderId', (req, res) => {
  try {
    res.json(ScheduleManager.removeFolder(req.params.folderId));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post('/api/schedules', (req, res) => {
  try {
    res.status(201).json(ScheduleManager.create(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/schedules/:scheduleId', (req, res) => {
  try {
    res.json(ScheduleManager.update(req.params.scheduleId, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/schedules/:scheduleId', (req, res) => {
  try {
    res.json(ScheduleManager.remove(req.params.scheduleId));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post('/api/schedules/:scheduleId/run-now', (req, res) => {
  try {
    res.json(ScheduleManager.runNow(req.params.scheduleId));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/overlay/status', (req, res) => {
  const data = getCampaignToolData();
  const robot = RobotManager.status();
  const queuePlan = buildQueuePlan(data);
  const activeProfile = (data.config.facebookProfiles || []).find(
    (profile) => profile.id === data.config.facebookProfileId
  );
  const activeTasks = queuePlan.activeTasks || [];
  const profileLabels = new Map((data.config.facebookProfiles || []).map((profile) => [profile.id, profile.label || profile.id]));
  const overlayRobot = {
    ...robot,
    activeRuns: (robot.activeRuns || []).map((run) => ({
      ...run,
      profileLabel: profileLabels.get(run.profileId) || run.profileId,
    })),
  };

  res.json({
    robot: overlayRobot,
    queue: {
      summary: queuePlan.summary || {},
      totalTasks: queuePlan.tasks?.length || 0,
      activeTasks: activeTasks.length,
      nextTasks: activeTasks.slice(0, 6),
    },
    runtime: {
      campaignDay: data.config.campaignDay || 1,
      campaignCategory: data.config.campaignCategory || 'real_estate',
      facebookProfileId: data.config.facebookProfileId || 'main',
      facebookProfileLabel: activeProfile?.label || data.config.facebookProfileId || 'Profil default',
      publishEnabled: data.config.publishEnabled === true,
    },
    history: data.history.slice().reverse().slice(0, 30),
  });
});

function spawnOverlay(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...(options.env || {}) };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(command, args, {
      cwd: overlayDesktopRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: options.shell === true,
      env: childEnv,
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ pid: child.pid });
    });
  });
}

app.post('/api/overlay/desktop/open', async (req, res) => {
  try {
    if (fs.existsSync(overlayDesktopUnpackedExe)) {
      const launched = await spawnOverlay(overlayDesktopUnpackedExe, [], { env: { RX_OVERLAY_TOKEN: OVERLAY_ACCESS_TOKEN } });
      res.json({ ok: true, mode: 'unpacked-exe', ...launched });
      return;
    }

    if (fs.existsSync(overlayDesktopExe)) {
      const launched = await spawnOverlay(overlayDesktopExe, [], { env: { RX_OVERLAY_TOKEN: OVERLAY_ACCESS_TOKEN } });
      res.json({ ok: true, mode: 'portable-exe', ...launched });
      return;
    }

    if (fs.existsSync(overlayElectronBin)) {
      const launched = await spawnOverlay(overlayElectronBin, ['.'], {
        shell: process.platform === 'win32',
        env: { RX_OVERLAY_TOKEN: OVERLAY_ACCESS_TOKEN },
      });
      res.json({ ok: true, mode: 'electron-dev', ...launched });
      return;
    }

    res.status(404).json({
      ok: false,
      error: 'Overlay desktop nu este construit. Ruleaza npm install si npm run dist in overlay-desktop.',
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
/* MEDIA */

function listMediaFiles(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return listMediaFiles(entryPath, baseDir);
    }

    const stat = fs.statSync(entryPath);
    const relativePath = path.relative(baseDir, entryPath);
    const parts = relativePath.split(path.sep);
    const reference = `app/uploads/${relativePath.split(path.sep).join('/')}`;

    return {
      name: entry.name,
      path: reference,
      absolutePath: entryPath,
      relativePath,
      propertyId: parts[0] || 'TEMP',
      day: parts[1]?.replace('day-', '') || '-',
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      type: /\.(mp4|mov|quicktime)$/i.test(entry.name) ? 'video' : 'image',
      hash: crypto.createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex'),
    };
  });
}

app.get('/api/media', (req, res) => {
  const files = listMediaFiles(uploadRoot);
  const campaigns = [...DataManager.getProperties(), ...DataManager.getJobs()];
  const references = new Set(campaigns.flatMap((campaign) => (campaign.posts || []).flatMap((post) => [post.imagePath, ...(post.media || []).map((item) => typeof item === 'string' ? item : item?.path)])).filter(Boolean).map(normalizeMediaReference));
  const hashCounts = files.reduce((counts, file) => counts.set(file.hash, (counts.get(file.hash) || 0) + 1), new Map());
  res.json(files.map(({ absolutePath, ...file }) => ({ ...file, used: references.has(file.path), duplicate: hashCounts.get(file.hash) > 1 })));
});

app.post('/api/media/upload', (req, res) => {
  upload.array('files')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || 'Media upload failed.' });
    }

    const files = req.files || [];
    const uploadedPaths = new Set(files.map((file) => path.resolve(file.path)));
    const existingByHash = new Map(listMediaFiles(uploadRoot).filter((file) => !uploadedPaths.has(path.resolve(file.absolutePath))).map((file) => [file.hash, file]));
    return res.json({
      files: files.map((file) => {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
        const duplicate = existingByHash.get(hash);
        if (duplicate) fs.unlinkSync(file.path);
        else existingByHash.set(hash, { path: file.path, hash });
        return {
        originalName: file.originalname,
        path: duplicate?.path || `app/uploads/${path.relative(uploadRoot, file.path).split(path.sep).join('/')}`,
        mimeType: file.mimetype,
        size: file.size,
        duplicate: Boolean(duplicate),
        hash,
      }; }),
    });
  });
});

app.delete('/api/media', (req, res) => {
  const reference = normalizeMediaReference(req.body?.path);
  const resolved = resolveMediaReference(reference);
  if (!reference || !resolved || !resolved.startsWith(uploadRoot + path.sep)) return res.status(400).json({ error: 'Cale media invalida.' });
  const campaigns = [...DataManager.getProperties(), ...DataManager.getJobs()];
  const usedBy = campaigns.filter((campaign) => (campaign.posts || []).some((post) => {
    const references = [post.imagePath, ...(post.media || []).map((item) => typeof item === 'string' ? item : item?.path)];
    return references.some((item) => normalizeMediaReference(item) === reference);
  })).map((campaign) => campaign.name || campaign.title || campaign.id);
  if (usedBy.length) return res.status(409).json({ error: `Fisierul este folosit de: ${usedBy.join(', ')}`, usedBy });
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Fisierul nu mai exista.' });
  fs.unlinkSync(resolved);
  return res.json({ ok: true, path: reference });
});

app.post('/api/media/cleanup-unused', (req, res) => {
  const files = listMediaFiles(uploadRoot);
  const campaigns = [...DataManager.getProperties(), ...DataManager.getJobs()];
  const references = new Set(campaigns.flatMap((campaign) => (campaign.posts || []).flatMap((post) => [post.imagePath, ...(post.media || []).map((item) => typeof item === 'string' ? item : item?.path)])).filter(Boolean).map(normalizeMediaReference));
  const unused = files.filter((file) => !references.has(normalizeMediaReference(file.path)));
  unused.forEach((file) => { if (fs.existsSync(file.absolutePath)) fs.unlinkSync(file.absolutePath); });
  return res.json({ deleted: unused.length, freedBytes: unused.reduce((sum, file) => sum + file.size, 0) });
});

/* ROBOT */

app.get('/api/robot/status', (req, res) => {
  res.json(RobotManager.status());
});

app.post('/api/robot/start', (req, res) => {
  res.json(RobotManager.start(req.body || {}));
});

app.post('/api/robot/stop', (req, res) => {
  res.json(RobotManager.stop());
});

app.post('/api/robot/stop-after-current', (req, res) => {
  res.json(RobotManager.stopAfterCurrentGroup());
});

app.post('/api/robot/pause', (req, res) => {
  res.json(RobotManager.pause());
});

app.post('/api/robot/pause-profile', (req, res) => {
  const profileId = req.body?.profileId;
  if (!profileId || typeof profileId !== 'string') return res.status(400).json({ error: 'Profil Facebook lipsa.' });
  return res.json(RobotManager.pause(profileId));
});

app.post('/api/robot/resume', (req, res) => {
  res.json(RobotManager.resume());
});

app.post('/api/robot/resume-profile', (req, res) => {
  const profileId = req.body?.profileId;
  if (!profileId || typeof profileId !== 'string') return res.status(400).json({ error: 'Profil Facebook lipsa.' });
  return res.json(RobotManager.resume(profileId));
});

app.post('/api/robot/stop-profile', (req, res) => {
  const profileId = req.body?.profileId;
  if (!profileId || typeof profileId !== 'string') return res.status(400).json({ error: 'Profil Facebook lipsa.' });
  return res.json(RobotManager.stop(profileId));
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint API inexistent.' });
});

if (fs.existsSync(path.join(dashboardDist, 'index.html'))) {
  app.use(express.static(dashboardDist, {
    index: false,
    maxAge: IS_PRODUCTION ? '1h' : 0,
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    return res.sendFile(path.join(dashboardDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('R.X. AI STUDIO API is running. Dashboard build is not available.');
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  return res.status(error.status || 500).json({ error: error.status ? error.message : 'Eroare interna a serverului.' });
});

let httpServer = null;
let shuttingDown = false;

function startServer() {
  validateEnvironment();
  ensureStoragePaths();
  if (httpServer) return httpServer;

  httpServer = app.listen(PORT, HOST, () => {
    console.log(`Dashboard API pornit: http://${HOST}:${PORT}`);
    console.log(`Mediu: ${IS_PRODUCTION ? 'production' : 'development'}; auth: ${AUTH_ENABLED ? 'enabled' : 'disabled'}`);
    ScheduleManager.start();
  });
  return httpServer;
}

function shutdown(signal = 'shutdown') {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Oprire controlata (${signal})...`);
  ScheduleManager.stop();
  if (RobotManager.isRunning()) RobotManager.stop();

  const forceTimer = setTimeout(() => {
    httpServer?.closeAllConnections?.();
    process.exit(1);
  }, 10000);
  forceTimer.unref?.();

  if (!httpServer) {
    clearTimeout(forceTimer);
    process.exit(0);
  }
  httpServer.close(() => {
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

if (require.main === module) {
  startServer();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdown('uncaughtException');
  });
}

module.exports = { app, shutdown, startServer, validateEnvironment };
