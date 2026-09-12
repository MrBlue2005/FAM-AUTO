'use strict';

// Facebook numeric account/profile identifiers are stable, opaque strings.
// They are deliberately configured only on the trusted local browser profile;
// task payloads and browser input are never an authority for this value.
const FACEBOOK_ACCOUNT_ID_PATTERN = /^[1-9][0-9]{4,24}$/;

function identityError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeExpectedFacebookAccountId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw identityError('FACEBOOK_IDENTITY_CONFIG_INVALID', 'Expected Facebook account ID must be a canonical numeric string.');
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (!FACEBOOK_ACCOUNT_ID_PATTERN.test(normalized)) {
    throw identityError('FACEBOOK_IDENTITY_CONFIG_INVALID', 'Expected Facebook account ID must be a canonical numeric string.');
  }
  return normalized;
}

function requireExpectedFacebookAccountId(profile) {
  const value = normalizeExpectedFacebookAccountId(profile?.expectedFacebookAccountId);
  if (!value) {
    throw identityError('FACEBOOK_IDENTITY_NOT_CONFIGURED', 'The local browser profile has no reviewed Facebook account identity.');
  }
  return value;
}

module.exports = {
  FACEBOOK_ACCOUNT_ID_PATTERN,
  normalizeExpectedFacebookAccountId,
  requireExpectedFacebookAccountId,
};
