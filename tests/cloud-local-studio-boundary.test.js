'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pages = [
  ['Robot', 'LocalRobot'],
  ['Queue', 'LocalQueue'],
  ['Settings', 'LocalSettings'],
  ['Diagnostics', 'LocalDiagnostics'],
  ['Reports', 'LocalReports'],
  ['Analytics', 'LocalAnalytics'],
  ['LiveFeed', 'LocalLiveFeed'],
];

test('CLOUD_READ_ONLY page boundaries return before mounting local runtime pages', () => {
  for (const [page, localPage] of pages) {
    const source = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'pages', `${page}.jsx`), 'utf8');
    const wrapper = new RegExp(`export default function ${page}\\([^)]*\\) \\{[\\s\\S]*?api\\.isCloudReadOnly\\(\\)[\\s\\S]*?return <LocalStudioBoundary[\\s\\S]*?return <${localPage}`, 'm');
    assert.match(source, wrapper, `${page} must return its hosted boundary before its local page mounts`);
    assert.match(source, new RegExp(`function ${localPage}\\(`), `${page} must retain its local implementation behind the boundary`);
  }
});

test('Local Studio boundary contains only hosted-safe generic copy', () => {
  const source = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'components', 'LocalStudioBoundary.jsx'), 'utf8');
  assert.match(source, /Local Studio pe dispozitiv/);
  assert.doesNotMatch(source, /localhost|127\.0\.0\.1|profilePath|cookie|credential|session/i);
});
