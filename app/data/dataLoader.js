const fs = require('fs');
const path = require('path');
const { normalizeCampaignMedia } = require('../utils/mediaPath');

const dataPath = __dirname;

function loadGroups() {
  const groupsPath = path.join(dataPath, 'groups.json');

  if (!fs.existsSync(groupsPath)) {
    return [];
  }

  const data = fs.readFileSync(groupsPath, 'utf8');

  return JSON.parse(data);
}

function loadProperties() {
  const propertiesDir = path.join(dataPath, 'properties');

  if (!fs.existsSync(propertiesDir)) {
    return [];
  }

  const files = fs
    .readdirSync(propertiesDir)
    .filter((file) => file.endsWith('.json'));

  const properties = files.map((file) => {
    const filePath = path.join(propertiesDir, file);
    const data = fs.readFileSync(filePath, 'utf8');

    return normalizeCampaignMedia(JSON.parse(data));
  });

  return properties;
}

module.exports = {
  loadGroups,
  loadProperties,
};
