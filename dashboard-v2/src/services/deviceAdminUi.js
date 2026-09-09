export const DEVICE_DISPLAY_NAME_MAX_LENGTH = 80;

// Kept separate from the page so the reviewed input contract is deterministic:
// only a trimmed display name can cross the admin API boundary.
export function validateDeviceDisplayName(value) {
  const displayName = String(value || '').trim();
  if (!displayName || displayName.length > DEVICE_DISPLAY_NAME_MAX_LENGTH) {
    return { displayName: '', error: 'Numele dispozitivului trebuie să aibă între 1 și 80 de caractere.' };
  }
  return { displayName, error: '' };
}
