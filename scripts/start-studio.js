const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backgroundMode = process.env.RX_STUDIO_BACKGROUND === '1';
const bundledPlaywrightBrowsers = path.join(root, 'runtime', 'ms-playwright');
const offlineBundle = require('node:fs').existsSync(path.join(root, 'runtime', 'offline-bundle.json'));
const serviceEnvironment = {
  ...process.env,
  ...(require('node:fs').existsSync(bundledPlaywrightBrowsers)
    ? { PLAYWRIGHT_BROWSERS_PATH: bundledPlaywrightBrowsers }
    : {}),
};
const serviceDefinitions = [
  {
    name: 'API',
    url: 'http://127.0.0.1:3000/readyz',
    cwd: root,
    command: process.execPath,
    args: ['--env-file-if-exists=.env', 'server/server.js'],
  },
  {
    name: 'Dashboard',
    url: 'http://127.0.0.1:5173/',
    cwd: path.join(root, 'dashboard-v2'),
    command: process.execPath,
    args: ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  },
  {
    name: 'Generator',
    url: 'http://127.0.0.1:3100/',
    cwd: path.join(root, 'property-copywriter'),
    command: process.execPath,
    args: ['node_modules/next/dist/bin/next', offlineBundle ? 'start' : 'dev', '-H', '127.0.0.1', '-p', '3100'],
  },
];

const children = [];
let shuttingDown = false;

async function isAvailable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isAvailable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Serviciul nu a pornit la timp: ${url}`);
}

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

async function startStudio() {
  for (const definition of serviceDefinitions) {
    if (await isAvailable(definition.url)) {
      console.log(`[${definition.name}] rulează deja; îl reutilizez.`);
      continue;
    }

    const child = spawn(definition.command, definition.args, {
      cwd: definition.cwd,
      stdio: backgroundMode ? 'ignore' : 'inherit',
      windowsHide: backgroundMode,
      env: serviceEnvironment,
    });
    children.push(child);
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      console.error(`[${definition.name}] s-a oprit neașteptat${code !== null ? ` cu codul ${code}` : ''}${signal ? ` (${signal})` : ''}.`);
      stopAll();
      process.exitCode = code || 1;
    });
    await waitFor(definition.url);
  }

  console.log('\nR.X. AI Studio este disponibil:');
  console.log('- Launcher:  http://127.0.0.1:5173');
  console.log('- Dashboard: http://127.0.0.1:5173/dashboard');
  console.log('- Generator: http://127.0.0.1:3100');
  console.log('\nApasă Ctrl+C pentru a opri serviciile pornite de această comandă.');
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});
process.on('exit', stopAll);

void startStudio().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  stopAll();
  process.exit(1);
});
