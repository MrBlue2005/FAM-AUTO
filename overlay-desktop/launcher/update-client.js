const CONTINUOUS_RELEASE_TAG = 'continuous-main';
const CONTINUOUS_MANIFEST_NAME = 'rx-update-manifest.json';
const CONTINUOUS_FORMAT = 'rx-ai-studio-continuous-update';

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function validateContinuousManifest(input) {
  if (!input || typeof input !== 'object') throw new Error('Manifestul update-ului continuu este invalid.');
  if (input.format !== CONTINUOUS_FORMAT || input.schemaVersion !== 1) {
    throw new Error('Formatul update-ului continuu nu este compatibil.');
  }
  if (!/^[a-f0-9]{40}$/i.test(String(input.commit || ''))) {
    throw new Error('Commitul din manifestul update-ului este invalid.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(input.appVersion || ''))) {
    throw new Error('Versiunea din manifestul update-ului este invalida.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(input.minimumBootstrapVersion || ''))) {
    throw new Error('Versiunea minima de bootstrap este invalida.');
  }
  if (!input.package || typeof input.package !== 'object') {
    throw new Error('Pachetul lipseste din manifestul update-ului.');
  }
  if (!/^RX-AI-Studio-Continuous-Update-[a-f0-9]{7,40}\.zip$/i.test(String(input.package.name || ''))) {
    throw new Error('Numele pachetului de update este invalid.');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(input.package.sha256 || ''))) {
    throw new Error('Checksum-ul pachetului de update este invalid.');
  }
  if (!Number.isSafeInteger(input.package.size) || input.package.size <= 0) {
    throw new Error('Dimensiunea pachetului de update este invalida.');
  }
  return input;
}

function continuousUpdateInfo({ release, manifest, currentVersion, currentCommit }) {
  const validated = validateContinuousManifest(manifest);
  const asset = (release?.assets || []).find((item) => item.name === validated.package.name);
  const bootstrapCompatible = compareVersions(currentVersion, validated.minimumBootstrapVersion) >= 0;
  const commitMatches = String(currentCommit || '').toLowerCase() === validated.commit.toLowerCase();
  return {
    kind: 'continuous',
    currentVersion,
    currentCommit: currentCommit || null,
    latestVersion: validated.appVersion,
    latestCommit: validated.commit,
    builtAt: validated.builtAt,
    summary: validated.summary || '',
    available: Boolean(asset) && bootstrapCompatible && !commitMatches,
    bootstrapCompatible,
    requiresInstaller: !bootstrapCompatible,
    assetName: asset?.name,
    assetSize: asset?.size,
    expectedSize: validated.package.size,
    downloadUrl: asset?.browser_download_url,
    digest: asset?.digest,
    expectedSha256: validated.package.sha256.toLowerCase(),
    releaseUrl: release?.html_url,
  };
}

function stableReleaseUpdateInfo(release, currentVersion) {
  if (!release) return { kind: 'installer', currentVersion, available: false, noRelease: true };
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  const assetName = `RX-AI-Studio-Offline-Setup-${latestVersion}.exe`;
  const asset = (release.assets || []).find((item) => item.name === assetName);
  return {
    kind: 'installer',
    currentVersion,
    latestVersion,
    available: isNewerVersion(latestVersion, currentVersion) && Boolean(asset),
    assetName: asset?.name,
    assetSize: asset?.size,
    releaseUrl: release.html_url,
    downloadUrl: asset?.browser_download_url,
    digest: asset?.digest,
  };
}

module.exports = {
  CONTINUOUS_FORMAT,
  CONTINUOUS_MANIFEST_NAME,
  CONTINUOUS_RELEASE_TAG,
  compareVersions,
  continuousUpdateInfo,
  isNewerVersion,
  stableReleaseUpdateInfo,
  validateContinuousManifest,
};
