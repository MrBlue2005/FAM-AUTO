export const DASHBOARD_DATA_MODES = Object.freeze({ LOCAL: 'LOCAL', CLOUD_READ_ONLY: 'CLOUD_READ_ONLY' });

export function normalizeDashboardDataMode(value) {
  const mode = String(value || DASHBOARD_DATA_MODES.LOCAL).trim().toUpperCase();
  if (mode === DASHBOARD_DATA_MODES.LOCAL || mode === DASHBOARD_DATA_MODES.CLOUD_READ_ONLY) return mode;
  throw new Error(`VITE_DASHBOARD_DATA_MODE must be LOCAL or CLOUD_READ_ONLY, received: ${mode}`);
}

export function assertCloudReadOnlyRequest(mode, method, endpoint) {
  if (mode === DASHBOARD_DATA_MODES.CLOUD_READ_ONLY
    && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || 'GET').toUpperCase())
    && !['/auth/login', '/auth/logout'].includes(endpoint)) {
    throw new Error('CLOUD_READ_ONLY does not permit dashboard mutations; no local write fallback is available.');
  }
}
