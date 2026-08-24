const { startBrowser } = require('./app/facebook/browserManager');
const { runCampaign } = require('./app/facebook/campaignRunner');
const DataManager = require('./app/core/DataManager');
const { buildQueuePlan } = require('./app/core/CampaignTools');

function buildCampaignMap(properties, jobs) {
  const jobCampaigns = jobs.map((job) => ({
    ...job,
    name: job.title,
    transactionType: 'job',
    campaignCategory: 'jobs',
  }));

  return new Map([...properties, ...jobCampaigns].map((item) => [item.id, item]));
}

function clearRetryFlag(taskId) {
  const config = DataManager.getRuntimeConfig();
  const retryTaskIds = (config.queueRetryTaskIds || []).filter((id) => id !== taskId);

  if (retryTaskIds.length !== (config.queueRetryTaskIds || []).length) {
    DataManager.saveRuntimeConfig({
      ...config,
      queueRetryTaskIds: retryTaskIds,
    });
  }
}

function getExecutionConfig() {
  try {
    const parsed = JSON.parse(process.env.RX_EXECUTION_CONFIG || '');
    return parsed && typeof parsed === 'object' ? parsed : DataManager.getRuntimeConfig();
  } catch {
    return DataManager.getRuntimeConfig();
  }
}

(async () => {
  let activeContext = null;

  try {
    const config = {
      ...getExecutionConfig(),
      skipGroupsPostedToday: process.env.RX_SKIP_GROUPS_POSTED_TODAY === '1',
    };
    const queuePlan = buildQueuePlan({
      config,
      properties: DataManager.getProperties(),
      jobs: DataManager.getJobs(),
      groups: DataManager.getGroups(),
      history: DataManager.getHistory(),
    });
    const tasks = queuePlan.activeTasks;

    if (!tasks.length) {
      console.log('Nu exista taskuri active in planul de executie.');
      return;
    }

    const campaignStartedAt = Date.now();
    const propertyTotals = tasks.reduce((totals, task) => {
      totals.set(task.campaignId, (totals.get(task.campaignId) || 0) + 1);
      return totals;
    }, new Map());
    const propertyProgress = new Map();
    const propertyStartedAt = new Map();
    let activeProfileId = null;
    let activePage = null;
    let totalProgress = 0;

    console.log('==============================');
    console.log('START PLAN DE EXECUTIE');
    console.log(`Taskuri active: ${tasks.length}`);
    console.log(`Mod: ${config.publishEnabled ? 'LIVE' : 'TEST'}`);
    console.log('==============================');

    for (const task of tasks) {
      const latestConfig = config;
      if (DataManager.getRuntimeConfig().stopAfterCurrentGroup) break;

      const latestProperties = DataManager.getProperties();
      const latestJobs = DataManager.getJobs();
      const latestGroups = DataManager.getGroups();
      const latestPlan = buildQueuePlan({
        config: latestConfig,
        properties: latestProperties,
        jobs: latestJobs,
        groups: latestGroups,
        history: DataManager.getHistory(),
      });
      const currentTask = latestPlan.activeTasks.find((item) => item.id === task.id);

      if (!currentTask) {
        console.log(`Task sarit dupa reverificarea Queue: ${task.id}`);
        propertyProgress.set(task.campaignId, (propertyProgress.get(task.campaignId) || 0) + 1);
        totalProgress += 1;
        continue;
      }

      const campaign = buildCampaignMap(latestProperties, latestJobs).get(currentTask.campaignId);
      const group = new Map(latestGroups.map((item) => [item.id, item])).get(currentTask.groupId);

      if (!campaign || !group) {
        console.error(`Task invalid dupa reverificare: ${currentTask.id}`);
        propertyProgress.set(currentTask.campaignId, (propertyProgress.get(currentTask.campaignId) || 0) + 1);
        totalProgress += 1;
        continue;
      }

      if (!propertyStartedAt.has(currentTask.campaignId)) {
        propertyStartedAt.set(currentTask.campaignId, Date.now());
      }

      if (activeProfileId !== currentTask.facebookProfileId) {
        if (activeContext) {
          await activeContext.close();
        }

        const browser = await startBrowser(currentTask.facebookProfileId);
        activeContext = browser.context;
        activePage = browser.page;
        activeProfileId = currentTask.facebookProfileId;
      }

      const result = await runCampaign(
        activePage,
        { ...campaign, postingIdentityId: currentTask.postingIdentityId },
        [group],
        currentTask.day,
        {
          plannedGroups: [group],
          facebookProfileId: currentTask.facebookProfileId,
          totalCampaignGroups: tasks.length,
          totalCampaignProgressBase: totalProgress,
          campaignStartedAt,
          propertyProgressBase: propertyProgress.get(currentTask.campaignId) || 0,
          propertyTotalGroups: propertyTotals.get(currentTask.campaignId) || 1,
          propertyStartedAt: propertyStartedAt.get(currentTask.campaignId),
          forceRetryGroupIds: currentTask.retry ? [currentTask.groupId] : [],
          skipGroupsPostedToday: config.skipGroupsPostedToday,
          executionConfig: config,
        }
      );

      totalProgress += result?.processed || 0;
      propertyProgress.set(
        currentTask.campaignId,
        (propertyProgress.get(currentTask.campaignId) || 0) + (result?.processed || 0)
      );

      if (currentTask.retry && result?.processed) {
        clearRetryFlag(currentTask.id);
      }
    }

    console.log('Toate taskurile active din plan au fost parcurse.');
  } catch (error) {
    console.error('EROARE:', error);
    process.exitCode = 1;
  } finally {
    if (activeContext) {
      await activeContext.close();
    }
  }
})();
