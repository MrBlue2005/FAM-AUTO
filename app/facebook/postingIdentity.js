const DataManager = require('../core/DataManager');

function getIdentityForPost(post) {
  const runtimeConfig = DataManager.getRuntimeConfig();
  const identities = runtimeConfig.facebookPostingIdentities || [];
  const profiles = runtimeConfig.facebookProfiles || [];
  const categoryMapping = runtimeConfig.postingIdentityByCategory || {};
  const profileMapping = runtimeConfig.postingIdentityByProfile || {};
  const category = post.campaignCategory || 'real_estate';
  const profileId = post.facebookProfileId || post.postingProfileId;
  const profile = profiles.find((item) => item.id === profileId);
  const identityId =
    post.postingIdentityId ||
    (profileId ? profileMapping[profileId] : null) ||
    categoryMapping[category] ||
    'default';
  const identity = identities.find((item) => item.id === identityId) || null;

  return identity
    ? {
        ...identity,
        useSavedLoginIdentity: profile?.useSavedLoginIdentity === true,
      }
    : null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function clickFirstVisible(locators) {
  for (const locatorFactory of locators) {
    const locator = locatorFactory();

    try {
      await locator.waitFor({ state: 'visible', timeout: 2500 });
      await locator.click();
      return true;
    } catch {
      // Facebook changes composer labels often; try the next selector.
    }
  }

  return false;
}

async function selectPostingIdentity(page, post) {
  const identity = getIdentityForPost(post);

  if (identity?.useSavedLoginIdentity) {
    return {
      selected: false,
      label: identity.label,
      reason: 'saved_profile_identity',
    };
  }

  const actorName = identity?.actorName?.trim();

  if (!actorName) {
    return {
      selected: false,
      label: identity?.label || 'Identitate implicita',
      reason: 'no_actor_name',
    };
  }

  const openedMenu = await clickFirstVisible([
    () => page.getByRole('button', { name: /postezi ca|posting as|interacționează ca|interaction as/i }),
    () => page.locator('[aria-label*="postezi ca" i]').first(),
    () => page.locator('[aria-label*="posting as" i]').first(),
    () => page.locator('[aria-label*="Interacționează" i]').first(),
    () => page.locator('[role="dialog"] [role="button"]').filter({ hasText: /.+/ }).first(),
  ]);

  if (!openedMenu) {
    console.log(`Nu am gasit selectorul de identitate pentru: ${actorName}`);
    return {
      selected: false,
      label: identity.label,
      reason: 'menu_not_found',
    };
  }

  const actorPattern = new RegExp(escapeRegex(actorName), 'i');

  const selectedActor = await clickFirstVisible([
    () => page.getByRole('menuitem', { name: actorPattern }),
    () => page.getByRole('button', { name: actorPattern }),
    () => page.getByText(actorName, { exact: false }).first(),
  ]);

  if (!selectedActor) {
    console.log(`Nu am gasit pagina/identitatea Facebook: ${actorName}`);
    await page.keyboard.press('Escape').catch(() => {});
    return {
      selected: false,
      label: identity.label,
      reason: 'actor_not_found',
    };
  }

  await page.waitForTimeout(1200);
  console.log(`Identitate Facebook selectata: ${actorName}`);

  return {
    selected: true,
    label: identity.label,
    actorName,
  };
}

module.exports = { selectPostingIdentity };
