const fs = require('fs');
const { getEligibleGroups, getPostForDay } = require('../utils/campaignPlanner');
const { resolveMediaReference } = require('../utils/mediaPath');
const {
  getActiveCampaignCategory,
  getProfileForCampaign,
  getProfileIdForCampaign,
} = require('../utils/campaignCategory');

function getCampaignName(item) {
  return item.name || item.title || item.id;
}

function getCategoryItems(config, properties, jobs) {
  if (getActiveCampaignCategory(config) === 'jobs') {
    return jobs.map((job) => ({
      ...job,
      name: job.title,
      transactionType: 'job',
      campaignCategory: 'jobs',
    }));
  }

  return properties.map((property) => ({
    ...property,
    campaignCategory: 'real_estate',
  }));
}

function getDefaultProfileIdForCategory(config, category) {
  const profile = (config.facebookProfiles || []).find((item) => {
    const profileConfig = {
      ...config,
      facebookProfileId: item.id,
    };

    return getActiveCampaignCategory(profileConfig) === category;
  });

  return profile?.id || config.facebookProfileId || 'main';
}

function matchesActiveProfile(item, config) {
  const activeProfileId = config.facebookProfileId || 'main';
  const explicitProfileId = item.facebookProfileId || item.postingProfileId || '';

  if (explicitProfileId) {
    return explicitProfileId === activeProfileId;
  }

  return activeProfileId === getDefaultProfileIdForCategory(
    config,
    getActiveCampaignCategory(config)
  );
}

function getSelectedCampaigns(config, properties, jobs) {
  const selectedIds = config.selectedPropertyIds || [];
  const source = getCategoryItems(config, properties, jobs).filter((item) =>
    matchesActiveProfile(item, config)
  );

  return source.filter((item) => {
    if (selectedIds.length > 0) return selectedIds.includes(item.id);
    return item.active === true;
  });
}

function applyQueueOptions(groups, config) {
  const startIndex = Math.max(Number(config.startFromGroup || 1) - 1, 0);
  const slicedGroups = groups.slice(startIndex);

  if (config.groupLimit === 'all') {
    return slicedGroups;
  }

  return slicedGroups.slice(0, Number(config.groupLimit || 1));
}

function getTaskId(campaignId, groupId, facebookProfileId = null) {
  return [facebookProfileId, campaignId, groupId].filter(Boolean).join('::');
}

function applySavedQueueState(tasks, config) {
  const excluded = new Set(config.queueExcludedTaskIds || []);
  const retry = new Set(config.queueRetryTaskIds || []);
  const order = config.queueOrder || [];
  const orderIndex = new Map(order.map((taskId, index) => [taskId, index]));

  return tasks
    .map((task, index) => ({
      ...task,
      originalIndex: index,
      excluded: excluded.has(task.id),
      retry: retry.has(task.id),
    }))
    .sort((a, b) => {
      const aOrder = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bOrder = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;

      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.originalIndex - b.originalIndex;
    });
}

function buildQueuePlan({ config, properties, jobs, groups, history = [] }) {
  const campaignDay = Number(config.campaignDay || 1);
  const campaignCategory = getActiveCampaignCategory(config);
  const campaigns = getSelectedCampaigns(config, properties, jobs);
  const tasks = campaigns.flatMap((campaign) => {
    const eligibleGroups = applyQueueOptions(getEligibleGroups(campaign, groups), config);
    const post = getPostForDay(campaign, campaignDay);
    const campaignProfile = getProfileForCampaign(campaign, config);
    const campaignProfileId = getProfileIdForCampaign(campaign, config);
    const postingIdentityId =
      campaign.postingIdentityId ||
      config.postingIdentityByProfile?.[campaignProfileId] ||
      config.postingIdentityByCategory?.[campaignCategory] ||
      'default';
    const postingIdentity = (config.facebookPostingIdentities || []).find(
      (identity) => identity.id === postingIdentityId
    );

    return eligibleGroups.map((group) => ({
      id: getTaskId(campaign.id, group.id, campaignProfileId),
      campaignId: campaign.id,
      campaignTitle: getCampaignName(campaign),
      campaignCategory,
      facebookProfileId: campaignProfileId,
      facebookProfileLabel: campaignProfile?.label || campaignProfile?.id || config.facebookProfileId || 'main',
      postingIdentityId,
      postingIdentityLabel: postingIdentity?.label || postingIdentityId,
      groupId: group.id,
      groupName: group.name,
      groupUrl: group.url,
      day: campaignDay,
      mode: config.publishEnabled ? 'Postare live' : 'Doar pregatire',
      hasPost: Boolean(post),
      hasText: Boolean(post?.text?.trim()),
      hasMedia: Boolean(post?.imagePath || post?.media?.length),
    }));
  });

  const plannedTasks = applySavedQueueState(tasks, config).map((task) => {
    const processed = history.some((entry) =>
      entry.propertyId === task.campaignId &&
      entry.groupId === task.groupId &&
      Number(entry.day) === Number(task.day) &&
      (entry.facebookProfileId || entry.postingProfileId || 'main') === task.facebookProfileId &&
      ['prepared', 'posted'].includes(entry.status)
    );

    return {
      ...task,
      processed,
      status: task.excluded
        ? 'excluded'
        : task.retry
          ? 'retry'
          : processed
            ? 'done'
            : 'pending',
    };
  });
  const activeTasks = plannedTasks.filter((task) =>
    !task.excluded && (!task.processed || task.retry)
  );

  return {
    tasks: plannedTasks,
    activeTasks,
    summary: {
      total: plannedTasks.length,
      active: activeTasks.length,
      excluded: plannedTasks.filter((task) => task.excluded).length,
      retry: plannedTasks.filter((task) => task.retry).length,
      done: plannedTasks.filter((task) => task.status === 'done').length,
    },
  };
}

function getCampaignPreview({ config, properties, jobs, campaignId, day }) {
  const campaignDay = Number(day || config.campaignDay || 1);
  const source = getCategoryItems(config, properties, jobs).filter((item) =>
    matchesActiveProfile(item, config)
  );
  const campaign = source.find((item) => item.id === campaignId) || source[0] || null;
  const post = campaign ? getPostForDay(campaign, campaignDay) : null;
  const campaignProfile = campaign ? getProfileForCampaign(campaign, config) : null;
  const campaignProfileId = campaign ? getProfileIdForCampaign(campaign, config) : null;
  const postingIdentityId =
    campaign?.postingIdentityId ||
    (campaignProfileId ? config.postingIdentityByProfile?.[campaignProfileId] : null) ||
    config.postingIdentityByCategory?.[getActiveCampaignCategory(config)] ||
    'default';
  const postingIdentity = (config.facebookPostingIdentities || []).find(
    (identity) => identity.id === postingIdentityId
  );

  return {
    campaignId: campaign?.id || null,
    campaignTitle: campaign ? getCampaignName(campaign) : '-',
    facebookProfileId: campaignProfileId,
    facebookProfileLabel: campaignProfile?.label || campaignProfile?.id || null,
    postingIdentityId: campaign ? postingIdentityId : null,
    postingIdentityLabel: campaign ? postingIdentity?.label || postingIdentityId : null,
    day: campaignDay,
    post: post || null,
    text: post?.text || '',
    media: post?.media || [],
    imagePath: post?.imagePath || '',
    warnings: [
      !campaign ? 'Nu exista campanie selectata.' : null,
      campaign && !post ? `Nu exista postare pentru ziua ${campaignDay}.` : null,
      post && !post.text?.trim() ? 'Postarea nu are text.' : null,
      post && !post.imagePath && !post.media?.length ? 'Postarea nu are media atasata.' : null,
    ].filter(Boolean),
  };
}

function validateCampaigns({ config, properties, jobs, groups }) {
  const activeCampaignCategory = getActiveCampaignCategory(config);
  const categories = [
    { id: 'real_estate', items: properties, nameField: 'name' },
    { id: 'jobs', items: jobs, nameField: 'title' },
  ];
  const activeGroupsByCategory = {
    real_estate: groups.filter((group) => group.active && (group.category || 'real_estate') === 'real_estate'),
    jobs: groups.filter((group) => group.active && (group.category || 'real_estate') === 'jobs'),
  };

  const profile = (config.facebookProfiles || []).find(
    (item) => item.id === config.facebookProfileId
  );
  const profileIssues = profile ? [] : ['Profilul Facebook activ nu este setat corect.'];

  const identityIssues = ['real_estate', 'jobs'].flatMap((category) => {
    const identityId = config.postingIdentityByCategory?.[category];
    const identity = (config.facebookPostingIdentities || []).find((item) => item.id === identityId);
    return identity ? [] : [`Identitatea Facebook pentru ${category} lipseste.`];
  });
  const profileIdentityIssues = Object.entries(config.postingIdentityByProfile || {}).flatMap(
    ([profileId, identityId]) => {
      const profile = (config.facebookProfiles || []).find((item) => item.id === profileId);
      const identity = (config.facebookPostingIdentities || []).find((item) => item.id === identityId);

      return profile && identity ? [] : [`Identitatea Facebook pentru profilul ${profileId} lipseste.`];
    }
  );

  const campaignIssues = categories.flatMap((category) =>
    category.items.map((item) => {
      const posts = item.posts || [];
      const missingText = posts.filter((post) => !post.text?.trim()).length;
      const missingMedia = posts.filter((post) => !post.imagePath && !post.media?.length).length;
      const noGroups = activeGroupsByCategory[category.id].length === 0;
      const missingCampaignProfile =
        item.facebookProfileId &&
        !(config.facebookProfiles || []).some((profile) => profile.id === item.facebookProfileId);
      const issues = [
        item.active !== true ? 'Campania este inactiva.' : null,
        missingCampaignProfile ? 'Profilul Facebook al campaniei nu exista in config.' : null,
        posts.length === 0 ? 'Nu are postari configurate.' : null,
        missingText > 0 ? `${missingText} postari fara text.` : null,
        missingMedia > 0 ? `${missingMedia} postari fara media.` : null,
        noGroups ? `Nu exista grupuri active pentru ${category.id}.` : null,
      ].filter(Boolean);

      return {
        id: item.id,
        title: item[category.nameField] || item.id,
        category: category.id,
        level: issues.some((issue) => !issue.includes('inactiva')) ? 'error' : issues.length ? 'warning' : 'ok',
        issues,
      };
    })
  );

  const brokenCampaigns = campaignIssues.filter((item) => item.level === 'error').length;
  const warningCampaigns = campaignIssues.filter((item) => item.level === 'warning').length;

  return {
    summary: {
      ok: campaignIssues.filter((item) => item.level === 'ok').length,
      warning: warningCampaigns,
      error: brokenCampaigns + profileIssues.length + identityIssues.length + profileIdentityIssues.length,
    },
    activeCampaignCategory,
    globalIssues: [...profileIssues, ...identityIssues, ...profileIdentityIssues],
    campaigns: campaignIssues,
  };
}

function buildPreflightReport({ config, properties, jobs, groups, history = [] }) {
  const queuePlan = buildQueuePlan({ config, properties, jobs, groups, history });
  const allCampaigns = new Map([
    ...properties,
    ...jobs.map((job) => ({ ...job, name: job.title, campaignCategory: 'jobs' })),
  ].map((item) => [item.id, item]));
  const issues = [];

  if (queuePlan.activeTasks.length === 0) {
    issues.push({
      level: 'error',
      code: 'EMPTY_QUEUE',
      message: 'Nu exista taskuri pending sau marcate pentru retry.',
    });
  }

  for (const task of queuePlan.activeTasks) {
    const campaign = allCampaigns.get(task.campaignId);
    const post = campaign ? getPostForDay(campaign, task.day) : null;
    const profileExists = (config.facebookProfiles || []).some(
      (profile) => profile.id === task.facebookProfileId
    );
    const identityExists = (config.facebookPostingIdentities || []).some(
      (identity) => identity.id === task.postingIdentityId
    );

    if (!campaign || !post) {
      issues.push({ level: 'error', code: 'MISSING_POST', taskId: task.id, campaignId: task.campaignId, message: `${task.campaignTitle}: lipseste postarea pentru ziua ${task.day}.` });
      continue;
    }

    if (!post.text?.trim()) {
      issues.push({ level: 'error', code: 'MISSING_TEXT', taskId: task.id, campaignId: task.campaignId, message: `${task.campaignTitle}: textul postarii este gol.` });
    }

    const media = (post.media?.length ? post.media : [post.imagePath])
      .map((item) => typeof item === 'string' ? item : item?.path)
      .filter(Boolean);
    const missingMedia = media.filter((item) => {
      const resolved = resolveMediaReference(item);
      return !resolved || !fs.existsSync(resolved);
    });

    if (media.length === 0) {
      issues.push({ level: 'error', code: 'MISSING_MEDIA', taskId: task.id, campaignId: task.campaignId, message: `${task.campaignTitle}: nu exista media pentru ziua ${task.day}.` });
    } else if (missingMedia.length > 0) {
      issues.push({ level: 'error', code: 'MEDIA_NOT_FOUND', taskId: task.id, campaignId: task.campaignId, message: `${task.campaignTitle}: ${missingMedia.length} fisiere media nu exista pe disc.` });
    }

    if (!profileExists) {
      issues.push({ level: 'error', code: 'INVALID_PROFILE', taskId: task.id, campaignId: task.campaignId, message: `${task.campaignTitle}: profilul Facebook ${task.facebookProfileId} nu exista.` });
    }

    if (!identityExists) {
      issues.push({ level: 'error', code: 'INVALID_IDENTITY', taskId: task.id, campaignId: task.campaignId, message: `${task.campaignTitle}: identitatea ${task.postingIdentityId} nu exista.` });
    }

    if (!/^https?:\/\//i.test(task.groupUrl || '')) {
      issues.push({ level: 'error', code: 'INVALID_GROUP_URL', taskId: task.id, campaignId: task.campaignId, message: `${task.groupName}: URL-ul grupului nu este valid.` });
    }
  }

  if (config.publishEnabled) {
    issues.push({
      level: 'warning',
      code: 'LIVE_MODE',
      message: `Mod LIVE activ: ${queuePlan.activeTasks.length} taskuri pot publica pe Facebook.`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    mode: config.publishEnabled ? 'live' : 'test',
    summary: {
      total: queuePlan.tasks.length,
      active: queuePlan.activeTasks.length,
      done: queuePlan.summary.done,
      errors: issues.filter((issue) => issue.level === 'error').length,
      warnings: issues.filter((issue) => issue.level === 'warning').length,
    },
    issues,
  };
}

function groupErrors(history) {
  const errors = history.filter((entry) => entry.status === 'error');
  const groups = errors.reduce((acc, entry) => {
    const key = entry.errorMessage || entry.reason || 'Eroare necunoscuta';

    acc[key] = acc[key] || {
      reason: key,
      count: 0,
      campaigns: new Set(),
      groups: new Set(),
      lastDate: null,
    };

    acc[key].count += 1;
    acc[key].campaigns.add(entry.propertyName || entry.propertyId || '-');
    acc[key].groups.add(entry.groupName || entry.groupId || '-');
    acc[key].lastDate = entry.date || acc[key].lastDate;

    return acc;
  }, {});

  return Object.values(groups)
    .map((item) => ({
      reason: item.reason,
      count: item.count,
      campaigns: Array.from(item.campaigns).slice(0, 6),
      groups: Array.from(item.groups).slice(0, 6),
      lastDate: item.lastDate,
    }))
    .sort((a, b) => b.count - a.count);
}

function buildReport(history) {
  const startedAt = history[0]?.date || null;
  const finishedAt = history[history.length - 1]?.date || null;
  const elapsedMs = startedAt && finishedAt ? new Date(finishedAt) - new Date(startedAt) : 0;

  return {
    generatedAt: new Date().toISOString(),
    startedAt,
    finishedAt,
    elapsedMinutes: Math.max(Math.round(elapsedMs / 60000), 0),
    totals: {
      prepared: history.filter((entry) => entry.status === 'prepared').length,
      posted: history.filter((entry) => entry.status === 'posted').length,
      skipped: history.filter((entry) => entry.status === 'skipped').length,
      errors: history.filter((entry) => entry.status === 'error').length,
      total: history.length,
    },
    errors: groupErrors(history),
  };
}

module.exports = {
  buildQueuePlan,
  getCampaignPreview,
  validateCampaigns,
  groupErrors,
  buildReport,
  buildPreflightReport,
  getTaskId,
};
