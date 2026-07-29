const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DataManager = require('../core/DataManager');
const { profilesPath } = require('../config/storagePaths');

const activeSetups = new Map();

function resolveProfilePath(profile) {
  const profilePath = profile?.profilePath || 'chrome-profile';

  return path.isAbsolute(profilePath)
    ? profilePath
    : path.join(profilesPath, profilePath);
}

function getProfile(profileId) {
  const config = DataManager.getRuntimeConfig();
  return (config.facebookProfiles || []).find((profile) => profile.id === profileId) || null;
}

function markProfileSetup(profileId) {
  const config = DataManager.getRuntimeConfig();
  const facebookProfiles = (config.facebookProfiles || []).map((profile) =>
    profile.id === profileId
      ? {
          ...profile,
          useSavedLoginIdentity: true,
          lastSetupAt: new Date().toISOString(),
        }
      : profile
  );

  DataManager.saveRuntimeConfig({
    ...config,
    facebookProfiles,
  });
}

async function startSetup(profileId) {
  if (activeSetups.has(profileId)) {
    return {
      ok: true,
      alreadyOpen: true,
      message: 'Setup-ul pentru profil este deja deschis.',
    };
  }

  const profile = getProfile(profileId);

  if (!profile) {
    return {
      ok: false,
      error: `Profil Facebook inexistent: ${profileId}`,
    };
  }

  const profileDir = resolveProfilePath(profile);

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    slowMo: 150,
  });
  const page = context.pages().length ? context.pages()[0] : await context.newPage();

  await page.goto('https://www.facebook.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  }).catch(() => {});

  activeSetups.set(profileId, { context, openedAt: new Date().toISOString() });

  return {
    ok: true,
    profileId,
    label: profile.label || profile.id,
    message: 'Chrome a fost deschis. Logheaza-te si intra in pagina/profilul corect.',
  };
}

async function finishSetup(profileId) {
  const setup = activeSetups.get(profileId);

  if (!setup) {
    markProfileSetup(profileId);
    return {
      ok: true,
      profileId,
      message: 'Profilul a fost marcat ca setat.',
    };
  }

  await setup.context.close().catch(() => {});
  activeSetups.delete(profileId);
  markProfileSetup(profileId);

  return {
    ok: true,
    profileId,
    message: 'Profilul a fost salvat si browserul de setup a fost inchis.',
  };
}

module.exports = {
  finishSetup,
  startSetup,
};
