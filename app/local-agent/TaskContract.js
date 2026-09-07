const { createIdentity } = require('./identity');

const TASK_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  CLAIMED: 'CLAIMED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SENSITIVE_TASK_KEYS = new Set([
  'accesstoken', 'authtoken', 'browsercache', 'chromiumpath', 'cookies', 'credentials',
  'indexeddb', 'localstorage', 'password', 'profilepath', 'refreshtoken',
  'sessionstorage', 'userdata', 'userdatadir',
]);

function sanitizeTaskValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeTaskValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_TASK_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .map(([key, item]) => [key, sanitizeTaskValue(item)]));
}

function sanitizeExecutionConfig(config) {
  return clone({
    campaignDay: config.campaignDay,
    campaignDayById: config.campaignDayById || {},
    groupLimit: config.groupLimit,
    startFromGroup: config.startFromGroup,
    publishEnabled: Boolean(config.publishEnabled),
    selectedPropertyIds: config.selectedPropertyIds || [],
    campaignCategory: config.campaignCategory || 'real_estate',
    selectedGroupListCategory: config.selectedGroupListCategory || 'Romania',
    facebookProfileId: config.facebookProfileId || 'main',
    skipGroupsPostedToday: Boolean(config.skipGroupsPostedToday),
    queueExcludedTaskIds: config.queueExcludedTaskIds || [],
    queueRetryTaskIds: config.queueRetryTaskIds || [],
    queueOrder: config.queueOrder || [],
    postingIdentityByCategory: config.postingIdentityByCategory || {},
    postingIdentityByProfile: config.postingIdentityByProfile || {},
    facebookPostingIdentities: (config.facebookPostingIdentities || []).map((identity) => ({
      id: identity.id,
      label: identity.label,
      actorName: identity.actorName,
    })),
    facebookProfiles: (config.facebookProfiles || []).map((profile) => ({
      id: profile.id,
      label: profile.label,
      category: profile.category,
    })),
  });
}

function createTaskSnapshots({ agentId, profileId, runtimeProfileId, config, queueTasks, properties, jobs, groups, now = new Date() }) {
  const campaigns = new Map([
    ...properties.map((item) => [item.id, item]),
    ...jobs.map((item) => [item.id, { ...item, name: item.title, transactionType: 'job', campaignCategory: 'jobs' }]),
  ]);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const scheduledAt = now.toISOString();
  const executionConfig = sanitizeExecutionConfig(config);

  return queueTasks.map((queueTask) => {
    const campaign = campaigns.get(queueTask.campaignId);
    const group = groupsById.get(queueTask.groupId);
    if (!campaign || !group) throw new Error(`Cannot snapshot incomplete queue task: ${queueTask.id}`);
    return {
      task_id: createIdentity('task'),
      agent_id: agentId,
      profile_id: profileId,
      task_type: 'FACEBOOK_GROUP_POST',
      status: TASK_STATUS.QUEUED,
      created_at: scheduledAt,
      scheduled_at: scheduledAt,
      started_at: null,
      completed_at: null,
      attempts: 0,
      payload: sanitizeTaskValue(clone({
        source_task_id: queueTask.id,
        runtime_profile_id: runtimeProfileId,
        campaign,
        group,
        campaign_day: queueTask.day,
        posting_identity_id: queueTask.postingIdentityId,
        retry: Boolean(queueTask.retry),
        execution_config: executionConfig,
      })),
      result: null,
      error: null,
    };
  });
}

module.exports = { TASK_STATUS, createTaskSnapshots, sanitizeExecutionConfig, sanitizeTaskValue };
