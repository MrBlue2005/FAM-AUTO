const config = require('../config/facebookConfig');
const human = require('../human');

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let groupsUntilLongPause = random(
  config.pause.longPauseEvery.min,
  config.pause.longPauseEvery.max
);

function shouldMicroBreak() {
  return Math.random() < config.pause.microBreak.probability;
}

async function waitSeconds(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function waitBetweenGroups(counter) {
  if (counter >= groupsUntilLongPause) {
    console.log('☕ Pauză mare...');

    await human.longPause();

    groupsUntilLongPause += random(
      config.pause.longPauseEvery.min,
      config.pause.longPauseEvery.max
    );

    return;
  }

  if (shouldMicroBreak()) {
    const seconds = random(
      config.pause.microBreak.min,
      config.pause.microBreak.max
    );

    console.log(`🟡 Micro break ${seconds}s...`);

    await waitSeconds(seconds);
  }

  await human.betweenGroups();
}

module.exports = {
  waitBetweenGroups,
};