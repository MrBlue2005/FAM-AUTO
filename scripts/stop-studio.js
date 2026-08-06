const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const studioPorts = new Set([3000, 3100, 5173]);

async function run(command, args, timeout = 6000) {
  return execFileAsync(command, args, {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout,
  });
}

function parsePowerShellIds(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map(Number)
    .filter((processId) => Number.isInteger(processId) && processId > 0);
}

async function getStudioParentIds() {
  const script = String.raw`
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts[\\/]start-studio\.js'
} | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress
`;
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script]
  );
  return parsePowerShellIds(stdout);
}

async function getListeningProcessIds() {
  const { stdout } = await run('netstat.exe', ['-ano', '-p', 'tcp']);
  const processIds = new Set();

  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!match || !studioPorts.has(Number(match[1]))) continue;
    processIds.add(Number(match[2]));
  }

  return Array.from(processIds);
}

async function getProcessInfo(processId) {
  const script = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${processId}' | Select-Object Name,CommandLine | ConvertTo-Json -Compress`;
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script]
  );
  const text = String(stdout || '').trim();
  return text ? JSON.parse(text) : null;
}

function isExpectedStudioService(processInfo) {
  if (!processInfo || String(processInfo.Name || '').toLowerCase() !== 'node.exe') return false;
  const command = String(processInfo.CommandLine || '');
  return /server[\\/]server\.js/i.test(command)
    || (/node_modules[\\/]vite[\\/]bin[\\/]vite\.js/i.test(command) && /(--port\s+5173|--port=5173)/i.test(command))
    || (/node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next/i.test(command) && /(-p\s+3100|--port\s+3100|--port=3100)/i.test(command))
    || /node_modules[\\/]next[\\/]dist[\\/]server[\\/]lib[\\/]start-server\.js/i.test(command);
}

async function killProcessTree(processId) {
  try {
    await run('taskkill.exe', ['/PID', String(processId), '/T', '/F']);
    return true;
  } catch {
    return false;
  }
}

async function stopStudio() {
  if (process.platform !== 'win32') {
    throw new Error('Oprirea automata este disponibila momentan numai pe Windows.');
  }

  const stoppedPids = new Set();
  const parentIds = await getStudioParentIds();
  for (const processId of parentIds) {
    if (await killProcessTree(processId)) stoppedPids.add(processId);
  }

  await new Promise((resolve) => setTimeout(resolve, 700));

  const listeningIds = await getListeningProcessIds();
  for (const processId of listeningIds) {
    const processInfo = await getProcessInfo(processId);
    if (!isExpectedStudioService(processInfo)) continue;
    if (await killProcessTree(processId)) stoppedPids.add(processId);
  }

  console.log(JSON.stringify({
    ok: true,
    stoppedPids: Array.from(stoppedPids),
  }));
}

stopStudio().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
