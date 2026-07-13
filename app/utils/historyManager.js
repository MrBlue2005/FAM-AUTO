const fs = require('fs');
const path = require('path');

const historyPath = path.join(__dirname, '../../logs/history.json');

function loadHistory() {
  if (!fs.existsSync(historyPath)) return [];

  const data = fs.readFileSync(historyPath, 'utf8');

  if (!data.trim()) return [];

  return JSON.parse(data);
}

function saveHistory(history) {
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
}

function normalizeHistoryProfileId(profileId) {
  return profileId || 'main';
}

function hasProcessed(history, propertyId, groupId, day, facebookProfileId = 'main') {
  const activeProfileId = normalizeHistoryProfileId(facebookProfileId);

  return history.some((item) =>
    item.propertyId === propertyId &&
    item.groupId === groupId &&
    item.day === day &&
    normalizeHistoryProfileId(item.facebookProfileId || item.postingProfileId) === activeProfileId &&
    ['prepared', 'posted'].includes(item.status)
  );
}

function addHistoryEntry(entry) {
  const history = loadHistory();

  history.push({
    ...entry,
    ...(process.env.RX_RUN_ID ? { runId: process.env.RX_RUN_ID } : {}),
    date: new Date().toISOString(),
  });

  saveHistory(history);
}

module.exports = {
  loadHistory,
  saveHistory,
  hasProcessed,
  addHistoryEntry,
  normalizeHistoryProfileId,
};
