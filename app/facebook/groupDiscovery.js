const DataManager = require('../core/DataManager');

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectGroupType(name) {
  const text = normalizeText(name);

  const rentKeywords = [
    'chirii',
    'chirie',
    'inchirieri',
    'inchiriere',
    'inchiriat',
    'de inchiriat',
  ];

  const saleKeywords = [
    'vanzari',
    'vanzare',
    'vand',
    'de vanzare',
    'apartamente vanzare',
  ];

  const hasRent = rentKeywords.some((keyword) => text.includes(keyword));
  const hasSale = saleKeywords.some((keyword) => text.includes(keyword));

  if (hasRent && hasSale) return 'mixed';
  if (hasRent) return 'rent';
  if (hasSale) return 'sale';

  return 'mixed';
}

async function getFacebookGroupName(page) {
  const candidates = [
    () => page.locator('h1').first(),
    () => page.locator('[role="main"] h1').first(),
    () => page.locator('a[role="link"][href*="/groups/"]').first(),
    () => page.locator('span[dir="auto"]').filter({ hasText: /./ }).first(),
  ];

  for (const getLocator of candidates) {
    try {
      const locator = getLocator();

      await locator.waitFor({
        state: 'visible',
        timeout: 5000,
      });

      const text = (await locator.innerText()).trim();

      if (
        text &&
        text.length >= 3 &&
        !text.includes('Facebook') &&
        !text.includes('Caută') &&
        !text.includes('Scrie ceva')
      ) {
        return text;
      }
    } catch (error) {}
  }

  try {
    const title = await page.title();

    if (title) {
      return title
        .replace('| Facebook', '')
        .replace('Facebook', '')
        .trim();
    }
  } catch (error) {}

  return null;
}

async function discoverAndUpdateGroup(page, group) {
  const discoveredName = await getFacebookGroupName(page);

  if (!discoveredName) {
    console.log(`⚠️ Nu am putut detecta numele real pentru: ${group.url}`);
    return group;
  }

  const groups = DataManager.getGroups();
  const detectedType = detectGroupType(discoveredName);

  const updatedGroups = groups.map((item) => {
    if (item.id !== group.id) return item;

    const updatedGroup = {
      ...item,
      name: discoveredName,
      discoveredName,
      detectedType,
      lastDiscoveredAt: new Date().toISOString(),
    };

    if (!item.overrideType) {
      updatedGroup.overrideType = detectedType;
    }

    return updatedGroup;
  });

  DataManager.saveGroups(updatedGroups);

  console.log(`🔎 Grup detectat: ${discoveredName} (${detectedType})`);

  return {
    ...group,
    name: discoveredName,
    discoveredName,
    detectedType,
  };
}

module.exports = {
  discoverAndUpdateGroup,
};