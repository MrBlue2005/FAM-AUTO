const fs = require('fs');
const path = require('path');

const rootPath = path.join(__dirname, '../..');

function resolveStoragePath(value, fallback) {
  if (!value) return path.join(rootPath, fallback);
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootPath, value);
}

const dataPath = resolveStoragePath(process.env.RX_DATA_PATH, path.join('app', 'data'));
const logsPath = resolveStoragePath(process.env.RX_LOGS_PATH, 'logs');
const uploadsPath = resolveStoragePath(process.env.RX_UPLOADS_PATH, path.join('app', 'uploads'));
const profilesPath = resolveStoragePath(process.env.RX_PROFILES_PATH, '.');

function ensureStoragePaths() {
  [dataPath, logsPath, uploadsPath, profilesPath].forEach((directory) => {
    fs.mkdirSync(directory, { recursive: true });
  });
}

function storageStatus() {
  return [
    ['data', dataPath],
    ['logs', logsPath],
    ['uploads', uploadsPath],
    ['profiles', profilesPath],
  ].map(([name, directory]) => {
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
      return { name, path: directory, ready: true };
    } catch (error) {
      return { name, path: directory, ready: false, error: error.message };
    }
  });
}

module.exports = {
  dataPath,
  ensureStoragePaths,
  logsPath,
  profilesPath,
  rootPath,
  storageStatus,
  uploadsPath,
};
