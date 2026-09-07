const { startBrowser } = require('./app/facebook/browserManager');
const { runCampaign } = require('./app/facebook/campaignRunner');
const DataManager = require('./app/core/DataManager');
const { buildQueuePlan } = require('./app/core/CampaignTools');
const { LocalAgentRegistry } = require('./app/local-agent/LocalAgentRegistry');
const { LocalAgentExecutor } = require('./app/local-agent/LocalAgentExecutor');
const { LocalTaskTransport } = require('./app/local-agent/LocalTaskTransport');

function clearRetryFlag(sourceTaskId) {
  const config = DataManager.getRuntimeConfig();
  const retryTaskIds = (config.queueRetryTaskIds || []).filter((id) => id !== sourceTaskId);
  if (retryTaskIds.length !== (config.queueRetryTaskIds || []).length) {
    DataManager.saveRuntimeConfig({ ...config, queueRetryTaskIds: retryTaskIds });
  }
}

function getCurrentPlan(executionConfig) {
  return buildQueuePlan({
    config: executionConfig,
    properties: DataManager.getProperties(),
    jobs: DataManager.getJobs(),
    groups: DataManager.getGroups(),
    history: DataManager.getHistory(),
  });
}

(async () => {
  const runId = process.env.RX_RUN_ID;
  const agentId = process.env.RX_AGENT_ID;
  const profileId = process.env.RX_PROFILE_ID;
  let activeContext = null;
  let transport = null;

  try {
    if (!runId || !agentId || !profileId) throw new Error('Local Agent execution identity is missing.');

    const runtimeConfig = DataManager.getRuntimeConfig();
    const registryService = new LocalAgentRegistry();
    const registry = registryService.load(runtimeConfig.facebookProfiles || []);
    const registeredProfile = registryService.getProfile(profileId, runtimeConfig.facebookProfiles || []);
    if (registry.agent.agentId !== agentId || !registeredProfile) {
      throw new Error('Local Agent execution identity does not match the persisted registry.');
    }

    transport = new LocalTaskTransport(runId);
    const executor = new LocalAgentExecutor();
    const initialTasks = transport.read().tasks.filter((task) => task.profile_id === profileId);
    if (!initialTasks.length) {
      console.log('Nu exista taskuri active in transportul local.');
      return;
    }

    const campaignStartedAt = Date.now();
    const propertyTotals = initialTasks.reduce((totals, task) => {
      const campaignId = task.payload.campaign.id;
      totals.set(campaignId, (totals.get(campaignId) || 0) + 1);
      return totals;
    }, new Map());
    const propertyProgress = new Map();
    const propertyStartedAt = new Map();
    let totalProgress = 0;

    await executor.runProfile(profileId, async () => {
      console.log('==============================');
      console.log('START RX LOCAL AGENT');
      console.log(`Taskuri active: ${initialTasks.length}`);
      console.log(`Mod: ${initialTasks[0].payload.execution_config.publishEnabled ? 'LIVE' : 'TEST'}`);
      console.log('==============================');

      while (true) {
        const task = transport.claimNextTask({ agentId, profileId });
        if (!task) break;
        transport.acknowledgeTask(task.task_id);
        const payload = task.payload;
        const campaignId = payload.campaign.id;
        const executionConfig = payload.execution_config;
        const currentTask = getCurrentPlan(executionConfig).activeTasks.find((item) => item.id === payload.source_task_id);

        if (!currentTask) {
          transport.cancelTask(task.task_id, { code: 'QUEUE_CHANGED', message: 'Taskul nu mai este eligibil dupa reverificarea Queue.' });
          console.log(`Task sarit dupa reverificarea Queue: ${payload.source_task_id}`);
          propertyProgress.set(campaignId, (propertyProgress.get(campaignId) || 0) + 1);
          totalProgress += 1;
          continue;
        }

        if (DataManager.getRuntimeConfig().stopAfterCurrentGroup) {
          transport.cancelTask(task.task_id, { code: 'STOP_REQUESTED', message: 'Executia a fost oprita de operator.' });
          transport.cancelQueuedTasks({ agentId, profileId }, { code: 'STOP_REQUESTED', message: 'Executia a fost oprita de operator.' });
          break;
        }

        if (!propertyStartedAt.has(campaignId)) propertyStartedAt.set(campaignId, Date.now());
        transport.reportRunning(task.task_id);

        try {
          if (!activeContext) {
            const browser = await startBrowser(payload.runtime_profile_id, {
              profilePath: registeredProfile.localProfilePath,
              displayName: registeredProfile.displayName,
            });
            activeContext = browser.context;
          }
          const page = activeContext.pages().length ? activeContext.pages()[0] : await activeContext.newPage();
          const result = await runCampaign(
            page,
            { ...payload.campaign, postingIdentityId: payload.posting_identity_id },
            [payload.group],
            payload.campaign_day,
            {
              plannedGroups: [payload.group],
              facebookProfileId: payload.runtime_profile_id,
              totalCampaignGroups: initialTasks.length,
              totalCampaignProgressBase: totalProgress,
              campaignStartedAt,
              propertyProgressBase: propertyProgress.get(campaignId) || 0,
              propertyTotalGroups: propertyTotals.get(campaignId) || 1,
              propertyStartedAt: propertyStartedAt.get(campaignId),
              forceRetryGroupIds: payload.retry ? [payload.group.id] : [],
              skipGroupsPostedToday: executionConfig.skipGroupsPostedToday,
              executionConfig,
            }
          );

          const processed = result?.processed || 0;
          totalProgress += processed;
          propertyProgress.set(campaignId, (propertyProgress.get(campaignId) || 0) + processed);
          if (payload.retry && processed) clearRetryFlag(payload.source_task_id);
          transport.reportCompletion(task.task_id, { processed });
        } catch (error) {
          transport.reportFailure(task.task_id, error);
          throw error;
        }
      }
    }, { taskId: initialTasks[0].task_id });

    console.log('Toate taskurile active din plan au fost parcurse.');
  } catch (error) {
    if (error.code === 'PROFILE_BUSY') {
      transport?.deferProfileTasks({ agentId, profileId }, { code: 'PROFILE_BUSY', message: error.message });
      console.error(`LOCAL_AGENT_ERROR:${JSON.stringify({ code: 'PROFILE_BUSY', profile_id: profileId })}`);
    } else {
      console.error('EROARE:', error);
    }
    process.exitCode = 1;
  } finally {
    if (activeContext) await activeContext.close().catch(() => {});
  }
})();
