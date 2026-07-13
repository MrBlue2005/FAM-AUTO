const fs = require('fs');
const path = require('path');

const DataManager = require('../app/core/DataManager');
const { ensureStoragePaths, storageStatus } = require('../app/config/storagePaths');
const { validateEnvironment } = require('../server/server');

const errors = [];

try {
  validateEnvironment();
} catch (error) {
  errors.push(error.message);
}

if (process.env.NODE_ENV !== 'production') errors.push('NODE_ENV trebuie sa fie production.');

ensureStoragePaths();
for (const storage of storageStatus()) {
  if (!storage.ready) errors.push(`Volumul ${storage.name} nu este accesibil pentru scriere: ${storage.path}`);
}

const dashboardIndex = path.join(__dirname, '..', 'dashboard-v2', 'dist', 'index.html');
if (!fs.existsSync(dashboardIndex)) errors.push('Buildul dashboardului lipseste. Ruleaza npm run build.');

const runtimeConfig = DataManager.getRuntimeConfig();
if (runtimeConfig.publishEnabled === true) errors.push('Publicarea LIVE este activa. Dezactiveaz-o inainte de primul deploy.');
if (!(runtimeConfig.facebookProfiles || []).length) errors.push('Nu exista profiluri Facebook configurate.');

if (errors.length) {
  console.error(`Verificarea de productie a esuat:\n- ${errors.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Verificarea de productie a trecut. Mediul, volumele si dashboardul sunt pregatite.');
}
