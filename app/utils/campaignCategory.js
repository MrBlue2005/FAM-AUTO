function normalizeCategory(value) {
  const text = String(value || '').toLowerCase();

  if (['jobs', 'job', 'joburi'].includes(text)) {
    return 'jobs';
  }

  if (['real_estate', 'real-estate', 'properties', 'property', 'imobiliare'].includes(text)) {
    return 'real_estate';
  }

  return null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function inferProfileCategory(profile) {
  if (!profile) return null;

  const explicitCategory = normalizeCategory(profile.category || profile.campaignCategory);

  if (explicitCategory) {
    return explicitCategory;
  }

  const profileText = normalizeText(
    [profile.id, profile.label, profile.profilePath].filter(Boolean).join(' ')
  );

  if (
    profileText.includes('job') ||
    profileText.includes('joburi') ||
    profileText.includes('munca') ||
    profileText.includes('cariere')
  ) {
    return 'jobs';
  }

  if (
    profileText.includes('imobiliare') ||
    profileText.includes('proprietati') ||
    profileText.includes('properties') ||
    profileText.includes('chrome-profile')
  ) {
    return 'real_estate';
  }

  return null;
}

function getSelectedFacebookProfile(config) {
  const profiles = config.facebookProfiles || [];

  return profiles.find((profile) => profile.id === config.facebookProfileId) || null;
}

function getProfileForCampaign(item = {}, config = {}) {
  const profiles = config.facebookProfiles || [];
  const profileId = item.facebookProfileId || item.postingProfileId || config.facebookProfileId;

  return profiles.find((profile) => profile.id === profileId) || getSelectedFacebookProfile(config);
}

function getProfileIdForCampaign(item = {}, config = {}) {
  return getProfileForCampaign(item, config)?.id || config.facebookProfileId || 'main';
}

function getActiveCampaignCategory(config = {}) {
  const profileCategory = inferProfileCategory(getSelectedFacebookProfile(config));

  if (profileCategory) {
    return profileCategory;
  }

  return normalizeCategory(config.campaignCategory) || 'real_estate';
}

function getCampaignCategoryForItem(item = {}, config = {}) {
  return (
    normalizeCategory(item.campaignCategory) ||
    (item.transactionType === 'job' ? 'jobs' : null) ||
    getActiveCampaignCategory(config)
  );
}

function getGroupCategory(group = {}) {
  return normalizeCategory(group.category) || 'real_estate';
}

module.exports = {
  getActiveCampaignCategory,
  getCampaignCategoryForItem,
  getGroupCategory,
  getProfileForCampaign,
  getProfileIdForCampaign,
  inferProfileCategory,
  normalizeCategory,
};
