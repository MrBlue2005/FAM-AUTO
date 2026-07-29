const defaultSettings = {
  apiUrl: 'http://127.0.0.1:3000/api',
  apiKey: '',
  overlayToken: '',
  sizePreset: 'medium',
  width: 780,
  height: 640,
  opacity: 0.92,
  alwaysOnTop: true,
  notifications: {
    errors: true,
    warnings: true,
    success: false,
    status: true,
  },
};

const sizePresets = {
  compact: {
    width: 620,
    height: 580,
  },
  medium: {
    width: 780,
    height: 640,
  },
  large: {
    width: 940,
    height: 720,
  },
};

const state = {
  settings: defaultSettings,
  data: null,
  initializedNotifications: false,
  previousStatus: null,
  notifiedEvents: new Set(),
  actionMessage: '',
  pollTimer: null,
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  [
    'alwaysOnTopInput',
    'apiKeyInput',
    'apiUrlInput',
    'averageTime',
    'closeButton',
    'currentCampaign',
    'currentEta',
    'currentEtaMeta',
    'currentGroup',
    'currentGroups',
    'currentPercent',
    'currentProgressFill',
    'currentProgressMeta',
    'feedCount',
    'feedList',
    'lastMessage',
    'messageBox',
    'minimizeButton',
    'modeBadge',
    'nextTasksList',
    'notifyErrorsInput',
    'notifyStatusInput',
    'notifySuccessInput',
    'notifyWarningsInput',
    'opacityInput',
    'opacityValue',
    'openDashboardButton',
    'pauseButton',
    'profileLabel',
    'refreshButton',
    'resumeButton',
    'runBadge',
    'saveSettingsButton',
    'settingsClose',
    'settingsPanel',
    'settingsToggle',
    'sizeCompactButton',
    'sizeLargeButton',
    'sizeMediumButton',
    'statusLabel',
    'statusStrip',
    'testNotificationButton',
    'totalEta',
    'totalEtaMeta',
    'totalGroups',
    'totalPercent',
    'totalProgressFill',
    'totalProgressMeta',
  ].forEach((id) => {
    elements[id] = $(id);
  });
}

function clamp(number, min, max) {
  return Math.min(Math.max(Number(number), min), max);
}

function mergeSettings(settings = {}) {
  const sizePreset = sizePresets[settings.sizePreset]
    ? settings.sizePreset
    : defaultSettings.sizePreset;
  const presetSize = sizePresets[sizePreset];

  return {
    ...defaultSettings,
    ...settings,
    sizePreset,
    width: presetSize.width,
    height: presetSize.height,
    opacity: clamp(settings.opacity || defaultSettings.opacity, 0.35, 1),
    alwaysOnTop: settings.alwaysOnTop !== false,
    notifications: {
      ...defaultSettings.notifications,
      ...(settings.notifications || {}),
    },
  };
}

function apiUrl(path) {
  return `${state.settings.apiUrl.replace(/\/$/, '')}${path}`;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.settings.apiKey) headers['x-api-key'] = state.settings.apiKey;
  if (state.settings.overlayToken) headers['x-overlay-token'] = state.settings.overlayToken;

  const response = await fetch(apiUrl(path), {
    headers,
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `API error ${response.status}: ${path}`);
  }

  return response.json();
}

function getPercent(current, total) {
  if (!total) return 0;
  return Math.min(Math.round((Number(current || 0) / Number(total)) * 100), 100);
}

function formatEta(seconds) {
  if (!seconds && seconds !== 0) return '-';

  const total = Math.max(Number(seconds), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatTime(value) {
  if (!value) return '-';

  try {
    return new Intl.DateTimeFormat('ro-RO', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value));
  } catch {
    return '-';
  }
}

function statusLabel(status, pauseRequested) {
  if (pauseRequested && status === 'running') return 'pauza ceruta';
  if (status === 'running') return 'ruleaza';
  if (status === 'paused') return 'in pauza';
  if (status === 'error') return 'eroare';
  if (status === 'stopped') return 'oprit';
  return 'Robot pregatit';
}

function historyType(status) {
  if (status === 'posted') return 'success';
  if (status === 'error') return 'error';
  if (status === 'skipped') return 'warning';
  return 'info';
}

function eventAllowsNotification(eventType) {
  if (eventType === 'error') return state.settings.notifications.errors;
  if (eventType === 'warning') return state.settings.notifications.warnings;
  if (eventType === 'success') return state.settings.notifications.success;
  return false;
}

async function sendNotification(title, body, urgency = 'normal') {
  if (!window.rxOverlay?.notify) return;
  await window.rxOverlay.notify({ title, body, urgency });
}

function buildFeedItems(data) {
  const robot = data?.robot || {};
  const liveItems = (robot.liveFeed || []).map((event, index) => ({
    id: `live-${event.time || index}-${event.type || 'info'}-${event.message || ''}`,
    type: event.type || 'info',
    title: event.message || '-',
    subtitle: 'Robot live',
    time: event.time || '-',
  }));

  const historyItems = (data?.history || []).map((entry, index) => ({
    id: `history-${entry.date || index}-${entry.status || 'info'}-${entry.groupId || ''}`,
    type: historyType(entry.status),
    title: `${entry.status || '-'} / ${entry.propertyName || entry.propertyId || '-'}`,
    subtitle: `${entry.groupName || '-'} / Ziua ${entry.day || '-'}`,
    time: formatTime(entry.date),
  }));

  return [...liveItems, ...historyItems].slice(0, 35);
}

function trimNotificationCache() {
  if (state.notifiedEvents.size <= 160) return;

  state.notifiedEvents = new Set(Array.from(state.notifiedEvents).slice(-100));
}

function handleNotifications(data) {
  const robot = data?.robot || {};
  const status = robot.robotStatus || 'idle';
  const feedItems = buildFeedItems(data);

  if (!state.initializedNotifications) {
    feedItems.forEach((item) => state.notifiedEvents.add(item.id));
    state.previousStatus = status;
    state.initializedNotifications = true;
    return;
  }

  if (
    state.settings.notifications.status &&
    status !== state.previousStatus &&
    ['running', 'paused', 'error', 'stopped'].includes(status)
  ) {
    sendNotification(
      'R.X. AI status',
      `${statusLabel(status, robot.pauseRequested)} - ${robot.lastMessage || ''}`,
      status === 'error' ? 'critical' : 'normal'
    );
  }

  state.previousStatus = status;

  feedItems
    .slice()
    .reverse()
    .forEach((item) => {
      if (state.notifiedEvents.has(item.id)) return;
      state.notifiedEvents.add(item.id);

      if (eventAllowsNotification(item.type)) {
        sendNotification('R.X. AI live feed', item.title, item.type === 'error' ? 'critical' : 'normal');
      }
    });

  trimNotificationCache();
}

function showMessage(message, type = 'info') {
  elements.messageBox.textContent = message;
  elements.messageBox.className = `message-box ${type}`;
}

function clearMessage() {
  elements.messageBox.textContent = '';
  elements.messageBox.className = 'message-box hidden';
}

function renderSettingsForm() {
  const { settings } = state;
  const presetButtons = [
    elements.sizeCompactButton,
    elements.sizeMediumButton,
    elements.sizeLargeButton,
  ];

  elements.apiUrlInput.value = settings.apiUrl;
  elements.apiKeyInput.value = settings.apiKey || '';
  elements.opacityInput.value = Math.round(settings.opacity * 100);
  elements.opacityValue.textContent = `${Math.round(settings.opacity * 100)}%`;
  presetButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.sizePreset === settings.sizePreset);
  });
  elements.alwaysOnTopInput.checked = settings.alwaysOnTop;
  elements.notifyErrorsInput.checked = settings.notifications.errors;
  elements.notifyWarningsInput.checked = settings.notifications.warnings;
  elements.notifySuccessInput.checked = settings.notifications.success;
  elements.notifyStatusInput.checked = settings.notifications.status;
}

function renderFeed(feedItems) {
  elements.feedCount.textContent = String(feedItems.length);
  elements.feedList.innerHTML = '';

  if (feedItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nu exista evenimente live inca.';
    elements.feedList.appendChild(empty);
    return;
  }

  feedItems.forEach((item) => {
    const row = document.createElement('article');
    row.className = `feed-item ${item.type}`;

    const dot = document.createElement('i');
    const text = document.createElement('div');
    const title = document.createElement('strong');
    const subtitle = document.createElement('span');
    const time = document.createElement('time');

    title.textContent = item.title;
    subtitle.textContent = item.subtitle;
    time.textContent = item.time;

    text.append(title, subtitle);
    row.append(dot, text, time);
    elements.feedList.appendChild(row);
  });
}

function renderNextTasks(tasks = []) {
  elements.nextTasksList.innerHTML = '';

  if (tasks.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'next-task-empty';
    empty.textContent = 'Queue fara taskuri pending.';
    elements.nextTasksList.appendChild(empty);
    return;
  }

  tasks.slice(0, 3).forEach((task) => {
    const row = document.createElement('div');
    row.className = 'next-task-row';

    const campaign = document.createElement('strong');
    campaign.textContent = task.campaignTitle || task.campaignId || '-';

    const group = document.createElement('span');
    group.textContent = `${task.groupName || task.groupId || '-'} / Ziua ${task.day || '-'}`;

    row.append(campaign, group);
    elements.nextTasksList.appendChild(row);
  });
}

function render() {
  const data = state.data || {};
  const robot = data.robot || {};
  const queue = data.queue || {};
  const runtime = data.runtime || {};
  const status = robot.robotStatus || 'idle';
  const pauseRequested = robot.pauseRequested === true;

  const currentProgress = Number(robot.progress || 0);
  const currentTotal = Number(robot.totalGroups || 0);
  const totalProgress = Number(robot.totalCampaignProgress || 0);
  const totalCampaignGroups = Number(robot.totalCampaignGroups || queue.activeTasks || 0);
  const currentPercent = getPercent(currentProgress, currentTotal);
  const totalPercent = getPercent(totalProgress, totalCampaignGroups);
  const currentEta = formatEta(robot.etaCurrentProperty);
  const totalEta = formatEta(robot.etaTotal);
  const feedItems = buildFeedItems(data);
  const canPause = ['running', 'error'].includes(status) && !pauseRequested;
  const canResume = status === 'paused' || pauseRequested;

  elements.statusStrip.className = `status-strip ${status}`;
  elements.statusLabel.textContent = statusLabel(status, pauseRequested);
  const lastMessage = status === 'idle' ? '' : robot.lastMessage || '';
  elements.lastMessage.textContent = lastMessage;
  elements.modeBadge.textContent = runtime.publishEnabled ? 'LIVE' : 'TEST';
  elements.modeBadge.className = `mode-badge ${runtime.publishEnabled ? 'live' : 'test'}`;
  elements.runBadge.textContent = robot.activeRunId
    ? `Run ${robot.activeRunId}`
    : `Ziua ${runtime.campaignDay || 1} / ${queue.activeTasks || 0} active`;

  elements.currentGroups.textContent = `${currentProgress}/${currentTotal}`;
  elements.currentGroup.textContent = robot.currentGroup || 'Niciun grup activ';
  elements.totalGroups.textContent = `${totalProgress}/${totalCampaignGroups}`;
  elements.currentEta.textContent = currentEta;
  elements.currentCampaign.textContent = robot.currentProperty || 'Nicio campanie';
  elements.totalEta.textContent = totalEta;
  elements.averageTime.textContent = robot.averageSecondsPerGroup
    ? `${robot.averageSecondsPerGroup}s / grup`
    : 'calculez live';

  elements.currentPercent.textContent = `${currentPercent}%`;
  elements.currentProgressFill.style.width = `${currentPercent}%`;
  elements.currentProgressMeta.textContent = `${currentProgress}/${currentTotal} grupuri`;
  elements.currentEtaMeta.textContent = `ETA ${currentEta}`;
  elements.profileLabel.textContent = runtime.facebookProfileLabel || runtime.facebookProfileId || '-';

  elements.totalPercent.textContent = `${totalPercent}%`;
  elements.totalProgressFill.style.width = `${totalPercent}%`;
  elements.totalProgressMeta.textContent = `${totalProgress}/${totalCampaignGroups} grupuri`;
  elements.totalEtaMeta.textContent = `ETA ${totalEta}`;

  elements.pauseButton.disabled = !canPause;
  elements.resumeButton.disabled = !canResume;

  renderNextTasks(queue.nextTasks || []);
  renderFeed(feedItems);

  if (state.actionMessage) {
    showMessage(state.actionMessage, 'info');
  }
}

async function loadSettings() {
  if (window.rxOverlay?.getSettings) {
    state.settings = mergeSettings(await window.rxOverlay.getSettings());
  } else {
    state.settings = mergeSettings(defaultSettings);
  }

  renderSettingsForm();
}

async function saveSettings(partialSettings = {}) {
  const nextSettings = mergeSettings({
    ...state.settings,
    ...partialSettings,
    notifications: {
      ...state.settings.notifications,
      ...(partialSettings.notifications || {}),
    },
  });

  state.settings = window.rxOverlay?.saveSettings
    ? mergeSettings(await window.rxOverlay.saveSettings(nextSettings))
    : nextSettings;

  renderSettingsForm();
}

async function loadStatus() {
  let loaded = false;

  try {
    const nextData = await request('/overlay/status');
    state.data = nextData;
    handleNotifications(nextData);
    clearMessage();
    loaded = true;
  } catch {
    showMessage('API offline. Porneste API-ul pe localhost:3000.', 'error');
  }

  render();
  return loaded;
}

function scheduleStatusRefresh() {
  window.clearTimeout(state.pollTimer);
  const status = state.data?.robot?.robotStatus;
  const isActive = ['running', 'paused'].includes(status);
  const delay = document.hidden ? 15000 : isActive ? 2000 : 8000;

  state.pollTimer = window.setTimeout(async () => {
    await loadStatus();
    scheduleStatusRefresh();
  }, delay);
}

async function refreshStatus() {
  const originalText = elements.refreshButton.textContent;

  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add('loading');
  elements.refreshButton.textContent = 'Actualizez...';

  const loaded = await loadStatus();

  if (loaded) {
    showMessage('Status actualizat.', 'info');
  }

  window.setTimeout(() => {
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove('loading');
    elements.refreshButton.textContent = originalText;
    if (loaded) {
      clearMessage();
    }
    render();
  }, 850);
}

async function runRobotAction(label, actionPath) {
  try {
    state.actionMessage = label;
    state.data = {
      ...(state.data || {}),
      robot: await request(actionPath, { method: 'POST' }),
    };
    render();
    await loadStatus();
  } catch {
    showMessage('Nu am putut trimite comanda catre API.', 'error');
  } finally {
    setTimeout(() => {
      state.actionMessage = '';
      render();
    }, 2400);
  }
}

function readSettingsFromForm() {
  const selectedPreset = [
    elements.sizeCompactButton,
    elements.sizeMediumButton,
    elements.sizeLargeButton,
  ].find((button) => button.classList.contains('active'))?.dataset.sizePreset || state.settings.sizePreset;

  return {
    apiUrl: elements.apiUrlInput.value.trim() || defaultSettings.apiUrl,
    apiKey: elements.apiKeyInput.value.trim(),
    sizePreset: selectedPreset,
    opacity: clamp(Number(elements.opacityInput.value) / 100, 0.35, 1),
    alwaysOnTop: elements.alwaysOnTopInput.checked,
    notifications: {
      errors: elements.notifyErrorsInput.checked,
      warnings: elements.notifyWarningsInput.checked,
      success: elements.notifySuccessInput.checked,
      status: elements.notifyStatusInput.checked,
    },
  };
}

function bindEvents() {
  elements.settingsToggle.addEventListener('click', () => {
    elements.settingsPanel.classList.toggle('hidden');
  });

  elements.settingsClose.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });

  elements.minimizeButton.addEventListener('click', () => window.rxOverlay?.minimize());
  elements.closeButton.addEventListener('click', () => window.rxOverlay?.close());
  elements.refreshButton.addEventListener('click', refreshStatus);
  elements.pauseButton.addEventListener('click', () =>
    runRobotAction('Pauza ceruta. Robotul se opreste la primul punct sigur.', '/robot/pause')
  );
  elements.resumeButton.addEventListener('click', () =>
    runRobotAction('Robot reluat.', '/robot/resume')
  );

  elements.opacityInput.addEventListener('input', async () => {
    elements.opacityValue.textContent = `${elements.opacityInput.value}%`;
    await saveSettings({ opacity: Number(elements.opacityInput.value) / 100 });
  });

  [
    elements.sizeCompactButton,
    elements.sizeMediumButton,
    elements.sizeLargeButton,
  ].forEach((button) => {
    button.addEventListener('click', async () => {
      await saveSettings({ sizePreset: button.dataset.sizePreset });
    });
  });

  elements.alwaysOnTopInput.addEventListener('change', async () => {
    await saveSettings({ alwaysOnTop: elements.alwaysOnTopInput.checked });
  });

  elements.saveSettingsButton.addEventListener('click', async () => {
    await saveSettings(readSettingsFromForm());
    state.actionMessage = 'Setarile overlay-ului au fost salvate.';
    render();
    await loadStatus();
  });

  elements.testNotificationButton.addEventListener('click', () => {
    sendNotification('R.X. AI Overlay', 'Notificarile desktop functioneaza.');
  });

  elements.openDashboardButton.addEventListener('click', () => {
    window.rxOverlay?.openExternal('http://localhost:5173');
  });

  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) await loadStatus();
    scheduleStatusRefresh();
  });
}

async function init() {
  cacheElements();
  bindEvents();
  await loadSettings();
  await loadStatus();
  scheduleStatusRefresh();
}

init();
