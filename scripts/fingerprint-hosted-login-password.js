'use strict';

const { passwordFingerprint } = require('../server/hosted-bff');

function promptMasked(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('This helper must run in an interactive terminal.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      if (chunk === '\u0003') return finish(new Error('Cancelled.'));
      if (chunk === '\r' || chunk === '\n') return finish();
      if (chunk === '\u007f' || chunk === '\b') { value = value.slice(0, -1); return; }
      value += chunk;
    };
    process.stdin.on('data', onData);
  });
}

(async () => {
  let password = await promptMasked('Known-valid password (masked): ');
  const fingerprint = passwordFingerprint(password);
  password = '';
  console.log(fingerprint);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
