'use strict';

const { normalizeExpectedFacebookAccountId } = require('./FacebookIdentityConfig');

const FACEBOOK_SESSION_ORIGIN = 'https://www.facebook.com';

function approvedFacebookCookieDomain(domain) {
  const value = String(domain || '').toLowerCase().replace(/^\.+/, '');
  return value === 'facebook.com' || value === 'www.facebook.com';
}

// `c_user` is Facebook's active-session numeric account identifier. The
// browser context is queried only for that cookie at the explicit Facebook
// origin; the value is immediately normalized/equality-checked and is never
// logged, persisted, or returned through any DTO.
async function getAuthenticatedFacebookAccountId(page) {
  const context = typeof page?.context === 'function' ? page.context() : null;
  if (!context || typeof context.cookies !== 'function') return null;
  let cookies;
  try {
    cookies = await context.cookies([FACEBOOK_SESSION_ORIGIN]);
  } catch {
    return null;
  }
  const identities = new Set();
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (cookie?.name !== 'c_user' || !approvedFacebookCookieDomain(cookie.domain)) continue;
    try {
      const identity = normalizeExpectedFacebookAccountId(cookie.value);
      if (identity) identities.add(identity);
    } catch {
      return null;
    }
  }
  return identities.size === 1 ? [...identities][0] : null;
}

function identityFailure(code) {
  return Object.assign(new Error('Facebook session identity could not be verified.'), { code });
}

async function verifyAuthenticatedFacebookAccountId(page, expectedFacebookAccountId) {
  const actualFacebookAccountId = await getAuthenticatedFacebookAccountId(page);
  if (!actualFacebookAccountId) throw identityFailure('FACEBOOK_IDENTITY_UNVERIFIED');
  if (actualFacebookAccountId !== expectedFacebookAccountId) throw identityFailure('FACEBOOK_IDENTITY_MISMATCH');
}

module.exports = {
  FACEBOOK_SESSION_ORIGIN,
  approvedFacebookCookieDomain,
  getAuthenticatedFacebookAccountId,
  verifyAuthenticatedFacebookAccountId,
};
