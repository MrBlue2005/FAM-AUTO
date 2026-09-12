import { campaignPreflightRequestBody } from './hostedCampaignPreflight.js';

const TOKEN_ERROR_CODES = new Set([
  'LIVE_CONFIRMATION_INVALID',
  'LIVE_CONFIRMATION_EXPIRED',
  'LIVE_CONFIRMATION_MISMATCH',
]);

export function reviewedLiveIntent(intent) {
  return Object.freeze(campaignPreflightRequestBody(intent || {}));
}

export function sameLiveIntent(left, right) {
  const a = reviewedLiveIntent(left); const b = reviewedLiveIntent(right);
  return a.kind === b.kind && a.campaignId === b.campaignId && a.day === b.day
    && a.targetId === b.targetId && a.deviceId === b.deviceId && a.profileId === b.profileId
    && a.campaignRevision === b.campaignRevision && a.postRevision === b.postRevision;
}

export function hasReviewedLiveIntent(intent) {
  const reviewed = reviewedLiveIntent(intent);
  return ['property', 'job'].includes(reviewed.kind) && Number.isInteger(reviewed.day) && reviewed.day > 0
    && Boolean(reviewed.campaignId) && Boolean(reviewed.targetId) && Boolean(reviewed.deviceId) && Boolean(reviewed.profileId);
}

export function isLiveConfirmationExpired(expiresAt, now = Date.now()) {
  return !Number.isFinite(Number(expiresAt)) || Number(expiresAt) * 1000 <= now;
}

export function isLiveConfirmationTokenError(error) {
  return TOKEN_ERROR_CODES.has(error?.code);
}

// Holds the opaque token only in transient browser memory. Snapshots intentionally
// omit it so React rendering and UI diagnostics cannot display or persist it.
export function createLiveConfirmationFlow({ now = () => Date.now() } = {}) {
  let frozenIntent = null; let confirmationToken = null; let expiresAt = null; let issuing = false; let pending = false;
  const clear = () => { frozenIntent = null; confirmationToken = null; expiresAt = null; };
  const snapshot = () => ({ dialogOpen: Boolean(confirmationToken), issuing, pending, intent: frozenIntent, expiresAt, expired: Boolean(confirmationToken) && isLiveConfirmationExpired(expiresAt, now()) });
  return {
    snapshot,
    cancel: () => { if (pending) return snapshot(); clear(); return snapshot(); },
    invalidateIfIntentChanged: (currentIntent) => {
      if (confirmationToken && !sameLiveIntent(frozenIntent, currentIntent)) { clear(); return true; }
      return false;
    },
    async open(intent, issue, currentIntent = () => intent) {
      if (issuing || pending || confirmationToken) return { ignored: true, state: snapshot() };
      const reviewed = reviewedLiveIntent(intent); issuing = true;
      try {
        if (!hasReviewedLiveIntent(reviewed)) throw new Error('Selectează o intenție validă pentru publicare.');
        const issued = await issue(reviewed);
        if (!issued?.confirmationToken || !Number.isFinite(Number(issued.expiresAt))) throw new Error('Confirmarea nu a putut fi inițiată.');
        if (!sameLiveIntent(reviewed, currentIntent())) return { selectionChanged: true, state: snapshot() };
        frozenIntent = reviewed; confirmationToken = issued.confirmationToken; expiresAt = Number(issued.expiresAt);
        return { opened: true, state: snapshot() };
      } catch (error) { return { error, state: snapshot() }; }
      finally { issuing = false; }
    },
    async submit(currentIntent, create) {
      if (pending || !confirmationToken) return { ignored: true, state: snapshot() };
      if (isLiveConfirmationExpired(expiresAt, now())) return { expired: true, state: snapshot() };
      if (!sameLiveIntent(frozenIntent, currentIntent)) { clear(); return { selectionChanged: true, state: snapshot() }; }
      pending = true;
      try {
        const result = await create({ ...frozenIntent, confirmationToken });
        clear();
        return { result, state: snapshot() };
      } catch (error) {
        const invalidated = isLiveConfirmationTokenError(error);
        if (invalidated) clear();
        return { error, invalidated, state: snapshot() };
      } finally { pending = false; }
    },
  };
}
