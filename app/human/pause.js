const config = require('../config/facebookConfig');

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function wait(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

async function shortPause() {
  const seconds = randomBetween(
    config.pause.short.min,
    config.pause.short.max
  );

  console.log(`⏳ Pauză scurtă ${seconds}s`);

  await wait(seconds);
}

async function mediumPause() {
  const seconds = randomBetween(
    config.pause.medium.min,
    config.pause.medium.max
  );

  console.log(`⏳ Pauză medie ${seconds}s`);

  await wait(seconds);
}

async function longPause() {
  const seconds = randomBetween(
    config.pause.longPause.min,
    config.pause.longPause.max
  );

  console.log(`⏳ Pauză mare ${seconds}s`);

  await wait(seconds);
}

async function betweenGroups() {
  const seconds = randomBetween(
    config.pause.betweenGroups.min,
    config.pause.betweenGroups.max
  );

  console.log(`⏳ Pauză între grupuri ${seconds}s`);

  await wait(seconds);
}

module.exports = {
  shortPause,
  mediumPause,
  longPause,
  betweenGroups,
};