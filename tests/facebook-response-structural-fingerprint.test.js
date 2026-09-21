'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_STRUCTURAL_DEPTH,
  MAX_STRUCTURAL_PATHS,
  structuralFingerprint,
  classifyResponse,
} = require('../app/facebook/submitTransportDiagnostics');

test('unknown GraphQL shapes receive deterministic structural fingerprints', async () => {
  const body = { data: { novel_result: { state: true, count: 2 } } };
  const response = { status: () => 200, text: async () => JSON.stringify(body) };
  const first = await classifyResponse(response, { operationName: 'ComposerStoryCreateMutation' });
  const second = await classifyResponse(response, { operationName: 'ComposerStoryCreateMutation' });
  assert.equal(first.responseClassification, 'CREATE_RESULT_UNKNOWN');
  assert.deepEqual(first.structuralFingerprint, second.structuralFingerprint);
  assert.match(first.structuralFingerprint.sha256, /^[a-f0-9]{64}$/);
});

test('unknown non-acknowledgement response retains only structural types and safe paths', async () => {
  const response = { status: () => 200, text: async () => JSON.stringify({ result: { novel_key: 7 } }) };
  const classified = await classifyResponse(response, { operationName: 'CreatePhotoMutation' });
  assert.equal(classified.responseClassification, 'UNKNOWN_RESPONSE_SHAPE');
  assert.equal(classified.structuralFingerprintReason, 'STRUCTURE_EXTRACTED_FULL');
  assert.match(classified.structuralFingerprint.paths.join('|'), /novel_key:NUMBER/);
});

test('unknown top-level array response is fingerprinted as a bounded array shape', async () => {
  const response = { status: () => 200, text: async () => JSON.stringify([{ novel_result: { state: true } }]) };
  const classified = await classifyResponse(response, { operationName: 'CreatePhotoMutation' });
  assert.equal(classified.responseClassification, 'UNKNOWN_RESPONSE_SHAPE');
  assert.equal(classified.structuralFingerprint.topLevelKind, 'ARRAY_ONE');
  assert.match(classified.structuralFingerprint.paths.join('|'), /\$\[\]\.novel_result:OBJECT/);
});

test('private scalar changes do not alter or leak through a fingerprint', () => {
  const first = structuralFingerprint({ data: { result: { body: 'FIRST SECRET', message: 'ERROR ONE', state: true } } });
  const second = structuralFingerprint({ data: { result: { body: 'SECOND SECRET', message: 'ERROR TWO', state: true } } });
  assert.equal(first.sha256, second.sha256);
  assert.doesNotMatch(JSON.stringify(first), /SECRET|ERROR ONE|body|message/i);
});

test('different safe structures produce different hashes', () => {
  const objectShape = structuralFingerprint({ data: { result: { state: true } } });
  const arrayShape = structuralFingerprint({ data: { result: [{ state: true }] } });
  assert.notEqual(objectShape.sha256, arrayShape.sha256);
});

test('fingerprinting is bounded by depth, path, key, and array limits', () => {
  let deep = { leaf: true };
  for (let index = 0; index < 12; index += 1) deep = { [`level_${index}`]: deep };
  const broad = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`safe_${index}`, [deep, deep, deep, deep]]));
  const result = structuralFingerprint({ data: broad });
  assert.ok(result.paths.length <= MAX_STRUCTURAL_PATHS);
  assert.ok(result.maxDepthObserved <= MAX_STRUCTURAL_DEPTH);
  assert.equal(result.pathLimitReached || result.depthLimitReached || result.keyLimitReached, true);
});

test('unsafe and malformed keys are omitted from normalized paths', () => {
  const oversizedKey = `oversized_${'x'.repeat(60)}`;
  const result = structuralFingerprint({ data: { 'bad-key': true, [oversizedKey]: true, password: 'PRIVATE', session_token: 'PRIVATE', okay_key: false } });
  assert.match(result.paths.join('|'), /okay_key:BOOLEAN/);
  assert.doesNotMatch(result.paths.join('|'), /bad-key|oversized_|password|session_token/);
});

test('bounded oversized responses are fingerprinted while malformed responses fail closed', async () => {
  const oversized = await classifyResponse({ status: () => 200, text: async () => `{"data":"${'S'.repeat(70000)}"}` }, { operationName: 'CreatePhotoMutation' });
  const malformed = await classifyResponse({ status: () => 200, text: async () => '{SECRET malformed' }, { operationName: 'CreatePhotoMutation' });
  assert.equal(oversized.structuralFingerprintReason, 'STRUCTURE_EXTRACTED_BOUNDED');
  assert.equal(malformed.structuralFingerprintReason, 'MALFORMED_JSON');
  assert.match(oversized.structuralFingerprint.sha256, /^[a-f0-9]{64}$/);
  assert.equal(malformed.structuralFingerprint, undefined);
  assert.doesNotMatch(JSON.stringify([oversized, malformed]), /SECRET|S{20}/);
});
