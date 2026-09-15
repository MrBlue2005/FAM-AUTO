'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { logsPath } = require('../config/storagePaths');

const STAGES = new Set([
  'COMPOSER_DISCOVERY_START', 'COMPOSER_POTENTIAL_ROOTS_SNAPSHOT',
  'COMPOSER_OPENER_FOUND', 'COMPOSER_OPENER_CLICKED',
  'COMPOSER_POST_CLICK_OBSERVATION', 'COMPOSER_ROOT_CANDIDATE_SEEN',
  'COMPOSER_ROOT_STRUCTURAL_REJECTED', 'COMPOSER_ROOT_ZERO_EDITOR',
  'COMPOSER_ROOT_MULTIPLE_EDITORS', 'COMPOSER_ROOT_HIDDEN',
  'COMPOSER_ROOT_DETACHED', 'COMPOSER_ROOT_TRANSITION_NEW',
  'COMPOSER_ROOT_TRANSITION_REPLACEMENT', 'COMPOSER_ROOT_TRANSITION_REUSE',
  'COMPOSER_ROOT_NO_TRANSITION', 'COMPOSER_ROOT_AMBIGUOUS',
  'COMPOSER_ROOT_ACCEPTED', 'COMPOSER_EDITOR_BOUND',
  'COMPOSER_ACQUISITION_TIMEOUT', 'COMPOSER_ACQUISITION_FAILED',
  'EDITOR_SHAPE_SNAPSHOT', 'EDITOR_SHAPE_DIAGNOSTIC_SUMMARY',
  'PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT', 'PRE_SELECTOR_EDITOR_SHAPE_SUMMARY',
  'EDITOR_SELECTOR_PARITY_SNAPSHOT', 'EDITOR_SELECTOR_PARITY_SUMMARY',
  'CONTENT_MISMATCH_DIAGNOSTIC_SUMMARY',
  'ZERO_MEDIA_INSPECTION_DIAGNOSTIC_SUMMARY',
  'PUBLISH_CONTROL_DISCOVERY_DIAGNOSTIC_SUMMARY',
  'POST_SUBMIT_CLICK_STARTED', 'POST_SUBMIT_CLICK_RETURNED', 'POST_SUBMIT_CLICK_FAILED',
  'POST_SUBMIT_VERIFICATION_STARTED', 'POST_SUBMIT_VERIFICATION_DIAGNOSTIC_SUMMARY',
  'ACKNOWLEDGEMENT_SHAPE_DIAGNOSTIC_SUMMARY',
]);

const REASON_CLASSES = new Set([
  'DISCOVERY_STARTED', 'OPENER_FOUND', 'OPENER_CLICKED', 'SNAPSHOT',
  'STRUCTURAL_REJECTED', 'ZERO_ELIGIBLE_EDITOR', 'MULTIPLE_ELIGIBLE_EDITORS',
  'ROOT_HIDDEN', 'ROOT_DETACHED', 'TRANSITION_NEW', 'TRANSITION_REPLACEMENT',
  'TRANSITION_REUSE', 'NO_ELIGIBLE_TRANSITION', 'AMBIGUOUS_TRANSITION',
  'ROOT_ACCEPTED', 'EDITOR_BOUND', 'ACQUISITION_TIMEOUT', 'UNKNOWN_SAFE_FAILURE',
  'EDITOR_SHAPE_SNAPSHOT', 'EDITOR_SHAPE_SUMMARY',
  'PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT', 'PRE_SELECTOR_EDITOR_SHAPE_SUMMARY',
  'EDITOR_SELECTOR_PARITY_SNAPSHOT', 'EDITOR_SELECTOR_PARITY_SUMMARY',
  'CONTENT_MISMATCH',
  'ZERO_MEDIA_INSPECTION',
  'PUBLISH_CONTROL_DISCOVERY',
  'POST_SUBMIT_CLICK_STARTED', 'POST_SUBMIT_CLICK_RETURNED', 'POST_SUBMIT_CLICK_FAILED',
  'POST_SUBMIT_VERIFICATION_STARTED', 'POST_SUBMIT_VERIFICATION',
  'ACKNOWLEDGEMENT_SHAPE',
]);

const COUNTERS = new Set([
  'potentialRootCount', 'visibleRootCount', 'structurallyEligibleRootCount',
  'rootsWithZeroEditor', 'rootsWithOneEditor', 'rootsWithMultipleEditors',
  'newRootCount', 'removedRootCount', 'transitionedRootCount', 'eligibleTransitionCount',
]);

const FLAGS = new Set([
  'hasRoleDialog', 'hasAriaModal', 'hasComposerPageletSignal', 'hasVisibleEditor',
  'editorCountIsOne', 'hasRoleTextbox', 'hasContentEditable', 'hasLexicalSignal',
  'isTextarea', 'isEditable', 'isVisible', 'isAttached', 'transitionDetected',
]);

const MAX_COUNTER = 1000;
const MAX_RECORDS_PER_TASK = 64;
const MAX_TASK_FILES = 24;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_EDITOR_SHAPE_SNAPSHOTS = 3;
const MAX_EDITOR_SHAPE_CANDIDATES = 12;
const ELIGIBILITY_REJECTION_REASONS = new Set([
  'ACCEPTED', 'HIDDEN', 'PLAYWRIGHT_NOT_ENABLED', 'PLAYWRIGHT_NOT_EDITABLE',
  'NOT_POST_SHAPE', 'COMMENT_REPLY_SEARCH_EXCLUDED', 'OTHER_SAFE_REJECTION',
]);
const TERMINAL_STAGES = new Set([
  'COMPOSER_ROOT_ACCEPTED', 'COMPOSER_EDITOR_BOUND', 'COMPOSER_ACQUISITION_FAILED',
]);
const PRE_SELECTOR_SNAPSHOT_STAGE = 'PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT';
const PRE_SELECTOR_SUMMARY_STAGE = 'PRE_SELECTOR_EDITOR_SHAPE_SUMMARY';
const SELECTOR_PARITY_SNAPSHOT_STAGE = 'EDITOR_SELECTOR_PARITY_SNAPSHOT';
const SELECTOR_PARITY_SUMMARY_STAGE = 'EDITOR_SELECTOR_PARITY_SUMMARY';
const SELECTOR_PARITY_RESULTS = new Set([
  'BOTH_ZERO', 'BOTH_NONZERO_EQUAL', 'BOTH_NONZERO_DIFFERENT',
  'DOM_NONZERO_PLAYWRIGHT_ZERO', 'DOM_ZERO_PLAYWRIGHT_NONZERO',
  'ROOT_UNAVAILABLE', 'SAFE_EVALUATION_ERROR',
]);
const CONTENT_MISMATCH_LENGTH_RELATIONS = new Set([
  'EXACT_LENGTH', 'SHORTER', 'LONGER', 'DOUBLE_LENGTH', 'EMPTY',
]);
const CONTENT_MISMATCH_INSERTION_METHODS = new Set([
  'CLIPBOARD_PASTE', 'RETAINED_EDITOR_SHIFT_ENTER', 'FILL', 'TYPE', 'PRESS_INSERT_TEXT', 'DOM_SETTER', 'OTHER_FIXED_METHOD',
]);
const CONTENT_MISMATCH_READ_TIMINGS = new Set([
  'IMMEDIATELY_AFTER_INSERTION', 'AFTER_EXISTING_SETTLE', 'FIRST_VERIFICATION_READ', 'BOUNDED_POST_PASTE_SYNC',
]);
const CONTENT_MISMATCH_READERS = new Set([
  'CONTENTEDITABLE_VISUAL_TEXT', 'TEXTAREA_VALUE', 'INPUT_VALUE',
]);
const CONTENT_MISMATCH_SUMMARY_STAGE = 'CONTENT_MISMATCH_DIAGNOSTIC_SUMMARY';
const ZERO_MEDIA_INSPECTION_SUMMARY_STAGE = 'ZERO_MEDIA_INSPECTION_DIAGNOSTIC_SUMMARY';
const PUBLISH_CONTROL_DISCOVERY_SUMMARY_STAGE = 'PUBLISH_CONTROL_DISCOVERY_DIAGNOSTIC_SUMMARY';
const POST_SUBMIT_VERIFICATION_SUMMARY_STAGE = 'POST_SUBMIT_VERIFICATION_DIAGNOSTIC_SUMMARY';
const MAX_PUBLISH_CONTROL_CANDIDATES = 16;
const MAX_PUBLISH_CONTROL_SNAPSHOTS = 3;
const PUBLISH_CONTROL_TAG_NAMES = new Set(['BUTTON', 'INPUT', 'DIV', 'SPAN', 'A', 'OTHER']);
const PUBLISH_CONTROL_ROLES = new Set([null, 'button', 'submit', 'other']);
const PUBLISH_CONTROL_TYPES = new Set([null, 'submit', 'button', 'reset', 'other']);
const PUBLISH_CONTROL_TEXT_CLASSES = new Set([
  'MATCHES_ALLOWED_PUBLISH_LABEL', 'NON_PUBLISH_TEXT', 'EMPTY_OR_UNAVAILABLE_TEXT',
  'MULTIPLE_LABEL_SIGNAL', 'SAFE_TEXT_EVALUATION_ERROR',
]);
const PUBLISH_CONTROL_REJECTIONS = new Set([
  'ACCEPTED', 'HIDDEN', 'DISABLED', 'WRONG_ROLE', 'WRONG_ELEMENT_TYPE',
  'LABEL_NOT_ALLOWED', 'AMBIGUOUS', 'DETACHED', 'OTHER_SAFE_REJECTION',
]);
const MEDIA_TAG_NAMES = new Set(['IMG', 'VIDEO', 'OTHER']);
const MEDIA_DIMENSION_BUCKETS = new Set(['ZERO', 'SMALL', 'MEDIUM', 'LARGE', 'UNKNOWN']);
const MEDIA_SRC_SCHEMES = new Set(['BLOB', 'DATA', 'HTTPS', 'OTHER', 'NONE']);
const MEDIA_ROLES = new Set([null, 'presentation', 'img', 'button', 'other']);
const MEDIA_CATEGORIES = new Set([
  'POSSIBLE_UPLOAD_ATTACHMENT', 'UI_AVATAR_OR_ICON', 'DECORATIVE_OR_PRESENTATION',
  'VIDEO_CANDIDATE', 'UNKNOWN_MEDIA_CANDIDATE',
]);
const ZERO_MEDIA_INSPECTION_RESULTS = new Set(['OK', 'COUNT_OPERATION_FAILED', 'EVALUATION_FAILED']);
const PROTECTED_STAGES = new Set([
  PRE_SELECTOR_SNAPSHOT_STAGE,
  PRE_SELECTOR_SUMMARY_STAGE,
  SELECTOR_PARITY_SUMMARY_STAGE,
  CONTENT_MISMATCH_SUMMARY_STAGE,
  ZERO_MEDIA_INSPECTION_SUMMARY_STAGE,
  PUBLISH_CONTROL_DISCOVERY_SUMMARY_STAGE,
  POST_SUBMIT_VERIFICATION_SUMMARY_STAGE,
  'ACKNOWLEDGEMENT_SHAPE_DIAGNOSTIC_SUMMARY',
  'COMPOSER_ACQUISITION_FAILED',
]);

function safeTaskId(value) {
  const taskId = String(value || '');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(taskId)) return null;
  return taskId;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function boundedInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, MAX_COUNTER) : undefined;
}

function sanitizeEvidence(evidence = {}) {
  const counters = {};
  const flags = {};
  for (const key of COUNTERS) {
    const value = boundedInteger(evidence.counters?.[key]);
    if (value !== undefined) counters[key] = value;
  }
  for (const key of FLAGS) {
    if (typeof evidence.flags?.[key] === 'boolean') flags[key] = evidence.flags[key];
  }
  return { counters, flags };
}

function sanitizeCandidate(value = {}) {
  const tagName = ['textarea', 'input', 'div', 'span', 'p', 'other'].includes(value.tagName) ? value.tagName : 'other';
  const role = [null, 'textbox', 'combobox', 'searchbox', 'other'].includes(value.role) ? value.role : 'other';
  const contenteditable = ['true', 'false', 'plaintext-only', 'empty', 'inherited/absent'].includes(value.contenteditable) ? value.contenteditable : 'inherited/absent';
  const reason = ['CONTENTEDITABLE_ATTRIBUTE', 'ROLE_ATTRIBUTE', 'TEXTAREA_TAG', 'INPUT_TAG', 'LEXICAL_ATTRIBUTE', 'ARIA_MULTILINE', 'TABINDEX'].includes(value.reason) ? value.reason : 'TABINDEX';
  const bool = (key) => value[key] === true;
  const eligibilityRejectionReason = ELIGIBILITY_REJECTION_REASONS.has(value.eligibilityRejectionReason) ? value.eligibilityRejectionReason : 'OTHER_SAFE_REJECTION';
  return { tagName, role, contenteditable, hasDataLexicalEditor: bool('hasDataLexicalEditor'), ariaMultiline: typeof value.ariaMultiline === 'boolean' ? value.ariaMultiline : null, tabIndex: Math.max(-1, Math.min(1000, Number.isFinite(Number(value.tabIndex)) ? Math.trunc(Number(value.tabIndex)) : 0)), isContentEditable: bool('isContentEditable'), disabled: bool('disabled'), readOnly: bool('readOnly'), visible: bool('visible'), attached: bool('attached'), ancestorEditable: bool('ancestorEditable'), childElementCount: boundedInteger(value.childElementCount) || 0, descendantEditableCount: boundedInteger(value.descendantEditableCount) || 0, candidateDepth: boundedInteger(value.candidateDepth) || 0, reason, eligibilityRejectionReason };
}

function sanitizeShapeSummary(value = {}) {
  const keys = ['candidateCount', 'visibleCandidateCount', 'isContentEditableCount', 'contenteditableAttributePresentCount', 'roleTextboxCount', 'textareaCount', 'lexicalCount', 'editableAncestorCount', 'plaintextOnlyCount', 'otherRoleCount', 'acceptedCount', 'playwrightNotEnabledCount', 'playwrightNotEditableCount', 'commentReplySearchExcludedCount', 'notPostShapeCount', 'otherSafeRejectionCount'];
  return Object.fromEntries(keys.map((key) => [key, boundedInteger(value[key]) || 0]));
}

function sanitizePreSelectorShapeSummary(value = {}) {
  const keys = [
    'candidateCount', 'visibleCandidateCount', 'roleTextboxCount',
    'contenteditablePresentCount', 'contenteditableTrueCount', 'plaintextOnlyCount',
    'lexicalCount', 'isContentEditableCount', 'ariaMultilineCount', 'textareaCount',
    'editableAncestorCount', 'inputCount', 'otherRoleCount',
  ];
  return Object.fromEntries(keys.map((key) => [key, boundedInteger(value[key]) || 0]));
}

function sanitizeSelectorParity(value = {}) {
  const count = (key) => boundedInteger(value[key]) || 0;
  const branchCount = (key) => boundedInteger(value.branchCounts?.[key]) || 0;
  return {
    domNativeCount: count('domNativeCount'),
    playwrightScopedCount: count('playwrightScopedCount'),
    rootAttached: value.rootAttached === true,
    rootVisible: value.rootVisible === true,
    sameRootReference: value.sameRootReference === true,
    selectorParityResult: SELECTOR_PARITY_RESULTS.has(value.selectorParityResult) ? value.selectorParityResult : 'SAFE_EVALUATION_ERROR',
    branchCounts: {
      contenteditableTrueCount: branchCount('contenteditableTrueCount'),
      roleTextboxCount: branchCount('roleTextboxCount'),
      lexicalSelectorCount: branchCount('lexicalSelectorCount'),
    },
  };
}

function sanitizeSelectorParitySummary(value = {}) {
  const keys = [
    'samples', 'bothZeroCount', 'bothNonzeroEqualCount',
    'bothNonzeroDifferentCount', 'domNonzeroPlaywrightZeroCount',
    'domZeroPlaywrightNonzeroCount', 'rootUnavailableCount',
    'safeEvaluationErrorCount',
  ];
  return Object.fromEntries(keys.map((key) => [key, boundedInteger(value[key]) || 0]));
}

function sanitizeHashPrefix(value) {
  return typeof value === 'string' && /^[a-f0-9]{12,16}$/.test(value) ? value : null;
}

function sanitizeContentMismatchStage(value = {}) {
  return {
    expected: { length: boundedInteger(value.expected?.length) || 0, sha256Prefix: sanitizeHashPrefix(value.expected?.sha256Prefix) },
    actual: { length: boundedInteger(value.actual?.length) || 0, sha256Prefix: sanitizeHashPrefix(value.actual?.sha256Prefix) },
  };
}

function sanitizeContentMismatch(value = {}) {
  const count = (key) => boundedInteger(value[key]) || 0;
  const duration = Number(value.settleDurationMs);
  const stages = value.normalizationStages || {};
  return {
    expectedNormalizedLength: count('expectedNormalizedLength'),
    actualNormalizedLength: count('actualNormalizedLength'),
    expectedSha256Prefix: sanitizeHashPrefix(value.expectedSha256Prefix),
    actualSha256Prefix: sanitizeHashPrefix(value.actualSha256Prefix),
    expectedLineCount: count('expectedLineCount'),
    actualLineCount: count('actualLineCount'),
    expectedLeadingWhitespaceCount: count('expectedLeadingWhitespaceCount'),
    actualLeadingWhitespaceCount: count('actualLeadingWhitespaceCount'),
    expectedTrailingWhitespaceCount: count('expectedTrailingWhitespaceCount'),
    actualTrailingWhitespaceCount: count('actualTrailingWhitespaceCount'),
    expectedNewlineCount: count('expectedNewlineCount'),
    actualNewlineCount: count('actualNewlineCount'),
    lengthRelation: CONTENT_MISMATCH_LENGTH_RELATIONS.has(value.lengthRelation) ? value.lengthRelation : 'EXACT_LENGTH',
    insertionMethod: CONTENT_MISMATCH_INSERTION_METHODS.has(value.insertionMethod) ? value.insertionMethod : 'OTHER_FIXED_METHOD',
    reader: CONTENT_MISMATCH_READERS.has(value.reader) ? value.reader : 'CONTENTEDITABLE_VISUAL_TEXT',
    visualLineBreakCount: count('visualLineBreakCount'),
    verificationReadCount: Math.max(1, count('verificationReadCount')),
    verificationReadTiming: CONTENT_MISMATCH_READ_TIMINGS.has(value.verificationReadTiming) ? value.verificationReadTiming : 'FIRST_VERIFICATION_READ',
    matchedOnReadNumber: Number.isInteger(value.matchedOnReadNumber) && value.matchedOnReadNumber > 0 ? Math.min(MAX_COUNTER, value.matchedOnReadNumber) : null,
    settleDurationMs: Number.isFinite(duration) && duration >= 0 ? Math.min(5000, Math.trunc(duration)) : 0,
    finalLengthRelation: CONTENT_MISMATCH_LENGTH_RELATIONS.has(value.finalLengthRelation) ? value.finalLengthRelation : (CONTENT_MISMATCH_LENGTH_RELATIONS.has(value.lengthRelation) ? value.lengthRelation : 'EXACT_LENGTH'),
    normalizationStages: {
      raw: sanitizeContentMismatchStage(stages.raw),
      nfc: sanitizeContentMismatchStage(stages.nfc),
      crlfToLf: sanitizeContentMismatchStage(stages.crlfToLf),
      nbspToSpace: sanitizeContentMismatchStage(stages.nbspToSpace),
      final: sanitizeContentMismatchStage(stages.final),
    },
  };
}

function sanitizeMediaCandidate(value = {}) {
  const bool = (key) => value[key] === true;
  return {
    tagName: MEDIA_TAG_NAMES.has(value.tagName) ? value.tagName : 'OTHER',
    visible: bool('visible'), attached: bool('attached'),
    naturalWidth: MEDIA_DIMENSION_BUCKETS.has(value.naturalWidth) ? value.naturalWidth : 'UNKNOWN',
    naturalHeight: MEDIA_DIMENSION_BUCKETS.has(value.naturalHeight) ? value.naturalHeight : 'UNKNOWN',
    hasSrc: bool('hasSrc'), srcScheme: MEDIA_SRC_SCHEMES.has(value.srcScheme) ? value.srcScheme : 'NONE',
    hasAlt: bool('hasAlt'), hasAriaHidden: bool('hasAriaHidden'),
    role: MEDIA_ROLES.has(value.role) ? value.role : 'other',
    ancestorButton: bool('ancestorButton'), ancestorPresentation: bool('ancestorPresentation'),
    ancestorEditable: bool('ancestorEditable'), candidateDepth: boundedInteger(value.candidateDepth) || 0,
    mediaCategory: MEDIA_CATEGORIES.has(value.mediaCategory) ? value.mediaCategory : 'UNKNOWN_MEDIA_CANDIDATE',
  };
}

function sanitizeZeroMediaInspection(value = {}) {
  const count = (key) => boundedInteger(value[key]) || 0;
  return {
    rawMediaSelectorCount: count('rawMediaSelectorCount'),
    visibleMediaCandidateCount: count('visibleMediaCandidateCount'),
    possibleUploadAttachmentCount: count('possibleUploadAttachmentCount'),
    uiAvatarOrIconCount: count('uiAvatarOrIconCount'),
    decorativeCount: count('decorativeCount'),
    videoCandidateCount: count('videoCandidateCount'),
    unknownCount: count('unknownCount'),
    classifiedAttachmentCount: count('classifiedAttachmentCount'),
    ignoredDecorativeCount: count('ignoredDecorativeCount'),
    ignoredUiAvatarOrIconCount: count('ignoredUiAvatarOrIconCount'),
    countOperationSucceeded: value.countOperationSucceeded === true,
    inspectionResult: ZERO_MEDIA_INSPECTION_RESULTS.has(value.inspectionResult) ? value.inspectionResult : 'EVALUATION_FAILED',
    candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, MAX_EDITOR_SHAPE_CANDIDATES).map(sanitizeMediaCandidate) : [],
  };
}

function sanitizePublishControlCandidate(value = {}) {
  const bool = (key) => value[key] === true;
  return {
    tagName: PUBLISH_CONTROL_TAG_NAMES.has(value.tagName) ? value.tagName : 'OTHER',
    role: PUBLISH_CONTROL_ROLES.has(value.role) ? value.role : 'other',
    visible: bool('visible'), enabled: bool('enabled'), attached: bool('attached'),
    type: PUBLISH_CONTROL_TYPES.has(value.type) ? value.type : 'other',
    ancestorForm: bool('ancestorForm'), ariaDisabled: bool('ariaDisabled'),
    tabIndex: Math.max(-1, Math.min(1000, Number.isFinite(Number(value.tabIndex)) ? Math.trunc(Number(value.tabIndex)) : 0)),
    candidateDepth: boundedInteger(value.candidateDepth) || 0,
    textClassification: PUBLISH_CONTROL_TEXT_CLASSES.has(value.textClassification) ? value.textClassification : 'SAFE_TEXT_EVALUATION_ERROR',
    rejection: PUBLISH_CONTROL_REJECTIONS.has(value.rejection) ? value.rejection : 'OTHER_SAFE_REJECTION',
  };
}

function sanitizePublishControlDiscovery(value = {}) {
  const count = (key) => boundedInteger(value[key]) || 0;
  const keys = [
    'rawCandidateCount', 'visibleCandidateCount', 'enabledCandidateCount',
    'labelMatchedCount', 'acceptedCandidateCount', 'hiddenCount', 'disabledCount',
    'wrongRoleCount', 'wrongElementTypeCount', 'labelNotAllowedCount',
    'ambiguousCount', 'detachedCount', 'otherSafeRejectionCount',
  ];
  return {
    ...Object.fromEntries(keys.map((key) => [key, count(key)])),
    candidates: Array.isArray(value.candidates)
      ? value.candidates.slice(0, MAX_PUBLISH_CONTROL_CANDIDATES).map(sanitizePublishControlCandidate)
      : [],
  };
}

const POST_SUBMIT_COMPOSER_STATES = new Set([
  'ATTACHED_VISIBLE', 'ATTACHED_HIDDEN', 'DETACHED', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR',
]);
const POST_SUBMIT_ACKNOWLEDGEMENT_CLASSES = new Set([
  'NONE', 'MATCH_FOUND', 'CANDIDATES_PRESENT_NO_MATCH', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR',
]);
const POST_SUBMIT_PREDICATE_RESULTS = new Set([
  'PASSED', 'FAILED_TIMEOUT', 'FAILED_ERROR', 'NOT_COMPLETED',
]);
const POST_SUBMIT_SUCCESS_PREDICATES = new Set(['BOTH_PREDICATES_PASSED', 'NOT_SATISFIED']);
const POST_SUBMIT_FAILURE_PREDICATES = new Set([
  'NONE', 'COMPOSER_NOT_HIDDEN', 'ACKNOWLEDGEMENT_NOT_OBSERVED', 'BOTH_FAILED',
  'CLICK_FAILED', 'VERIFICATION_ERROR', 'OTHER_SAFE_FAILURE',
]);
const POST_SUBMIT_CLICK_ERRORS = new Set(['NONE', 'TIMEOUT', 'SAFE_CLICK_ERROR']);
const POST_SUBMIT_ELAPSED_BUCKETS = new Set([
  'UNDER_1_SECOND', 'UNDER_5_SECONDS', 'UNDER_30_SECONDS', 'UNDER_120_SECONDS', 'AT_OR_OVER_TIMEOUT', 'UNKNOWN',
]);
const boundedDuration = (value) => Math.max(0, Math.min(120000, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0));

function sanitizePostSubmitClick(value = {}) {
  return {
    clickReturned: value.clickReturned === true,
    elapsedMs: boundedDuration(value.elapsedMs),
    clickError: POST_SUBMIT_CLICK_ERRORS.has(value.clickError) ? value.clickError : 'SAFE_CLICK_ERROR',
  };
}

function sanitizePostSubmitVerification(value = {}) {
  const bool = (key) => value[key] === true;
  return {
    clickReturned: bool('clickReturned'),
    verificationStarted: bool('verificationStarted'),
    verificationElapsedMs: boundedDuration(value.verificationElapsedMs),
    verificationElapsedBucket: POST_SUBMIT_ELAPSED_BUCKETS.has(value.verificationElapsedBucket) ? value.verificationElapsedBucket : 'UNKNOWN',
    retainedComposerAttached: bool('retainedComposerAttached'),
    retainedComposerVisible: bool('retainedComposerVisible'),
    composerState: POST_SUBMIT_COMPOSER_STATES.has(value.composerState) ? value.composerState : 'SAFE_EVALUATION_ERROR',
    acknowledgementCandidateCount: boundedInteger(value.acknowledgementCandidateCount) || 0,
    acknowledgementClassification: POST_SUBMIT_ACKNOWLEDGEMENT_CLASSES.has(value.acknowledgementClassification) ? value.acknowledgementClassification : 'SAFE_EVALUATION_ERROR',
    canonicalTargetStillValid: bool('canonicalTargetStillValid'),
    composerHiddenPredicate: POST_SUBMIT_PREDICATE_RESULTS.has(value.composerHiddenPredicate) ? value.composerHiddenPredicate : 'NOT_COMPLETED',
    acknowledgementPredicate: POST_SUBMIT_PREDICATE_RESULTS.has(value.acknowledgementPredicate) ? value.acknowledgementPredicate : 'NOT_COMPLETED',
    successPredicate: POST_SUBMIT_SUCCESS_PREDICATES.has(value.successPredicate) ? value.successPredicate : 'NOT_SATISFIED',
    failurePredicate: POST_SUBMIT_FAILURE_PREDICATES.has(value.failurePredicate) ? value.failurePredicate : 'OTHER_SAFE_FAILURE',
  };
}

const ACK_FAMILIES = new Set(['CURRENT_TEXT_MATCH', 'ROLE_STATUS', 'ROLE_ALERT', 'ARIA_LIVE_REGION', 'OTHER_SAFE_ACK_SURFACE']);
const ACK_TAGS = new Set(['DIV', 'SPAN', 'P', 'SECTION', 'OTHER']);
const ACK_ROLES = new Set([null, 'status', 'alert', 'other']);
const ACK_ARIA_LIVE = new Set(['OFF', 'POLITE', 'ASSERTIVE', 'OTHER', 'NONE']);
const ACK_TEXT_CLASSES = new Set(['MATCHES_CURRENT_ACK_PATTERN', 'NON_MATCHING_TEXT_PRESENT', 'EMPTY_OR_UNAVAILABLE', 'SAFE_TEXT_EVALUATION_ERROR']);
const ACK_ACCESSIBILITY_CLASSES = new Set(['MATCHES_CURRENT_ACK_PATTERN', 'NON_MATCHING_ACCESSIBLE_NAME_PRESENT', 'EMPTY_OR_UNAVAILABLE', 'SAFE_ACCESSIBILITY_EVALUATION_ERROR']);
const ACK_BUCKETS = new Set(['UNDER_1_SECOND', 'UNDER_5_SECONDS', 'UNDER_30_SECONDS', 'UNDER_120_SECONDS', 'AT_OR_OVER_TIMEOUT']);
const ACK_MATCHER_RESULTS = new Set(['MATCHED', 'NO_MATCH', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR']);

function sanitizeAcknowledgementCandidate(value = {}) {
  return {
    candidateFamily: ACK_FAMILIES.has(value.candidateFamily) ? value.candidateFamily : 'OTHER_SAFE_ACK_SURFACE',
    tagName: ACK_TAGS.has(value.tagName) ? value.tagName : 'OTHER', role: ACK_ROLES.has(value.role) ? value.role : 'other',
    visible: value.visible === true, attached: value.attached === true,
    ariaLive: ACK_ARIA_LIVE.has(value.ariaLive) ? value.ariaLive : 'NONE',
    textClassification: ACK_TEXT_CLASSES.has(value.textClassification) ? value.textClassification : 'SAFE_TEXT_EVALUATION_ERROR',
    accessibilityClassification: ACK_ACCESSIBILITY_CLASSES.has(value.accessibilityClassification) ? value.accessibilityClassification : 'SAFE_ACCESSIBILITY_EVALUATION_ERROR',
    nestedTextPresent: value.nestedTextPresent === true, candidateDepth: boundedInteger(value.candidateDepth) || 0,
    firstObservedBucket: ACK_BUCKETS.has(value.firstObservedBucket) ? value.firstObservedBucket : 'UNDER_1_SECOND',
    lastObservedBucket: ACK_BUCKETS.has(value.lastObservedBucket) ? value.lastObservedBucket : 'UNDER_1_SECOND',
    observationCount: boundedInteger(value.observationCount) || 0,
  };
}

function sanitizeAcknowledgementShape(value = {}) {
  const keys = ['totalDistinctCandidatesObserved', 'currentPatternMatchObservationCount', 'accessibilityPatternMatchObservationCount', 'roleStatusObservationCount', 'roleAlertObservationCount', 'ariaLiveObservationCount', 'transientCandidateCount', 'candidatesVisibleAtVerificationStart', 'candidatesObservedAfterVerificationStart', 'structurallyAckLikeButPatternMismatchCount'];
  return { ...Object.fromEntries(keys.map((key) => [key, boundedInteger(value[key]) || 0])), currentMatcherWouldHaveMatched: value.currentMatcherWouldHaveMatched === true, exactCurrentMatcherResult: ACK_MATCHER_RESULTS.has(value.exactCurrentMatcherResult) ? value.exactCurrentMatcherResult : 'SAFE_EVALUATION_ERROR', candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 16).map(sanitizeAcknowledgementCandidate) : [] };
}

function readRecords(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed?.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function rotate(directory) {
  try {
    const files = fs.readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, stat: fs.statSync(path.join(directory, name)) }))
      .sort((left, right) => left.stat.mtimeMs - right.stat.mtimeMs);
    while (files.length >= MAX_TASK_FILES) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(directory, oldest.name));
    }
  } catch {
    // Diagnostics must never alter execution behavior if local logging fails.
  }
}

function removeOldestUnprotected(records) {
  const index = records.findIndex((record) => !PROTECTED_STAGES.has(record.stage));
  if (index < 0) return false;
  records.splice(index, 1);
  return true;
}

function createComposerAcquisitionDiagnosticSink(options = {}) {
  const directory = options.directory || path.join(logsPath, 'local-agent-composer-diagnostics');
  const now = options.now || (() => new Date().toISOString());
  const maxRecords = Math.max(4, Math.min(Number(options.maxRecords) || MAX_RECORDS_PER_TASK, MAX_RECORDS_PER_TASK));
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || MAX_FILE_BYTES, MAX_FILE_BYTES));

  function forTask(taskId) {
    const safeId = safeTaskId(taskId);
    const filePath = safeId ? path.join(directory, `${safeId}.json`) : null;

    function persist(stage, reasonClass, evidence = {}, summary = false, shape = null) {
      if (!safeId || !filePath || !STAGES.has(stage) || !REASON_CLASSES.has(reasonClass)) return;
      try {
        const { counters, flags } = sanitizeEvidence(evidence);
        const record = { timestamp: now(), task_id: safeId, stage, reason_class: reasonClass, counters, flags };
        if (shape?.contentMismatch === true) {
          record.contentMismatch = sanitizeContentMismatch(shape.value);
        } else if (shape?.zeroMediaInspection === true) {
          record.zeroMediaInspection = sanitizeZeroMediaInspection(shape.value);
        } else if (shape?.publishControlDiscovery === true) {
          record.publishControlDiscovery = sanitizePublishControlDiscovery(shape.value);
        } else if (shape?.postSubmitClick === true) {
          record.postSubmitClick = sanitizePostSubmitClick(shape.value);
        } else if (shape?.postSubmitVerification === true) {
          record.postSubmitVerification = sanitizePostSubmitVerification(shape.value);
        } else if (shape?.acknowledgementShape === true) {
          record.acknowledgementShape = sanitizeAcknowledgementShape(shape.value);
        } else if (shape?.selectorParity === true) {
          if (shape?.summary) record.selectorParitySummary = sanitizeSelectorParitySummary(shape.summary);
          else record.selectorParity = sanitizeSelectorParity(shape.value);
        } else if (shape?.preSelector === true) {
          if (shape?.candidates) record.preSelectorEditorShapeCandidates = shape.candidates.slice(0, MAX_EDITOR_SHAPE_CANDIDATES).map(sanitizeCandidate);
          if (shape?.summary) record.preSelectorEditorShapeSummary = sanitizePreSelectorShapeSummary(shape.summary);
        } else {
          if (shape?.candidates) record.editorShapeCandidates = shape.candidates.slice(0, MAX_EDITOR_SHAPE_CANDIDATES).map(sanitizeCandidate);
          if (shape?.summary) record.editorShapeSummary = sanitizeShapeSummary(shape.summary);
        }
        rotate(directory);
        const records = readRecords(filePath);
        const terminal = summary || TERMINAL_STAGES.has(stage) || stage === 'EDITOR_SHAPE_SNAPSHOT' || stage === 'EDITOR_SHAPE_DIAGNOSTIC_SUMMARY' || stage === PRE_SELECTOR_SNAPSHOT_STAGE || stage === PRE_SELECTOR_SUMMARY_STAGE || stage === SELECTOR_PARITY_SNAPSHOT_STAGE || stage === SELECTOR_PARITY_SUMMARY_STAGE || stage === CONTENT_MISMATCH_SUMMARY_STAGE || stage === ZERO_MEDIA_INSPECTION_SUMMARY_STAGE || stage === PUBLISH_CONTROL_DISCOVERY_SUMMARY_STAGE || stage === POST_SUBMIT_VERIFICATION_SUMMARY_STAGE;
        if (stage === 'EDITOR_SHAPE_SNAPSHOT' && records.filter((item) => item.stage === stage).length >= MAX_EDITOR_SHAPE_SNAPSHOTS) return;
        // One snapshot is sufficient to explain a selector miss. Keeping the
        // first bounded sample reserves space for its terminal summary.
        if (stage === PRE_SELECTOR_SNAPSHOT_STAGE && records.some((item) => item.stage === stage)) return;
        if (stage === SELECTOR_PARITY_SNAPSHOT_STAGE && records.some((item) => item.stage === stage)) return;
        if (stage === PUBLISH_CONTROL_DISCOVERY_SUMMARY_STAGE) {
          const previousPublishSummary = [...records].reverse().find((item) => item.stage === stage);
          if (previousPublishSummary
            && JSON.stringify(previousPublishSummary.publishControlDiscovery) === JSON.stringify(record.publishControlDiscovery)) return;
          if (records.filter((item) => item.stage === stage).length >= MAX_PUBLISH_CONTROL_SNAPSHOTS) return;
        }
        const previous = records[records.length - 1];
        // Repeated polling snapshots carry no additional safe diagnostic
        // meaning. Coalesce them so terminal evidence cannot be crowded out.
        if (!terminal && previous
          && previous.stage === stage
          && previous.reason_class === reasonClass
          && JSON.stringify(previous.counters) === JSON.stringify(counters)
          && JSON.stringify(previous.flags) === JSON.stringify(flags)) return;
        if (terminal) {
          while (records.length >= maxRecords && removeOldestUnprotected(records)) { /* retain protected diagnostic evidence */ }
          while (records.length && Buffer.byteLength(JSON.stringify({ version: 1, task_id: safeId, records: [...records, record] }), 'utf8') > maxBytes && removeOldestUnprotected(records)) { /* retain protected diagnostic evidence */ }
        }
        if (records.length < maxRecords) records.push(record);
        const value = { version: 1, task_id: safeId, records: records.slice(-maxRecords) };
        if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes) atomicWrite(filePath, value);
      } catch {
        // Local diagnostics are observability only and cannot block a safe
        // pre-marker failure path or a successful execution.
      }
    }

    return Object.freeze({
      emit: (stage, reasonClass, evidence) => persist(stage, reasonClass, evidence),
      summary: (stage, reasonClass, evidence) => persist(stage, reasonClass, evidence, true),
      shape: (candidates, summary) => persist('EDITOR_SHAPE_SNAPSHOT', 'EDITOR_SHAPE_SNAPSHOT', {}, false, { candidates, summary }),
      shapeSummary: (summary) => persist('EDITOR_SHAPE_DIAGNOSTIC_SUMMARY', 'EDITOR_SHAPE_SUMMARY', {}, true, { summary }),
      preSelectorShape: (candidates, summary) => persist(PRE_SELECTOR_SNAPSHOT_STAGE, 'PRE_SELECTOR_EDITOR_SHAPE_SNAPSHOT', {}, false, { candidates, summary, preSelector: true }),
      preSelectorShapeSummary: (summary) => persist(PRE_SELECTOR_SUMMARY_STAGE, 'PRE_SELECTOR_EDITOR_SHAPE_SUMMARY', {}, true, { summary, preSelector: true }),
      selectorParity: (value) => persist(SELECTOR_PARITY_SNAPSHOT_STAGE, 'EDITOR_SELECTOR_PARITY_SNAPSHOT', {}, false, { value, selectorParity: true }),
      selectorParitySummary: (summary) => persist(SELECTOR_PARITY_SUMMARY_STAGE, 'EDITOR_SELECTOR_PARITY_SUMMARY', {}, true, { summary, selectorParity: true }),
      contentMismatchSummary: (value) => persist(CONTENT_MISMATCH_SUMMARY_STAGE, 'CONTENT_MISMATCH', {}, true, { value, contentMismatch: true }),
      zeroMediaInspectionSummary: (value) => persist(ZERO_MEDIA_INSPECTION_SUMMARY_STAGE, 'ZERO_MEDIA_INSPECTION', {}, true, { value, zeroMediaInspection: true }),
      publishControlDiscoverySummary: (value) => persist(PUBLISH_CONTROL_DISCOVERY_SUMMARY_STAGE, 'PUBLISH_CONTROL_DISCOVERY', {}, true, { value, publishControlDiscovery: true }),
      postSubmitClickStarted: (value) => persist('POST_SUBMIT_CLICK_STARTED', 'POST_SUBMIT_CLICK_STARTED', {}, false, { value, postSubmitClick: true }),
      postSubmitClickReturned: (value) => persist('POST_SUBMIT_CLICK_RETURNED', 'POST_SUBMIT_CLICK_RETURNED', {}, false, { value, postSubmitClick: true }),
      postSubmitClickFailed: (value) => persist('POST_SUBMIT_CLICK_FAILED', 'POST_SUBMIT_CLICK_FAILED', {}, true, { value, postSubmitClick: true }),
      postSubmitVerificationStarted: (value) => persist('POST_SUBMIT_VERIFICATION_STARTED', 'POST_SUBMIT_VERIFICATION_STARTED', {}, false, { value, postSubmitVerification: true }),
      postSubmitVerificationSummary: (value) => persist(POST_SUBMIT_VERIFICATION_SUMMARY_STAGE, 'POST_SUBMIT_VERIFICATION', {}, true, { value, postSubmitVerification: true }),
      acknowledgementShapeSummary: (value) => persist('ACKNOWLEDGEMENT_SHAPE_DIAGNOSTIC_SUMMARY', 'ACKNOWLEDGEMENT_SHAPE', {}, true, { value, acknowledgementShape: true }),
    });
  }

  return Object.freeze({ forTask });
}

module.exports = {
  COUNTERS,
  FLAGS,
  MAX_FILE_BYTES,
  MAX_EDITOR_SHAPE_CANDIDATES,
  MAX_EDITOR_SHAPE_SNAPSHOTS,
  ELIGIBILITY_REJECTION_REASONS,
  MAX_RECORDS_PER_TASK,
  MAX_TASK_FILES,
  REASON_CLASSES,
  sanitizeCandidate,
  sanitizeShapeSummary,
  sanitizePreSelectorShapeSummary,
  sanitizeSelectorParity,
  sanitizeSelectorParitySummary,
  sanitizeContentMismatch,
  sanitizeMediaCandidate,
  sanitizeZeroMediaInspection,
  sanitizePublishControlCandidate,
  sanitizePublishControlDiscovery,
  sanitizePostSubmitClick,
  sanitizePostSubmitVerification,
  MAX_PUBLISH_CONTROL_CANDIDATES,
  MAX_PUBLISH_CONTROL_SNAPSHOTS,
  STAGES,
  createComposerAcquisitionDiagnosticSink,
};
