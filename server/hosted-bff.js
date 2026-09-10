'use strict';

// Stateless authentication boundary for the same-origin hosted dashboard BFF.
// It intentionally does not share the local server's in-memory session model.
const crypto = require('crypto');
const express = require('express');
const { SupabaseApplicationDataStore } = require('../app/cloud/SupabaseApplicationDataStore');
const { createCloudApplicationMutationRouter } = require('./cloud-application-mutation-api');
const { createCloudDashboardReadRouter } = require('./cloud-dashboard-read-api');
const { createCloudMediaUploadRouter } = require('./cloud-media-upload-api');
const { createCloudRemoteTaskRouter } = require('./cloud-remote-task-api');
const { ROLES, PERMISSIONS, requirePermission } = require('./hosted-rbac');
const { createDeviceAdminRouter } = require('./device-admin-api');
const { createUserAdminRouter } = require('./user-admin-api');

const SESSION_COOKIE = 'rx_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const [name, ...value] = part.trim().split('=');
    if (!name) return cookies;
    try { cookies[name] = decodeURIComponent(value.join('=')); }
    catch { cookies[name] = ''; }
    return cookies;
  }, {});
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

function secureScryptMatch(password, encoded) {
  const parsed = parseScryptEncoding(encoded);
  if (!parsed) return false;
  const { saltHex, expectedHex, options } = parsed;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(String(password || ''), Buffer.from(saltHex, 'hex'), expected.length, options);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function signingKey(secret) {
  return Buffer.from(String(secret || ''), 'utf8');
}

function signPayload(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', signingKey(secret)).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPayload(token, secret, nowMs) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', signingKey(secret)).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.v !== 1 || !payload.username || !payload.role || !payload.csrf || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 < nowMs) return null;
    return payload;
  } catch { return null; }
}

function normalizeOrigins(value) {
  return String(value || '').split(',').map((origin) => origin.trim()).filter(Boolean);
}

function normalizedSyntheticTargetId(value) {
  return String(value || '').trim();
}

function createHostedBffConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const authEnabled = env.AUTH_ENABLED !== 'false';
  const publicOrigin = String(env.RX_BFF_PUBLIC_ORIGIN || '').replace(/\/$/, '');
  const syntheticAgentId = normalizedSyntheticTargetId(env.RX_BFF_SYNTHETIC_AGENT_ID);
  const syntheticProfileId = normalizedSyntheticTargetId(env.RX_BFF_SYNTHETIC_PROFILE_ID);
  const chromiumPreflightEnabled = env.RX_BFF_CHROMIUM_PREFLIGHT_ENABLED === 'true';
  const facebookSessionPreflightEnabled = env.RX_BFF_FACEBOOK_SESSION_PREFLIGHT_ENABLED === 'true';
  const controlledExecutionEnabled = env.RX_BFF_CONTROLLED_EXECUTION_ENABLED === 'true';
  const liveExecutionEnabled = env.RX_BFF_LIVE_EXECUTION_ENABLED === 'true';
  const facebookSessionAgentId = normalizedSyntheticTargetId(env.RX_BFF_FACEBOOK_SESSION_AGENT_ID);
  const facebookSessionProfileId = normalizedSyntheticTargetId(env.RX_BFF_FACEBOOK_SESSION_PROFILE_ID);
  const developmentOrigins = normalizeOrigins(env.RX_BFF_ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3000,http://localhost:3000');
  const allowedOrigins = production ? [publicOrigin] : [...new Set([publicOrigin, ...developmentOrigins].filter(Boolean))];
  const errors = [];
  if (production && !authEnabled) errors.push('AUTH_ENABLED=true is required in production.');
  if (authEnabled && !env.ADMIN_PASSWORD_SCRYPT) errors.push('ADMIN_PASSWORD_SCRYPT is required when hosted BFF authentication is enabled.');
  if (env.ADMIN_PASSWORD_SCRYPT && !parseScryptEncoding(env.ADMIN_PASSWORD_SCRYPT)) errors.push('ADMIN_PASSWORD_SCRYPT must be a valid Scrypt encoding.');
  const userConfigured = Boolean(env.USER_USERNAME || env.USER_PASSWORD_SCRYPT);
  if (userConfigured && (!env.USER_USERNAME || !env.USER_PASSWORD_SCRYPT)) errors.push('USER_USERNAME and USER_PASSWORD_SCRYPT must be configured together.');
  if (env.USER_PASSWORD_SCRYPT && !parseScryptEncoding(env.USER_PASSWORD_SCRYPT)) errors.push('USER_PASSWORD_SCRYPT must be a valid Scrypt encoding.');
  if (userConfigured && env.USER_USERNAME === (env.ADMIN_USERNAME || 'admin')) errors.push('ADMIN_USERNAME and USER_USERNAME must be distinct.');
  if (authEnabled && String(env.RX_BFF_SESSION_SIGNING_SECRET || '').length < 32) errors.push('RX_BFF_SESSION_SIGNING_SECRET must be at least 32 characters.');
  if (production && !publicOrigin) errors.push('RX_BFF_PUBLIC_ORIGIN is required in production.');
  if (production && (!env.RX_APP_SUPABASE_URL || !env.RX_APP_SUPABASE_SERVICE_ROLE_KEY)) errors.push('Hosted application Supabase URL and service-role credentials are required in production.');
  if (errors.length) throw new Error(`Hosted BFF configuration is invalid: ${errors.join(' ')}`);
  return { production, authEnabled, publicOrigin, allowedOrigins, signingSecret: env.RX_BFF_SESSION_SIGNING_SECRET, syntheticAgentId, syntheticProfileId, chromiumPreflightEnabled, facebookSessionPreflightEnabled, facebookSessionAgentId, facebookSessionProfileId, controlledExecutionEnabled, liveExecutionEnabled, env };
}

function cookieValue(token, production, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
}

function createHostedBffApp({ env = process.env, now = () => Date.now(), store } = {}) {
  const config = createHostedBffConfig(env);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.get('origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (!origin || !config.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-rx-csrf');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      return res.sendStatus(204);
    }
    return next();
  });

  const applicationStore = store || (env.RX_APP_SUPABASE_URL && env.RX_APP_SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseApplicationDataStore({ url: env.RX_APP_SUPABASE_URL, serviceRoleKey: env.RX_APP_SUPABASE_SERVICE_ROLE_KEY })
    : null);

  const sessionFor = async (req) => {
    const session = verifyPayload(parseCookies(req.get('cookie'))[SESSION_COOKIE], config.signingSecret, now());
    if (!session || !session.managedUserId) return session;
    if (!applicationStore?.getManagedUserById) return null;
    try {
      const user = await applicationStore.getManagedUserById(session.managedUserId);
      return user?.enabled !== false && Number(user.session_version) === Number(session.sessionVersion) && user.role === ROLES.USER ? { ...session, canControlledExecute: user.controlled_execution_enabled === true } : null;
    } catch { return null; }
  };
  const requireSession = async (req, res, next) => {
    if (!config.authEnabled) { req.user = { username: 'admin', role: ROLES.ADMIN }; return next(); }
    const session = await sessionFor(req);
    if (!session) return res.status(401).json({ error: 'Session is invalid or expired.' });
    req.user = session;
    return next();
  };
  const requireMutationTrust = (req, res, next) => {
    const origin = req.get('origin');
    if (!origin || !config.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (!safeEqual(req.get('x-rx-csrf'), req.user.csrf)) return res.status(403).json({ error: 'CSRF validation failed.' });
    return next();
  };
  const requireCloudAccess = (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    return requireMutationTrust(req, res, next);
  };
  const issueSession = (user) => {
    const issuedAt = Math.floor(now() / 1000);
    const payload = { v: 1, username: user.username, role: user.role, csrf: crypto.randomBytes(32).toString('base64url'), iat: issuedAt, exp: issuedAt + SESSION_TTL_SECONDS, ...(user.managedUserId ? { managedUserId: user.managedUserId, sessionVersion: user.sessionVersion } : {}) };
    return { payload, token: signPayload(payload, config.signingSecret) };
  };
  const authenticate = async (username, password) => {
    const candidates = [
      { username: config.env.ADMIN_USERNAME || 'admin', scrypt: config.env.ADMIN_PASSWORD_SCRYPT, role: ROLES.ADMIN },
    ];
    const user = candidates.find((candidate) => candidate.username === username);
    if (user) return secureScryptMatch(password, user.scrypt) ? user : null;
    if (applicationStore?.getManagedUserByUsername) {
      const managed = await applicationStore.getManagedUserByUsername(String(username || '').trim().toLowerCase());
      if (managed) {
        if (managed.enabled === false || managed.role !== ROLES.USER || !secureScryptMatch(password, managed.password_scrypt)) return null;
        await applicationStore.recordManagedUserLogin?.(managed.user_id);
        return { username: managed.username, role: ROLES.USER, managedUserId: managed.user_id, sessionVersion: managed.session_version };
      }
    }
    const legacy = config.env.USER_USERNAME && config.env.USER_PASSWORD_SCRYPT && config.env.USER_USERNAME === username ? { username: config.env.USER_USERNAME, scrypt: config.env.USER_PASSWORD_SCRYPT, role: ROLES.USER } : null;
    return legacy && secureScryptMatch(password, legacy.scrypt) ? legacy : null;
  };

  app.get('/api/bff/healthz', (req, res) => res.json({ ok: true, status: 'ready' }));
  app.get('/api/auth/status', async (req, res) => {
    const session = config.authEnabled ? await sessionFor(req) : { username: 'admin', role: ROLES.ADMIN, csrf: null };
    res.json({ enabled: config.authEnabled, authenticated: Boolean(session), username: session?.username || null, role: session?.role || null, managedUser: Boolean(session?.managedUserId), canControlledExecute: session?.canControlledExecute === true, csrfToken: session?.csrf || null });
  });
  app.post('/api/auth/login', async (req, res) => {
    const origin = req.get('origin');
    if (origin && !config.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (!config.authEnabled) return res.json({ enabled: false, username: 'admin', role: 'admin' });
    const user = await authenticate(String(req.body?.username || ''), req.body?.password);
    if (!user) return res.status(401).json({ error: 'Invalid username or password.' });
    const session = issueSession(user);
    res.setHeader('Set-Cookie', cookieValue(session.token, config.production, SESSION_TTL_SECONDS));
    return res.json({ username: user.username, role: user.role, managedUser: Boolean(user.managedUserId), expiresAt: session.payload.exp * 1000, csrfToken: session.payload.csrf });
  });
  app.post('/api/auth/logout', requireSession, requireMutationTrust, (req, res) => {
    res.setHeader('Set-Cookie', cookieValue('', config.production, 0));
    res.json({ ok: true });
  });
  app.post('/api/bff/csrf-probe', requireSession, requireMutationTrust, (req, res) => res.json({ ok: true }));

  if (applicationStore) {
    app.use('/api/cloud-read', requireSession, createCloudDashboardReadRouter(applicationStore, { requirePermission }));
    app.use('/api/admin/devices', requireSession, requireCloudAccess, createDeviceAdminRouter({ store: applicationStore, env, requirePermission }));
    app.use('/api/admin/users', requireSession, requireCloudAccess, createUserAdminRouter({ store: applicationStore, env, requirePermission }));
    if (env.RX_BFF_CLOUD_MEDIA_UPLOAD_ENABLED === 'true') app.use('/api/cloud-media', requireSession, requirePermission(PERMISSIONS.MEDIA_WRITE), requireCloudAccess, createCloudMediaUploadRouter(applicationStore));
    // General application/control-plane mutation routes are intentionally not hosted.
    // This reviewed route is opt-in and contains only dashboard metadata edits.
    if (env.RX_BFF_CLOUD_APP_MUTATIONS_ENABLED === 'true') app.use('/api/cloud-mutations', requireSession, requirePermission(PERMISSIONS.CAMPAIGNS_WRITE), requireCloudAccess, createCloudApplicationMutationRouter(applicationStore));
    if (env.RX_BFF_CLOUD_REMOTE_TASKS_ENABLED === 'true') app.use('/api/cloud-remote-tasks', requireSession, requireCloudAccess, createCloudRemoteTaskRouter({ store: applicationStore, agentId: config.syntheticAgentId, profileId: config.syntheticProfileId, chromiumPreflightEnabled: config.chromiumPreflightEnabled, facebookSessionPreflightEnabled: config.facebookSessionPreflightEnabled, facebookSessionAgentId: config.facebookSessionAgentId, facebookSessionProfileId: config.facebookSessionProfileId, controlledExecutionEnabled: config.controlledExecutionEnabled, now }));
  }
  return app;
}

module.exports = { createHostedBffApp, createHostedBffConfig, signPayload, verifyPayload, SESSION_COOKIE, SESSION_TTL_SECONDS };
