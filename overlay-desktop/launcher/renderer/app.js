const startButton = document.getElementById('startButton');
const openButton = document.getElementById('openButton');
const stopButton = document.getElementById('stopButton');
const message = document.getElementById('message');
const minimizeButton = document.getElementById('minimizeButton');
const closeButton = document.getElementById('closeButton');

let launchInProgress = false;
let stopInProgress = false;

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

startButton.addEventListener('click', startStudio);
openButton.addEventListener('click', () => window.rxStudioLauncher.open());
stopButton.addEventListener('click', stopStudio);
minimizeButton.addEventListener('click', () => window.rxStudioLauncher.minimize());
closeButton.addEventListener('click', () => window.rxStudioLauncher.close());
window.rxStudioLauncher.onStatus(renderStatus);

void window.rxStudioLauncher.getStatus().then((status) => {
  renderStatus(status);
  if (status.allOnline) {
    window.rxStudioLauncher.open();
  } else {
    startStudio();
  }
});
