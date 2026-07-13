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

(async () => {
  let activeContext = null;

  try {
    const config = DataManager.getRuntimeConfig();
    const properties = DataManager.getProperties();
    const jobs = DataManager.getJobs();
    const groups = DataManager.getGroups();
    const history = DataManager.getHistory();
    const queuePlan = buildQueuePlan({ config, properties, jobs, groups, history });
    const tasks = queuePlan.activeTasks;

    if (!tasks.length) {
      console.log('Nu exista taskuri active in planul de executie.');
      return;
    }

    const campaignsById = buildCampaignMap(properties, jobs);
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const campaignStartedAt = Date.now();
    let activeProfileId = null;
    let activePage = null;
    let totalProgress = 0;

    console.log('==============================');
    console.log('START PLAN DE EXECUTIE');
    console.log(`Taskuri active: ${tasks.length}`);
    console.log(`Mod: ${config.publishEnabled ? 'LIVE' : 'TEST'}`);
    console.log('==============================');

    for (const task of tasks) {
      const latestConfig = DataManager.getRuntimeConfig();
      if (latestConfig.stopAfterCurrentGroup) break;

      const campaign = campaignsById.get(task.campaignId);
      const group = groupsById.get(task.groupId);

      if (!campaign || !group) {
        console.error(`Task invalid in plan: ${task.id}`);
        totalProgress += 1;
        continue;
      }

      if (activeProfileId !== task.facebookProfileId) {
        if (activeContext) {
          await activeContext.close();
        }

        const browser = await startBrowser(task.facebookProfileId);
        activeContext = browser.context;
        activePage = browser.page;
        activeProfileId = task.facebookProfileId;
      }

      const result = await runCampaign(
        activePage,
        { ...campaign, postingIdentityId: task.postingIdentityId },
        [group],
        task.day,
        {
          plannedGroups: [group],
          facebookProfileId: task.facebookProfileId,
          totalCampaignGroups: tasks.length,
          totalCampaignProgressBase: totalProgress,
          campaignStartedAt,
          forceRetryGroupIds: task.retry ? [task.groupId] : [],
        }
      );

      totalProgress += result?.processed || 0;

      if (task.retry && result?.processed) {
        clearRetryFlag(task.id);
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
