const startButton = document.getElementById('startButton');
const openButton = document.getElementById('openButton');
const stopButton = document.getElementById('stopButton');
const message = document.getElementById('message');
const minimizeButton = document.getElementById('minimizeButton');
const closeButton = document.getElementById('closeButton');
const enterWorkspaceButton = document.getElementById('enterWorkspaceButton');
const startupStatus = document.querySelector('.startup-status');
const checkUpdateButton = document.getElementById('checkUpdateButton');
const installUpdateButton = document.getElementById('installUpdateButton');
const updateStatus = document.getElementById('updateStatus');

let launchInProgress = false;
let stopInProgress = false;
let startupLaunch = false;
let updateCheckInProgress = false;
let updateInstallInProgress = false;

function renderStatus(status) {
  for (const service of status.services || []) {
    const card = document.querySelector(`[data-service=${service.id}]`);
    if (!card) continue;
    card.classList.toggle('online', service.online);
    card.classList.toggle('pending', !service.online && status.starting);
    card.querySelector('small').textContent = service.online
      ? status.stopping ? 'Se opreste...' : 'Online'
      : status.starting
        ? 'Porneste...'
        : 'Oprit';
  }

  openButton.disabled = !status.allOnline;
  startButton.disabled = launchInProgress || stopInProgress || status.starting || status.stopping;
  stopButton.disabled = !status.anyOnline || launchInProgress || stopInProgress || status.starting || status.stopping;
  startButton.textContent = status.allOnline
    ? 'Studio este pornit'
    : status.starting || launchInProgress
      ? 'Pornesc serviciile...'
      : 'Porneste Studio';

  if (startupLaunch) {
    enterWorkspaceButton.disabled = !status.allOnline;
    startupStatus.textContent = status.allOnline
      ? 'Your workspace is ready.'
      : 'Preparing your workspace...';
  }

  if (status.stopping || stopInProgress) {
    message.className = 'message working';
    message.textContent = 'Opresc serviciile Studio in fundal...';
  } else if (status.allOnline) {
    message.className = 'message success';
    message.textContent = 'Toate serviciile sunt online. Studio este gata.';
  } else if (status.starting || launchInProgress) {
    message.className = 'message working';
    message.textContent = 'Pornesc serviciile. Prima pornire poate dura cateva secunde.';
  }
}

async function stopStudio() {
  if (stopInProgress) return;
  const confirmed = window.confirm('Opresti RX AI Studio? Daca robotul ruleaza, campania activa va fi intrerupta imediat.');
  if (!confirmed) return;

  stopInProgress = true;
  stopButton.disabled = true;
  message.className = 'message working';
  message.textContent = 'Opresc RX AI Studio...';

  try {
    const status = await window.rxStudioLauncher.stop();
    renderStatus(status);
    message.className = 'message success';
    message.textContent = 'Studio a fost oprit complet.';
  } catch (error) {
    message.className = 'message error';
    message.textContent = error.message || 'Studio nu a putut fi oprit.';
  } finally {
    stopInProgress = false;
    renderStatus(await window.rxStudioLauncher.getStatus());
  }
}

async function startStudio() {
  if (launchInProgress) return;
  launchInProgress = true;
  startButton.disabled = true;
  message.className = 'message working';
  message.textContent = 'Pornesc RX AI Studio...';

  try {
    const status = await window.rxStudioLauncher.start();
    renderStatus(status);
  } catch (error) {
    message.className = 'message error';
    message.textContent = error.message || 'Studio nu a putut porni.';
  } finally {
    launchInProgress = false;
    renderStatus(await window.rxStudioLauncher.getStatus());
  }
}

async function checkForUpdate() {
  if (updateCheckInProgress || updateInstallInProgress) return;
  updateCheckInProgress = true;
  checkUpdateButton.disabled = true;
  updateStatus.textContent = 'Verific ultimul update din repository...';
  try {
    const update = await window.rxStudioLauncher.checkUpdate();
    const canInstallAvailableUpdate = update.available && (update.kind !== 'continuous' || update.canAutoInstall !== false);
    installUpdateButton.hidden = !canInstallAvailableUpdate;
    if (update.available) {
      updateStatus.textContent = update.kind === 'continuous'
        ? `Update disponibil din main (${update.latestCommit.slice(0, 7)}): ${update.summary || 'modificari noi'}.`
        : `Versiunea ${update.latestVersion} este disponibila. Ai instalat ${update.currentVersion}.`;
    } else if (update.sourceCheckout && update.repositoryDiffers) {
      updateStatus.textContent = `Repository-ul local si canalul public sunt pe commituri diferite. Aceasta copie se actualizeaza prin Git, nu prin installer.`;
    } else if (update.requiresInstaller) {
      updateStatus.textContent = `Updaterul necesita bootstrap ${update.latestVersion} sau mai nou. Instaleaza ultimul release stabil.`;
    } else if (update.noRelease) {
      updateStatus.textContent = `Versiunea ${update.currentVersion}. Nu exista inca un release publicat.`;
    } else {
      updateStatus.textContent = `Versiunea ${update.currentVersion} este la zi cu repository-ul.`;
    }
  } catch (error) {
    updateStatus.textContent = error.message || 'Nu am putut verifica actualizarile.';
  } finally {
    updateCheckInProgress = false;
    checkUpdateButton.disabled = false;
  }
}

async function installUpdate() {
  if (updateInstallInProgress) return;
  const confirmed = window.confirm('Descarc si aplic update-ul din repository? Studio va fi oprit numai dupa verificarea completa, iar datele locale vor fi pastrate.');
  if (!confirmed) return;
  updateInstallInProgress = true;
  installUpdateButton.disabled = true;
  checkUpdateButton.disabled = true;
  updateStatus.textContent = 'Descarc si verific update-ul. Nu inchide launcherul...';
  message.className = 'message working';
  message.textContent = 'Update in curs. Studio va fi oprit doar inainte de aplicarea pachetului verificat.';
  try {
    const result = await window.rxStudioLauncher.installUpdate();
    updateStatus.textContent = result.kind === 'continuous'
      ? 'Update verificat. Aplic modificarile si repornesc launcherul.'
      : 'Installerul noii versiuni a pornit.';
  } catch (error) {
    updateStatus.textContent = error.message || 'Update-ul nu a putut fi instalat.';
    message.className = 'message error';
    message.textContent = updateStatus.textContent;
    updateInstallInProgress = false;
    installUpdateButton.disabled = false;
    checkUpdateButton.disabled = false;
  }
}

startButton.addEventListener('click', startStudio);
openButton.addEventListener('click', () => window.rxStudioLauncher.open());
stopButton.addEventListener('click', stopStudio);
minimizeButton.addEventListener('click', () => window.rxStudioLauncher.minimize());
closeButton.addEventListener('click', () => window.rxStudioLauncher.close());
enterWorkspaceButton.addEventListener('click', async () => {
  if (enterWorkspaceButton.disabled) return;
  await window.rxStudioLauncher.open();
  window.rxStudioLauncher.close();
});
checkUpdateButton.addEventListener('click', checkForUpdate);
installUpdateButton.addEventListener('click', installUpdate);
window.rxStudioLauncher.onStatus(renderStatus);

async function initializeLauncher() {
  startupLaunch = await window.rxStudioLauncher.isStartupLaunch();
  document.body.classList.toggle('startup-welcome-mode', startupLaunch);

  const status = await window.rxStudioLauncher.getStatus();
  renderStatus(status);
  void checkForUpdate();
  startStudio();
}

void initializeLauncher();
