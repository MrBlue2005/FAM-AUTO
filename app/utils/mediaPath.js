const fs = require('fs');
const path = require('path');
const { rootPath, uploadsPath } = require('../config/storagePaths');
const uploadMarker = '/app/uploads/';

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function getUploadSuffix(value) {
  const normalized = toPosix(value);
  const lower = normalized.toLowerCase();
  const markerIndex = lower.indexOf(uploadMarker);

  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + uploadMarker.length);
  }

  const relativeMarker = 'app/uploads/';
  if (lower.startsWith(relativeMarker)) {
    return normalized.slice(relativeMarker.length);
  }

  return null;
}

function normalizeMediaReference(value) {
  if (!value || typeof value !== 'string') return value;

  const suffix = getUploadSuffix(value);
  return suffix === null ? value : `app/uploads/${suffix}`;
}

function resolveMediaReference(value) {
  if (!value || typeof value !== 'string') return null;

  if (path.isAbsolute(value) && fs.existsSync(value)) {
    return value;
  }

  const suffix = getUploadSuffix(value);
  if (suffix === null) {
    return path.isAbsolute(value) ? value : path.resolve(rootPath, value);
  }

  const resolved = path.resolve(uploadsPath, ...suffix.split('/').filter(Boolean));
  const relative = path.relative(uploadsPath, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

function normalizeCampaignMedia(campaign) {
  if (!campaign || typeof campaign !== 'object') return campaign;

  return {
    ...campaign,
    posts: Array.isArray(campaign.posts)
      ? campaign.posts.map((post) => ({
          ...post,
          imagePath: normalizeMediaReference(post.imagePath),
          media: Array.isArray(post.media)
            ? post.media.map((item) => {
                if (typeof item === 'string') return normalizeMediaReference(item);
                if (item && typeof item === 'object') {
                  return { ...item, path: normalizeMediaReference(item.path) };
                }
                return item;
              })
            : post.media,
        }))
      : campaign.posts,
  };
}

module.exports = {
  getUploadsRoot: () => uploadsPath,
  normalizeCampaignMedia,
  normalizeMediaReference,
  resolveMediaReference,
};
