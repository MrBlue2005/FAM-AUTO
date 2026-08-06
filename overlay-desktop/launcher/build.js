const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

require('../scripts/generate-icon');

async function main() {
  const overlayRoot = path.join(__dirname, '..');
  const cli = path.join(overlayRoot, 'node_modules', 'electron-builder', 'cli.js');
  const build = spawnSync(
    process.execPath,
    [cli, '--config', 'launcher/electron-builder.js', '--win', 'portable'],
    {
      cwd: overlayRoot,
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      stdio: 'inherit',
    }
  );

  if (build.error) throw build.error;
  if (build.status !== 0) {
    process.exitCode = build.status || 1;
    return;
  }

  const { rcedit } = await import('rcedit');
  const icon = path.join(overlayRoot, 'build', 'icon.ico');
  const output = path.join(overlayRoot, 'launcher', 'dist');
  const targets = [
    path.join(output, 'win-unpacked', 'RX AI Studio Launcher.exe'),
  ].filter((file) => fs.existsSync(file));

  for (const target of targets) {
    await rcedit(target, {
      icon,
      'file-version': '0.1.0.0',
      'product-version': '0.1.0.0',
      'version-string': {
        CompanyName: 'R.X. AI Studio',
        FileDescription: 'Pornire RX AI Studio',
        ProductName: 'RX AI Studio Launcher',
      },
    });
    console.log(`Iconita RX aplicata: ${target}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
