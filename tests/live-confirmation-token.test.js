'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  LIVE_CONFIRMATION_TOKEN_PURPOSE,
  LIVE_CONFIRMATION_TOKEN_VERSION,
  LIVE_CONFIRMATION_TOKEN_TTL_SECONDS,
  issueLiveConfirmationToken,
  verifyLiveConfirmationToken,
} = require('../server/live-confirmation-token');

const secret = 'test-live-confirmation-signing-secret-that-is-long-enough';
const now = Date.parse('2026-09-12T10:00:00.000Z');
const owner = { role: 'USER', managedUserId: 'user_immutable_123' };
const intent = { campaignId: 'campaign_123', day: 1, targetId: 'target_123', deviceId: 'agent_123', profileId: 'profile_123' };

function issue(overrides = {}) {
  return issueLiveConfirmationToken({ signingSecret: secret, owner, ...intent, now, ...overrides });
}

function verify(token, overrides = {}) {
  return verifyLiveConfirmationToken({ token, signingSecret: secret, expectedOwner: owner, expectedIntent: intent, now, ...overrides });
}

function resign(claims) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${LIVE_CONFIRMATION_TOKEN_PURPOSE}:${LIVE_CONFIRMATION_TOKEN_VERSION}.${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
}

function assertInvalid(callback, code = 'LIVE_CONFIRMATION_TOKEN_INVALID') {
  assert.throws(callback, (error) => error?.code === code && error.message === 'Live confirmation token is invalid.');
}

test('issues a valid owner- and intent-bound live confirmation token with a ten minute TTL', () => {
  const issued = issue({ randomBytes: () => Buffer.alloc(16, 7) });
  const verified = verify(issued.token);
  assert.equal(issued.confirmationId, Buffer.alloc(16, 7).toString('base64url'));
  assert.equal(issued.expiresAt, (now / 1000) + LIVE_CONFIRMATION_TOKEN_TTL_SECONDS);
  assert.deepEqual(verified, { confirmationId: issued.confirmationId, owner, ...intent, issuedAt: now / 1000, expiresAt: issued.expiresAt });
});

test('the same token verifies repeatedly with the same confirmation ID', () => {
  const issued = issue({ randomBytes: () => Buffer.alloc(16, 8) });
  assert.deepEqual(verify(issued.token), verify(issued.token));
});

test('identical intent receives distinct server-generated confirmation IDs', () => {
  let byte = 0;
  const randomBytes = () => Buffer.alloc(16, ++byte);
  const first = issue({ randomBytes }); const second = issue({ randomBytes });
  assert.notEqual(first.confirmationId, second.confirmationId); assert.notEqual(first.token, second.token);
});

test('rejects tampered payloads and signatures without exposing crypto details', () => {
  const issued = issue({ randomBytes: () => Buffer.alloc(16, 9) });
  const [body, signature] = issued.token.split('.');
  assertInvalid(() => verify(`${body}x.${signature}`));
  assertInvalid(() => verify(`${body}.${signature}x`));
});

test('rejects expired tokens', () => {
  const issued = issue({ randomBytes: () => Buffer.alloc(16, 10) });
  assertInvalid(() => verify(issued.token, { now: now + (LIVE_CONFIRMATION_TOKEN_TTL_SECONDS * 1000) }), 'LIVE_CONFIRMATION_TOKEN_EXPIRED');
});

test('rejects owner and every immutable intent mismatch', () => {
  const issued = issue({ randomBytes: () => Buffer.alloc(16, 11) });
  assertInvalid(() => verify(issued.token, { expectedOwner: { role: 'USER', managedUserId: 'other' } }), 'LIVE_CONFIRMATION_BINDING_MISMATCH');
  for (const [field, value] of Object.entries({ campaignId: 'other-campaign', day: 2, targetId: 'other-target', deviceId: 'other-device', profileId: 'other-profile' })) {
    assertInvalid(() => verify(issued.token, { expectedIntent: { ...intent, [field]: value } }), 'LIVE_CONFIRMATION_BINDING_MISMATCH');
  }
});

test('rejects a validly signed wrong purpose or version', () => {
  const issued = issue({ randomBytes: () => Buffer.alloc(16, 12) });
  const claims = JSON.parse(Buffer.from(issued.token.split('.')[0], 'base64url').toString('utf8'));
  assertInvalid(() => verify(resign({ ...claims, purpose: 'rx.session' })));
  assertInvalid(() => verify(resign({ ...claims, version: 2 })));
});

test('supports bootstrap ADMIN without inventing a managed user identity and rejects legacy USER', () => {
  const admin = { role: 'ADMIN', username: 'admin' };
  const issued = issueLiveConfirmationToken({ signingSecret: secret, owner: admin, ...intent, now, randomBytes: () => Buffer.alloc(16, 13) });
  assert.equal(verifyLiveConfirmationToken({ token: issued.token, signingSecret: secret, expectedOwner: admin, expectedIntent: intent, now }).owner.managedUserId, undefined);
  assertInvalid(() => issue({ owner: { role: 'USER', username: 'legacy-user' } }), 'LIVE_CONFIRMATION_OWNER_INVALID');
});
