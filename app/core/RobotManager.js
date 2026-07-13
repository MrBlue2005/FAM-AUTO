const { spawn } = require('child_process');
const path = require('path');

const { updateState, getState, addLiveFeed } = require('./AppState');
const DataManager = require('./DataManager');
const { buildPreflightReport, buildQueuePlan } = require('./CampaignTools');

let robotProcess = null;
let activeRunId = null;

function start(options = {}) {
  if (robotProcess) {
    updateState({
      lastMessage: 'Robotul ruleaza deja. Start blocat pentru siguranta.',
    });

    addLiveFeed({
      type: 'warning',
      message: 'Start blocat: robotul ruleaza deja.',
    });

    return getState();
  }

  const config = DataManager.getRuntimeConfig();
  const requestedProfileId = options.facebookProfileId || options.confirmedFacebookProfileId;
  const selectedProfile = requestedProfileId
    ? (config.facebookProfiles || []).find((profile) => profile.id === requestedProfileId)
    : null;

  if (requestedProfileId && !selectedProfile) {
    updateState({
      robotStatus: 'error',
      lastMessage: `Profil Facebook invalid la pornire: ${requestedProfileId}`,
    });

    addLiveFeed({
      type: 'error',
      message: `Start blocat: profil Facebook invalid (${requestedProfileId}).`,
    });

    return getState();
  }

  const effectiveConfig = {
    ...config,
    facebookProfileId: requestedProfileId || config.facebookProfileId,
    stopAfterCurrentGroup: false,
    pauseRequested: false,
  };
  const preflight = buildPreflightReport({
    config: effectiveConfig,
    properties: DataManager.getProperties(),
    jobs: DataManager.getJobs(),
    groups: DataManager.getGroups(),
    history: DataManager.getHistory(),
  });

  if (!preflight.ok) {
    const message = `Start blocat de preflight: ${preflight.summary.errors} probleme.`;
    updateState({ robotStatus: 'error', lastMessage: message, preflight });
    addLiveFeed({ type: 'error', message });
    return getState();
  }

  if (effectiveConfig.publishEnabled && options.confirmedPublishEnabled !== true) {
    const message = 'Start LIVE blocat: publicarea nu a fost confirmata explicit.';
    updateState({ robotStatus: 'error', lastMessage: message, preflight });
    addLiveFeed({ type: 'error', message });
    return getState();
  }

  DataManager.saveRuntimeConfig(effectiveConfig);

  const queuePlan = buildQueuePlan({
    config: effectiveConfig,
    properties: DataManager.getProperties(),
    jobs: DataManager.getJobs(),
    groups: DataManager.getGroups(),
    history: DataManager.getHistory(),
  });
  const run = DataManager.createCampaignRun({ config: effectiveConfig, tasks: queuePlan.activeTasks });
  activeRunId = run.id;

  const rootPath = path.join(__dirname, '../..');

  robotProcess = spawn(process.execPath, ['index.js'], {
    cwd: rootPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RX_RUN_ID: run.id },
  });

  updateState({
    robotStatus: 'running',
    lastMessage: 'Robot pornit.',
    progress: 0,
    totalGroups: 0,
    currentProperty: null,
    currentGroup: null,
    stopAfterCurrentGroup: false,
    liveFeed: [],
    preflight,
    activeRunId: run.id,
  });

  addLiveFeed({
    type: 'info',
    message: 'Robot pornit.',
  });

  robotProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);

    lines.forEach((line) => {
      if (line.startsWith('APP_STATE:')) {
        try {
          updateState(JSON.parse(line.replace('APP_STATE:', '')));
        } catch (error) {
          console.error('Eroare parse APP_STATE:', error.message);
        }
        return;
      }

      if (line.startsWith('APP_EVENT:')) {
        try {
          addLiveFeed(JSON.parse(line.replace('APP_EVENT:', '')));
        } catch (error) {
          console.error('Eroare parse APP_EVENT:', error.message);
        }
        return;
      }

      console.log(line);
      updateState({ lastMessage: line });
    });
  });

  robotProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();

    console.error(message);

    updateState({
      robotStatus: 'error',
      lastMessage: message,
    });

    addLiveFeed({
      type: 'error',
      message,
    });
  });

  robotProcess.on('error', (error) => {
    if (activeRunId) DataManager.finishCampaignRun(activeRunId, 'failed', { errorMessage: error.message });
    activeRunId = null;
    robotProcess = null;
    updateState({ robotStatus: 'error', activeRunId: null, lastMessage: `Robotul nu a putut porni: ${error.message}` });
    addLiveFeed({ type: 'error', message: `Robotul nu a putut porni: ${error.message}` });
  });

  robotProcess.on('close', (code, signal) => {
    const closedRunId = activeRunId;
    const spawnFailed = !closedRunId && getState().robotStatus === 'error';
    const manuallyStopped = signal || getState().lastMessage === 'Robot oprit manual.';
    if (closedRunId) {
      DataManager.finishCampaignRun(closedRunId, manuallyStopped ? 'stopped' : code === 0 ? 'completed' : 'failed', {
        exitCode: code,
        signal: signal || null,
      });
    }
    activeRunId = null;
    robotProcess = null;

    if (spawnFailed) return;

    updateState({
      robotStatus: 'stopped',
      lastMessage: 'Robot finalizat.',
      currentGroup: null,
      stopAfterCurrentGroup: false,
      activeRunId: null,
    });

    addLiveFeed({
      type: 'success',
      message: 'Robot finalizat.',
    });
  });

  return getState();
}

function stop() {
  if (robotProcess) {
    robotProcess.kill();
  }

  updateState({
    robotStatus: 'stopped',
    lastMessage: 'Robot oprit manual.',
    currentGroup: null,
    stopAfterCurrentGroup: false,
  });

  addLiveFeed({
    type: 'warning',
    message: 'Robot oprit manual.',
  });

  return getState();
}

function stopAfterCurrentGroup() {
  const config = DataManager.getRuntimeConfig();

  DataManager.saveRuntimeConfig({
    ...config,
    stopAfterCurrentGroup: true,
  });

  updateState({
    stopAfterCurrentGroup: true,
    lastMessage: 'Robotul se va opri după grupul curent.',
  });

  addLiveFeed({
    type: 'warning',
    message: 'Stop programat după grupul curent.',
  });

  return getState();
}

function status() {
  return getState();
}

function isRunning() {
  return Boolean(robotProcess);
}

module.exports = {
  start,
  stop,
  stopAfterCurrentGroup,
  status,
  isRunning,
  pause,
  resume,
};

function pause() {
  const config = DataManager.getRuntimeConfig();

  DataManager.saveRuntimeConfig({
    ...config,
    pauseRequested: true,
  });

  updateState({
    pauseRequested: true,
    lastMessage: 'Robot pus pe pauză după grupul curent.',
  });

  addLiveFeed({
    type: 'warning',
    message: 'Pauză cerută. Robotul se oprește temporar după grupul curent.',
  });

  return getState();
}

function resume() {
  const config = DataManager.getRuntimeConfig();

  DataManager.saveRuntimeConfig({
    ...config,
    pauseRequested: false,
  });

  updateState({
    pauseRequested: false,
    lastMessage: 'Robot reluat.',
  });

  addLiveFeed({
    type: 'success',
    message: 'Robot reluat.',
  });

  return getState();
}
