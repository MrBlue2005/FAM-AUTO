const DEFAULT_GROUP_LIST_CATEGORY = 'Romania';

function normalizeGroupListCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getGroupListCategory(group = {}) {
  return String(group.groupListCategory || '').trim() || DEFAULT_GROUP_LIST_CATEGORY;
}

function matchesSelectedGroupListCategory(group = {}, config = {}) {
  const selected = normalizeGroupListCategory(config.selectedGroupListCategory);

  if (!selected || selected === 'all') return true;

  return normalizeGroupListCategory(getGroupListCategory(group)) === selected;
}

module.exports = {
  DEFAULT_GROUP_LIST_CATEGORY,
  getGroupListCategory,
  matchesSelectedGroupListCategory,
  normalizeGroupListCategory,
};
