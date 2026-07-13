const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

require('./generate-icon');

async function main() {
  const root = path.join(__dirname, '..');
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  const build = spawnSync(process.execPath, [cli, '--win', 'portable'], {
    cwd: root,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    stdio: 'inherit',
  });

  if (build.error) throw build.error;
  if (build.status !== 0) {
    process.exitCode = build.status || 1;
    return;
  }

  const { rcedit } = await import('rcedit');
  const icon = path.join(root, 'build', 'icon.ico');
  const unpackedExecutable = path.join(root, 'dist', 'win-unpacked', 'R.X. AI Overlay.exe');
  const portableExecutable = path.join(root, 'dist', 'RX-AI-Overlay-0.1.0.exe');
  const targets = [unpackedExecutable].filter((file) => fs.existsSync(file));

  for (const target of targets) {
    await rcedit(target, {
      icon,
      'file-version': '0.1.0.0',
      'product-version': '0.1.0.0',
      'version-string': {
        CompanyName: 'R.X. AI Studio',
        FileDescription: 'R.X. AI Overlay',
        ProductName: 'R.X. AI Overlay',
      },
    });
    console.log(`Iconita RX aplicata: ${target}`);
  }

  if (process.argv.includes('--signed')) {
    const signTargets = [unpackedExecutable, portableExecutable].filter((file) => fs.existsSync(file));
    const sign = spawnSync(process.execPath, [path.join(__dirname, 'sign.js'), ...signTargets], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    if (sign.error) throw sign.error;
    process.exitCode = sign.status || 0;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
