'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { classifyResponse, createFacebookSubmitTransportObserver } = require('../app/facebook/submitTransportDiagnostics');
const { classifyPostSubmitOutcome, POST_SUBMIT_OUTCOME } = require('../app/facebook/verifyPost');
const { createComposerAcquisitionDiagnosticSink } = require('../app/local-agent/ComposerAcquisitionDiagnostics');

const operation = { operationName: 'ComposerStoryCreateMutation' };
const response = (body, status = 200) => ({ status: () => status, text: async () => JSON.stringify(body) });
const classify = (body) => classifyResponse(response(body), operation);

test('ComposerStoryCreateMutation extracts only allowlisted story, post, and feedback identifiers', async () => {
  const story = await classify({ data: { story_create: { story: { id: '123_456', __typename: 'Story' }, private_text: 'DO NOT KEEP' } } });
  const post = await classify({ data: { story_create: { post_id: 'post:789', author_name: 'PRIVATE USER' } } });
  const feedback = await classify({ data: { story_create: { feedback: { id: 'feedback_42' }, body: 'PRIVATE BODY' } } });
  assert.equal(story.responseClassification, 'CREATE_RESULT_WITH_STORY_ID'); assert.equal(story.storyId, '123_456'); assert.equal(story.resultTypename, 'Story');
  assert.equal(post.responseClassification, 'CREATE_RESULT_WITH_POST_ID'); assert.equal(post.postId, 'post:789');
  assert.equal(feedback.responseClassification, 'CREATE_RESULT_WITH_FEEDBACK_ID'); assert.equal(feedback.feedbackId, 'feedback_42');
  assert.doesNotMatch(JSON.stringify([story, post, feedback]), /DO NOT KEEP|PRIVATE USER|PRIVATE BODY|private_text|author_name/);
});

test('pending and embedded semantic failure evidence are distinct diagnostic classes', async () => {
  const pending = await classify({ data: { story_create: { submission_status: 'PENDING_REVIEW', submission_id: 'submission_7' } } });
  const failedStatus = await classify({ data: { story_create: { status: 'REJECTED', message: 'PRIVATE POLICY DETAIL' } } });
  const failedBoolean = await classify({ data: { story_create: { success: false, private_reason: 'SECRET' } } });
  assert.equal(pending.responseClassification, 'CREATE_RESULT_PENDING'); assert.equal(pending.pendingStateObserved, true); assert.equal(pending.submissionId, 'submission_7');
  assert.equal(failedStatus.responseClassification, 'CREATE_RESULT_EXPLICIT_FAILURE'); assert.equal(failedStatus.embeddedSemanticFailureObserved, true);
  assert.equal(failedBoolean.responseClassification, 'CREATE_RESULT_EXPLICIT_FAILURE'); assert.equal(failedBoolean.semanticSuccess, false);
  assert.doesNotMatch(JSON.stringify([failedStatus, failedBoolean]), /PRIVATE POLICY DETAIL|SECRET|private_reason/);
});

test('success flag permits diagnostic acknowledgement without asserting publication', async () => {
  const classified = await classify({ data: { story_create: { success: true, creation_id: 'create_1' } } });
  assert.equal(classified.responseClassification, 'CREATE_RESULT_ACK_WITHOUT_OBJECT');
  assert.equal(classified.creationId, 'create_1');
  assert.equal(classifyPostSubmitOutcome({ composerPassed: true, targetReload: { resultClass: 'NOT_FOUND' }, transportSummary: { responses: [classified] } }).outcomeClassification, POST_SUBMIT_OUTCOME.UNCONFIRMED);
});

test('HTTP 200 unknown, malformed, and top-level GraphQL error responses remain fail-closed', async () => {
  const unknown = await classify({ data: { story_create: { arbitrary: 'PRIVATE' } } });
  const malformed = await classifyResponse({ status: () => 200, text: async () => '{not-json' }, operation);
  const graphql = await classify({ errors: [{ message: 'PRIVATE GRAPHQL ERROR' }], data: null });
  assert.equal(unknown.responseClassification, 'CREATE_RESULT_UNKNOWN');
  assert.equal(malformed.responseClassification, 'UNKNOWN_RESPONSE_SHAPE');
  assert.equal(graphql.responseClassification, 'GRAPHQL_ERRORS_PRESENT');
  assert.doesNotMatch(JSON.stringify(graphql), /PRIVATE GRAPHQL ERROR/);
});

test('unrelated GraphQL operation does not receive Composer create classifications', async () => {
  const classified = await classifyResponse(response({ data: { story_create: { story_id: '123' } } }), { operationName: 'CreatePhotoMutation' });
  assert.equal(classified.responseClassification, 'MUTATION_ACKNOWLEDGEMENT');
  assert.notEqual(classified.responseClassification, 'CREATE_RESULT_WITH_STORY_ID');
});

test('opaque identifiers are format-validated and bounded', async () => {
  const long = await classify({ data: { story_create: { story_id: 'a'.repeat(129) } } });
  const malformed = await classify({ data: { story_create: { post_id: 'bad id/with spaces' } } });
  assert.equal(long.storyIdPresent, false); assert.equal(long.storyId, null); assert.equal(long.responseClassification, 'CREATE_RESULT_UNKNOWN');
  assert.equal(malformed.postIdPresent, false); assert.equal(malformed.postId, null); assert.equal(malformed.responseClassification, 'CREATE_RESULT_UNKNOWN');
});

class FakePage extends EventEmitter { mainFrame() { return {}; } }
function request(operationName, docId = null) {
  const params = new URLSearchParams(); if (operationName) params.set('fb_api_req_friendly_name', operationName); if (docId) params.set('doc_id', docId);
  return { url: () => 'https://www.facebook.com/api/graphql/', method: () => 'POST', resourceType: () => 'xhr', postData: () => params.toString() };
}
function networkResponse(requestValue, body) { return { request: () => requestValue, status: () => 200, text: async () => JSON.stringify(body) }; }

async function observePair(secondRequest, secondBody) {
  const page = new FakePage(); let now = Date.parse('2026-09-21T10:00:00Z'); const observer = createFacebookSubmitTransportObserver(page, { now: () => now });
  observer.start(); observer.markClickStarted();
  const primary = request('ComposerStoryCreateMutation', '111'); page.emit('request', primary); now += 1; page.emit('response', networkResponse(primary, { data: { story_create: { story_id: 'story_1' } } }));
  now += 1; page.emit('request', secondRequest); now += 1; page.emit('response', networkResponse(secondRequest, secondBody));
  return observer.stop();
}

test('second acknowledgement correlation requires a request-chain or shared-ID signal', async () => {
  const sameDocument = await observePair(request(null, '111'), { data: { acknowledgement: true } });
  const sharedObject = await observePair(request(null, '222'), { data: { result: { story_id: 'story_1' } } });
  assert.equal(sameDocument.responses[1].correlation, 'PROVEN_REQUEST_CHAIN');
  assert.equal(sharedObject.responses[1].correlation, 'PROVEN_SHARED_ID');
  assert.deepEqual(sharedObject.responses[1].sharedOpaqueIdTypes, ['STORY']);
});

test('timing-only second-response correlation remains explicitly non-proven', async () => {
  const summary = await observePair(request('CreatePhotoMutation', '222'), { data: { acknowledgement: true } });
  assert.equal(summary.responses[1].correlation, 'LIKELY_TEMPORAL_ONLY');
});

test('created object reference is a narrow future ID-verification hook and persistence stays private', async () => {
  const summary = await observePair(request(null, '222'), { data: { acknowledgement: true, private_text: 'SECOND SECRET' } });
  assert.deepEqual(summary.createdObjectVerificationReference, { objectType: 'STORY', opaqueId: 'story_1' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-mutation-outcome-'));
  try {
    const sink = createComposerAcquisitionDiagnosticSink({ directory }).forTask('live_execution_mutation_shape');
    sink.submitTransportSummary({ ...summary, rawBody: 'RAW SECRET', responses: summary.responses.map((item) => ({ ...item, rawBody: 'RAW RESPONSE', arbitrary: { private: 'PRIVATE NESTED' } })) });
    const persisted = fs.readFileSync(path.join(directory, 'live_execution_mutation_shape.json'), 'utf8');
    assert.match(persisted, /createdObjectVerificationReference|story_1|CREATE_RESULT_WITH_STORY_ID/);
    assert.doesNotMatch(persisted, /RAW SECRET|RAW RESPONSE|PRIVATE NESTED|SECOND SECRET|rawBody|arbitrary/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
