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
function request(operationName, documentId) {
  const data = new URLSearchParams();
  if (operationName) data.set('fb_api_req_friendly_name', operationName);
  if (documentId) data.set('doc_id', documentId);
  return { url: () => 'https://www.facebook.com/api/graphql/', method: () => 'POST', resourceType: () => 'xhr', postData: () => data.toString() };
}
function response(requestValue, body) { return { request: () => requestValue, status: () => 200, text: async () => JSON.stringify(body) }; }

async function observe({ secondaryDocumentId = '222', sharedId = false } = {}) {
  const page = new FakePage(); let now = Date.parse('2026-09-21T12:00:00Z');
  const observer = createFacebookSubmitTransportObserver(page, { now: () => now });
  observer.start(); observer.markClickStarted();
  const primary = request('ComposerStoryCreateMutation', '111');
  page.emit('request', primary); now += 1;
  page.emit('response', response(primary, { data: { story_create: sharedId ? { story_id: 'shared_1' } : { arbitrary: 'PRIVATE PRIMARY' } } }));
  const secondary = request('CreatePhotoMutation', secondaryDocumentId); now += 1;
  page.emit('request', secondary); now += 1;
  page.emit('response', response(secondary, { data: { acknowledgement: true, ...(sharedId ? { story_id: 'shared_1' } : {}), body: 'PRIVATE SECONDARY' } }));
  page.emit('console', { type: () => 'error', text: () => 'GraphQL SECRET payload failed', location: () => ({ url: 'https://www.facebook.com/api/graphql/' }) });
  return observer.stop();
}

test('primary and secondary summaries retain operation, document, and internal request identity', async () => {
  const summary = await observe();
  assert.equal(summary.primaryMutationSummary.operationName, 'ComposerStoryCreateMutation');
  assert.equal(summary.primaryMutationSummary.documentId, '111');
  assert.equal(summary.primaryMutationSummary.requestCorrelationId, 'REQ_1');
  assert.equal(summary.secondaryAcknowledgementSummary.operationName, 'CreatePhotoMutation');
  assert.equal(summary.secondaryAcknowledgementSummary.documentId, '222');
  assert.equal(summary.secondaryAcknowledgementSummary.requestCorrelationId, 'REQ_2');
  assert.equal(summary.secondaryAcknowledgementSummary.correlation, 'LIKELY_TEMPORAL_ONLY');
});

test('same validated document proves a bounded request chain while timing alone does not', async () => {
  const chain = await observe({ secondaryDocumentId: '111' });
  const temporal = await observe({ secondaryDocumentId: '222' });
  assert.equal(chain.secondaryAcknowledgementSummary.correlation, 'PROVEN_REQUEST_CHAIN');
  assert.equal(temporal.secondaryAcknowledgementSummary.correlation, 'LIKELY_TEMPORAL_ONLY');
});

test('a shared allowlisted opaque ID proves correlation without exposing it in the protected summary', async () => {
  const summary = await observe({ sharedId: true });
  assert.equal(summary.secondaryAcknowledgementSummary.correlation, 'PROVEN_SHARED_ID');
  assert.deepEqual(summary.secondaryAcknowledgementSummary.sharedOpaqueIdTypes, ['STORY']);
  assert.doesNotMatch(JSON.stringify(summary.secondaryAcknowledgementSummary), /shared_1/);
});

test('protected acknowledgement evidence survives required-record pressure', async () => {
  const summary = await observe();
  summary.requests = Array.from({ length: 8 }, () => ({ ...summary.requests[0], rawBody: 'REQUEST SECRET', headers: 'HEADER SECRET', cookies: 'COOKIE SECRET' }));
  summary.responses = Array.from({ length: 8 }, () => ({ ...summary.responses[0], rawBody: 'RESPONSE SECRET' }));
  summary.consoleErrors = Array.from({ length: 8 }, () => ({ ...summary.consoleErrors[0], text: 'CONSOLE SECRET' }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-ack-retention-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory }).forTask('live_execution_ack_pressure');
    sink.submitTransportSummary(summary);
    const persistedText = fs.readFileSync(path.join(directory, 'live_execution_ack_pressure.json'), 'utf8');
    const persistedRecord = JSON.parse(persistedText).records.find((record) => record.stage === 'SUBMIT_TRANSPORT_DIAGNOSTIC_SUMMARY');
    const persisted = persistedRecord.submitTransport;
    const persistedBytes = Buffer.byteLength(JSON.stringify(persistedRecord), 'utf8');
    assert.ok(persistedBytes <= 2500, `submit transport record exceeded its 2500-byte bound: ${persistedBytes}`);
    assert.equal(persisted.detailTruncated, true);
    assert.equal(persisted.primaryMutationSummary.requestCorrelationId, 'REQ_1');
    assert.match(persisted.primaryMutationSummary.structuralFingerprint.sha256, /^[a-f0-9]{64}$/);
    assert.equal(persisted.secondaryAcknowledgementSummary.operationName, 'CreatePhotoMutation');
    assert.equal(persisted.secondaryAcknowledgementSummary.documentId, '222');
    assert.equal(persisted.secondaryAcknowledgementSummary.correlation, 'LIKELY_TEMPORAL_ONLY');
    assert.equal(persisted.consoleErrorSummary.counts.GRAPHQL, 1);
    assert.doesNotMatch(persistedText, /REQUEST SECRET|RESPONSE SECRET|CONSOLE SECRET|HEADER SECRET|COOKIE SECRET|PRIVATE PRIMARY|PRIVATE SECONDARY/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('console diagnostics retain category but never arbitrary text', async () => {
  const summary = await observe();
  assert.equal(summary.consoleErrors[0].category, 'GRAPHQL');
  assert.equal(summary.consoleErrorSummary.counts.GRAPHQL, 1);
  assert.doesNotMatch(JSON.stringify(summary.consoleErrors), /SECRET|payload failed/);
});
