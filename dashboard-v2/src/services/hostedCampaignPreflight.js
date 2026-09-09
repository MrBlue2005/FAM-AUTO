import { DEVICE_PROFILE_READINESS } from './hostedDeviceSelection.js';

export const ROUTED_PREFLIGHT_ERROR_MESSAGES = Object.freeze({
  DEVICE_NOT_FOUND: 'Dispozitivul nu mai este disponibil.',
  DEVICE_OFFLINE: 'Dispozitivul este offline.',
  DEVICE_STALE: 'Conexiunea dispozitivului nu mai este actuală.',
  PROFILE_NOT_FOUND: 'Profilul nu mai este disponibil.',
  PROFILE_NOT_READY: 'Profilul nu este pregătit.',
  PROFILE_OWNERSHIP_MISMATCH: 'Profilul nu aparține dispozitivului selectat.',
  CONFLICTING_WORK: 'Profilul este ocupat de o altă execuție.',
});

const reselectionCodes = new Set([
  'DEVICE_NOT_FOUND', 'DEVICE_OFFLINE', 'DEVICE_STALE',
  'PROFILE_NOT_FOUND', 'PROFILE_NOT_READY', 'PROFILE_OWNERSHIP_MISMATCH',
]);

export function campaignPreflightRequestBody({ kind, campaignId, day, targetId, deviceId, profileId, campaignRevision, postRevision }) {
  return {
    kind,
    campaignId,
    day: Number(day),
    targetId,
    deviceId,
    profileId,
    ...(Number.isInteger(campaignRevision) ? { campaignRevision } : {}),
    ...(Number.isInteger(postRevision) ? { postRevision } : {}),
  };
}

export function canRequestRoutedPreflight(selection, intent) {
  return selection?.readiness === DEVICE_PROFILE_READINESS.READY_FOR_PREFLIGHT
    && Boolean(intent?.campaignId) && Number(intent?.day) > 0 && Boolean(intent?.targetId);
}

export function routedPreflightErrorMessage(error) {
  return ROUTED_PREFLIGHT_ERROR_MESSAGES[error?.code] || error?.message || 'Preflight-ul nu a putut fi solicitat.';
}

export function requiresExplicitReselection(error) {
  return reselectionCodes.has(error?.code);
}
