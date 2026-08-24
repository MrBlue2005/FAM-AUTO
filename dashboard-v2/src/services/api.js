const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_API_KEY || '';
const API_ORIGIN = API_URL.replace(/\/api$/, '');

function getMediaUrl(reference) {
  const value = typeof reference === 'string' ? reference : reference?.path;
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;

  const normalized = value.replace(/\\/g, '/');
  const marker = 'app/uploads/';
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex === -1) return '';

  const relative = normalized.slice(markerIndex + marker.length);
  return `${API_ORIGIN}/uploads/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

async function downloadExport(type) {
  const response = await fetch(`${API_URL}/export/${encodeURIComponent(type)}`, {
    credentials: 'include',
    headers: { ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
  });
  if (!response.ok) throw new Error('Exportul nu a putut fi generat.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `rx-${type}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

async function downloadFile(endpoint, fallbackName) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    credentials: 'include',
    headers: { ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Fisierul nu a putut fi generat.');
  }
  const disposition = response.headers.get('content-disposition') || '';
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function request(endpoint, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { 'x-rx-csrf': '1' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload.error || `Eroare API: ${endpoint}`;
    window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message, type: 'error' } }));
    throw new Error(message);
  }

  return response.json();
}

export const api = {
  getMediaUrl,
  downloadExport,
  getAuthStatus: () => request('/auth/status'),
  login: (credentials) => request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  logout: () => request('/auth/logout', { method: 'POST', body: '{}' }),
  getProperties: () => request('/properties'),
  getPropertyDescriptionTransfer: (transferId) =>
    request(`/property-description-transfers/${encodeURIComponent(transferId)}`),
  saveProperty: (property) =>
    request('/properties', {
      method: 'POST',
      body: JSON.stringify(property),
    }),
  deleteProperty: (propertyId) =>
    request(`/properties/${propertyId}`, {
      method: 'DELETE',
    }),

  getJobs: () => request('/jobs'),
  saveJob: (job) =>
    request('/jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    }),
  deleteJob: (jobId) =>
    request(`/jobs/${jobId}`, {
      method: 'DELETE',
    }),

  getGroups: () => request('/groups'),
  saveGroups: (groups) =>
    request('/groups', {
      method: 'POST',
      body: JSON.stringify(groups),
    }),

  getHistory: () => request('/history'),
  getAudit: ({ limit = 100 } = {}) => request(`/audit?limit=${encodeURIComponent(limit)}`),
  getDashboardSummary: () => request('/dashboard/summary'),
  getHealth: () => request('/health'),
  getLiveFeed: ({ limit = 120 } = {}) => request(`/live-feed?limit=${encodeURIComponent(limit)}`),
  getPropertyLogs: () => request('/property-logs'),
  clearPropertyHistory: (propertyId) =>
    request(`/history/clear-property/${propertyId}`, {
      method: 'POST',
    }),
  clearAllHistory: () =>
    request('/history/clear-all', {
      method: 'POST',
    }),

  getRuntimeConfig: () => request('/runtime-config'),
  saveRuntimeConfig: (config) =>
    request('/runtime-config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  importRuntimeConfig: (config) =>
    request('/runtime-config/import', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  exportRuntimeConfigUrl: `${API_URL}/runtime-config/export`,
  exportBackupUrl: `${API_URL}/backup/export`,
  importBackup: (backup) => request('/backup/import', { method: 'POST', body: JSON.stringify(backup) }),
  getFacebookProfiles: () => request('/facebook-profiles'),
  setupFacebookProfile: (profileId) =>
    request(`/facebook-profiles/${encodeURIComponent(profileId)}/setup`, {
      method: 'POST',
    }),
  finishFacebookProfileSetup: (profileId) =>
    request(`/facebook-profiles/${encodeURIComponent(profileId)}/setup/finish`, {
      method: 'POST',
    }),

  getQueuePlan: () => request('/queue/plan'),
  excludeQueueTask: ({ taskId, excluded }) =>
    request('/queue/exclude', {
      method: 'POST',
      body: JSON.stringify({ taskId, excluded }),
    }),
  retryQueueTask: ({ taskId, retry }) =>
    request('/queue/retry', {
      method: 'POST',
      body: JSON.stringify({ taskId, retry }),
    }),
  reorderQueue: (taskIds) =>
    request('/queue/reorder', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    }),
  getCampaignPreview: ({ category, campaignId, day }) =>
    request(
      `/campaign-preview?category=${encodeURIComponent(category)}&campaignId=${encodeURIComponent(
        campaignId || ''
      )}&day=${encodeURIComponent(day || '')}`
    ),
  getValidations: () => request('/validations'),
  getPreflight: () => request('/preflight'),
  getDiagnostics: () => request('/diagnostics'),
  getGroupedErrors: () => request('/logs/errors'),
  getLatestReport: () => request('/reports/latest'),
  exportLatestReportUrl: `${API_URL}/reports/latest/export`,
  downloadExcelReport: (range = 'all') => downloadFile(`/reports/latest/excel?range=${encodeURIComponent(range)}`, `rx-campaign-report-${new Date().toISOString().slice(0, 10)}.xlsx`),

  getRuns: ({ status = 'all', search = '' } = {}) => request(`/runs?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`),
  getRun: (runId) => request(`/runs/${encodeURIComponent(runId)}`),
  downloadRunExcel: (runId) => downloadFile(`/runs/${encodeURIComponent(runId)}/excel`, `rx-run-${runId}.xlsx`),
  retryRunErrors: (runId) => request(`/runs/${encodeURIComponent(runId)}/retry-errors`, { method: 'POST', body: '{}' }),
  archiveRun: (runId, archived = true) => request(`/runs/${encodeURIComponent(runId)}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),

  getSchedules: () => request('/schedules'),
  createScheduleFolder: (name) => request('/schedule-folders', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteScheduleFolder: (folderId) => request(`/schedule-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' }),
  createSchedule: (schedule) => request('/schedules', { method: 'POST', body: JSON.stringify(schedule) }),
  updateSchedule: (scheduleId, schedule) => request(`/schedules/${encodeURIComponent(scheduleId)}`, { method: 'PUT', body: JSON.stringify(schedule) }),
  deleteSchedule: (scheduleId) => request(`/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' }),
  runScheduleNow: (scheduleId) => request(`/schedules/${encodeURIComponent(scheduleId)}/run-now`, { method: 'POST', body: '{}' }),

  getOverlayStatus: () => request('/overlay/status'),
  openDesktopOverlay: () =>
    request('/overlay/desktop/open', {
      method: 'POST',
    }),

  getMedia: () => request('/media'),
  deleteMedia: (path) => request('/media', { method: 'DELETE', body: JSON.stringify({ path }) }),
  cleanupUnusedMedia: () => request('/media/cleanup-unused', { method: 'POST', body: '{}' }),

  uploadMedia: ({ propertyId, day, files, onProgress, signal }) => {
    const formData = new FormData();

    formData.append('propertyId', propertyId || 'TEMP');
    formData.append('day', day);

    Array.from(files).forEach((file) => {
      formData.append('files', file);
    });

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/media/upload`);
      if (API_KEY) xhr.setRequestHeader('x-api-key', API_KEY);
      xhr.withCredentials = true;
      xhr.setRequestHeader('x-rx-csrf', '1');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        const payload = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else reject(new Error(payload.error || 'Media upload failed'));
      };
      xhr.onerror = () => reject(new Error('Conexiunea pentru upload a esuat.'));
      xhr.onabort = () => reject(new DOMException('Upload anulat.', 'AbortError'));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(formData);
    });
  },

  getRobotStatus: () => request('/robot/status'),

  startRobot: (options = {}) =>
    request('/robot/start', {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  stopRobot: () =>
    request('/robot/stop', {
      method: 'POST',
    }),

  pauseRobot: () =>
    request('/robot/pause', {
      method: 'POST',
    }),

  resumeRobot: () =>
    request('/robot/resume', {
      method: 'POST',
    }),

  stopRobotAfterCurrent: () =>
    request('/robot/stop-after-current', {
      method: 'POST',
    }),
};
