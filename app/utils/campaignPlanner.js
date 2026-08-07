const DataManager = require('../core/DataManager');
const { classifyGroup } = require('./groupClassifier');
const {
  getCampaignCategoryForItem,
  getGroupCategory,
} = require('./campaignCategory');
const { matchesSelectedGroupListCategory } = require('./groupListCategory');

function getEligibleGroups(item, groups, config = null) {
  const runtimeConfig = config || DataManager.getRuntimeConfig();
  const campaignCategory = getCampaignCategoryForItem(item, runtimeConfig);

  return groups.filter((group) => {
    if (!group.active) return false;
    if (!matchesSelectedGroupListCategory(group, runtimeConfig)) return false;

    const groupCategory = getGroupCategory(group);

    if (groupCategory !== campaignCategory) {
      return false;
    }

    if (campaignCategory === 'jobs') {
      return true;
    }

    const groupType = classifyGroup(group);

    if (item.transactionType === 'rent') {
      return groupType === 'rent' || groupType === 'mixed';
    }

    if (item.transactionType === 'sale') {
      return groupType === 'sale' || groupType === 'mixed';
    }

    return false;
  });
}

function getPostForDay(item, day) {
  return item.posts?.find((post) => Number(post.day) === Number(day));
}

module.exports = {
  getEligibleGroups,
  getPostForDay,
};
