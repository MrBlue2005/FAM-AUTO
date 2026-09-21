'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_RESPONSE_INSPECTION_BYTES,
  MAX_TRANSIENT_RESPONSE_BYTES,
  MAX_STRUCTURAL_ARRAYS,
  classifyResponse,
} = require('../app/facebook/submitTransportDiagnostics');

const operation = { operationName: 'ComposerStoryCreateMutation' };
function bufferedResponse(value) {
  const buffer = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return { status: () => 200, body: async () => buffer, headerValue: async () => null };
}
function largeEnvelope(result, bytes = MAX_RESPONSE_INSPECTION_BYTES + 1024, secret = 'PRIVATE') {
  return { data: { story_create: result }, private_text: `${secret}${'x'.repeat(bytes)}` };
}

test('responses below 64 KiB keep full fingerprint completeness', async () => {
  const result = await classifyResponse(bufferedResponse({ data: { story_create: { unfamiliar: true } } }), operation);
  assert.equal(result.responseClassification, 'CREATE_RESULT_UNKNOWN');
  assert.equal(result.structuralFingerprint.completeness, 'FULL');
  assert.equal(result.responseSizeBucket, 'UP_TO_64_KIB');
});

test('responses just above 64 KiB receive bounded-complete structural evidence', async () => {
  const result = await classifyResponse(bufferedResponse(largeEnvelope({ unfamiliar: true })), operation);
  assert.equal(result.structuralFingerprintReason, 'STRUCTURE_EXTRACTED_BOUNDED');
  assert.equal(result.responseCompleteness, 'BOUNDED_COMPLETE');
  assert.equal(result.responseSizeBucket, '64_TO_256_KIB');
});

test('substantially oversized responses below the hard maximum remain inspectable', async () => {
  const result = await classifyResponse(bufferedResponse(largeEnvelope({ unfamiliar: true }, 300 * 1024)), operation);
  assert.match(result.structuralFingerprint.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.responseSizeBucket, '256_KIB_TO_1_MIB');
});

test('declared responses above the absolute hard maximum are rejected before body retrieval', async () => {
  let bodyReads = 0;
  const result = await classifyResponse({ status: () => 200, headerValue: async () => String(MAX_TRANSIENT_RESPONSE_BYTES + 1), body: async () => { bodyReads += 1; return Buffer.alloc(1); } }, operation);
  assert.equal(bodyReads, 0);
  assert.equal(result.structuralFingerprintReason, 'STRUCTURE_UNAVAILABLE_HARD_LIMIT');
  assert.equal(result.responseCompleteness, 'UNAVAILABLE');
  assert.equal(result.responseSizeBucket, 'OVER_1_MIB');
});

test('safe story and post IDs are extracted from bounded large responses', async () => {
  const story = await classifyResponse(bufferedResponse(largeEnvelope({ story_id: 'story_123' })), operation);
  const post = await classifyResponse(bufferedResponse(largeEnvelope({ post_id: 'post_123' })), operation);
  assert.equal(story.storyId, 'story_123'); assert.equal(story.responseClassification, 'CREATE_RESULT_WITH_STORY_ID');
  assert.equal(post.postId, 'post_123'); assert.equal(post.responseClassification, 'CREATE_RESULT_WITH_POST_ID');
  assert.ok(story.structuralFingerprint && post.structuralFingerprint);
});

test('pending state and embedded failure remain safely discoverable in large responses', async () => {
  const pending = await classifyResponse(bufferedResponse(largeEnvelope({ submission_status: 'PENDING_REVIEW', submission_id: 'submission_1' })), operation);
  const failed = await classifyResponse(bufferedResponse(largeEnvelope({ status: 'REJECTED', message: 'PRIVATE FAILURE' })), operation);
  assert.equal(pending.responseClassification, 'CREATE_RESULT_PENDING'); assert.equal(pending.submissionId, 'submission_1');
  assert.equal(failed.responseClassification, 'CREATE_RESULT_EXPLICIT_FAILURE'); assert.equal(failed.embeddedSemanticFailureObserved, true);
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE FAILURE/);
});

test('private text never persists or affects an identical large structural fingerprint', async () => {
  const first = await classifyResponse(bufferedResponse(largeEnvelope({ unfamiliar: true }, 80 * 1024, 'FIRST_SECRET_')), operation);
  const second = await classifyResponse(bufferedResponse(largeEnvelope({ unfamiliar: true }, 80 * 1024, 'SECOND_SECRET')), operation);
  assert.equal(first.structuralFingerprint.sha256, second.structuralFingerprint.sha256);
  assert.doesNotMatch(JSON.stringify([first, second]), /FIRST_SECRET|SECOND_SECRET|x{20}/);
});

test('materially different large structures produce different fingerprints', async () => {
  const first = await classifyResponse(bufferedResponse(largeEnvelope({ branch_a: { enabled: true } })), operation);
  const second = await classifyResponse(bufferedResponse(largeEnvelope({ branch_b: [{ count: 1 }] })), operation);
  assert.notEqual(first.structuralFingerprint.sha256, second.structuralFingerprint.sha256);
});

test('deeply nested oversized objects are explicitly partial and depth bounded', async () => {
  let nested = { leaf: true };
  for (let index = 0; index < 12; index += 1) nested = { [`level_${index}`]: nested };
  const result = await classifyResponse(bufferedResponse(largeEnvelope({ nested })), operation);
  assert.equal(result.responseCompleteness, 'PARTIAL');
  assert.equal(result.structuralFingerprint.partial, true);
  assert.equal(result.structuralFingerprint.depthLimitReached, true);
});

test('array-heavy oversized responses are bounded by inspected elements and paths', async () => {
  const arrays = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`rows_${index}`, [{ value: index }]]));
  const result = await classifyResponse(bufferedResponse(largeEnvelope(arrays)), operation);
  assert.equal(result.responseCompleteness, 'PARTIAL');
  assert.ok(result.structuralFingerprint.paths.length <= 32);
  assert.equal(result.structuralFingerprint.arraysInspected, MAX_STRUCTURAL_ARRAYS);
  assert.equal(result.structuralFingerprint.arrayLimitReached, true);
});

test('malformed oversized JSON remains unavailable without retaining content', async () => {
  const result = await classifyResponse(bufferedResponse(`{"data":${'PRIVATE'.repeat(10000)}`), operation);
  assert.equal(result.structuralFingerprintReason, 'MALFORMED_JSON');
  assert.equal(result.responseCompleteness, 'UNAVAILABLE');
  assert.equal(result.responseSizeBucket, '64_TO_256_KIB');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
