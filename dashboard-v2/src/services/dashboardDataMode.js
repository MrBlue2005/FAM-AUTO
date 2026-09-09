export const DASHBOARD_DATA_MODES = Object.freeze({ LOCAL: 'LOCAL', CLOUD_READ_ONLY: 'CLOUD_READ_ONLY' });
export const CLOUD_READ_ONLY_CAPABILITIES = Object.freeze({ signedMediaPreview: true, applicationMutations: false, mediaUpload: false, mediaCleanup: false, runtimeAndRobot: false, schedulerExecution: false, historyAndReports: false, copywriterTransfer: false });

export function normalizeDashboardDataMode(value) {
  const mode = String(value || DASHBOARD_DATA_MODES.LOCAL).trim().toUpperCase();
  if (mode === DASHBOARD_DATA_MODES.LOCAL || mode === DASHBOARD_DATA_MODES.CLOUD_READ_ONLY) return mode;
  throw new Error(`VITE_DASHBOARD_DATA_MODE must be LOCAL or CLOUD_READ_ONLY, received: ${mode}`);
}

export function assertCloudReadOnlyRequest(mode, method, endpoint) {
  if (mode !== DASHBOARD_DATA_MODES.CLOUD_READ_ONLY) return;
  const path = String(endpoint || ''); const verb = String(method || 'GET').toUpperCase();
  const hosted = path.startsWith('/cloud-read/') || path.startsWith('/cloud-mutations/') || path.startsWith('/cloud-media/') || path.startsWith('/cloud-remote-tasks/') || path.startsWith('/admin/') || ['/auth/login', '/auth/logout', '/auth/status'].includes(path);
  if (!hosted) throw new Error('CLOUD_READ_ONLY does not permit machine-local API access; no local write fallback or localhost fallback is available.');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb) && !path.startsWith('/cloud-mutations/') && !path.startsWith('/cloud-media/') && !path.startsWith('/cloud-remote-tasks/') && !path.startsWith('/admin/') && !['/auth/login', '/auth/logout'].includes(path)) throw new Error('CLOUD_READ_ONLY does not permit dashboard mutations; no local write fallback is available.');
}

export function dashboardCapabilities(mode) {
  return mode === DASHBOARD_DATA_MODES.CLOUD_READ_ONLY
    ? CLOUD_READ_ONLY_CAPABILITIES
    : { signedMediaPreview: false, applicationMutations: true, mediaUpload: true, mediaCleanup: true, runtimeAndRobot: true, schedulerExecution: true, historyAndReports: true, copywriterTransfer: true };
}

export function cloudReadOnlyUnavailableMessage(feature = 'Aceasta actiune') {
  return `${feature} nu este disponibila in CLOUD_READ_ONLY. Nu exista fallback catre datele locale.`;
}

export function cloudMediaUploadEnabled(mode, value) { return mode === DASHBOARD_DATA_MODES.CLOUD_READ_ONLY && value === 'true'; }
export function cloudApplicationMutationsEnabled(mode, value) { return mode === DASHBOARD_DATA_MODES.CLOUD_READ_ONLY && value === 'true'; }
