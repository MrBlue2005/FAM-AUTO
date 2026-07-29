const { spawn } = require('child_process');
const path = require('path');

const rootPath = path.join(__dirname, '..');
const serverOutput = new Map();
const childProcessEnv = { ...process.env };
delete childProcessEnv.NO_COLOR;

function startNode(name, args, env = childProcessEnv) {
  const child = spawn(process.execPath, args, {
    cwd: rootPath,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverOutput.set(child, '');
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      const output = `${serverOutput.get(child)}${chunk}`.slice(-8000);
      serverOutput.set(child, output);
      if (process.env.DEBUG_E2E_SERVERS === 'true') process.stderr.write(`[${name}] ${chunk}`);
    });
  }

  return child;
}

async function waitForUrl(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Serverul pentru ${url} s-a oprit prematur.\n${serverOutput.get(child)}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Serverul pentru ${url} nu a pornit in ${timeoutMs / 1000}s.\n${serverOutput.get(child)}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;

  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  if (child.exitCode === null) child.kill('SIGKILL');
}

async function run() {
  const e2eApiUrl = 'http://127.0.0.1:3110/api';
  const e2eDashboardUrl = 'http://127.0.0.1:5175';
  const storageEnv = {
    ...childProcessEnv,
    PORT: '3110',
    CORS_ORIGINS: 'http://127.0.0.1:5175',
    RX_DATA_PATH: path.join(rootPath, '.tmp', 'e2e', 'data'),
    RX_LOGS_PATH: path.join(rootPath, '.tmp', 'e2e', 'logs'),
    RX_UPLOADS_PATH: path.join(rootPath, '.tmp', 'e2e', 'uploads'),
    RX_PROFILES_PATH: path.join(rootPath, '.tmp', 'e2e', 'profiles'),
  };
  const api = startNode('api', ['server/server.js'], storageEnv);
  const dashboard = startNode('dashboard', [
    'dashboard-v2/node_modules/vite/bin/vite.js',
    'dashboard-v2',
    '--host',
    '127.0.0.1',
    '--port',
    '5175',
    '--strictPort',
  ], { ...childProcessEnv, VITE_API_URL: e2eApiUrl });

  try {
    await Promise.all([
      waitForUrl('http://127.0.0.1:3110/readyz', api),
      waitForUrl(e2eDashboardUrl, dashboard),
    ]);

    const playwrightCli = require.resolve('@playwright/test/cli');
    const testRunner = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
      cwd: rootPath,
      env: { ...childProcessEnv, E2E_API_URL: e2eApiUrl, E2E_DASHBOARD_URL: e2eDashboardUrl },
      stdio: 'inherit',
      windowsHide: true,
    });
    const exitCode = await new Promise((resolve, reject) => {
      testRunner.once('error', reject);
      testRunner.once('exit', (code) => resolve(code ?? 1));
    });

    process.exitCode = exitCode;
  } finally {
    await Promise.all([stopChild(dashboard), stopChild(api)]);
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
