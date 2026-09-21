'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createFacebookSubmitTransportObserver, safeOperationName, safeDocumentId, classifyResponse } = require('../app/facebook/submitTransportDiagnostics');
const { POST_SUBMIT_OUTCOME, classifyPostSubmitOutcome } = require('../app/facebook/verifyPost');
const { submitScopedPublishControl } = require('../app/local-agent/RealFacebookPublisherAdapter');
const { createComposerAcquisitionDiagnosticSink } = require('../app/local-agent/ComposerAcquisitionDiagnostics');

class FakePage extends EventEmitter {
  mainFrame() { return this.frame || (this.frame = { url: () => 'https://www.facebook.com/groups/test' }); }
}

function request(overrides = {}) {
  return {
    url: () => 'https://www.facebook.com/api/graphql/', method: () => 'POST', resourceType: () => 'fetch',
    postData: () => 'fb_api_req_friendly_name=ComposerStoryCreateMutation&variables=PRIVATE_BODY',
    failure: () => null, ...overrides,
  };
}

function response(req, status, body) {
  return { request: () => req, status: () => status, text: async () => body };
}

async function observedTransport({ status = 200, body = '{"data":{"story_create":{"id":"private"}}}', fail = null } = {}) {
  const page = new FakePage(); let clock = Date.parse('2026-09-21T10:00:00.000Z');
  const observer = createFacebookSubmitTransportObserver(page, { now: () => clock });
  observer.start(); observer.markClickStarted();
  const req = request({ failure: () => fail ? { errorText: fail } : null });
  clock += 5; page.emit('request', req);
  if (fail) { clock += 5; page.emit('requestfailed', req); }
  else { clock += 5; page.emit('response', response(req, status, body)); }
  return { page, observer, summary: await observer.stop() };
}

test('2xx transport never promotes success without an existing acknowledgement or exact reload proof', async () => {
  const { summary } = await observedTransport({});
  assert.equal(summary.transportClassification, 'TRANSPORT_RESPONSE_OBSERVED');
  assert.equal(summary.responses[0].responseClassification, 'CREATE_RESULT_WITH_STORY_ID');
  assert.equal(classifyPostSubmitOutcome({ composerPassed: true, acknowledgementPassed: true, transportSummary: summary }).outcomeClassification, POST_SUBMIT_OUTCOME.PUBLISHED_ACKNOWLEDGED);
  assert.equal(classifyPostSubmitOutcome({ composerPassed: true, targetReload: { resultClass: 'VERIFIED_EXACT_TARGET_POST', postReloadExactTrustedPostCount: 1 }, transportSummary: summary }).outcomeClassification, POST_SUBMIT_OUTCOME.PUBLISHED_VISIBLE_EXACT);
  assert.deepEqual(classifyPostSubmitOutcome({ composerPassed: true, targetReload: { resultClass: 'NOT_FOUND' }, transportSummary: summary }), { outcomeClassification: POST_SUBMIT_OUTCOME.UNCONFIRMED, outcomeEvidenceSource: 'NO_AUTHORITATIVE_EVIDENCE', matchingImmutableBodyCount: 0, matchingTokenCount: 0 });
});

test('4xx and 5xx submit responses are bounded explicit transport failures', async () => {
  const client = await observedTransport({ status: 403, body: 'private body' });
  const server = await observedTransport({ status: 503, body: 'private body' });
  assert.equal(client.summary.transportClassification, 'HTTP_4XX');
  assert.equal(server.summary.transportClassification, 'HTTP_5XX');
  assert.equal(client.summary.explicitFailureObserved, true);
  assert.equal(classifyPostSubmitOutcome({ transportSummary: server.summary }).outcomeClassification, POST_SUBMIT_OUTCOME.EXPLICIT_FACEBOOK_FAILURE);
});

test('GraphQL errors and permission/moderation envelopes are classified without retaining messages', async () => {
  const graphql = await observedTransport({ body: '{"errors":[{"message":"private arbitrary failure"}]}' });
  const permission = await observedTransport({ body: '{"errors":[{"code":200,"message":"permission denied secret detail"}]}' });
  assert.equal(graphql.summary.transportClassification, 'GRAPHQL_ERRORS_PRESENT');
  assert.equal(permission.summary.transportClassification, 'PERMISSION_OR_MODERATION_FAILURE');
  assert.doesNotMatch(JSON.stringify(permission.summary), /denied|secret detail/i);
});

test('network abort is classified and no relevant request remains a distinct fail-closed state', async () => {
  const failed = await observedTransport({ fail: 'net::ERR_ABORTED private URL' });
  assert.equal(failed.summary.transportClassification, 'REQUEST_FAILED');
  assert.equal(failed.summary.requestFailures[0].failureClass, 'ABORTED');
  assert.doesNotMatch(JSON.stringify(failed.summary), /private URL/);
  const page = new FakePage(); const observer = createFacebookSubmitTransportObserver(page);
  observer.start(); observer.markClickStarted(); page.emit('request', request({ url: () => 'https://evil.example/api/graphql/' }));
  assert.equal((await observer.stop()).transportClassification, 'NO_RELEVANT_REQUEST');
});

test('composer close, acknowledgement, reload, request, and response timestamps correlate to one click', async () => {
  const page = new FakePage(); let clock = Date.parse('2026-09-21T10:00:00.000Z');
  const observer = createFacebookSubmitTransportObserver(page, { now: () => clock }); observer.start(); observer.markClickStarted();
  const req = request(); clock += 10; page.emit('request', req); clock += 10; page.emit('response', response(req, 200, '{"data":{}}'));
  clock += 10; observer.markComposerHidden(); clock += 10; observer.markAcknowledgement(); clock += 10; observer.markReload();
  const summary = await observer.stop();
  assert.ok(summary.clickTimestamp && summary.firstRequestTimestamp && summary.firstResponseTimestamp && summary.composerHiddenTimestamp && summary.acknowledgementTimestamp && summary.reloadTimestamp);
});

test('console, page error, navigation, and frame detach evidence is bounded and text-free', async () => {
  const page = new FakePage(); const observer = createFacebookSubmitTransportObserver(page); observer.start(); observer.markClickStarted();
  for (let index = 0; index < 20; index += 1) page.emit('console', { type: () => 'error', text: () => `SECRET_${index}`, location: () => ({ url: 'https://www.facebook.com/api/graphql/?token=SECRET' }) });
  page.emit('pageerror', Object.assign(new Error('PRIVATE_PAGE_ERROR'), { name: 'TypeError' }));
  page.emit('framenavigated', page.mainFrame()); page.emit('framedetached', {});
  const summary = await observer.stop();
  assert.equal(summary.consoleErrors.length, 8); assert.equal(summary.pageErrors[0].errorClass, 'TypeError');
  assert.equal(summary.navigations[0].mainFrame, true); assert.equal(summary.frameDetachCount, 1);
  assert.doesNotMatch(JSON.stringify(summary), /SECRET|PRIVATE_PAGE_ERROR|token=/);
});

test('safe GraphQL operation extraction keeps only a strict operation name', () => {
  assert.equal(safeOperationName('fb_api_req_friendly_name=ComposerStoryCreateMutation&variables=%7B%22body%22%3A%22PRIVATE%22%7D'), 'ComposerStoryCreateMutation');
  assert.equal(safeOperationName('{"operationName":"ComposerStoryCreateMutation","variables":{"body":"PRIVATE"}}'), 'ComposerStoryCreateMutation');
  assert.equal(safeDocumentId('{"doc_id":"123456789"}'), '123456789');
  assert.equal(safeOperationName('operationName=bad-name&cookie=SECRET'), null);
});

test('diagnostic persistence strips headers, cookies, bodies, arbitrary errors, and unknown fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-transport-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory }).forTask('live_execution_transport_test');
    sink.submitTransportSummary({ observationWindowMs: 30000, clickTimestamp: '2026-09-21T10:00:00.000Z', transportClassification: 'GRAPHQL_ERRORS_PRESENT', explicitFailureObserved: true, relevantRequestCount: 1, responseCount: 1, requests: [{ timestamp: '2026-09-21T10:00:00.001Z', relativeToClickMs: 1, method: 'POST', resourceType: 'FETCH', hostnameClass: 'FACEBOOK_WWW', pathClass: 'GRAPHQL', operationName: 'ComposerStoryCreateMutation', headers: 'AUTH_SECRET', cookies: 'COOKIE_SECRET', rawBody: 'BODY_SECRET' }], responses: [{ timestamp: '2026-09-21T10:00:00.002Z', method: 'POST', resourceType: 'FETCH', hostnameClass: 'FACEBOOK_WWW', pathClass: 'GRAPHQL', status: 200, statusClass: 'HTTP_2XX', responseClassification: 'GRAPHQL_ERRORS_PRESENT', rawBody: 'RESPONSE_SECRET', message: 'ERROR_SECRET' }] });
    const persisted = fs.readFileSync(path.join(directory, 'live_execution_transport_test.json'), 'utf8');
    assert.doesNotMatch(persisted, /AUTH_SECRET|COOKIE_SECRET|BODY_SECRET|RESPONSE_SECRET|ERROR_SECRET|headers|cookies|rawBody/);
    assert.match(persisted, /ComposerStoryCreateMutation|GRAPHQL_ERRORS_PRESENT/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('click helper invokes the dangerous control exactly once and never retries after failure', async () => {
  let clicks = 0; let marked = 0;
  await assert.rejects(submitScopedPublishControl({ click: async () => { clicks += 1; throw new Error('failure'); } }, {}, () => 1, { markClickStarted: () => { marked += 1; }, stop: async () => ({ transportClassification: 'NO_RELEVANT_REQUEST' }) }), /failure/);
  assert.equal(clicks, 1); assert.equal(marked, 1);
});

test('response classifier never preserves a raw response envelope', async () => {
  const classified = await classifyResponse({ status: () => 200, text: async () => '{"errors":[{"message":"TOP SECRET"}]}' });
  assert.deepEqual(classified, { status: 200, statusClass: 'HTTP_2XX', responseClassification: 'GRAPHQL_ERRORS_PRESENT', graphqlErrorsPresent: true });
  assert.doesNotMatch(JSON.stringify(classified), /TOP SECRET/);
});
