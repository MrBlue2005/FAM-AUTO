const config = require('../config/facebookConfig');

function randomDelay() {
  return Math.floor(
    Math.random() *
      (config.typing.maxDelay - config.typing.minDelay + 1)
  ) + config.typing.minDelay;
}

async function type(textbox, text) {
  console.log('⌨️ Tastare umană...');

  await textbox.pressSequentially(text, {
    delay: randomDelay(),
    timeout: 0,
  });
}

module.exports = {
  type,
};