const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { profilesPath } = require('../config/storagePaths');

async function startBrowser(profileId = null) {
  const DataManager = require('../core/DataManager');
  const runtimeConfig = DataManager.getRuntimeConfig();
  const profiles = runtimeConfig.facebookProfiles || [];
  const activeProfileId = profileId || runtimeConfig.facebookProfileId;
  const selectedProfile = profiles.find(
    (profile) => profile.id === activeProfileId
  );

  const profilePath = selectedProfile?.profilePath || 'chrome-profile';
  const safeProfilePath = path.isAbsolute(profilePath)
    ? profilePath
    : path.join(profilesPath, profilePath);

  if (!fs.existsSync(safeProfilePath)) {
    fs.mkdirSync(safeProfilePath, { recursive: true });
  }

  console.log(
    `Profil Facebook activ: ${selectedProfile?.label || activeProfileId || 'main'}`
  );

  const configuredSlowMo = Number(process.env.BROWSER_SLOW_MO);

  const context = await chromium.launchPersistentContext(safeProfilePath, {
    headless: process.env.BROWSER_HEADLESS === 'true',
    slowMo: Number.isFinite(configuredSlowMo) ? configuredSlowMo : 300,
  });

  const page = context.pages().length
    ? context.pages()[0]
    : await context.newPage();

  return { context, page };
}

module.exports = { startBrowser };
