const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeCampaignMedia } = require('../utils/mediaPath');
const { dataPath, logsPath } = require('../config/storagePaths');

const defaultRuntimeConfig = {
  campaignDay: 1,
  groupLimit: 1,
  startFromGroup: 1,
  publishEnabled: false,
  selectedPropertyIds: [],
  stopAfterCurrentGroup: false,
  campaignCategory: 'real_estate',
  selectedGroupListCategory: 'Romania',
  facebookProfileId: 'main',
  facebookProfiles: [
    {
      id: 'main',
      label: 'Profil principal',
      profilePath: 'chrome-profile',
      category: 'real_estate',
      useSavedLoginIdentity: true,
    },
    {
      id: 'jobs',
      label: 'Profil joburi',
      profilePath: 'chrome-profile-jobs',
      category: 'jobs',
      useSavedLoginIdentity: true,
    },
  ],
  postingIdentityByCategory: {
    real_estate: 'default',
    jobs: 'jobs_page',
  },
  postingIdentityByProfile: {},
  queueExcludedTaskIds: [],
  queueRetryTaskIds: [],
  queueOrder: [],
  facebookPostingIdentities: [
    {
      id: 'default',
      label: 'Identitate implicita',
      actorName: '',
    },
    {
      id: 'jobs_page',
      label: 'Pagina joburi',
      actorName: '',
    },
  ],
};

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  const data = fs.readFileSync(filePath, 'utf8');

  if (!data.trim()) return fallback;

  return JSON.parse(data);
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function useDefaultIfEmpty(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

function assertEntityId(value, label) {
  if (!value) throw new Error(`${label} ID lipsa.`);
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`${label} ID contine caractere nepermise.`);
}

/* GROUPS */

function getGroups() {
  return readJson(path.join(dataPath, 'groups.json'), []);
}

function saveGroups(groups) {
  if (!Array.isArray(groups)) throw new Error('Lista de grupuri trebuie sa fie un array.');
  writeJson(path.join(dataPath, 'groups.json'), groups);
  return groups;
}

/* SCHEDULES */

function getSchedules() {
  return readJson(path.join(dataPath, 'schedules.json'), []);
}

function saveSchedules(schedules) {
  writeJson(path.join(dataPath, 'schedules.json'), schedules);
  return schedules;
}

function pruneSchedulesForCampaign(schedules, campaignId, campaignCategory) {
  const normalizedCategory = campaignCategory === 'jobs' ? 'jobs' : 'real_estate';
  let updatedCount = 0;
  let removedCount = 0;

  const nextSchedules = (Array.isArray(schedules) ? schedules : []).flatMap((schedule) => {
    const scheduleCategory = schedule?.campaignCategory === 'jobs' ? 'jobs' : 'real_estate';
    const campaignIds = Array.isArray(schedule?.campaignIds) ? schedule.campaignIds : [];

    if (scheduleCategory !== normalizedCategory || !campaignIds.includes(campaignId)) {
      return [schedule];
    }

    const remainingCampaignIds = campaignIds.filter((id) => id !== campaignId);

    if (!remainingCampaignIds.length) {
      removedCount += 1;
      return [];
    }

    updatedCount += 1;
    return [{
      ...schedule,
      campaignIds: remainingCampaignIds,
      updatedAt: new Date().toISOString(),
    }];
  });

  return { schedules: nextSchedules, updatedCount, removedCount };
}

function removeCampaignFromSchedules(campaignId, campaignCategory) {
  const result = pruneSchedulesForCampaign(getSchedules(), campaignId, campaignCategory);

  if (result.updatedCount || result.removedCount) {
    saveSchedules(result.schedules);
  }

  return result;
}

/* PROPERTIES */

function getProperties() {
  const propertiesDir = path.join(dataPath, 'properties');

  if (!fs.existsSync(propertiesDir)) return [];

  return fs
    .readdirSync(propertiesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => normalizeCampaignMedia(readJson(path.join(propertiesDir, file), null)))
    .filter(Boolean);
}

function saveProperty(property) {
  const propertiesDir = path.join(dataPath, 'properties');

  assertEntityId(property?.id, 'Property');

  if (!property.id) {
    throw new Error('Property ID lipsă.');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(property.id)) throw new Error('Property ID contine caractere nepermise.');

  const normalizedProperty = normalizeCampaignMedia(property);
  writeJson(path.join(propertiesDir, `${property.id}.json`), normalizedProperty);

  return normalizedProperty;
}

function deleteProperty(propertyId) {
  assertEntityId(propertyId, 'Property');
  const propertiesDir = path.join(dataPath, 'properties');
  const filePath = path.join(propertiesDir, `${propertyId}.json`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  removeCampaignFromSchedules(propertyId, 'real_estate');

  return getProperties();
}

/* JOBS */

function getJobs() {
  const jobsDir = path.join(dataPath, 'jobs');

  if (!fs.existsSync(jobsDir)) return [];

  return fs
    .readdirSync(jobsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => normalizeCampaignMedia(readJson(path.join(jobsDir, file), null)))
    .filter(Boolean);
}

function saveJob(job) {
  const jobsDir = path.join(dataPath, 'jobs');

  assertEntityId(job?.id, 'Job');

  if (!job.id) {
    throw new Error('Job ID lipsă.');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(job.id)) throw new Error('Job ID contine caractere nepermise.');

  const normalizedJob = normalizeCampaignMedia(job);
  writeJson(path.join(jobsDir, `${job.id}.json`), normalizedJob);

  return normalizedJob;
}

function deleteJob(jobId) {
  assertEntityId(jobId, 'Job');
  const jobsDir = path.join(dataPath, 'jobs');
  const filePath = path.join(jobsDir, `${jobId}.json`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  removeCampaignFromSchedules(jobId, 'jobs');

  return getJobs();
}

/* HISTORY */

function getHistory() {
  return readJson(path.join(logsPath, 'history.json'), []);
}

function addHistory(entry) {
  const historyPath = path.join(logsPath, 'history.json');
  const history = getHistory();

  history.push({
    ...entry,
    date: new Date().toISOString(),
  });

  writeJson(historyPath, history);

  return history;
}

function clearHistoryForProperty(propertyId) {
  const historyPath = path.join(logsPath, 'history.json');
  const history = getHistory();

  const filtered = history.filter((item) => item.propertyId !== propertyId);

  writeJson(historyPath, filtered);

  return filtered;
}

function clearAllHistory() {
  const historyPath = path.join(logsPath, 'history.json');

  writeJson(historyPath, []);

  return [];
}

/* CAMPAIGN RUNS */

function getCampaignRuns() {
  return readJson(path.join(logsPath, 'runs.json'), [])
    .slice()
    .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
}

function getCampaignRun(runId) {
  return getCampaignRuns().find((run) => run.id === runId) || null;
}

function getCampaignRunHistory(runId) {
  return getHistory().filter((entry) => entry.runId === runId);
}

function summarizeRunHistory(history) {
  return {
    total: history.length,
    posted: history.filter((entry) => entry.status === 'posted').length,
    prepared: history.filter((entry) => entry.status === 'prepared').length,
    skipped: history.filter((entry) => entry.status === 'skipped').length,
    errors: history.filter((entry) => entry.status === 'error').length,
  };
}

function createCampaignRun({ config, tasks = [] }) {
  const runsPath = path.join(logsPath, 'runs.json');
  const runs = getCampaignRuns();
  const startedAt = new Date().toISOString();
  const id = `RUN_${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const run = {
    id,
    status: 'running',
    startedAt,
    finishedAt: null,
    mode: config.publishEnabled ? 'live' : 'test',
    campaignCategory: config.campaignCategory || 'real_estate',
    facebookProfileId: config.facebookProfileId || 'main',
    campaignIds: Array.from(new Set(tasks.map((task) => task.campaignId))),
    groupIds: Array.from(new Set(tasks.map((task) => task.groupId))),
    taskCount: tasks.length,
    configSnapshot: {
      campaignDay: config.campaignDay,
      groupLimit: config.groupLimit,
      startFromGroup: config.startFromGroup,
      publishEnabled: Boolean(config.publishEnabled),
      selectedPropertyIds: config.selectedPropertyIds || [],
      campaignCategory: config.campaignCategory || 'real_estate',
      facebookProfileId: config.facebookProfileId || 'main',
      skipGroupsPostedToday: Boolean(config.skipGroupsPostedToday),
    },
    totals: summarizeRunHistory([]),
  };
  writeJson(runsPath, [...runs, run]);
  return run;
}

function updateCampaignRun(runId, changes = {}) {
  const runsPath = path.join(logsPath, 'runs.json');
  const runs = getCampaignRuns();
  const index = runs.findIndex((run) => run.id === runId);
  if (index === -1) return null;
  runs[index] = { ...runs[index], ...changes, id: runId };
  writeJson(runsPath, runs);
  return runs[index];
}

function finishCampaignRun(runId, status, details = {}) {
  const history = getCampaignRunHistory(runId);
  return updateCampaignRun(runId, {
    status,
    finishedAt: new Date().toISOString(),
    totals: summarizeRunHistory(history),
    ...details,
  });
}

function getAuditLog() {
  return readJson(path.join(logsPath, 'audit.json'), []);
}

function addAuditEntry(entry) {
  const auditPath = path.join(logsPath, 'audit.json');
  const audit = getAuditLog();
  audit.push({ ...entry, date: new Date().toISOString() });
  writeJson(auditPath, audit.slice(-2000));
  return audit;
}

function createBackup() {
  return { format: 'rx-ai-studio-backup', version: 1, createdAt: new Date().toISOString(), runtimeConfig: getRuntimeConfig(), groups: getGroups(), schedules: getSchedules(), properties: getProperties(), jobs: getJobs(), history: getHistory(), runs: getCampaignRuns() };
}

function restoreBackup(backup) {
  if (!backup || backup.format !== 'rx-ai-studio-backup' || backup.version !== 1) throw new Error('Format de backup invalid sau incompatibil.');
  for (const key of ['groups', 'properties', 'jobs', 'history']) {
    if (!Array.isArray(backup[key])) throw new Error(`Camp invalid in backup: ${key}.`);
  }
  if (!backup.runtimeConfig || typeof backup.runtimeConfig !== 'object') throw new Error('Configuratia runtime lipseste din backup.');
  for (const [label, campaigns] of [['Property', backup.properties], ['Job', backup.jobs]]) {
    const ids = new Set();
    for (const campaign of campaigns) {
      assertEntityId(campaign?.id, label);
      if (ids.has(campaign.id)) throw new Error(`ID duplicat in backup: ${campaign.id}.`);
      ids.add(campaign.id);
    }
  }

  const replaceCampaignDirectory = (directoryName, campaigns, saveCampaign) => {
    const directory = path.join(dataPath, directoryName);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    const incomingIds = new Set(campaigns.map((campaign) => String(campaign.id || '')));
    if (incomingIds.has('')) throw new Error(`Exista ${directoryName} fara ID in backup.`);
    fs.readdirSync(directory).filter((file) => file.endsWith('.json')).forEach((file) => {
      if (!incomingIds.has(path.basename(file, '.json'))) fs.unlinkSync(path.join(directory, file));
    });
    campaigns.forEach(saveCampaign);
  };

  saveRuntimeConfig(backup.runtimeConfig);
  saveGroups(backup.groups);
  saveSchedules(Array.isArray(backup.schedules) ? backup.schedules : []);
  replaceCampaignDirectory('properties', backup.properties, saveProperty);
  replaceCampaignDirectory('jobs', backup.jobs, saveJob);
  writeJson(path.join(logsPath, 'history.json'), backup.history);
  writeJson(path.join(logsPath, 'runs.json'), Array.isArray(backup.runs) ? backup.runs : []);
  return createBackup();
}

/* RUNTIME CONFIG */

function getRuntimeConfig() {
  const config = readJson(path.join(dataPath, 'runtimeConfig.json'), {});

  return {
    ...defaultRuntimeConfig,
    ...config,
    facebookProfiles: useDefaultIfEmpty(
      config.facebookProfiles,
      defaultRuntimeConfig.facebookProfiles
    ),
    postingIdentityByCategory: {
      ...defaultRuntimeConfig.postingIdentityByCategory,
      ...(config.postingIdentityByCategory || {}),
    },
    postingIdentityByProfile: {
      ...defaultRuntimeConfig.postingIdentityByProfile,
      ...(config.postingIdentityByProfile || {}),
    },
    facebookPostingIdentities: useDefaultIfEmpty(
      config.facebookPostingIdentities,
      defaultRuntimeConfig.facebookPostingIdentities
    ),
    queueExcludedTaskIds: config.queueExcludedTaskIds || [],
    queueRetryTaskIds: config.queueRetryTaskIds || [],
    queueOrder: config.queueOrder || [],
  };
}

function saveRuntimeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuratia runtime trebuie sa fie un obiect.');
  const filePath = path.join(dataPath, 'runtimeConfig.json');
  const normalizedConfig = {
    ...defaultRuntimeConfig,
    ...config,
    facebookProfiles: useDefaultIfEmpty(
      config.facebookProfiles,
      defaultRuntimeConfig.facebookProfiles
    ),
    postingIdentityByCategory: {
      ...defaultRuntimeConfig.postingIdentityByCategory,
      ...(config.postingIdentityByCategory || {}),
    },
    postingIdentityByProfile: {
      ...defaultRuntimeConfig.postingIdentityByProfile,
      ...(config.postingIdentityByProfile || {}),
    },
    facebookPostingIdentities: useDefaultIfEmpty(
      config.facebookPostingIdentities,
      defaultRuntimeConfig.facebookPostingIdentities
    ),
    queueExcludedTaskIds: config.queueExcludedTaskIds || [],
    queueRetryTaskIds: config.queueRetryTaskIds || [],
    queueOrder: config.queueOrder || [],
  };

  writeJson(filePath, normalizedConfig);

  return getRuntimeConfig();
}

module.exports = {
  getGroups,
  saveGroups,

  getSchedules,
  saveSchedules,
  pruneSchedulesForCampaign,

  getProperties,
  saveProperty,
  deleteProperty,

  getJobs,
  saveJob,
  deleteJob,

  getHistory,
  addHistory,
  getAuditLog,
  addAuditEntry,
  clearHistoryForProperty,
  clearAllHistory,

  getCampaignRuns,
  getCampaignRun,
  getCampaignRunHistory,
  createCampaignRun,
  updateCampaignRun,
  finishCampaignRun,

  createBackup,
  restoreBackup,

  getRuntimeConfig,
  saveRuntimeConfig,
};
