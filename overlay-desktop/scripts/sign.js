const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const certificate = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
const password = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;

if (!certificate) {
  throw new Error('Lipseste WIN_CSC_LINK: seteaza local calea catre certificatul code-signing .pfx/.p12.');
}

const kitsRoot = path.join(process.env['ProgramFiles(x86)'] || '', 'Windows Kits', '10', 'bin');
const candidates = fs.existsSync(kitsRoot)
  ? fs.readdirSync(kitsRoot)
      .sort()
      .reverse()
      .map((version) => path.join(kitsRoot, version, 'x64', 'signtool.exe'))
  : [];
const signTool = candidates.find((file) => fs.existsSync(file));

if (!signTool) {
  throw new Error('signtool.exe nu este instalat. Instaleaza Windows SDK Signing Tools.');
}

for (const target of process.argv.slice(2)) {
  const args = [
    'sign', '/fd', 'SHA256', '/td', 'SHA256',
    '/tr', 'http://timestamp.digicert.com',
    '/f', certificate,
  ];
  if (password) args.push('/p', password);
  args.push(target);

  const result = spawnSync(signTool, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`Semnat digital: ${target}`);
}
