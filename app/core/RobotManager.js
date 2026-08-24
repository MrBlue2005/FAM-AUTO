const { spawn } = require('child_process');
const path = require('path');

const { updateState, addLiveFeed } = require('./AppState');
const DataManager = require('./DataManager');
const { buildPreflightReport, buildQueuePlan } = require('./CampaignTools');

// A persistent Chromium profile may be used by one worker only. Different
// profiles receive independent Node/Playwright workers and config snapshots.
const activeRobots = new Map();

function activeRuns() {
  return [...activeRobots.values()].map((worker) => ({
    profileId: worker.profileId,
    runId: worker.runId,
    robotStatus: worker.state.robotStatus || 'running',
    currentProperty: worker.state.currentProperty || null,
    currentGroup: worker.state.currentGroup || null,
    progress: worker.state.progress || 0,
    totalGroups: worker.state.totalGroups || 0,
    lastMessage: worker.state.lastMessage || '',
  }));
}

function refreshAggregateState() {
  const runs = activeRuns();
  const primary = runs[0] || null;
  const robotStatus = !runs.length ? 'idle'
    : runs.some((run) => run.robotStatus === 'running') ? 'running' : 'paused';

  return updateState({
    robotStatus,
    activeRuns: runs,
    activeRunCount: runs.length,
    activeRunId: primary?.runId || null,
    currentProperty: primary?.currentProperty || null,
    currentGroup: primary?.currentGroup || null,
    progress: primary?.progress || 0,
    totalGroups: primary?.totalGroups || 0,
    lastMessage: primary?.lastMessage || (runs.length ? 'Roboti activi.' : 'Robot pregatit.'),
  });
}

function status() {
  return refreshAggregateState();
}

function start(options = {}) {
  const storedConfig = DataManager.getRuntimeConfig();
  const baseConfig = options.executionConfig || storedConfig;
  const profileId = options.facebookProfileId || options.confirmedFacebookProfileId || baseConfig.facebookProfileId;
  const selectedProfile = (baseConfig.facebookProfiles || []).find((profile) => profile.id === profileId);

  if (!selectedProfile) {
    const message = `Profil Facebook invalid la pornire: ${profileId}`;
    addLiveFeed({ type: 'error', message });
    return { ...status(), startedProfileId: null, lastMessage: message };
  }
  if (activeRobots.has(profileId)) {
    const message = `Profilul ${selectedProfile.label || profileId} ruleaza deja. Alege un profil diferit.`;
    addLiveFeed({ type: 'warning', message, profileId });
    return { ...status(), startedProfileId: null, lastMessage: message };
  }

  // Pause and stop-after-current are shared safety controls. Reset them only
  // before the first worker starts so a second profile never changes another
  // active worker's execution plan.
  if (activeRobots.size === 0) {
    DataManager.saveRuntimeConfig({
      ...storedConfig,
      pauseRequested: false,
      stopAfterCurrentGroup: false,
    });
  }

  const executionConfig = {
    ...baseConfig,
    facebookProfileId: profileId,
    stopAfterCurrentGroup: false,
    pauseRequested: false,
    skipGroupsPostedToday: options.skipGroupsPostedToday === true,
  };
  const workerData = {
    config: executionConfig,
    properties: DataManager.getProperties(),
    jobs: DataManager.getJobs(),
    groups: DataManager.getGroups(),
    history: DataManager.getHistory(),
  };
  const preflight = buildPreflightReport(workerData);
  if (!preflight.ok) {
    const noGroupsToday = preflight.issues.some((issue) => issue.code === 'NO_ELIGIBLE_GROUPS_TODAY');
    const message = noGroupsToday
      ? preflight.issues.find((issue) => issue.code === 'NO_ELIGIBLE_GROUPS_TODAY').message
      : `Start blocat de preflight: ${preflight.summary.errors} probleme.`;
    addLiveFeed({ type: noGroupsToday ? 'warning' : 'error', message, profileId });
    return { ...status(), startedProfileId: null, lastMessage: message, preflight };
  }
  if (executionConfig.publishEnabled && options.confirmedPublishEnabled !== true) {
    const message = 'Start LIVE blocat: publicarea nu a fost confirmata explicit.';
    addLiveFeed({ type: 'error', message, profileId });
    return { ...status(), startedProfileId: null, lastMessage: message, preflight };
  }

  const queuePlan = buildQueuePlan(workerData);
  const run = DataManager.createCampaignRun({ config: executionConfig, tasks: queuePlan.activeTasks });
  const robotProcess = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      RX_RUN_ID: run.id,
      RX_EXECUTION_CONFIG: JSON.stringify(executionConfig),
      RX_SKIP_GROUPS_POSTED_TODAY: executionConfig.skipGroupsPostedToday ? '1' : '0',
    },
  });
  const worker = {
    profileId,
    runId: run.id,
    process: robotProcess,
    state: { robotStatus: 'running', preflight, lastMessage: 'Robot pornit.', progress: 0, totalGroups: 0 },
  };
  activeRobots.set(profileId, worker);
  addLiveFeed({ type: 'info', message: `Robot pornit pe profilul ${selectedProfile.label || profileId}.`, profileId });
  refreshAggregateState();

  robotProcess.stdout.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach((line) => {
      if (line.startsWith('APP_STATE:')) {
        try { worker.state = { ...worker.state, ...JSON.parse(line.replace('APP_STATE:', '')) }; refreshAggregateState(); }
        catch (error) { console.error('Eroare parse APP_STATE:', error.message); }
        return;
      }
      if (line.startsWith('APP_EVENT:')) {
        try { addLiveFeed({ ...JSON.parse(line.replace('APP_EVENT:', '')), profileId }); }
        catch (error) { console.error('Eroare parse APP_EVENT:', error.message); }
        return;
      }
      console.log(line);
      worker.state.lastMessage = line;
      refreshAggregateState();
    });
  });
  robotProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();
    console.error(message);
    worker.state = { ...worker.state, robotStatus: 'error', lastMessage: message };
    addLiveFeed({ type: 'error', message, profileId });
    refreshAggregateState();
  });
  robotProcess.on('error', (error) => {
    DataManager.finishCampaignRun(run.id, 'failed', { errorMessage: error.message });
    activeRobots.delete(profileId);
    addLiveFeed({ type: 'error', message: `Robotul nu a putut porni: ${error.message}`, profileId });
    refreshAggregateState();
  });
  robotProcess.on('close', (code, signal) => {
    activeRobots.delete(profileId);
    DataManager.finishCampaignRun(run.id, signal ? 'stopped' : code === 0 ? 'completed' : 'failed', { exitCode: code, signal: signal || null });
    addLiveFeed({ type: code === 0 && !signal ? 'success' : 'warning', message: `Robot finalizat pe profilul ${selectedProfile.label || profileId}.`, profileId });
    refreshAggregateState();
  });
  return { ...status(), startedProfileId: profileId, preflight };
}

function stop(profileId = null) {
  const workers = profileId ? [activeRobots.get(profileId)].filter(Boolean) : [...activeRobots.values()];
  workers.forEach((worker) => worker.process.kill());
  addLiveFeed({ type: 'warning', message: profileId ? `Robot oprit pe profilul ${profileId}.` : 'Toate rulările robotului au fost oprite.' });
  return status();
}

function stopAfterCurrentGroup() {
  const config = DataManager.getRuntimeConfig();
  DataManager.saveRuntimeConfig({ ...config, stopAfterCurrentGroup: true });
  const message = 'Toate rulările active se vor opri după grupul curent.';
  addLiveFeed({ type: 'warning', message });
  return { ...status(), stopAfterCurrentGroup: true, lastMessage: message };
}

function pause() {
  const config = DataManager.getRuntimeConfig();
  DataManager.saveRuntimeConfig({ ...config, pauseRequested: true });
  const message = 'Toate rulările active vor intra în pauză după grupul curent.';
  addLiveFeed({ type: 'warning', message });
  return { ...status(), pauseRequested: true, lastMessage: message };
}

function resume() {
  const config = DataManager.getRuntimeConfig();
  DataManager.saveRuntimeConfig({ ...config, pauseRequested: false });
  addLiveFeed({ type: 'success', message: 'Toate rulările active au fost reluate.' });
  return { ...status(), pauseRequested: false };
}
function isRunning(profileId = null) { return profileId ? activeRobots.has(profileId) : activeRobots.size > 0; }

module.exports = { start, stop, stopAfterCurrentGroup, status, isRunning, pause, resume };
