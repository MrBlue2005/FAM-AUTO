const DataManager = require('../core/DataManager');

function loadHistory() {
  return DataManager.getHistory();
}

function hasProcessed(history, propertyId, groupId, reference = new Date()) {
  return history.some((item) =>
    String(item.propertyId) === String(propertyId) &&
    String(item.groupId) === String(groupId) &&
    ['prepared', 'posted'].includes(item.status) &&
    isSameLocalDay(item.date, reference)
  );
}

function isSameLocalDay(value, reference = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return false;
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

function getGroupsPostedOnDate(history, reference = new Date()) {
  return new Set((Array.isArray(history) ? history : [])
    .filter((entry) => entry.status === 'posted' && entry.groupId && isSameLocalDay(entry.date, reference))
    .map((entry) => String(entry.groupId)));
}

function hasPostedInGroupOnDate(history, groupId, reference = new Date()) {
  return getGroupsPostedOnDate(history, reference).has(String(groupId));
}

function addHistoryEntry(entry) {
  return DataManager.addHistory({
    ...entry,
    ...(process.env.RX_RUN_ID ? { runId: process.env.RX_RUN_ID } : {}),
  });
}

module.exports = {
  loadHistory,
  hasProcessed,
  getGroupsPostedOnDate,
  hasPostedInGroupOnDate,
  isSameLocalDay,
  addHistoryEntry,
};
