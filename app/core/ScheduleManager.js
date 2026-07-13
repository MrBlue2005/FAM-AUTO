const crypto = require('crypto');

const DataManager = require('./DataManager');
const RobotManager = require('./RobotManager');
const { inferProfileCategory } = require('../utils/campaignCategory');

const DEFAULT_LATE_MINUTES = 10;
const CHECK_INTERVAL_MS = 15000;
let timer = null;
let tickRunning = false;

function getSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}

function parseTime(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error('Ora trebuie sa fie in format HH:mm.');
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function normalizeDays(days) {
  const normalized = Array.from(new Set((Array.isArray(days) ? days : []).map(Number)))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  if (!normalized.length) throw new Error('Selecteaza cel putin o zi a saptamanii.');
  return normalized;
}

function computeNextRun(schedule, from = new Date()) {
  const { hours, minutes } = parseTime(schedule.time);
  const days = new Set(normalizeDays(schedule.daysOfWeek));

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(from);
    candidate.setDate(from.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (days.has(candidate.getDay()) && candidate.getTime() > from.getTime()) {
      return candidate.toISOString();
    }
  }

  throw new Error('Nu am putut calcula urmatoarea rulare.');
}

function validateCampaignSelection(category, campaignIds) {
  const source = category === 'jobs' ? DataManager.getJobs() : DataManager.getProperties();
  const knownIds = new Set(source.map((campaign) => campaign.id));
  const ids = Array.from(new Set((Array.isArray(campaignIds) ? campaignIds : []).map(String).filter(Boolean)));
  if (!ids.length) throw new Error('Selecteaza cel putin o campanie.');
  const unknown = ids.filter((id) => !knownIds.has(id));
  if (unknown.length) throw new Error(`Campanii inexistente: ${unknown.join(', ')}.`);
  return ids;
}

function normalizeGroupLimit(value) {
  if (value === 'all') return 'all';
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Limita de grupuri trebuie sa fie intre 1 si 500 sau "all".');
  }
  return limit;
}

function normalizeSchedule(input = {}, existing = null) {
  const now = new Date();
  const config = DataManager.getRuntimeConfig();
  const category = input.campaignCategory === 'jobs' ? 'jobs' : 'real_estate';
  const profileId = String(input.facebookProfileId || config.facebookProfileId || 'main');
  const profile = (config.facebookProfiles || []).find((item) => item.id === profileId);
  if (!profile) {
    throw new Error(`Profilul Facebook ${profileId} nu exista.`);
  }
  const profileCampaignCategory = inferProfileCategory(profile);
  if (profileCampaignCategory && profileCampaignCategory !== category) {
    throw new Error('Profilul Facebook nu corespunde tipului de campanie selectat.');
  }

  const publishEnabled = input.publishEnabled === true;
  if (publishEnabled && input.confirmedPublishEnabled !== true) {
    throw new Error('Programarea LIVE necesita confirmare explicita.');
  }

  const enabled = input.enabled !== false;
  const campaignDay = Number(input.campaignDay || 1);
  const startFromGroup = Number(input.startFromGroup || 1);
  const maxLateMinutes = Number(input.maxLateMinutes || DEFAULT_LATE_MINUTES);
  if (!Number.isInteger(campaignDay) || campaignDay < 1 || campaignDay > 31) {
    throw new Error('Ziua campaniei trebuie sa fie intre 1 si 31.');
  }
  if (!Number.isInteger(startFromGroup) || startFromGroup < 1) {
    throw new Error('Grupul de start trebuie sa fie cel putin 1.');
  }
  if (!Number.isInteger(maxLateMinutes) || maxLateMinutes < 1 || maxLateMinutes > 1440) {
    throw new Error('Toleranta trebuie sa fie intre 1 si 1440 minute.');
  }

  const schedule = {
    id: existing?.id || `SCHEDULE_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    name: String(input.name || '').trim(),
    enabled,
    daysOfWeek: normalizeDays(input.daysOfWeek),
    time: String(input.time || ''),
    timezone: getSystemTimeZone(),
    campaignCategory: category,
    campaignIds: validateCampaignSelection(category, input.campaignIds),
    facebookProfileId: profileId,
    campaignDay,
    groupLimit: normalizeGroupLimit(input.groupLimit ?? 1),
    startFromGroup,
    publishEnabled,
    liveConfirmed: publishEnabled,
    maxLateMinutes,
    overlapPolicy: 'skip',
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    lastRunAt: existing?.lastRunAt || null,
    lastStatus: existing?.lastStatus || 'never',
    lastMessage: existing?.lastMessage || '',
  };
  if (!schedule.name) throw new Error('Numele programarii este obligatoriu.');
  parseTime(schedule.time);
  schedule.nextRunAt = enabled ? computeNextRun(schedule, now) : null;
  return schedule;
}

function list() {
  return DataManager.getSchedules().slice().sort((a, b) => {
    if (!a.nextRunAt && !b.nextRunAt) return String(a.name || '').localeCompare(String(b.name || ''));
    if (!a.nextRunAt) return 1;
    if (!b.nextRunAt) return -1;
    return new Date(a.nextRunAt) - new Date(b.nextRunAt);
  });
}

function create(input) {
  const schedule = normalizeSchedule(input);
  DataManager.saveSchedules([...DataManager.getSchedules(), schedule]);
  return schedule;
}

function update(id, input) {
  const schedules = DataManager.getSchedules();
  const index = schedules.findIndex((schedule) => schedule.id === id);
  if (index === -1) throw new Error('Programarea nu exista.');
  schedules[index] = normalizeSchedule(input, schedules[index]);
  DataManager.saveSchedules(schedules);
  return schedules[index];
}

function remove(id) {
  const schedules = DataManager.getSchedules();
  if (!schedules.some((schedule) => schedule.id === id)) throw new Error('Programarea nu exista.');
  DataManager.saveSchedules(schedules.filter((schedule) => schedule.id !== id));
  return { ok: true, id };
}

function saveExecutionResult(schedule, changes, advanceSchedule) {
  const schedules = DataManager.getSchedules();
  const index = schedules.findIndex((item) => item.id === schedule.id);
  if (index === -1) return null;
  const now = new Date();
  schedules[index] = {
    ...schedules[index],
    ...changes,
    updatedAt: now.toISOString(),
    nextRunAt: advanceSchedule && schedules[index].enabled
      ? computeNextRun(schedules[index], new Date(now.getTime() + 60000))
      : schedules[index].nextRunAt,
  };
  DataManager.saveSchedules(schedules);
  return schedules[index];
}

function execute(schedule, { trigger = 'manual', now = new Date() } = {}) {
  const scheduled = trigger === 'scheduled';
  if (scheduled) {
    const lateMs = now.getTime() - new Date(schedule.nextRunAt).getTime();
    if (lateMs > schedule.maxLateMinutes * 60000) {
      return saveExecutionResult(schedule, {
        lastRunAt: now.toISOString(),
        lastStatus: 'missed',
        lastMessage: `Rulare ratata: API-ul a revenit dupa toleranta de ${schedule.maxLateMinutes} minute.`,
      }, true);
    }
  }

  if (RobotManager.isRunning()) {
    return saveExecutionResult(schedule, {
      lastRunAt: now.toISOString(),
      lastStatus: 'skipped',
      lastMessage: 'Rulare sarita: robotul executa deja o alta campanie.',
    }, scheduled);
  }

  const currentConfig = DataManager.getRuntimeConfig();
  DataManager.saveRuntimeConfig({
    ...currentConfig,
    campaignDay: schedule.campaignDay,
    groupLimit: schedule.groupLimit,
    startFromGroup: schedule.startFromGroup,
    publishEnabled: schedule.publishEnabled,
    selectedPropertyIds: schedule.campaignIds,
    campaignCategory: schedule.campaignCategory,
    facebookProfileId: schedule.facebookProfileId,
    queueExcludedTaskIds: [],
    queueRetryTaskIds: [],
    queueOrder: [],
    pauseRequested: false,
    stopAfterCurrentGroup: false,
  });

  const robot = RobotManager.start({
    facebookProfileId: schedule.facebookProfileId,
    confirmedPublishEnabled: schedule.publishEnabled && schedule.liveConfirmed,
  });
  const started = robot.robotStatus === 'running';
  const result = saveExecutionResult(schedule, {
    lastRunAt: now.toISOString(),
    lastStatus: started ? 'started' : 'blocked',
    lastMessage: robot.lastMessage || (started ? 'Rulare programata pornita.' : 'Pornire blocata.'),
  }, scheduled);
  DataManager.addAuditEntry({
    action: `SCHEDULE ${trigger.toUpperCase()}`,
    scheduleId: schedule.id,
    ok: started,
    message: result?.lastMessage,
  });
  return result;
}

function runNow(id) {
  const schedule = DataManager.getSchedules().find((item) => item.id === id);
  if (!schedule) throw new Error('Programarea nu exista.');
  return execute(schedule, { trigger: 'manual' });
}

function tick(now = new Date()) {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const dueSchedules = DataManager.getSchedules().filter((schedule) =>
      schedule.enabled && schedule.nextRunAt && new Date(schedule.nextRunAt).getTime() <= now.getTime()
    );
    dueSchedules.forEach((schedule) => execute(schedule, { trigger: 'scheduled', now }));
  } finally {
    tickRunning = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => tick(), 1000).unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  computeNextRun,
  create,
  execute,
  getSystemTimeZone,
  list,
  normalizeSchedule,
  remove,
  runNow,
  start,
  stop,
  tick,
  update,
};
