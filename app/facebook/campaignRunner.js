const fs = require('fs');
const path = require('path');
const { openGroup } = require('./groupNavigation');
const { createPost } = require('./postCreator');
const { publishPost } = require('./publishPost');
const { discoverAndUpdateGroup } = require('./groupDiscovery');

const DataManager = require('../core/DataManager');

const {
  loadHistory,
  hasProcessed,
  hasPostedInGroupOnDate,
  addHistoryEntry,
} = require('../utils/historyManager');

const {
  getEligibleGroups,
  getPostForDay,
} = require('../utils/campaignPlanner');
const {
  getCampaignCategoryForItem,
  getGroupCategory,
  getProfileIdForCampaign,
} = require('../utils/campaignCategory');

const { waitBetweenGroups } = require('../utils/delayManager');

async function captureFailureScreenshot(page, campaignId, groupId) {
  try {
    const errorsDir = path.join(__dirname, '../../logs/errors');
    fs.mkdirSync(errorsDir, { recursive: true });
    const safeId = `${campaignId}-${groupId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeId}.png`;
    const filePath = path.join(errorsDir, fileName);
    await page.screenshot({ path: filePath, fullPage: false });
    return `logs/errors/${fileName}`;
  } catch {
    return null;
  }
}

function emitState(update) {
  console.log(`APP_STATE:${JSON.stringify(update)}`);
}

function emitEvent(type, message) {
  console.log(`APP_EVENT:${JSON.stringify({ type, message })}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getItemName(item) {
  return item.name || item.title || item.id || 'Campanie fără nume';
}

function calculateEta({ startedAt, processed, total }) {
  if (!startedAt || processed <= 0 || total <= 0) {
    return {
      averageSecondsPerGroup: null,
      etaSeconds: null,
    };
  }

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const averageSecondsPerGroup = elapsedSeconds / processed;
  const remaining = Math.max(total - processed, 0);
  const etaSeconds = Math.round(remaining * averageSecondsPerGroup);

  return {
    averageSecondsPerGroup: Math.round(averageSecondsPerGroup),
    etaSeconds,
  };
}

async function waitIfPaused(itemName, groupName = null) {
  let pauseMessageSent = false;

  while (true) {
    const runtimeConfig = DataManager.getRuntimeConfig();

    if (!runtimeConfig.pauseRequested) {
      if (pauseMessageSent) {
        emitEvent('success', 'Robot reluat. Continuă campania.');
        emitState({
          robotStatus: 'running',
          currentProperty: itemName,
          currentGroup: groupName,
          pauseRequested: false,
          lastMessage: 'Robot reluat. Continuă campania.',
        });
      }

      return;
    }

    if (!pauseMessageSent) {
      emitEvent('warning', 'Robot în pauză. Așteaptă Resume...');
      pauseMessageSent = true;
    }

    emitState({
      robotStatus: 'paused',
      currentProperty: itemName,
      currentGroup: groupName,
      pauseRequested: true,
      lastMessage: 'Robot în pauză. Așteaptă Resume...',
    });

    await sleep(3000);
  }
}

function isGroupCompatibleWithProperty(item, group) {
  const runtimeConfig = DataManager.getRuntimeConfig();
  const campaignCategory = getCampaignCategoryForItem(item, runtimeConfig);
  const groupCategory = getGroupCategory(group);

  if (groupCategory !== campaignCategory) {
    return false;
  }

  if (campaignCategory === 'jobs') {
    return true;
  }

  const groupType = group.overrideType || group.detectedType || 'mixed';

  if (item.transactionType === 'sale' && groupType === 'rent') {
    return false;
  }

  if (item.transactionType === 'rent' && groupType === 'sale') {
    return false;
  }

  return true;
}

function shouldStopAfterCurrentGroup() {
  const runtimeConfig = DataManager.getRuntimeConfig();
  return runtimeConfig.stopAfterCurrentGroup === true;
}

async function runCampaign(page, item, groups, campaignDay, options = {}) {
  const itemName = getItemName(item);
  const history = loadHistory();
  const runtimeConfig = DataManager.getRuntimeConfig();
  const facebookProfileId = options.facebookProfileId || getProfileIdForCampaign(item, runtimeConfig);
  const forceRetryGroupIds = new Set(options.forceRetryGroupIds || []);

  const postTemplate = getPostForDay(item, campaignDay);

  if (!postTemplate) {
    const message = `Nu există postare pentru ziua ${campaignDay}.`;

    console.log(message);
    emitEvent('warning', message);

    emitState({
      currentProperty: itemName,
      currentGroup: null,
      lastMessage: message,
    });

    return { processed: 0 };
  }

  let eligibleGroups = options.plannedGroups || getEligibleGroups(item, groups);
  const propertyProgressBase = Number(options.propertyProgressBase || 0);
  const propertyTotalGroups = Number(
    options.propertyTotalGroups || eligibleGroups.length
  );

  if (propertyProgressBase === 0) {
    console.log(`Grupuri de parcurs pentru proprietate: ${propertyTotalGroups}`);
    emitEvent('info', `Pornesc ${itemName}: ${propertyTotalGroups} grupuri de parcurs.`);
  }

  if (eligibleGroups.length === 0) {
    const message = `Nu exista grupuri de parcurs pentru ${itemName} pe profilul ${facebookProfileId}.`;

    console.log(message);
    emitEvent('warning', message);
    emitState({
      robotStatus: 'running',
      currentProperty: itemName,
      currentGroup: null,
      progress: 0,
      totalGroups: 0,
      totalCampaignProgress: Number(options.totalCampaignProgressBase || 0),
      totalCampaignGroups: Number(options.totalCampaignGroups || 0),
      pauseRequested: false,
      lastMessage: message,
    });

    return { processed: 0 };
  }

  const propertyStartedAt = Number(options.propertyStartedAt || Date.now());
  const campaignStartedAt = options.campaignStartedAt || propertyStartedAt;

  const totalCampaignGroups = Number(
    options.totalCampaignGroups || eligibleGroups.length
  );

  const totalCampaignProgressBase = Number(
    options.totalCampaignProgressBase || 0
  );

  emitState({
    robotStatus: 'running',
    currentProperty: itemName,
    currentGroup: null,
    progress: propertyProgressBase,
    totalGroups: propertyTotalGroups,
    totalCampaignProgress: totalCampaignProgressBase,
    totalCampaignGroups,
    averageSecondsPerGroup: null,
    etaCurrentProperty: null,
    etaTotal: null,
    pauseRequested: false,
    lastMessage: propertyProgressBase === 0
      ? `Pornesc campania: ${itemName}`
      : `Continui campania: ${itemName} (${propertyProgressBase}/${propertyTotalGroups})`,
  });

  let processedCounter = 0;

  function updateLiveState(groupName, message) {
    const propertyEta = calculateEta({
      startedAt: propertyStartedAt,
      processed: propertyProgressBase + processedCounter,
      total: propertyTotalGroups,
    });

    const campaignEta = calculateEta({
      startedAt: campaignStartedAt,
      processed: totalCampaignProgressBase + processedCounter,
      total: totalCampaignGroups,
    });

    emitState({
      robotStatus: 'running',
      currentProperty: itemName,
      currentGroup: groupName || null,
      progress: propertyProgressBase + processedCounter,
      totalGroups: propertyTotalGroups,
      totalCampaignProgress: totalCampaignProgressBase + processedCounter,
      totalCampaignGroups,
      averageSecondsPerGroup:
        campaignEta.averageSecondsPerGroup || propertyEta.averageSecondsPerGroup,
      etaCurrentProperty: propertyEta.etaSeconds,
      etaTotal: campaignEta.etaSeconds,
      pauseRequested: false,
      lastMessage: message,
    });
  }

  for (const group of eligibleGroups) {
    await waitIfPaused(itemName, group.name);

    if (
      options.skipGroupsPostedToday &&
      hasPostedInGroupOnDate(loadHistory(), group.id)
    ) {
      const message = `Sarit: ${group.name} are deja o postare astazi.`;

      addHistoryEntry({
        propertyId: item.id,
        propertyName: itemName,
        facebookProfileId,
        groupId: group.id,
        groupName: group.name,
        day: campaignDay,
        status: 'skipped',
        reason: 'group_posted_today',
      });
      console.log(message);
      emitEvent('warning', message);
      processedCounter++;
      updateLiveState(group.name, message);
      continue;
    }

    if (
      !forceRetryGroupIds.has(group.id) &&
      hasProcessed(history, item.id, group.id)
    ) {
      const message = `Sărit: ${group.name} deja procesat.`;

      console.log(message);
      emitEvent('warning', message);

      processedCounter++;
      updateLiveState(group.name, message);

      if (shouldStopAfterCurrentGroup()) {
        const stopMessage = 'Robotul se oprește după grupul curent.';
        console.log('🛑 Stop după grupul curent.');
        emitEvent('warning', stopMessage);
        break;
      }

      continue;
    }

    try {
      const post = {
        ...postTemplate,
        groupUrl: group.url,
        facebookProfileId,
        postingIdentityId: item.postingIdentityId,
        campaignCategory: getCampaignCategoryForItem(item, DataManager.getRuntimeConfig()),
      };

      updateLiveState(group.name, `Deschid grupul: ${group.name}`);
      emitEvent('info', `Deschid grupul: ${group.name}`);

      console.log(`Deschid grupul: ${group.name}`);

      await openGroup(page, post.groupUrl);

      const discoveredGroup = await discoverAndUpdateGroup(page, group);

      if (!isGroupCompatibleWithProperty(item, discoveredGroup)) {
        const message = `Sărit după discovery: ${discoveredGroup.name} nu este compatibil cu campania ${item.transactionType}.`;

        console.log(`⏭ ${message}`);
        emitEvent('warning', message);

        addHistoryEntry({
          propertyId: item.id,
          propertyName: itemName,
          facebookProfileId,
          groupId: group.id,
          groupName: discoveredGroup.name,
          day: campaignDay,
          status: 'skipped',
          reason: `group_${
            discoveredGroup.overrideType || discoveredGroup.detectedType
          }_campaign_${item.transactionType}`,
        });

        processedCounter++;
        updateLiveState(discoveredGroup.name, message);

        if (shouldStopAfterCurrentGroup()) {
          const stopMessage = 'Robotul se oprește după grupul curent.';
          console.log('🛑 Stop după grupul curent.');
          emitEvent('warning', stopMessage);
          break;
        }

        continue;
      }

      updateLiveState(
        discoveredGroup.name,
        `Pregătesc postarea pentru: ${discoveredGroup.name}`
      );

      emitEvent('info', `Pregătesc postarea pentru: ${discoveredGroup.name}`);
      console.log(`Pregătesc postare pentru grupul: ${discoveredGroup.name}`);

      await createPost(page, post);

      emitEvent('info', `Public postarea în: ${discoveredGroup.name}`);

      const published = await publishPost(page);

      addHistoryEntry({
        propertyId: item.id,
        propertyName: itemName,
        facebookProfileId,
        groupId: group.id,
        groupName: discoveredGroup.name,
        day: campaignDay,
        status: published ? 'posted' : 'prepared',
      });

      processedCounter++;

      const message = published
        ? `Postat în: ${discoveredGroup.name}`
        : `Pregătit pentru: ${discoveredGroup.name}`;

      updateLiveState(discoveredGroup.name, message);
      emitEvent(published ? 'success' : 'info', message);

      console.log(
        published
          ? `✅ Postat și notat în history: ${discoveredGroup.name}`
          : `✅ Pregătit și notat în history: ${discoveredGroup.name}`
      );

      if (shouldStopAfterCurrentGroup()) {
        const stopMessage = 'Robotul se oprește după grupul curent.';
        console.log('🛑 Stop după grupul curent.');
        emitEvent('warning', stopMessage);
        break;
      }

      await waitBetweenGroups(processedCounter);
    } catch (error) {
      const screenshotPath = await captureFailureScreenshot(page, item.id, group.id);
      addHistoryEntry({
        propertyId: item.id,
        propertyName: itemName,
        facebookProfileId,
        groupId: group.id,
        groupName: group.name,
        day: campaignDay,
        status: 'error',
        errorMessage: error.message,
        screenshotPath,
      });

      processedCounter++;

      const message = `Eroare la grupul: ${group.name}`;

      updateLiveState(group.name, message);
      emitEvent('error', `${message} - ${error.message}`);

      console.error(`❌ Eroare la grupul ${group.name}: ${error.message}`);

      if (shouldStopAfterCurrentGroup()) {
        const stopMessage = 'Robotul se oprește după grupul curent.';
        console.log('🛑 Stop după grupul curent.');
        emitEvent('warning', stopMessage);
        break;
      }

      await waitBetweenGroups(processedCounter);
    }
  }

  updateLiveState(null, `Campania ${itemName} a fost parcursă.`);
  emitEvent('success', `Campania ${itemName} a fost parcursă.`);

  console.log('✅ Grupurile selectate au fost parcurse.');

  return {
    processed: processedCounter,
  };
}

module.exports = {
  runCampaign,
};
