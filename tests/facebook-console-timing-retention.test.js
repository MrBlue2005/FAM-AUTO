'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createFacebookSubmitTransportObserver } = require('../app/facebook/submitTransportDiagnostics');
const { createComposerAcquisitionDiagnosticSink } = require('../app/local-agent/ComposerAcquisitionDiagnostics');

class FakePage extends EventEmitter { mainFrame() { return {}; } }
const message = (text) => ({ type: () => 'error', text: () => text, location: () => ({ url: 'https://www.facebook.com/api/graphql/' }) });
const request = () => ({ url: () => 'https://www.facebook.com/api/graphql/', method: () => 'POST', resourceType: () => 'fetch', postData: () => 'fb_api_req_friendly_name=ComposerStoryCreateMutation&doc_id=123' });

async function observe(actions) {
  const page = new FakePage(); let now = Date.parse('2026-09-21T16:00:00Z');
  const observer = createFacebookSubmitTransportObserver(page, { now: () => now }); observer.start();
  const api = { page, observer, advance: (ms) => { now += ms; } };
  await actions(api); return observer.stop();
}

test('permission error immediately after click retains protected timing', async () => {
  const summary = await observe(async ({ page, observer, advance }) => { observer.markClickStarted(); advance(120); page.emit('console', message('permission denied PRIVATE')); });
  assert.deepEqual({ category: summary.consoleErrorSummary.dominantClassification, timing: summary.consoleErrorSummary.timingClassification, relative: summary.consoleErrorSummary.nearestRelativeToClickMs }, { category: 'PERMISSION', timing: 'IMMEDIATE_POST_CLICK', relative: 120 });
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE/);
});

test('permission error immediately before click is retained as pre-click evidence', async () => {
  const summary = await observe(async ({ page, observer, advance }) => { page.emit('console', message('permission forbidden')); advance(500); observer.markClickStarted(); });
  assert.equal(summary.consoleErrorSummary.timingClassification, 'PRE_CLICK');
  assert.equal(summary.consoleErrorSummary.nearestRelativeToClickMs, -500);
  assert.equal(summary.consoleErrorSummary.anyBeforeClick, true);
});

test('multiple errors retain first, last, nearest, counts, and dominant category', async () => {
  const summary = await observe(async ({ page, observer, advance }) => { observer.markClickStarted(); advance(50); page.emit('console', message('fetch network')); advance(50); page.emit('console', message('permission denied')); advance(50); page.emit('console', message('permission forbidden')); });
  assert.equal(summary.consoleErrorSummary.errorCount, 3);
  assert.equal(summary.consoleErrorSummary.firstRelativeToClickMs, 50);
  assert.equal(summary.consoleErrorSummary.lastRelativeToClickMs, 150);
  assert.equal(summary.consoleErrorSummary.nearestRelativeToClickMs, 50);
  assert.equal(summary.consoleErrorSummary.dominantClassification, 'PERMISSION');
  assert.deepEqual(summary.consoleErrorSummary.counts, { NETWORK: 1, PERMISSION: 2 });
});

test('unrelated telemetry is safely classified without retaining its message', async () => {
  const summary = await observe(async ({ page, observer, advance }) => { observer.markClickStarted(); advance(6000); page.emit('console', message('analytics pixel PRIVATE payload')); });
  assert.equal(summary.consoleErrorSummary.dominantClassification, 'PLATFORM_TELEMETRY');
  assert.equal(summary.consoleErrorSummary.timingClassification, 'UNRELATED_WINDOW');
  assert.equal(summary.consoleErrorSummary.correlationWindowBucket, 'WITHIN_30_SECONDS');
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|payload/);
});

test('console error after the primary response is classified as post-response', async () => {
  const summary = await observe(async ({ page, observer, advance }) => {
    observer.markClickStarted();
    advance(100);
    const observedRequest = request();
    page.emit('request', observedRequest);
    advance(100);
    page.emit('response', { request: () => observedRequest, status: () => 200, body: async () => Buffer.from('{"data":{"story_create":{"unfamiliar":true}}}'), headerValue: async () => null });
    advance(100);
    page.emit('console', message('graphql response handling error'));
  });
  assert.equal(summary.consoleErrorSummary.nearestRelativeToClickMs, 300);
  assert.equal(summary.consoleErrorSummary.timingClassification, 'POST_RESPONSE');
});

test('protected console timing survives full event-array compaction pressure', async () => {
  const summary = await observe(async ({ page, observer, advance }) => { observer.markClickStarted(); advance(75); page.emit('console', message('permission denied SECRET')); });
  const event = { timestamp: summary.clickTimestamp, relativeToClickMs: 1, method: 'POST', resourceType: 'FETCH', hostnameClass: 'FACEBOOK_WWW', pathClass: 'GRAPHQL', operationName: 'ComposerStoryCreateMutation', requestCorrelationId: 'REQ_1' };
  summary.requests = Array.from({ length: 8 }, () => event); summary.responses = Array.from({ length: 8 }, () => ({ ...event, status: 200, statusClass: 'HTTP_2XX', responseClassification: 'UNKNOWN_RESPONSE_SHAPE' }));
  summary.consoleErrors = Array.from({ length: 8 }, () => ({ ...summary.consoleErrors[0], rawMessage: 'SECRET' }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-console-timing-'));
  try {
    createComposerAcquisitionDiagnosticSink({ directory }).forTask('live_execution_console_pressure').submitTransportSummary(summary);
    const text = fs.readFileSync(path.join(directory, 'live_execution_console_pressure.json'), 'utf8'); const data = JSON.parse(text).records[0].submitTransport;
    assert.equal(data.detailTruncated, true); assert.equal(data.consoleErrors.length, 0);
    assert.equal(data.consoleErrorSummary.nearestRelativeToClickMs, 75);
    assert.equal(data.consoleErrorSummary.timingClassification, 'IMMEDIATE_POST_CLICK');
    assert.equal(data.consoleErrorSummary.dominantClassification, 'PERMISSION');
    assert.doesNotMatch(text, /SECRET|rawMessage/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('no console events produce an explicit empty timing summary', async () => {
  const summary = await observe(async ({ observer }) => { observer.markClickStarted(); });
  assert.equal(summary.consoleErrorSummary.errorCount, 0);
  assert.equal(summary.consoleErrorSummary.timingClassification, 'TIMING_UNKNOWN');
  assert.equal(summary.consoleErrorSummary.dominantClassification, null);
});
