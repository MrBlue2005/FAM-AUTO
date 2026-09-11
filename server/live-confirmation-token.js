'use strict';

// Purpose-separated, stateless authorization artifact for the later live-confirmation
// route. This is deliberately not a session token and is not browser-verifiable.
const crypto = require('crypto');

const LIVE_CONFIRMATION_TOKEN_PURPOSE = 'rx.live-confirmation';
const LIVE_CONFIRMATION_TOKEN_VERSION = 1;
const LIVE_CONFIRMATION_TOKEN_TTL_SECONDS = 10 * 60;
const CONFIRMATION_ID_BYTES = 16;

function tokenError(code) {
  const error = new Error('Live confirmation token is invalid.');
  error.code = code;
  return error;
}

function readNow(now) {
  const value = typeof now === 'function' ? now() : (now ?? Date.now());
  if (!Number.isSafeInteger(value) || value < 0) throw tokenError('LIVE_CONFIRMATION_CLOCK_INVALID');
  return value;
}

function requiredText(value, code) {
  if (typeof value !== 'string' || !value) throw tokenError(code);
  return value;
}

function normalizeOwner(owner) {
  if (!owner || typeof owner !== 'object') throw tokenError('LIVE_CONFIRMATION_OWNER_INVALID');
  if (owner.role === 'USER' && typeof owner.managedUserId === 'string' && owner.managedUserId) {
    return { role: 'USER', managedUserId: owner.managedUserId };
  }
  if (owner.role === 'ADMIN' && typeof owner.username === 'string' && owner.username) {
    return { role: 'ADMIN', username: owner.username };
  }
  // A legacy environment USER has no immutable managed identity and is denied.
  throw tokenError('LIVE_CONFIRMATION_OWNER_INVALID');
}

function normalizeIntent(intent) {
  if (!intent || typeof intent !== 'object') throw tokenError('LIVE_CONFIRMATION_INTENT_INVALID');
  if (!Number.isSafeInteger(intent.day) || intent.day < 1) throw tokenError('LIVE_CONFIRMATION_INTENT_INVALID');
  return {
    campaignId: requiredText(intent.campaignId, 'LIVE_CONFIRMATION_INTENT_INVALID'),
    day: intent.day,
    targetId: requiredText(intent.targetId, 'LIVE_CONFIRMATION_INTENT_INVALID'),
    deviceId: requiredText(intent.deviceId, 'LIVE_CONFIRMATION_INTENT_INVALID'),
    profileId: requiredText(intent.profileId, 'LIVE_CONFIRMATION_INTENT_INVALID'),
  };
}

function signingSecret(secret) {
  return Buffer.from(requiredText(secret, 'LIVE_CONFIRMATION_SIGNING_SECRET_INVALID'), 'utf8');
}

function encodedClaims(claims) {
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

function signatureFor(encoded, secret) {
  // The constant label makes this MAC domain distinct from hosted session MACs.
  return crypto.createHmac('sha256', signingSecret(secret))
    .update(`${LIVE_CONFIRMATION_TOKEN_PURPOSE}:${LIVE_CONFIRMATION_TOKEN_VERSION}.${encoded}`)
    .digest('base64url');
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseToken(token, secret) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra || !safeEqual(signature, signatureFor(encoded, secret))) {
    throw tokenError('LIVE_CONFIRMATION_TOKEN_INVALID');
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw tokenError('LIVE_CONFIRMATION_TOKEN_INVALID');
  }
}

function sameOwner(left, right) {
  return left.role === right.role
    && (left.role === 'USER' ? left.managedUserId === right.managedUserId : left.username === right.username);
}

function sameIntent(left, right) {
  return left.campaignId === right.campaignId && left.day === right.day && left.targetId === right.targetId
    && left.deviceId === right.deviceId && left.profileId === right.profileId;
}

function issueLiveConfirmationToken({ signingSecret: secret, owner, campaignId, day, targetId, deviceId, profileId, now, randomBytes = crypto.randomBytes, ttlSeconds = LIVE_CONFIRMATION_TOKEN_TTL_SECONDS }) {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > LIVE_CONFIRMATION_TOKEN_TTL_SECONDS) {
    throw tokenError('LIVE_CONFIRMATION_TTL_INVALID');
  }
  const issuedAt = Math.floor(readNow(now) / 1000);
  let random;
  try { random = randomBytes(CONFIRMATION_ID_BYTES); } catch { throw tokenError('LIVE_CONFIRMATION_RANDOM_INVALID'); }
  if (!Buffer.isBuffer(random) || random.length < CONFIRMATION_ID_BYTES) throw tokenError('LIVE_CONFIRMATION_RANDOM_INVALID');
  const claims = {
    purpose: LIVE_CONFIRMATION_TOKEN_PURPOSE,
    version: LIVE_CONFIRMATION_TOKEN_VERSION,
    confirmationId: random.subarray(0, CONFIRMATION_ID_BYTES).toString('base64url'),
    owner: normalizeOwner(owner),
    ...normalizeIntent({ campaignId, day, targetId, deviceId, profileId }),
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
  };
  const encoded = encodedClaims(claims);
  return { token: `${encoded}.${signatureFor(encoded, secret)}`, confirmationId: claims.confirmationId, expiresAt: claims.expiresAt };
}

function verifyLiveConfirmationToken({ token, signingSecret: secret, expectedOwner, expectedIntent, now }) {
  const claims = parseToken(token, secret);
  if (!claims || claims.purpose !== LIVE_CONFIRMATION_TOKEN_PURPOSE || claims.version !== LIVE_CONFIRMATION_TOKEN_VERSION
    || typeof claims.confirmationId !== 'string' || !claims.confirmationId
    || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)
    || claims.expiresAt <= claims.issuedAt || claims.expiresAt <= Math.floor(readNow(now) / 1000)) {
    throw tokenError('LIVE_CONFIRMATION_TOKEN_INVALID');
  }
  let owner; let intent;
  try {
    owner = normalizeOwner(claims.owner);
    intent = normalizeIntent(claims);
  } catch {
    throw tokenError('LIVE_CONFIRMATION_TOKEN_INVALID');
  }
  const requiredOwner = normalizeOwner(expectedOwner);
  const requiredIntent = normalizeIntent(expectedIntent);
  if (!sameOwner(owner, requiredOwner) || !sameIntent(intent, requiredIntent)) {
    throw tokenError('LIVE_CONFIRMATION_BINDING_MISMATCH');
  }
  return { confirmationId: claims.confirmationId, owner, ...intent, issuedAt: claims.issuedAt, expiresAt: claims.expiresAt };
}

module.exports = {
  LIVE_CONFIRMATION_TOKEN_PURPOSE,
  LIVE_CONFIRMATION_TOKEN_VERSION,
  LIVE_CONFIRMATION_TOKEN_TTL_SECONDS,
  issueLiveConfirmationToken,
  verifyLiveConfirmationToken,
};
