import { DASHBOARD_DATA_MODES, normalizeDashboardDataMode, assertCloudReadOnlyRequest, dashboardCapabilities, cloudMediaUploadEnabled, cloudApplicationMutationsEnabled } from './dashboardDataMode';
import { createEphemeralPreviewCache } from './cloudMediaPreview';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_API_KEY || '';
const API_ORIGIN = API_URL.replace(/\/api$/, '');
export const dashboardDataMode = normalizeDashboardDataMode(import.meta.env.VITE_DASHBOARD_DATA_MODE);
const cloudReadOnly = dashboardDataMode === DASHBOARD_DATA_MODES.CLOUD_READ_ONLY;
const cloudMediaUpload = cloudMediaUploadEnabled(dashboardDataMode, import.meta.env.VITE_CLOUD_MEDIA_UPLOAD_ENABLED);
const cloudApplicationMutations = cloudApplicationMutationsEnabled(dashboardDataMode, import.meta.env.VITE_CLOUD_APP_MUTATIONS_ENABLED);
const cloudRemoteTasks = cloudReadOnly && import.meta.env.VITE_CLOUD_REMOTE_TASKS_ENABLED === 'true';
const cloudChromiumPreflight = cloudRemoteTasks && import.meta.env.VITE_CHROMIUM_PREFLIGHT_ENABLED === 'true';
const cloudFacebookSessionPreflight = cloudRemoteTasks && import.meta.env.VITE_FACEBOOK_SESSION_PREFLIGHT_ENABLED === 'true';
let hostedCsrfToken = '';
const cloudRevisions = new Map();
async function rememberCloudRevisions(kind, rows) {
  if (!cloudApplicationMutations || !Array.isArray(rows)) return rows;
  await Promise.all(rows.map(async (row) => {
    const result = await cloudMutation(`/revisions/${encodeURIComponent(kind)}/${encodeURIComponent(row.id)}`);
    if (Number.isInteger(result?.revision)) cloudRevisions.set(`${kind}:${row.id}`, result.revision);
  }));
  return rows;
}
async function cloudRevision(kind, id) {
  const cached = cloudRevisions.get(`${kind}:${id}`);
  if (Number.isInteger(cached)) return cached;
  const result = await cloudMutation(`/revisions/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
  if (!Number.isInteger(result?.revision)) throw new Error('A current cloud revision is required. Reload the data and try again.');
  return result.revision;
}
async function cloudCampaignSave(kind, value) {
  const revision = await cloudRevision(kind, value.id);
  return cloudMutation(kind === 'job' ? '/jobs' : '/properties', { method: 'POST', body: JSON.stringify({ ...value, revision }) });
}
const cloudMediaPreviewCache = createEphemeralPreviewCache({ requestPreview: (mediaId) => cloudRead(`/media/${encodeURIComponent(mediaId)}/preview`) });

function cloudRead(endpoint) {
  return request(`/cloud-read${endpoint}`);
}
function cloudMutation(endpoint, options) {
  if (!cloudApplicationMutations) throw new Error('Cloud application mutations are disabled; no local write fallback is available.');
  return request(`/cloud-mutations${endpoint}`, options);
}

function cacheHostedCsrf(payload) {
  if (typeof payload?.csrfToken === 'string') hostedCsrfToken = payload.csrfToken;
  return payload;
}

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
  if (cloudReadOnly) throw new Error('CLOUD_READ_ONLY does not provide local exports; no local read fallback is available.');
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
  if (cloudReadOnly) throw new Error('CLOUD_READ_ONLY does not provide local report downloads; no local read fallback is available.');
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
  const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const enabledCloudMutation = cloudApplicationMutations && endpoint.startsWith('/cloud-mutations/');
  const enabledRemoteTask = cloudRemoteTasks && endpoint.startsWith('/cloud-remote-tasks/');
  if (!(cloudMediaUpload && endpoint.startsWith('/cloud-media/')) && !enabledCloudMutation && !enabledRemoteTask) assertCloudReadOnlyRequest(dashboardDataMode, method, endpoint);
  if (cloudReadOnly && !endpoint.startsWith('/cloud-read/') && !endpoint.startsWith('/cloud-media/') && !endpoint.startsWith('/cloud-mutations/') && !endpoint.startsWith('/cloud-remote-tasks/') && !endpoint.startsWith('/auth/')) {
    throw new Error('This dashboard feature is unavailable in CLOUD_READ_ONLY; no local read fallback is available.');
  }
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      ...(mutation ? { 'x-rx-csrf': cloudReadOnly ? hostedCsrfToken : '1' } : {}),
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
  dashboardDataMode,
  isCloudReadOnly: () => cloudReadOnly,
  isCloudMediaUploadEnabled: () => cloudMediaUpload,
  isCloudApplicationMutationsEnabled: () => cloudApplicationMutations,
  isCloudRemoteTasksEnabled: () => cloudRemoteTasks,
  isCloudChromiumPreflightEnabled: () => cloudChromiumPreflight,
  isCloudFacebookSessionPreflightEnabled: () => cloudFacebookSessionPreflight,
  capabilities: () => ({ ...dashboardCapabilities(dashboardDataMode), applicationMutations: cloudApplicationMutations, mediaUpload: cloudMediaUpload, remoteTasks: cloudRemoteTasks, chromiumPreflight: cloudChromiumPreflight }),
  getMediaUrl,
  getMediaPreviewUrl: (media) => {
    if (!cloudReadOnly) return Promise.resolve(getMediaUrl(media));
    return cloudMediaPreviewCache.resolve(typeof media === 'string' ? media : media?.mediaId || media?.id);
  },
  getAgentStatus: () => cloudRead('/agent-status'),
  createCampaignPreflightTask: ({ kind, campaignId, day, targetId, campaignRevision, postRevision }) => request('/cloud-remote-tasks/campaign-preflight', { method: 'POST', body: JSON.stringify({ kind, campaignId, day, targetId, campaignRevision, postRevision }) }),
  getCampaignPreflightTask: (taskId) => request(`/cloud-remote-tasks/campaign-preflight/${encodeURIComponent(taskId)}`),
  createChromiumSafePreflightTask: () => request('/cloud-remote-tasks/chromium-safe-preflight', { method: 'POST', body: '{}' }),
  getChromiumSafePreflightTask: (taskId) => request(`/cloud-remote-tasks/chromium-safe-preflight/${encodeURIComponent(taskId)}`),
  createFacebookSessionReadinessTask: () => request('/cloud-remote-tasks/facebook-session-readiness', { method: 'POST', body: '{}' }),
  refreshMediaPreviewUrl: (media) => {
    const mediaId = typeof media === 'string' ? media : media?.mediaId || media?.id;
    cloudMediaPreviewCache.invalidate(mediaId);
    return cloudMediaPreviewCache.resolve(mediaId);
  },
  downloadExport,
  getAuthStatus: () => request('/auth/status').then(cacheHostedCsrf),
  login: (credentials) => request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }).then(cacheHostedCsrf),
  logout: () => request('/auth/logout', { method: 'POST', body: '{}' }).then((payload) => { hostedCsrfToken = ''; return payload; }),
  getProperties: () => cloudReadOnly ? cloudRead('/properties').then((rows) => rememberCloudRevisions('property', rows)) : request('/properties'),
  getPropertyDescriptionTransfer: (transferId) =>
    request(`/property-description-transfers/${encodeURIComponent(transferId)}`),
  saveProperty: (property) =>
    cloudReadOnly ? cloudCampaignSave('property', property) : request('/properties', {
      method: 'POST',
      body: JSON.stringify(property),
    }),
  updateProperty: (propertyId, property) =>
    cloudReadOnly ? cloudRevision('property', propertyId).then((revision) => cloudMutation(`/properties/${encodeURIComponent(propertyId)}`, {
      method: 'PUT', body: JSON.stringify({ ...property, revision }),
    })) : request(`/properties/${encodeURIComponent(propertyId)}`, {
      method: 'PUT',
      body: JSON.stringify(property),
    }),
  deleteProperty: (propertyId) =>
    cloudReadOnly ? cloudRevision('property', propertyId).then((revision) => cloudMutation(`/properties/${encodeURIComponent(propertyId)}`, {
      method: 'DELETE', body: JSON.stringify({ revision }),
    })) : request(`/properties/${propertyId}`, {
      method: 'DELETE',
    }),

  getCampaignFolders: () => cloudReadOnly ? cloudRead('/campaign-folders') : request('/campaign-folders'),
  createCampaignFolder: (name) => cloudReadOnly ? cloudMutation('/campaign-folders', { method: 'POST', body: JSON.stringify({ name }) }) : request('/campaign-folders', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteCampaignFolder: (folderId) => cloudReadOnly ? cloudMutation(`/campaign-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE', body: '{}' }) : request(`/campaign-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' }),

  getJobs: () => cloudReadOnly ? cloudRead('/jobs').then((rows) => rememberCloudRevisions('job', rows)) : request('/jobs'),
  saveJob: (job) =>
    cloudReadOnly ? cloudCampaignSave('job', job) : request('/jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    }),
  deleteJob: (jobId) =>
    cloudReadOnly ? cloudRevision('job', jobId).then((revision) => cloudMutation(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', body: JSON.stringify({ revision }) })) : request(`/jobs/${jobId}`, {
      method: 'DELETE',
    }),

  getGroups: () => cloudReadOnly ? cloudRead('/groups').then((rows) => rememberCloudRevisions('group', rows)) : request('/groups'),
  saveGroups: (groups) =>
    cloudReadOnly ? Promise.all(groups.map(async (group) => ({ ...group, revision: await cloudRevision('group', group.id) }))).then((rows) => cloudMutation('/groups', { method: 'POST', body: JSON.stringify(rows) })) : request('/groups', {
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
    (cloudReadOnly ? cloudRead : request)(
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
  getReportProfiles: () => request('/reports/profiles'),
  downloadExcelReport: ({ range = 'all', profileId = 'all' } = {}) => downloadFile(
    `/reports/latest/excel?range=${encodeURIComponent(range)}&profileId=${encodeURIComponent(profileId)}`,
    `rx-campaign-report-${new Date().toISOString().slice(0, 10)}.xlsx`
  ),

  getRuns: ({ status = 'all', search = '', profileId = 'all' } = {}) => request(`/runs?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&profileId=${encodeURIComponent(profileId)}`),
  getRun: (runId) => request(`/runs/${encodeURIComponent(runId)}`),
  downloadRunExcel: (runId) => downloadFile(`/runs/${encodeURIComponent(runId)}/excel`, `rx-run-${runId}.xlsx`),
  retryRunErrors: (runId) => request(`/runs/${encodeURIComponent(runId)}/retry-errors`, { method: 'POST', body: '{}' }),
  archiveRun: (runId, archived = true) => request(`/runs/${encodeURIComponent(runId)}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),

  getSchedules: () => cloudReadOnly ? cloudRead('/schedules').then(async (result) => ({ ...result, schedules: await rememberCloudRevisions('schedule', result.schedules) })) : request('/schedules'),
  createScheduleFolder: (name) => cloudReadOnly ? cloudMutation('/schedule-folders', { method: 'POST', body: JSON.stringify({ name }) }) : request('/schedule-folders', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteScheduleFolder: (folderId) => cloudReadOnly ? cloudMutation(`/schedule-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE', body: '{}' }) : request(`/schedule-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' }),
  createSchedule: (schedule) => cloudReadOnly ? cloudMutation('/schedules', { method: 'POST', body: JSON.stringify(schedule) }) : request('/schedules', { method: 'POST', body: JSON.stringify(schedule) }),
  updateSchedule: (scheduleId, schedule) => cloudReadOnly ? cloudRevision('schedule', scheduleId).then((revision) => cloudMutation(`/schedules/${encodeURIComponent(scheduleId)}`, { method: 'PUT', body: JSON.stringify({ ...schedule, revision }) })) : request(`/schedules/${encodeURIComponent(scheduleId)}`, { method: 'PUT', body: JSON.stringify(schedule) }),
  deleteSchedule: (scheduleId) => cloudReadOnly ? cloudRevision('schedule', scheduleId).then((revision) => cloudMutation(`/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE', body: JSON.stringify({ revision }) })) : request(`/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' }),
  runScheduleNow: (scheduleId) => request(`/schedules/${encodeURIComponent(scheduleId)}/run-now`, { method: 'POST', body: '{}' }),

  getOverlayStatus: () => request('/overlay/status'),
  openDesktopOverlay: () =>
    request('/overlay/desktop/open', {
      method: 'POST',
    }),

  getMedia: () => cloudReadOnly ? cloudRead('/media') : request('/media'),
  uploadCloudMedia: async ({ file, campaignId, kind, day, onProgress, signal }) => {
    if (!cloudMediaUpload) throw new Error('Cloud media upload is not enabled; no local upload fallback is available.');
    const bytes = new Uint8Array(await file.arrayBuffer()); const hash = await crypto.subtle.digest('SHA-256', bytes); const sha256 = Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, '0')).join('');
    const initiated = await request('/cloud-media/initiate', { method: 'POST', body: JSON.stringify({ originalName: file.name, mimeType: file.type, byteSize: file.size, sha256 }) });
    const response = await fetch(initiated.upload.url, { method: 'PUT', headers: { authorization: `Bearer ${initiated.upload.token}`, 'content-type': file.type }, body: file, signal });
    if (!response.ok) throw new Error('Cloud Storage upload failed; media remains staged.'); onProgress?.(100);
    const finalized = await request(`/cloud-media/${encodeURIComponent(initiated.media.mediaId)}/finalize`, { method: 'POST', body: '{}' });
    if (finalized.media.state !== 'READY') throw new Error('Cloud media was not verified as READY.');
    await request('/cloud-media/attach', { method: 'POST', body: JSON.stringify({ campaignId, kind, day, mediaId: finalized.media.mediaId }) });
    return { mediaId: finalized.media.mediaId, type: file.type.startsWith('video/') ? 'video' : 'image', name: file.name };
  },
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

  stopRobotProfile: (profileId) =>
    request('/robot/stop-profile', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    }),

  pauseRobot: () =>
    request('/robot/pause', {
      method: 'POST',
    }),

  pauseRobotProfile: (profileId) =>
    request('/robot/pause-profile', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    }),

  resumeRobot: () =>
    request('/robot/resume', {
      method: 'POST',
    }),

  resumeRobotProfile: (profileId) =>
    request('/robot/resume-profile', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    }),

  stopRobotAfterCurrent: () =>
    request('/robot/stop-after-current', {
      method: 'POST',
    }),
};
