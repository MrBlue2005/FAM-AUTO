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
  'ACKNOWLEDGEMENT_SEMANTIC_DIAGNOSTIC_SUMMARY',
  'POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY',
  'POST_CANDIDATE_TEXT_PARITY_DIAGNOSTIC_SUMMARY',
  'POST_CANDIDATE_BODY_SUBTREE_DIAGNOSTIC_SUMMARY',
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
  'ACKNOWLEDGEMENT_SEMANTIC',
  'POST_PUBLICATION_STRUCTURAL',
  'POST_CANDIDATE_TEXT_PARITY',
  'POST_CANDIDATE_BODY_SUBTREE',
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
  SELECTOR_PARITY_SNAPSHOT_STAGE,
  SELECTOR_PARITY_SUMMARY_STAGE,
  CONTENT_MISMATCH_SUMMARY_STAGE,
  ZERO_MEDIA_INSPECTION_SUMMARY_STAGE,
  PUBLISH_CONTROL_DISCOVERY_SUMMARY_STAGE,
  POST_SUBMIT_VERIFICATION_SUMMARY_STAGE,
  'ACKNOWLEDGEMENT_SHAPE_DIAGNOSTIC_SUMMARY',
  'ACKNOWLEDGEMENT_SEMANTIC_DIAGNOSTIC_SUMMARY',
  'POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY',
  'POST_CANDIDATE_TEXT_PARITY_DIAGNOSTIC_SUMMARY',
  'POST_CANDIDATE_BODY_SUBTREE_DIAGNOSTIC_SUMMARY',
  'COMPOSER_ACQUISITION_FAILED',
]);
const CRITICAL_TERMINAL_STAGES = new Set([
  POST_SUBMIT_VERIFICATION_SUMMARY_STAGE,
  'POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY',
  'POST_CANDIDATE_TEXT_PARITY_DIAGNOSTIC_SUMMARY',
  'POST_CANDIDATE_BODY_SUBTREE_DIAGNOSTIC_SUMMARY',
]);
// These four summaries are the complete, deliberately fixed set required to
// diagnose the post-click result.  A priority alone cannot reserve room for a
// later member of this set: earlier critical records could otherwise consume
// the whole file.  Keep each record below a deterministic ceiling and reserve
// space for every member before accepting lower-priority evidence.
const REQUIRED_CRITICAL_TERMINAL_STAGES = new Set(CRITICAL_TERMINAL_STAGES);
const REQUIRED_CRITICAL_RECORD_MAX_BYTES = 7000;
const REQUIRED_CRITICAL_FILE_OVERHEAD_BYTES = 768;
const REQUIRED_CRITICAL_RESERVE_BYTES = (REQUIRED_CRITICAL_TERMINAL_STAGES.size * REQUIRED_CRITICAL_RECORD_MAX_BYTES) + REQUIRED_CRITICAL_FILE_OVERHEAD_BYTES;
const TERMINAL_DIAGNOSTIC_STAGES = new Set([
  'ACKNOWLEDGEMENT_SHAPE_DIAGNOSTIC_SUMMARY',
  'ACKNOWLEDGEMENT_SEMANTIC_DIAGNOSTIC_SUMMARY',
]);
const DIAGNOSTIC_PRIORITY = Object.freeze({ ORDINARY: 0, PROTECTED: 1, TERMINAL: 2, CRITICAL_TERMINAL: 3 });
const POST_CANDIDATE_TEXT_PARITY_STAGE = 'POST_CANDIDATE_TEXT_PARITY_DIAGNOSTIC_SUMMARY';
const POST_CANDIDATE_BODY_SUBTREE_STAGE = 'POST_CANDIDATE_BODY_SUBTREE_DIAGNOSTIC_SUMMARY';
const POST_CANDIDATE_READER_TYPES = new Set(['CURRENT_READER', 'TEXT_CONTENT', 'INNER_TEXT', 'VISUAL_TEXT', 'DESCENDANT_TEXT_BLOCKS']);
const POST_CANDIDATE_LENGTH_RELATIONS = new Set(['EMPTY', 'EXACT_LENGTH', 'SHORTER', 'LONGER']);
const POST_CANDIDATE_TEXT_SHAPES = new Set(['EXACT_POST_BODY_ONLY', 'POST_BODY_PLUS_HEADER', 'POST_BODY_PLUS_ACTIONS', 'POST_BODY_PLUS_HEADER_AND_ACTIONS', 'BODY_SUBSTRING_PRESENT', 'NO_BODY_MATCH', 'EMPTY_OR_UNAVAILABLE', 'AMBIGUOUS']);
const POST_CANDIDATE_PARITY_CLASSES = new Set(['EXACT_WHOLE_CANDIDATE_MATCH', 'EXACT_DESCENDANT_BODY_MATCH', 'IMMUTABLE_BODY_PRESENT_WITH_EXTRA_UI_TEXT', 'VISUAL_RECONSTRUCTION_REQUIRED', 'NO_IMMUTABLE_BODY_SIGNAL', 'SAFE_EVALUATION_ERROR']);
const BODY_ISOLATION_CLASSES = new Set(['EXACT_SINGLE_SUBTREE', 'EXACT_CONTIGUOUS_BLOCK_SEQUENCE', 'BODY_WITH_HEADER_OUTSIDE', 'BODY_WITH_ACTIONS_OUTSIDE', 'BODY_WITH_HEADER_AND_ACTIONS_OUTSIDE', 'BODY_PRESENT_BUT_NOT_ISOLATABLE', 'AMBIGUOUS', 'NO_BODY_SIGNAL', 'SAFE_EVALUATION_ERROR']);
const BODY_SUMMARY_CLASSES = new Set(['EXACT_SINGLE_SUBTREE', 'EXACT_CONTIGUOUS_BLOCK_SEQUENCE', 'IMMUTABLE_BODY_ISOLATED_FROM_EXTRA_UI', 'BODY_PRESENT_BUT_NOT_ISOLATABLE', 'NO_RELIABLE_BODY_SIGNAL', 'SAFE_EVALUATION_ERROR']);
const POST_CANDIDATE_CORRELATION = /^POST_CANDIDATE_[1-9]\d{0,2}$/;
const BODY_SUBTREE_TAGS = new Set(['DIV', 'SPAN', 'P', 'ARTICLE', 'SECTION', 'OTHER']);
const BODY_BLOCK_ROLES = new Set(['BODY_CANDIDATE', 'HEADER_OR_AUTHOR', 'TIMESTAMP', 'ACTION_OR_CONTROL', 'COMMENT_OR_REPLY', 'NESTED_ARTICLE', 'INTERACTIVE_WRAPPER', 'GENERIC_TEXT_WRAPPER', 'LEAF_TEXT', 'HIDDEN', 'DETACHED', 'UNKNOWN']);
const BODY_BLOCK_ELIGIBILITY = new Set(['ELIGIBLE_BODY_TEXT', 'REJECT_HEADER', 'REJECT_TIMESTAMP', 'REJECT_ACTION_CONTROL', 'REJECT_COMMENT_REPLY', 'REJECT_NESTED_ARTICLE', 'REJECT_INTERACTIVE', 'REJECT_HIDDEN', 'REJECT_DETACHED', 'REJECT_EMPTY', 'REJECT_AMBIGUOUS', 'SAFE_EVALUATION_ERROR']);
const BODY_COVERAGE = new Set(['NO_BODY_SIGNAL', 'PARTIAL_BODY_SIGNAL', 'WHOLE_BODY_PLUS_EXTRA', 'EXACT_BODY']);
const BODY_SEQUENCE_REJECTIONS = new Set(['NONE', 'INCLUDES_HEADER', 'INCLUDES_TIMESTAMP', 'INCLUDES_ACTION', 'INCLUDES_COMMENT_REPLY', 'INCLUDES_NESTED_ARTICLE', 'INCLUDES_INTERACTIVE', 'HIDDEN_OR_DETACHED', 'AMBIGUOUS', 'SAFE_EVALUATION_ERROR']);
const BODY_BLOCK_PATTERNS = new Set(['EXACT_LEAF_EXISTS', 'EXACT_WRAPPER_EXISTS', 'BODY_SPLIT_ACROSS_SIBLINGS', 'BODY_PLUS_HEADER_CONTAMINATION', 'BODY_PLUS_ACTION_CONTAMINATION', 'BODY_PLUS_HEADER_AND_ACTION_CONTAMINATION', 'BODY_INSIDE_INTERACTIVE_WRAPPER', 'BODY_INSIDE_GENERIC_WRAPPER', 'BODY_SIGNAL_AMBIGUOUS', 'NO_BODY_SIGNAL', 'SAFE_EVALUATION_ERROR']);
const BODY_ARTICLE_RELATIONS = new Set(['SELECTED_POST_ROOT', 'DESCENDANT_OF_SELECTED_POST', 'INDEPENDENT_NESTED_ARTICLE', 'COMMENT_REPLY_ARTICLE', 'UNKNOWN']);
const INTERACTIVE_BOUNDARY_CLASSES = new Set(['NO_INTERACTIVE_DESCENDANTS', 'BODY_REGION_SEPARATE_FROM_CONTROLS', 'BODY_REGION_MIXED_WITH_CONTROLS', 'BODY_TEXT_INSIDE_INTERACTIVE_NODE', 'BODY_TEXT_UNDER_INTERACTIVE_ANCESTOR', 'BODY_REGION_AMBIGUOUS', 'SAFE_EVALUATION_ERROR']);
const BODY_CONTROL_RELATIONS = new Set(['NO_CONTROLS', 'SIBLING_REGIONS', 'BODY_ANCESTOR_OF_CONTROLS', 'CONTROLS_ANCESTOR_OF_BODY', 'OVERLAPPING_STRUCTURE', 'UNKNOWN']);
const CONTROL_DEPTH_BUCKETS = new Set(['NONE', 'SAME_LEVEL', 'ONE_LEVEL_BELOW', 'TWO_PLUS_LEVELS_BELOW']);
const BOUNDARY_EVIDENCE = new Set(['EXACT_BODY_REGION_SEPARATE', 'WHOLE_BODY_PLUS_EXTRA_REGION_SEPARATE', 'BODY_SIGNAL_ONLY_IN_BROAD_WRAPPER', 'BODY_SIGNAL_INSIDE_INTERACTIVE_STRUCTURE', 'AMBIGUOUS', 'NONE']);
const INTERACTIVE_BOUNDARY_AMBIGUITY_REASONS = new Set(['MULTIPLE_BODY_SIGNAL_REGIONS', 'MULTIPLE_EXACT_REGION_CANDIDATES', 'BODY_AND_CONTROLS_OVERLAP', 'NO_ISOLATABLE_BODY_REGION', 'CONTROL_BOUNDARY_UNRESOLVED', 'WRAPPER_CHAIN_DUPLICATION', 'REGION_BUDGET_EXHAUSTED', 'STRUCTURAL_RELATION_UNKNOWN', 'SAFE_EVALUATION_ERROR', 'OTHER']);
const EXACT_REGION_ABSENCE_REASONS = new Set(['EXACT_REGION_PRESENT', 'NO_EXACT_DOM_BODY_REGION', 'EXACT_REGION_NOT_CAPTURED', 'EXACT_REGION_STRUCTURALLY_EXCLUDED', 'MULTIPLE_EXACT_REGION_CANDIDATES', 'REGION_BUDGET_EXHAUSTED', 'INSUFFICIENT_EVIDENCE', 'SAFE_EVALUATION_ERROR']);
const CONTROL_BRANCH_RELATIONS = new Set(['SAME_BRANCH_AS_BODY', 'SEPARATE_CHILD_BRANCH', 'MULTIPLE_CONTROL_BRANCHES', 'CONTROL_ANCESTOR_OF_BODY', 'BODY_ANCESTOR_OF_CONTROLS', 'UNKNOWN']);
const BOUNDARY_TRANSITIONS = new Set(['NONE', 'BODY_SIGNAL_BECOMES_EXACT', 'BODY_SIGNAL_BECOMES_NONINTERACTIVE', 'INTERACTIVE_DESCENDANTS_BEGIN', 'CONTROL_STRUCTURE_BEGINS', 'BODY_SIGNAL_LOST', 'AMBIGUITY_BEGINS', 'SAFE_EVALUATION_ERROR']);
const BODY_BRANCH_CLASSES = new Set(['BODY_ONLY_BRANCH', 'CONTROL_ONLY_BRANCH', 'BODY_AND_CONTROL_BRANCH', 'STRUCTURAL_UI_BRANCH', 'COMMENT_REPLY_BRANCH', 'NESTED_ARTICLE_BRANCH', 'UNKNOWN_BRANCH']);

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
  'PASSED', 'FAILED_TIMEOUT', 'FAILED_ERROR', 'NOT_COMPLETED', 'NOT_OBSERVED_BEFORE_RELOAD',
]);
const POST_SUBMIT_SUCCESS_PREDICATES = new Set(['BOTH_PREDICATES_PASSED', 'TARGET_RELOAD_PROOF_PASSED', 'NOT_SATISFIED']);
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

const ACK_SEMANTIC_CLASSES = new Set([
  'PUBLICATION_SUCCESS_LIKE', 'PUBLICATION_FAILURE_LIKE', 'GENERIC_SUCCESS_LIKE',
  'GENERIC_ERROR_LIKE', 'UNRELATED_NOTIFICATION_LIKE', 'EMPTY_OR_UNAVAILABLE',
  'AMBIGUOUS', 'SAFE_EVALUATION_ERROR',
]);
const ACK_SEMANTIC_LANGUAGES = new Set(['RO', 'EN', 'OTHER', 'UNKNOWN']);
const ACK_RELATIVE_BUCKETS = new Set(['UNDER_1S', 'UNDER_5S', 'UNDER_15S', 'UNDER_30S', 'OVER_30S']);
const ACK_SEMANTIC_FEATURES = [
  'hasPublicationConcept', 'hasSuccessConcept', 'hasFailureConcept',
  'hasPostObjectConcept', 'hasGroupConcept', 'hasRetryConcept', 'hasErrorConcept',
];

function sanitizeAcknowledgementSemanticCandidate(value = {}) {
  const bool = (key) => value[key] === true;
  return {
    candidateFamily: ACK_FAMILIES.has(value.candidateFamily) ? value.candidateFamily : 'OTHER_SAFE_ACK_SURFACE',
    role: ACK_ROLES.has(value.role) ? value.role : 'other',
    ariaLive: ACK_ARIA_LIVE.has(value.ariaLive) ? value.ariaLive : 'NONE',
    visible: bool('visible'), attached: bool('attached'),
    semanticClassification: ACK_SEMANTIC_CLASSES.has(value.semanticClassification) ? value.semanticClassification : 'SAFE_EVALUATION_ERROR',
    languageClassification: ACK_SEMANTIC_LANGUAGES.has(value.languageClassification) ? value.languageClassification : 'UNKNOWN',
    ...Object.fromEntries(ACK_SEMANTIC_FEATURES.map((key) => [key, bool(key)])),
    firstObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(value.firstObservedRelativeBucket) ? value.firstObservedRelativeBucket : 'UNDER_1S',
    lastObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(value.lastObservedRelativeBucket) ? value.lastObservedRelativeBucket : 'UNDER_1S',
    observationCount: boundedInteger(value.observationCount) || 0,
    transient: bool('transient'),
  };
}

function sanitizeAcknowledgementSemantic(value = {}) {
  const counts = [
    'totalSemanticCandidates', 'publicationSuccessLikeCount', 'publicationFailureLikeCount',
    'genericSuccessLikeCount', 'genericErrorLikeCount', 'unrelatedNotificationLikeCount',
    'ambiguousCount', 'roleAlertPublicationSuccessLikeCount',
    'roleStatusPublicationSuccessLikeCount', 'ariaLivePublicationSuccessLikeCount',
    'transientPublicationSuccessLikeCount',
  ];
  const flags = [
    ...ACK_SEMANTIC_FEATURES.map((key) => key.replace(/^has/, '').replace(/Concept$/, 'ConceptObserved').replace(/^([A-Z])/, (match) => match.toLowerCase())),
    'languageROObserved', 'languageENObserved', 'languageOtherObserved',
    'currentMatcherMatched', 'semanticPublicationSuccessObserved',
  ];
  return {
    ...Object.fromEntries(counts.map((key) => [key, boundedInteger(value[key]) || 0])),
    ...Object.fromEntries(flags.map((key) => [key, value[key] === true])),
    candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 16).map(sanitizeAcknowledgementSemanticCandidate) : [],
  };
}

const STRUCTURAL_ACCESSIBLE_SOURCES = new Set(['NONE', 'TEXT_CONTENT', 'ARIA_LABEL', 'ARIA_LABELLEDBY', 'DESCENDANT_TEXT', 'OTHER_ACCESSIBLE_SOURCE', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR']);
const STRUCTURAL_TEXT_SOURCES = new Set(['NONE', 'DIRECT_TEXT_NODE', 'DESCENDANT_TEXT', 'MIXED_TEXT_STRUCTURE', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR']);
const STRUCTURAL_CONTAINERS = new Set(['TOAST_LIKE', 'LIVE_REGION_LIKE', 'DIALOG_LIKE', 'BUTTON_LIKE', 'STATUS_CONTAINER_LIKE', 'ALERT_CONTAINER_LIKE', 'GENERIC_CONTAINER', 'UNKNOWN']);
const STRUCTURAL_ANCESTORS = new Set(['DIALOG', 'ALERT', 'STATUS', 'LIVE_REGION', 'FORM', 'NAVIGATION', 'MAIN', 'ARTICLE', 'BUTTON', 'GENERIC', 'NONE']);
const ARTICLE_FAMILIES = new Set(['ARTICLE_ROLE', 'FEED_ITEM_ROLE', 'POST_CONTAINER_LIKE', 'UNKNOWN_ARTICLE_LIKE']);
const STRUCTURAL_EVIDENCE_CLASSES = new Set(['NONE', 'COMPOSER_ONLY', 'NEW_ARTICLE_STRUCTURE_ONLY', 'IMMUTABLE_TEXT_POST_CANDIDATE', 'MULTIPLE_STRUCTURAL_SIGNALS', 'AMBIGUOUS', 'SAFE_EVALUATION_ERROR']);
const TARGET_RELOAD_RESULT_CLASSES = new Set(['VERIFIED_EXACT_TARGET_POST', 'NOT_FOUND', 'AMBIGUOUS', 'TARGET_MISMATCH', 'NAVIGATION_FAILED', 'STRUCTURE_UNTRUSTED', 'DUPLICATE_UNRESOLVED', 'SAFE_EVALUATION_ERROR']);
const TARGET_RELOAD_AMBIGUITY_REASONS = new Set(['NONE', 'MULTIPLE_EXACT_CANDIDATES', 'NO_TRUSTED_NEWNESS', 'NESTED_ARTICLE', 'SAFE_EVALUATION_ERROR']);
const BASELINE_RESULT_CLASSES = new Set(['BASELINE_ZERO_EXACT_POSTS', 'BASELINE_ONE_EXACT_POST', 'BASELINE_MULTIPLE_EXACT_POSTS', 'BASELINE_NO_CANDIDATES_OBSERVED', 'BASELINE_INCOMPLETE_DISCOVERY', 'BASELINE_UNTRUSTED_BODY_SIGNAL', 'BASELINE_TARGET_MISMATCH', 'BASELINE_UNAVAILABLE', 'BASELINE_SAFE_EVALUATION_ERROR']);
const NEWNESS_TRANSITION_CLASSES = new Set(['ZERO_TO_ONE', 'ZERO_TO_ZERO', 'ZERO_TO_MULTIPLE', 'NONZERO_BASELINE', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR']);
const BODY_EXTRACTION_RESULTS = new Set(['EXACT_BODY_DIRECT', 'EXACT_BODY_AFTER_STRUCTURAL_UI_EXCLUSION', 'EXACT_BODY_CONTIGUOUS_BLOCKS', 'BODY_SUBSTRING_ONLY', 'BODY_AMBIGUOUS', 'BODY_NOT_FOUND', 'SAFE_EVALUATION_ERROR']);
const BODY_DESCENT_RESULTS = new Set(['EXACT_SAFE_BODY_REGION', 'BODY_SIGNAL_LOST', 'BODY_SIGNAL_SPLIT_AMBIGUOUS', 'BODY_CONTROL_INSEPARABLE', 'COMMENT_REPLY_BOUNDARY', 'INDEPENDENT_ARTICLE_BOUNDARY', 'HIDDEN_OR_DETACHED_BOUNDARY', 'INTERACTIVE_ANCESTOR_BOUNDARY', 'DEPTH_LIMIT_REACHED', 'NODE_LIMIT_REACHED', 'SAFE_EVALUATION_ERROR']);
const BODY_DESCENT_ADMISSION_SOURCES = new Set(['NONE', 'ROOT_SIGNAL', 'DESCENDANT_SIGNAL', 'ROOT_AND_DESCENDANT_SIGNAL']);
const CAPTURE_STAGE_RESULTS = new Set(['ROOT_SELECTOR_ZERO', 'ROOT_SELECTOR_CAP_REACHED', 'NO_ELIGIBLE_ROOTS', 'ELIGIBLE_ROOT_NO_ROOT_SIGNAL', 'ROOT_SIGNAL_FOUND', 'RAW_DESCENDANT_SIGNAL_FOUND', 'DESCENDANT_SIGNAL_ONLY_AFTER_24', 'DESCENDANT_SIGNAL_REDUCED_OUT', 'ROOT_REPRESENTATION_MISMATCH', 'NO_SIGNAL_IN_SELECTED_ROOT', 'CAPTURE_EVALUATION_ERROR', 'UNKNOWN']);
const ROOT_READER_PARITY_CLASSES = new Set(['BOTH_SIGNAL', 'INNER_ONLY_SIGNAL', 'TEXTCONTENT_ONLY_SIGNAL', 'NO_SIGNAL_SAME_LENGTH', 'NO_SIGNAL_DIFFERENT_LENGTH', 'SAFE_EVALUATION_ERROR']);

function sanitizeCaptureCandidate(value = {}) {
  const count = (key, max = 10000) => Math.min(max, boundedInteger(value[key]) || 0);
  return {
    candidateIndex: count('candidateIndex', 16), preCapOrdinal: count('preCapOrdinal', 16),
    tagFamily: ['ARTICLE', 'DIV', 'SECTION', 'OTHER'].includes(value.tagFamily) ? value.tagFamily : 'OTHER', roleFamily: ['ARTICLE', 'NONE', 'OTHER'].includes(value.roleFamily) ? value.roleFamily : 'OTHER',
    visible: value.visible === true, attached: value.attached === true, nestedArticle: value.nestedArticle === true, commentReply: value.commentReply === true, composerLike: value.composerLike === true, dialogLike: value.dialogLike === true,
    rootInnerTextContainsImmutable: value.rootInnerTextContainsImmutable === true, rootTextContentContainsImmutable: value.rootTextContentContainsImmutable === true, rootVisualTextContainsImmutable: value.rootVisualTextContainsImmutable === true, rootAnyReaderContainsImmutable: value.rootAnyReaderContainsImmutable === true,
    rootNormalizedLength: count('rootNormalizedLength', 1000000), rootLineCount: count('rootLineCount'), rootNewlineCount: count('rootNewlineCount'), representationLengthsDiffer: value.representationLengthsDiffer === true, normalizedLengthsDiffer: value.normalizedLengthsDiffer === true,
    rootReaderParityClass: ROOT_READER_PARITY_CLASSES.has(value.rootReaderParityClass) ? value.rootReaderParityClass : 'SAFE_EVALUATION_ERROR',
    rawDescendantSelectorMatchCount: count('rawDescendantSelectorMatchCount'), rawDescendantCap: 64, rawDescendantCapReached: value.rawDescendantCapReached === true,
    rawVisibleCount: count('rawVisibleCount', 64), rawAttachedCount: count('rawAttachedCount', 64), rawHiddenCount: count('rawHiddenCount', 64), rawDetachedCount: count('rawDetachedCount', 64),
    firstBodySignalRawOrdinal: value.firstBodySignalRawOrdinal == null ? null : count('firstBodySignalRawOrdinal', 64), bodySignalRawCount: count('bodySignalRawCount', 64), bodySignalInWindow1To24: value.bodySignalInWindow1To24 === true, bodySignalInWindow25To64: value.bodySignalInWindow25To64 === true,
    bodySignalBeyond64Known: value.bodySignalBeyond64Known === true, bodySignalBeyond64: value.bodySignalBeyond64Known === true ? value.bodySignalBeyond64 === true : 'UNKNOWN',
    reducedBlockCount: count('reducedBlockCount', 24), reducedBlockCap: 24, reducedBlockCapReached: value.reducedBlockCapReached === true,
    firstBodySignalReducedOrdinal: value.firstBodySignalReducedOrdinal == null ? null : count('firstBodySignalReducedOrdinal', 24), reducedBodySignalCount: count('reducedBodySignalCount', 24), parentLinksPreservedCount: count('parentLinksPreservedCount', 24), parentLinksMissingBecauseParentOutsideReducedSet: count('parentLinksMissingBecauseParentOutsideReducedSet', 24),
    containsZeroWidthChar: value.containsZeroWidthChar === true, containsBidiControl: value.containsBidiControl === true, containsSoftHyphen: value.containsSoftHyphen === true, containsNBSP: value.containsNBSP === true, containsCRLFNormalization: value.containsCRLFNormalization === true,
    captureStageResult: CAPTURE_STAGE_RESULTS.has(value.captureStageResult) ? value.captureStageResult : 'UNKNOWN',
  };
}

function sanitizeCaptureDiagnostics(value = {}) {
  const count = (key) => boundedInteger(value[key]) || 0;
  return {
    rootSelectorMatchCount: count('rootSelectorMatchCount'), rootSelectorCap: 16, rootSelectorCapReached: value.rootSelectorCapReached === true,
    rootCountBeforeEligibility: Math.min(16, count('rootCountBeforeEligibility')), rootCountAfterComposerExclusion: Math.min(16, count('rootCountAfterComposerExclusion')),
    rootCountAfterCommentReplyExclusion: Math.min(16, count('rootCountAfterCommentReplyExclusion')), rootCountAfterDialogExclusion: Math.min(16, count('rootCountAfterDialogExclusion')), rootCountAfterAllEligibilityFiltering: Math.min(16, count('rootCountAfterAllEligibilityFiltering')),
    captureStageResult: CAPTURE_STAGE_RESULTS.has(value.captureStageResult) ? value.captureStageResult : 'UNKNOWN', candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 16).map(sanitizeCaptureCandidate) : [],
  };
}

function sanitizeBodyDescent(value = {}, prefix = '') {
  const key = (name) => `${prefix}${name}`;
  return {
    [key('bodyDescentAdmissionSource')]: BODY_DESCENT_ADMISSION_SOURCES.has(value[key('bodyDescentAdmissionSource')]) ? value[key('bodyDescentAdmissionSource')] : 'NONE',
    [key('candidateRootBodySignal')]: value[key('candidateRootBodySignal')] === true,
    [key('candidateDescendantBodySignal')]: value[key('candidateDescendantBodySignal')] === true,
    [key('bodyDescentAttempted')]: value[key('bodyDescentAttempted')] === true,
    [key('bodyDescentResult')]: BODY_DESCENT_RESULTS.has(value[key('bodyDescentResult')]) ? value[key('bodyDescentResult')] : 'SAFE_EVALUATION_ERROR',
    [key('bodyDescentDepth')]: Math.min(24, boundedInteger(value[key('bodyDescentDepth')]) || 0),
    [key('bodyDescentNodesInspected')]: Math.min(128, boundedInteger(value[key('bodyDescentNodesInspected')]) || 0),
    [key('bodyDescentUniqueBranchSteps')]: Math.min(24, boundedInteger(value[key('bodyDescentUniqueBranchSteps')]) || 0),
    [key('bodyDescentControlOnlyBranchesIgnored')]: Math.min(24, boundedInteger(value[key('bodyDescentControlOnlyBranchesIgnored')]) || 0),
    [key('bodyDescentBodySignalSplits')]: Math.min(24, boundedInteger(value[key('bodyDescentBodySignalSplits')]) || 0),
  };
}

function sanitizeTargetReloadVerification(value = {}) {
  const count = (key) => boundedInteger(value[key]) || 0;
  return {
    navigationAttempted: value.navigationAttempted === true, navigationCount: Math.min(1, count('navigationCount')),
    canonicalTargetBeforeNavigation: value.canonicalTargetBeforeNavigation === true, canonicalTargetAfterNavigation: value.canonicalTargetAfterNavigation === true, navigationSucceeded: value.navigationSucceeded === true,
    candidateCount: Math.min(16, count('candidateCount')), visibleAttachedCandidateCount: Math.min(16, count('visibleAttachedCandidateCount')),
    exactBodyCandidateCount: Math.min(16, count('exactBodyCandidateCount')), structurallyTrustedExactCandidateCount: Math.min(16, count('structurallyTrustedExactCandidateCount')), duplicateExactCandidateCount: Math.min(16, count('duplicateExactCandidateCount')),
    bodyExtractionAttempted: value.bodyExtractionAttempted === true, bodyExtractionResult: BODY_EXTRACTION_RESULTS.has(value.bodyExtractionResult) ? value.bodyExtractionResult : 'SAFE_EVALUATION_ERROR', bodyExactAfterUiExclusionCount: Math.min(16, count('bodyExactAfterUiExclusionCount')), bodyExactContiguousBlockCount: Math.min(16, count('bodyExactContiguousBlockCount')),
    resultClass: TARGET_RELOAD_RESULT_CLASSES.has(value.resultClass) ? value.resultClass : 'SAFE_EVALUATION_ERROR', ambiguityReason: TARGET_RELOAD_AMBIGUITY_REASONS.has(value.ambiguityReason) ? value.ambiguityReason : 'SAFE_EVALUATION_ERROR', verificationElapsedMs: boundedDuration(value.verificationElapsedMs),
    baselineAttempted: value.baselineAttempted === true, baselineCanonicalTargetValid: value.baselineCanonicalTargetValid === true,
    baselineCandidateCount: Math.min(16, count('baselineCandidateCount')), baselineExactTrustedPostCount: Math.min(16, count('baselineExactTrustedPostCount')), baselineTrustedExactPostCount: Math.min(16, count('baselineTrustedExactPostCount')),
    baselineDiscoveryComplete: value.baselineDiscoveryComplete === true, baselineCandidateCapReached: value.baselineCandidateCapReached === true,
    discoveryComplete: value.discoveryComplete === true, candidateCapReached: value.candidateCapReached === true,
    baselineVisibleAttachedCandidateCount: Math.min(16, count('baselineVisibleAttachedCandidateCount')),
    baselineImmutableBodySignalCandidateCount: Math.min(16, count('baselineImmutableBodySignalCandidateCount')),
    baselineUntrustedBodySignalCount: Math.min(16, count('baselineUntrustedBodySignalCount')),
    baselineCandidateEvaluationErrorCount: Math.min(16, count('baselineCandidateEvaluationErrorCount')),
    baselineResultClass: BASELINE_RESULT_CLASSES.has(value.baselineResultClass) ? value.baselineResultClass : 'BASELINE_SAFE_EVALUATION_ERROR',
    composerExcludedFromBaseline: value.composerExcludedFromBaseline === true, commentsExcludedFromBaseline: value.commentsExcludedFromBaseline === true,
    ...(value.captureDiagnostics && typeof value.captureDiagnostics === 'object' ? { captureDiagnostics: sanitizeCaptureDiagnostics(value.captureDiagnostics) } : {}),
    ...(value.baselineCaptureDiagnostics && typeof value.baselineCaptureDiagnostics === 'object' ? { baselineCaptureDiagnostics: sanitizeCaptureDiagnostics(value.baselineCaptureDiagnostics) } : {}),
    ...sanitizeBodyDescent(value), ...sanitizeBodyDescent(value, 'baseline'),
    trustedNewnessEstablished: value.trustedNewnessEstablished === true,
    postReloadExactTrustedPostCount: Math.min(16, count('postReloadExactTrustedPostCount')),
    newnessTransitionClass: NEWNESS_TRANSITION_CLASSES.has(value.newnessTransitionClass) ? value.newnessTransitionClass : 'SAFE_EVALUATION_ERROR',
  };
}
const PAGE_COMPOSER_STATES = new Set(['ATTACHED_VISIBLE', 'ATTACHED_HIDDEN', 'DETACHED', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR']);
const BUCKETS = new Set(['ZERO', 'ONE', 'MULTIPLE', 'UNKNOWN']);

function sanitizePostPublicationStructuralCandidate(value = {}) {
  return {
    candidateFamily: ACK_FAMILIES.has(value.candidateFamily) ? value.candidateFamily : 'OTHER_SAFE_ACK_SURFACE',
    role: ACK_ROLES.has(value.role) ? value.role : 'other', ariaLive: ACK_ARIA_LIVE.has(value.ariaLive) ? value.ariaLive : 'NONE',
    visible: value.visible === true, attached: value.attached === true,
    accessibleNameSource: STRUCTURAL_ACCESSIBLE_SOURCES.has(value.accessibleNameSource) ? value.accessibleNameSource : 'SAFE_EVALUATION_ERROR',
    textSource: STRUCTURAL_TEXT_SOURCES.has(value.textSource) ? value.textSource : 'SAFE_EVALUATION_ERROR',
    semanticContainer: STRUCTURAL_CONTAINERS.has(value.semanticContainer) ? value.semanticContainer : 'UNKNOWN',
    interactiveAncestor: value.interactiveAncestor === true, dialogAncestor: value.dialogAncestor === true,
    formAncestor: value.formAncestor === true, liveRegionAncestor: value.liveRegionAncestor === true,
    candidateDepth: boundedInteger(value.candidateDepth) || 0,
    nearestSemanticAncestor: STRUCTURAL_ANCESTORS.has(value.nearestSemanticAncestor) ? value.nearestSemanticAncestor : 'NONE',
    ancestorRoleCount: boundedInteger(value.ancestorRoleCount) || 0, ancestorLiveRegionCount: boundedInteger(value.ancestorLiveRegionCount) || 0,
    interactiveAncestorCount: boundedInteger(value.interactiveAncestorCount) || 0,
  };
}

function sanitizePostPublicationStructural(value = {}) {
  const bool = (key) => value[key] === true;
  const counts = ['ackSurfaceCount', 'toastLikeCount', 'liveRegionLikeCount', 'statusContainerLikeCount', 'alertContainerLikeCount', 'accessibleNameFromTextCount', 'accessibleNameFromAriaCount', 'accessibleNameUnavailableCount', 'articleLikeCandidateCount', 'visibleArticleLikeCandidateCount', 'immutableTextExactMatchCandidateCount'];
  const state = value.pageState || {};
  return {
    ...Object.fromEntries(counts.map((key) => [key, boundedInteger(value[key]) || 0])),
    composerHiddenObserved: bool('composerHiddenObserved'), publishControlGoneObserved: bool('publishControlGoneObserved'), canonicalTargetStillValid: bool('canonicalTargetStillValid'),
    newArticleLikeCandidateObservedAfterClick: bool('newArticleLikeCandidateObservedAfterClick'), exactImmutableTextCandidateObservedAfterClick: bool('exactImmutableTextCandidateObservedAfterClick'),
    structuralSuccessEvidenceClass: STRUCTURAL_EVIDENCE_CLASSES.has(value.structuralSuccessEvidenceClass) ? value.structuralSuccessEvidenceClass : 'SAFE_EVALUATION_ERROR',
    pageState: { retainedComposerAttached: state.retainedComposerAttached === true, retainedComposerVisible: state.retainedComposerVisible === true, composerState: PAGE_COMPOSER_STATES.has(state.composerState) ? state.composerState : 'SAFE_EVALUATION_ERROR', publishControlPresent: state.publishControlPresent === true, publishControlVisible: state.publishControlVisible === true, targetCanonicalValid: state.targetCanonicalValid === true, dialogCountBucket: BUCKETS.has(state.dialogCountBucket) ? state.dialogCountBucket : 'UNKNOWN', visibleDialogCountBucket: BUCKETS.has(state.visibleDialogCountBucket) ? state.visibleDialogCountBucket : 'UNKNOWN' },
    acknowledgementCandidates: Array.isArray(value.acknowledgementCandidates) ? value.acknowledgementCandidates.slice(0, 16).map(sanitizePostPublicationStructuralCandidate) : [],
    articleCandidates: Array.isArray(value.articleCandidates) ? value.articleCandidates.slice(0, 16).map((candidate) => ({ candidateCorrelationId: POST_CANDIDATE_CORRELATION.test(candidate.candidateCorrelationId) ? candidate.candidateCorrelationId : undefined, candidateFamily: ARTICLE_FAMILIES.has(candidate.candidateFamily) ? candidate.candidateFamily : 'UNKNOWN_ARTICLE_LIKE', visible: candidate.visible === true, attached: candidate.attached === true, containsTextSurface: candidate.containsTextSurface === true, containsMediaSurface: candidate.containsMediaSurface === true, containsTimestampLikeSurface: candidate.containsTimestampLikeSurface === true, containsActionBarLikeSurface: candidate.containsActionBarLikeSurface === true, immutableTextExactMatch: candidate.immutableTextExactMatch === true, firstObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(candidate.firstObservedRelativeBucket) ? candidate.firstObservedRelativeBucket : 'UNDER_1S', lastObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(candidate.lastObservedRelativeBucket) ? candidate.lastObservedRelativeBucket : 'UNDER_1S', observationCount: boundedInteger(candidate.observationCount) || 0, transient: candidate.transient === true })) : [],
    targetReloadVerification: sanitizeTargetReloadVerification(value.targetReloadVerification),
  };
}

function sanitizePostCandidateTextView(value = {}) {
  return {
    readerType: POST_CANDIDATE_READER_TYPES.has(value.readerType) ? value.readerType : 'CURRENT_READER',
    readSucceeded: value.readSucceeded === true,
    normalizedLength: boundedInteger(value.normalizedLength) || 0,
    lineCount: boundedInteger(value.lineCount) || 0,
    newlineCount: boundedInteger(value.newlineCount) || 0,
    exactImmutableMatch: value.exactImmutableMatch === true,
    containsImmutableText: value.containsImmutableText === true,
    immutableTextPrefixMatch: value.immutableTextPrefixMatch === true,
    immutableTextSuffixMatch: value.immutableTextSuffixMatch === true,
    lengthRelation: POST_CANDIDATE_LENGTH_RELATIONS.has(value.lengthRelation) ? value.lengthRelation : 'EMPTY',
  };
}

function sanitizePostCandidateTextParityCandidate(value = {}) {
  return {
    candidateCorrelationId: POST_CANDIDATE_CORRELATION.test(value.candidateCorrelationId) ? value.candidateCorrelationId : undefined,
    candidateFamily: ARTICLE_FAMILIES.has(value.candidateFamily) ? value.candidateFamily : 'UNKNOWN_ARTICLE_LIKE',
    visible: value.visible === true, attached: value.attached === true,
    hasExtraTextBeforeImmutable: value.hasExtraTextBeforeImmutable === true,
    hasExtraTextAfterImmutable: value.hasExtraTextAfterImmutable === true,
    hasActionControlTextSurface: value.hasActionControlTextSurface === true,
    hasTimestampTextSurface: value.hasTimestampTextSurface === true,
    hasAuthorHeaderTextSurface: value.hasAuthorHeaderTextSurface === true,
    hasNestedArticleTextSurface: value.hasNestedArticleTextSurface === true,
    candidateTextShape: POST_CANDIDATE_TEXT_SHAPES.has(value.candidateTextShape) ? value.candidateTextShape : 'AMBIGUOUS',
    exactImmutableDescendantMatch: value.exactImmutableDescendantMatch === true,
    exactImmutableDescendantMatchCount: boundedInteger(value.exactImmutableDescendantMatchCount) || 0,
    matchedDescendantVisible: value.matchedDescendantVisible === true,
    matchedDescendantAttached: value.matchedDescendantAttached === true,
    exactTextViewMatchObserved: value.exactTextViewMatchObserved === true,
    exactDescendantMatchObserved: value.exactDescendantMatchObserved === true,
    firstObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(value.firstObservedRelativeBucket) ? value.firstObservedRelativeBucket : 'UNDER_1S',
    lastObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(value.lastObservedRelativeBucket) ? value.lastObservedRelativeBucket : 'UNDER_1S',
    observationCount: boundedInteger(value.observationCount) || 0,
    wasPresentBeforeClickObservation: value.wasPresentBeforeClickObservation === true,
    firstObservedAfterClick: value.firstObservedAfterClick === true,
    remainedVisibleThroughObservation: value.remainedVisibleThroughObservation === true,
    remainedAttachedThroughObservation: value.remainedAttachedThroughObservation === true,
    views: Array.isArray(value.views) ? value.views.slice(0, 5).map(sanitizePostCandidateTextView) : [],
  };
}

function sanitizePostCandidateTextParity(value = {}) {
  const counts = ['candidateCountInspected', 'currentReaderExactMatchCount', 'textContentExactMatchCount', 'innerTextExactMatchCount', 'visualTextExactMatchCount', 'descendantBlockExactMatchCount', 'bodySubstringCandidateCount', 'exactImmutableDescendantCandidateCount', 'postBodyPlusHeaderCount', 'postBodyPlusActionsCount', 'postBodyPlusHeaderAndActionsCount', 'noBodyMatchCount', 'ambiguousCount'];
  return {
    ...Object.fromEntries(counts.map((key) => [key, boundedInteger(value[key]) || 0])),
    bestSupportedTextParityClass: POST_CANDIDATE_PARITY_CLASSES.has(value.bestSupportedTextParityClass) ? value.bestSupportedTextParityClass : 'SAFE_EVALUATION_ERROR',
    candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 16).map(sanitizePostCandidateTextParityCandidate) : [],
  };
}

function sanitizePostCandidateBodySubtree(value = {}) {
  return {
    candidateCorrelationId: POST_CANDIDATE_CORRELATION.test(value.candidateCorrelationId) ? value.candidateCorrelationId : undefined,
    subtreeIndex: boundedInteger(value.subtreeIndex) || 0,
    depthRelativeToCandidate: Math.min(24, boundedInteger(value.depthRelativeToCandidate) || 0),
    tagFamily: BODY_SUBTREE_TAGS.has(value.tagFamily) ? value.tagFamily : 'OTHER',
    visible: value.visible === true, attached: value.attached === true,
    hasDirectTextNode: value.hasDirectTextNode === true, hasDescendantText: value.hasDescendantText === true,
    hasInteractiveDescendant: value.hasInteractiveDescendant === true, hasArticleDescendant: value.hasArticleDescendant === true,
    blockIndex: Math.min(24, boundedInteger(value.blockIndex) || 0),
    parentBlockIndex: value.parentBlockIndex === null ? null : Math.min(24, boundedInteger(value.parentBlockIndex) || 0),
    childBlockIndices: Array.isArray(value.childBlockIndices) ? value.childBlockIndices.slice(0, 12).map((item) => Math.min(24, boundedInteger(item) || 0)).filter(Boolean) : [],
    interactive: value.interactive === true, interactiveAncestor: value.interactiveAncestor === true,
    nestedArticle: value.nestedArticle === true, commentReplyAncestor: value.commentReplyAncestor === true,
    headerLikeAncestor: value.headerLikeAncestor === true, timestampLikeAncestor: value.timestampLikeAncestor === true, actionLikeAncestor: value.actionLikeAncestor === true,
    childTextBlockCount: Math.min(24, boundedInteger(value.childTextBlockCount) || 0), interactiveDescendantCount: Math.min(24, boundedInteger(value.interactiveDescendantCount) || 0),
    blockRole: BODY_BLOCK_ROLES.has(value.blockRole) ? value.blockRole : 'UNKNOWN', eligibility: BODY_BLOCK_ELIGIBILITY.has(value.eligibility) ? value.eligibility : 'SAFE_EVALUATION_ERROR', coverage: BODY_COVERAGE.has(value.coverage) ? value.coverage : 'NO_BODY_SIGNAL',
    nestedArticleDirect: value.nestedArticleDirect === true, nestedArticleInherited: value.nestedArticleInherited === true,
    hiddenDirect: value.hiddenDirect === true, hiddenInherited: value.hiddenInherited === true,
    articleRelation: BODY_ARTICLE_RELATIONS.has(value.articleRelation) ? value.articleRelation : 'UNKNOWN',
    ...sanitizePostCandidateTextView(value),
  };
}

function sanitizePostCandidateBodySequence(value = {}) {
  return {
    sequenceStartBlockIndex: Math.min(24, boundedInteger(value.sequenceStartBlockIndex) || 0), sequenceBlockCount: Math.min(8, boundedInteger(value.sequenceBlockCount) || 0),
    allVisible: value.allVisible === true, allAttached: value.allAttached === true,
    sequenceExactImmutableMatch: value.sequenceExactImmutableMatch === true, sequenceContainsImmutableText: value.sequenceContainsImmutableText === true,
    rejectionReason: BODY_SEQUENCE_REJECTIONS.has(value.rejectionReason) ? value.rejectionReason : 'SAFE_EVALUATION_ERROR',
    containsNestedArticleBlock: value.containsNestedArticleBlock === true, containsHiddenBlock: value.containsHiddenBlock === true,
    firstRejectedBlockIndex: value.firstRejectedBlockIndex === null ? null : Math.min(24, boundedInteger(value.firstRejectedBlockIndex) || 0),
    firstRejectionReason: BODY_SEQUENCE_REJECTIONS.has(value.firstRejectionReason) ? value.firstRejectionReason : 'NONE',
  };
}

function sanitizePostCandidateBodySubtreeCandidate(value = {}) {
  const candidate = value.candidate || {};
  return {
    candidateCorrelationId: POST_CANDIDATE_CORRELATION.test(value.candidateCorrelationId) ? value.candidateCorrelationId : undefined,
    candidateFamily: ARTICLE_FAMILIES.has(candidate.candidateFamily) ? candidate.candidateFamily : 'UNKNOWN_ARTICLE_LIKE',
    visible: candidate.visible === true, attached: candidate.attached === true,
    bodyIsolationClass: BODY_ISOLATION_CLASSES.has(value.bodyIsolationClass) ? value.bodyIsolationClass : 'SAFE_EVALUATION_ERROR',
    minimalExactBodySubtreeFound: value.minimalExactBodySubtreeFound === true,
    minimalExactBodySubtreeCount: boundedInteger(value.minimalExactBodySubtreeCount) || 0,
    minimalMatchVisible: value.minimalMatchVisible === true, minimalMatchAttached: value.minimalMatchAttached === true,
    minimalMatchDepth: Math.min(24, boundedInteger(value.minimalMatchDepth) || 0),
    minimalMatchHasInteractiveDescendant: value.minimalMatchHasInteractiveDescendant === true,
    minimalMatchHasArticleDescendant: value.minimalMatchHasArticleDescendant === true,
    exactContiguousBlockSequenceFound: value.exactContiguousBlockSequenceFound === true,
    exactContiguousBlockSequenceCount: boundedInteger(value.exactContiguousBlockSequenceCount) || 0,
    blockCountInBestMatch: Math.min(24, boundedInteger(value.blockCountInBestMatch) || 0),
    bestSequenceVisible: value.bestSequenceVisible === true, bestSequenceAttached: value.bestSequenceAttached === true,
    extraTextBeforeBody: value.extraTextBeforeBody === true, extraTextAfterBody: value.extraTextAfterBody === true,
    headerOutsideBody: value.headerOutsideBody === true, actionsOutsideBody: value.actionsOutsideBody === true,
    timestampOutsideBody: value.timestampOutsideBody === true,
    interactiveBoundary: sanitizeInteractiveBoundary(value.interactiveBoundary),
    firstObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(value.firstObservedRelativeBucket) ? value.firstObservedRelativeBucket : 'UNDER_1S',
    lastObservedRelativeBucket: ACK_RELATIVE_BUCKETS.has(value.lastObservedRelativeBucket) ? value.lastObservedRelativeBucket : 'UNDER_1S',
    observationCount: boundedInteger(value.observationCount) || 0,
    wasPresentBeforeClickObservation: value.wasPresentBeforeClickObservation === true,
    firstObservedAfterClick: value.firstObservedAfterClick === true,
    remainedVisibleThroughObservation: value.remainedVisibleThroughObservation === true,
    remainedAttachedThroughObservation: value.remainedAttachedThroughObservation === true,
    subtrees: Array.isArray(value.subtrees) ? value.subtrees.slice(0, 24).map(sanitizePostCandidateBodySubtree) : [],
    contiguousSequences: Array.isArray(value.contiguousSequences) ? value.contiguousSequences.slice(0, 24).map(sanitizePostCandidateBodySequence) : [],
  };
}

function sanitizeInteractiveBoundaryRegion(value = {}) {
  return {
    regionIndex: Math.min(24, boundedInteger(value.regionIndex) || 0), parentRegionIndex: value.parentRegionIndex === null ? null : Math.min(24, boundedInteger(value.parentRegionIndex) || 0),
    depthRelativeToWrapper: Math.min(24, boundedInteger(value.depthRelativeToWrapper) || 0), tagFamily: BODY_SUBTREE_TAGS.has(value.tagFamily) ? value.tagFamily : 'OTHER',
    visible: value.visible === true, attached: value.attached === true, interactive: value.interactive === true, interactiveAncestor: value.interactiveAncestor === true, hasInteractiveDescendant: value.hasInteractiveDescendant === true,
    commentReplyAncestor: value.commentReplyAncestor === true, nestedIndependentArticle: value.nestedIndependentArticle === true,
    headerLikeAncestor: value.headerLikeAncestor === true, timestampLikeAncestor: value.timestampLikeAncestor === true, actionLikeAncestor: value.actionLikeAncestor === true,
    normalizedLength: Math.min(10000, boundedInteger(value.normalizedLength) || 0), lineCount: Math.min(1000, boundedInteger(value.lineCount) || 0), newlineCount: Math.min(1000, boundedInteger(value.newlineCount) || 0),
    containsImmutableText: value.containsImmutableText === true, exactImmutableMatch: value.exactImmutableMatch === true, prefixMatch: value.prefixMatch === true, suffixMatch: value.suffixMatch === true,
    lengthRelation: POST_CANDIDATE_LENGTH_RELATIONS.has(value.lengthRelation) ? value.lengthRelation : 'EMPTY',
  };
}

function sanitizePrimaryWrapperChainRegion(value = {}) {
  return {
    regionIndex: Math.min(24, boundedInteger(value.regionIndex) || 0), parentRegionIndex: value.parentRegionIndex === null ? null : Math.min(24, boundedInteger(value.parentRegionIndex) || 0),
    depthRelativeToPrimaryWrapper: Math.min(24, boundedInteger(value.depthRelativeToPrimaryWrapper) || 0), tagFamily: BODY_SUBTREE_TAGS.has(value.tagFamily) ? value.tagFamily : 'OTHER',
    containsImmutableText: value.containsImmutableText === true, exactImmutableMatch: value.exactImmutableMatch === true,
    lengthRelation: POST_CANDIDATE_LENGTH_RELATIONS.has(value.lengthRelation) ? value.lengthRelation : 'EMPTY',
    interactive: value.interactive === true, interactiveAncestor: value.interactiveAncestor === true, hasInteractiveDescendant: value.hasInteractiveDescendant === true,
    directInteractiveChildCount: Math.min(24, boundedInteger(value.directInteractiveChildCount) || 0), nestedInteractiveDescendantCount: Math.min(24, boundedInteger(value.nestedInteractiveDescendantCount) || 0),
    childBodySignalRegionCount: Math.min(24, boundedInteger(value.childBodySignalRegionCount) || 0), childExactBodyRegionCount: Math.min(24, boundedInteger(value.childExactBodyRegionCount) || 0),
    boundaryTransition: BOUNDARY_TRANSITIONS.has(value.boundaryTransition) ? value.boundaryTransition : 'SAFE_EVALUATION_ERROR',
  };
}

function sanitizeInteractiveBoundaryBranch(value = {}) {
  return {
    branchIndex: Math.min(24, boundedInteger(value.branchIndex) || 0), parentRegionIndex: Math.min(24, boundedInteger(value.parentRegionIndex) || 0), tagFamily: BODY_SUBTREE_TAGS.has(value.tagFamily) ? value.tagFamily : 'OTHER',
    containsImmutableText: value.containsImmutableText === true, exactImmutableMatch: value.exactImmutableMatch === true,
    interactive: value.interactive === true, interactiveAncestor: value.interactiveAncestor === true, hasInteractiveDescendant: value.hasInteractiveDescendant === true,
    commentReply: value.commentReply === true, independentNestedArticle: value.independentNestedArticle === true, hidden: value.hidden === true,
    normalizedLength: Math.min(10000, boundedInteger(value.normalizedLength) || 0), lineCount: Math.min(1000, boundedInteger(value.lineCount) || 0), newlineCount: Math.min(1000, boundedInteger(value.newlineCount) || 0),
    lengthRelation: POST_CANDIDATE_LENGTH_RELATIONS.has(value.lengthRelation) ? value.lengthRelation : 'EMPTY', branchClass: BODY_BRANCH_CLASSES.has(value.branchClass) ? value.branchClass : 'UNKNOWN_BRANCH',
  };
}

function sanitizeInteractiveBoundary(value = {}) {
  const counts = ['interactiveWrapperCount', 'nonInteractiveBodyRegionCount', 'nonInteractiveExactBodyRegionCount', 'nonInteractiveWholeBodyPlusExtraRegionCount', 'controlRegionCount', 'directInteractiveChildCount', 'nestedInteractiveDescendantCount'];
  return {
    interactiveBoundaryDiagnosticAttempted: value.interactiveBoundaryDiagnosticAttempted === true,
    interactiveBoundaryClass: INTERACTIVE_BOUNDARY_CLASSES.has(value.interactiveBoundaryClass) ? value.interactiveBoundaryClass : 'SAFE_EVALUATION_ERROR',
    ...Object.fromEntries(counts.map((key) => [key, Math.min(24, boundedInteger(value[key]) || 0)])),
    bodyAndControlsSiblingRelation: BODY_CONTROL_RELATIONS.has(value.bodyAndControlsSiblingRelation) ? value.bodyAndControlsSiblingRelation : 'UNKNOWN',
    nearestControlDepthBucket: CONTROL_DEPTH_BUCKETS.has(value.nearestControlDepthBucket) ? value.nearestControlDepthBucket : 'NONE',
    bestBoundaryEvidence: BOUNDARY_EVIDENCE.has(value.bestBoundaryEvidence) ? value.bestBoundaryEvidence : 'AMBIGUOUS',
    regions: Array.isArray(value.regions) ? value.regions.slice(0, 8).map(sanitizeInteractiveBoundaryRegion) : [],
    interactiveBoundaryAmbiguityReason: INTERACTIVE_BOUNDARY_AMBIGUITY_REASONS.has(value.interactiveBoundaryAmbiguityReason) ? value.interactiveBoundaryAmbiguityReason : 'SAFE_EVALUATION_ERROR',
    exactRegionAbsenceReason: EXACT_REGION_ABSENCE_REASONS.has(value.exactRegionAbsenceReason) ? value.exactRegionAbsenceReason : 'SAFE_EVALUATION_ERROR',
    controlBranchRelation: CONTROL_BRANCH_RELATIONS.has(value.controlBranchRelation) ? value.controlBranchRelation : 'UNKNOWN',
    controlBranchCount: Math.min(24, boundedInteger(value.controlBranchCount) || 0), bodySignalBranchCount: Math.min(24, boundedInteger(value.bodySignalBranchCount) || 0),
    firstBodyBranchIndex: value.firstBodyBranchIndex === null ? null : Math.min(24, boundedInteger(value.firstBodyBranchIndex) || 0), firstControlBranchIndex: value.firstControlBranchIndex === null ? null : Math.min(24, boundedInteger(value.firstControlBranchIndex) || 0), nearestBoundaryRegionIndex: value.nearestBoundaryRegionIndex === null ? null : Math.min(24, boundedInteger(value.nearestBoundaryRegionIndex) || 0),
    primaryWrapperChain: Array.isArray(value.primaryWrapperChain) ? value.primaryWrapperChain.slice(0, 12).map(sanitizePrimaryWrapperChainRegion) : [],
    childBranches: Array.isArray(value.childBranches) ? value.childBranches.slice(0, 12).map(sanitizeInteractiveBoundaryBranch) : [],
  };
}

function sanitizePostCandidateBodySubtreeSummary(value = {}) {
  const counts = ['candidateCountInspected', 'bodySubstringCandidateCount', 'minimalExactBodySubtreeCandidateCount', 'exactContiguousBlockSequenceCandidateCount', 'bodyWithHeaderOutsideCount', 'bodyWithActionsOutsideCount', 'bodyWithHeaderAndActionsOutsideCount', 'bodyPresentButNotIsolatableCount', 'ambiguousCount', 'newAfterClickExactBodyCandidateCount', 'visibleAttachedExactBodyCandidateCount', 'bodyBlockCount', 'eligibleBodyBlockCount', 'headerRejectedCount', 'timestampRejectedCount', 'actionRejectedCount', 'commentReplyRejectedCount', 'nestedArticleRejectedCount', 'interactiveRejectedCount', 'hiddenRejectedCount', 'detachedRejectedCount', 'ambiguousRejectedCount', 'exactBodyBlockCount', 'wholeBodyPlusExtraBlockCount', 'partialBodySignalBlockCount', 'exactContiguousSequenceCount', 'wholeBodyPlusExtraSequenceCount', 'interactiveWrapperCount', 'nonInteractiveBodyRegionCount', 'nonInteractiveExactBodyRegionCount', 'nonInteractiveWholeBodyPlusExtraRegionCount', 'controlRegionCount', 'directInteractiveChildCount', 'nestedInteractiveDescendantCount'];
  return {
    ...Object.fromEntries(counts.map((key) => [key, boundedInteger(value[key]) || 0])),
    bestSupportedBodyIsolationClass: BODY_SUMMARY_CLASSES.has(value.bestSupportedBodyIsolationClass) ? value.bestSupportedBodyIsolationClass : 'SAFE_EVALUATION_ERROR',
    bestObservedBlockPattern: BODY_BLOCK_PATTERNS.has(value.bestObservedBlockPattern) ? value.bestObservedBlockPattern : 'SAFE_EVALUATION_ERROR', detailTruncated: value.detailTruncated === true,
    primaryCandidateDetailRetained: value.primaryCandidateDetailRetained === true,
    secondaryCandidateDetailDropped: value.secondaryCandidateDetailDropped === true,
    parentChainDetailRetained: value.parentChainDetailRetained === true,
    sequenceDetailRetained: value.sequenceDetailRetained === true,
    interactiveBoundaryDiagnosticAttempted: value.interactiveBoundaryDiagnosticAttempted === true,
    interactiveBoundaryClass: INTERACTIVE_BOUNDARY_CLASSES.has(value.interactiveBoundaryClass) ? value.interactiveBoundaryClass : 'SAFE_EVALUATION_ERROR',
    bodyAndControlsSiblingRelation: BODY_CONTROL_RELATIONS.has(value.bodyAndControlsSiblingRelation) ? value.bodyAndControlsSiblingRelation : 'UNKNOWN',
    nearestControlDepthBucket: CONTROL_DEPTH_BUCKETS.has(value.nearestControlDepthBucket) ? value.nearestControlDepthBucket : 'NONE',
    bestBoundaryEvidence: BOUNDARY_EVIDENCE.has(value.bestBoundaryEvidence) ? value.bestBoundaryEvidence : 'AMBIGUOUS',
    interactiveBoundaryRegions: Array.isArray(value.interactiveBoundaryRegions) ? value.interactiveBoundaryRegions.slice(0, 8).map(sanitizeInteractiveBoundaryRegion) : [],
    interactiveBoundaryAmbiguityReason: INTERACTIVE_BOUNDARY_AMBIGUITY_REASONS.has(value.interactiveBoundaryAmbiguityReason) ? value.interactiveBoundaryAmbiguityReason : 'SAFE_EVALUATION_ERROR',
    exactRegionAbsenceReason: EXACT_REGION_ABSENCE_REASONS.has(value.exactRegionAbsenceReason) ? value.exactRegionAbsenceReason : 'SAFE_EVALUATION_ERROR',
    controlBranchRelation: CONTROL_BRANCH_RELATIONS.has(value.controlBranchRelation) ? value.controlBranchRelation : 'UNKNOWN',
    controlBranchCount: Math.min(24, boundedInteger(value.controlBranchCount) || 0), bodySignalBranchCount: Math.min(24, boundedInteger(value.bodySignalBranchCount) || 0),
    firstBodyBranchIndex: value.firstBodyBranchIndex === null ? null : Math.min(24, boundedInteger(value.firstBodyBranchIndex) || 0), firstControlBranchIndex: value.firstControlBranchIndex === null ? null : Math.min(24, boundedInteger(value.firstControlBranchIndex) || 0), nearestBoundaryRegionIndex: value.nearestBoundaryRegionIndex === null ? null : Math.min(24, boundedInteger(value.nearestBoundaryRegionIndex) || 0),
    primaryWrapperChain: Array.isArray(value.primaryWrapperChain) ? value.primaryWrapperChain.slice(0, 12).map(sanitizePrimaryWrapperChainRegion) : [],
    childBranches: Array.isArray(value.childBranches) ? value.childBranches.slice(0, 12).map(sanitizeInteractiveBoundaryBranch) : [],
    ...sanitizeBodyDescent(value),
    candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 16).map(sanitizePostCandidateBodySubtreeCandidate) : [],
  };
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

function recordPriority(record) {
  if (CRITICAL_TERMINAL_STAGES.has(record?.stage)) return DIAGNOSTIC_PRIORITY.CRITICAL_TERMINAL;
  if (TERMINAL_DIAGNOSTIC_STAGES.has(record?.stage)) return DIAGNOSTIC_PRIORITY.TERMINAL;
  if (PROTECTED_STAGES.has(record?.stage)) return DIAGNOSTIC_PRIORITY.PROTECTED;
  return DIAGNOSTIC_PRIORITY.ORDINARY;
}

function isRequiredCritical(record) {
  return REQUIRED_CRITICAL_TERMINAL_STAGES.has(record?.stage);
}

function serializedTaskBytes(taskId, records) {
  return Buffer.byteLength(JSON.stringify({ version: 1, task_id: taskId, records }), 'utf8');
}

function requiredCriticalDetailKey(stage) {
  if (stage === 'POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY') return 'postPublicationStructural';
  if (stage === POST_CANDIDATE_TEXT_PARITY_STAGE) return 'postCandidateTextParity';
  if (stage === POST_CANDIDATE_BODY_SUBTREE_STAGE) return 'postCandidateBodySubtree';
  return null;
}

function correlationOrder(value) {
  const match = /^POST_CANDIDATE_(\d+)$/.exec(String(value || ''));
  return match ? Number(match[1]) : MAX_COUNTER;
}

function bodyBlockDetailRank(block) {
  if (block?.exactImmutableMatch === true) return 0;
  if (block?.containsImmutableText === true) return 1;
  if (block?.coverage === 'WHOLE_BODY_PLUS_EXTRA') return 2;
  if (block?.coverage === 'PARTIAL_BODY_SIGNAL') return 3;
  if (block?.eligibility === 'REJECT_NESTED_ARTICLE') return 4;
  if (block?.eligibility === 'REJECT_HIDDEN') return 5;
  return 6;
}

function bodyCandidateDetailRank(candidate) {
  const blocks = Array.isArray(candidate?.subtrees) ? candidate.subtrees : [];
  const contains = blocks.some((block) => block?.containsImmutableText === true);
  // Candidates have already passed through the privacy sanitizer, which
  // flattens their visible/attached fields onto the candidate record.
  const visibleAttached = candidate?.visible === true && candidate?.attached === true;
  const whole = blocks.some((block) => block?.coverage === 'WHOLE_BODY_PLUS_EXTRA');
  const partial = blocks.some((block) => block?.coverage === 'PARTIAL_BODY_SIGNAL');
  return [contains ? 0 : 1, visibleAttached ? 0 : 1, whole ? 0 : partial ? 1 : 2, correlationOrder(candidate?.candidateCorrelationId)];
}

function compareRank(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
  }
  return 0;
}

function compactBodyBlockDetail(block) {
  return {
    blockIndex: block.blockIndex,
    parentBlockIndex: block.parentBlockIndex,
    childBlockIndices: block.childBlockIndices,
    blockRole: block.blockRole,
    eligibility: block.eligibility,
    coverage: block.coverage,
    depthRelativeToCandidate: block.depthRelativeToCandidate,
    tagFamily: block.tagFamily,
    visible: block.visible === true,
    attached: block.attached === true,
    nestedArticle: block.nestedArticle === true,
    nestedArticleDirect: block.nestedArticleDirect === true,
    nestedArticleInherited: block.nestedArticleInherited === true,
    hiddenDirect: block.hiddenDirect === true,
    hiddenInherited: block.hiddenInherited === true,
    articleRelation: block.articleRelation,
    interactive: block.interactive === true,
    interactiveAncestor: block.interactiveAncestor === true,
    commentReplyAncestor: block.commentReplyAncestor === true,
    headerLikeAncestor: block.headerLikeAncestor === true,
    timestampLikeAncestor: block.timestampLikeAncestor === true,
    actionLikeAncestor: block.actionLikeAncestor === true,
    childTextBlockCount: block.childTextBlockCount,
    interactiveDescendantCount: block.interactiveDescendantCount,
    normalizedLength: block.normalizedLength,
    lineCount: block.lineCount,
    newlineCount: block.newlineCount,
    exactImmutableMatch: block.exactImmutableMatch === true,
    containsImmutableText: block.containsImmutableText === true,
    immutableTextPrefixMatch: block.immutableTextPrefixMatch === true,
    immutableTextSuffixMatch: block.immutableTextSuffixMatch === true,
    lengthRelation: block.lengthRelation,
  };
}

function compactBodySequenceDetail(sequence) {
  return {
    sequenceStartBlockIndex: sequence.sequenceStartBlockIndex,
    sequenceBlockCount: sequence.sequenceBlockCount,
    sequenceExactImmutableMatch: sequence.sequenceExactImmutableMatch === true,
    sequenceContainsImmutableText: sequence.sequenceContainsImmutableText === true,
    rejectionReason: sequence.rejectionReason,
    containsNestedArticleBlock: sequence.containsNestedArticleBlock === true,
    containsHiddenBlock: sequence.containsHiddenBlock === true,
    firstRejectedBlockIndex: sequence.firstRejectedBlockIndex,
    firstRejectionReason: sequence.firstRejectionReason,
  };
}

// Retain one deterministic diagnostic sample for the body-subtree summary
// before dropping secondary candidates. These fields are already sanitized;
// this must never influence extraction or any success decision.
function compactPrimaryBodyCandidate(summary, maxBlocks = 16, maxSequences = 8) {
  const candidates = Array.isArray(summary?.candidates) ? summary.candidates : [];
  const primary = [...candidates].sort((left, right) => compareRank(bodyCandidateDetailRank(left), bodyCandidateDetailRank(right)))[0];
  if (!primary) return { candidates: [], primaryCandidateDetailRetained: false, secondaryCandidateDetailDropped: false, parentChainDetailRetained: false, sequenceDetailRetained: false };
  const allBlocks = Array.isArray(primary.subtrees) ? primary.subtrees : [];
  const byIndex = new Map(allBlocks.map((block) => [block.blockIndex, block]));
  const retained = []; const retainedIds = new Set();
  const include = (block) => { if (block && retained.length < maxBlocks && !retainedIds.has(block.blockIndex)) { retained.push(block); retainedIds.add(block.blockIndex); } };
  const orderedBlocks = [...allBlocks].sort((left, right) => bodyBlockDetailRank(left) - bodyBlockDetailRank(right) || (left.blockIndex || 0) - (right.blockIndex || 0));
  // Admit each body-bearing block together with its bounded ancestor context
  // before lower-priority detail. This prevents a busy body signal set from
  // consuming all 16 slots before its parent chain can be represented.
  for (const block of orderedBlocks) {
    if (block.containsImmutableText !== true && block.exactImmutableMatch !== true) continue;
    include(block);
    let parent = byIndex.get(block.parentBlockIndex);
    for (let depth = 0; parent && depth < 4 && retained.length < maxBlocks; depth += 1) { include(parent); parent = byIndex.get(parent.parentBlockIndex); }
  }
  orderedBlocks.forEach(include);
  const sequences = (Array.isArray(primary.contiguousSequences) ? primary.contiguousSequences : []).sort((left, right) => {
    const leftRank = left.sequenceExactImmutableMatch ? 0 : left.sequenceContainsImmutableText ? 1 : 2;
    const rightRank = right.sequenceExactImmutableMatch ? 0 : right.sequenceContainsImmutableText ? 1 : 2;
    return leftRank - rightRank || (left.sequenceStartBlockIndex || 0) - (right.sequenceStartBlockIndex || 0);
  }).slice(0, maxSequences);
  return {
    // Only the body-bearing selection fields survive compaction. This keeps
    // the fixed reservation viable for all 16 bounded blocks rather than
    // dropping relevant structural evidence to retain redundant snapshots.
    candidates: [{
      candidateCorrelationId: primary.candidateCorrelationId,
      visible: primary.visible === true,
      attached: primary.attached === true,
      subtrees: retained.sort((left, right) => (left.blockIndex || 0) - (right.blockIndex || 0)).map(compactBodyBlockDetail),
      contiguousSequences: sequences.map(compactBodySequenceDetail),
    }],
    primaryCandidateDetailRetained: retained.length > 0,
    secondaryCandidateDetailDropped: candidates.length > 1,
    parentChainDetailRetained: retained.some((block) => retainedIds.has(block.parentBlockIndex)),
    sequenceDetailRetained: sequences.length > 0,
  };
}

// Candidate arrays are optional observability detail. Aggregate counters,
// classifications, and booleans remain intact when a required terminal record
// needs to be compacted. This clone is local-only and contains already-redacted
// values exclusively.
function compactRequiredCriticalRecord(record, maxBytes) {
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') <= maxBytes) return record;
  const compacted = JSON.parse(JSON.stringify(record));
  const key = requiredCriticalDetailKey(compacted.stage);
  if (compacted.stage === POST_CANDIDATE_BODY_SUBTREE_STAGE && compacted.postCandidateBodySubtree) {
    const summary = compacted.postCandidateBodySubtree;
    Object.assign(summary, compactPrimaryBodyCandidate(summary));
    summary.detailTruncated = true;
    // The bounded primary sample normally fits well below the required
    // terminal ceiling. If a future safe field expands it, reduce only the
    // optional detail in a deterministic order, never its aggregates.
    // Sequence samples yield before any primary structural discriminator.
    // Only then may the bounded block sample shrink to preserve the fixed
    // four-summary reservation.
    for (const limits of [[16, 4], [12, 2], [8, 2], [4, 2], [4, 0]]) {
      if (Buffer.byteLength(JSON.stringify(compacted), 'utf8') <= maxBytes) break;
      Object.assign(summary, compactPrimaryBodyCandidate(record.postCandidateBodySubtree, limits[0], limits[1]));
      summary.detailTruncated = true;
    }
    return compacted;
  }
  if (compacted.stage === 'POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY' && compacted.postPublicationStructural?.targetReloadVerification) {
    const structural = compacted.postPublicationStructural;
    const reload = structural.targetReloadVerification;
    structural.acknowledgementCandidates = [];
    structural.articleCandidates = [];
    structural.detailTruncated = true;
    const minimalCandidate = (candidate) => ({
      candidateIndex: candidate.candidateIndex, preCapOrdinal: candidate.preCapOrdinal,
      rootInnerTextContainsImmutable: candidate.rootInnerTextContainsImmutable, rootTextContentContainsImmutable: candidate.rootTextContentContainsImmutable,
      rootVisualTextContainsImmutable: candidate.rootVisualTextContainsImmutable, rootAnyReaderContainsImmutable: candidate.rootAnyReaderContainsImmutable,
      rootReaderParityClass: candidate.rootReaderParityClass, representationLengthsDiffer: candidate.representationLengthsDiffer, normalizedLengthsDiffer: candidate.normalizedLengthsDiffer,
      firstBodySignalRawOrdinal: candidate.firstBodySignalRawOrdinal, bodySignalRawCount: candidate.bodySignalRawCount,
      bodySignalInWindow1To24: candidate.bodySignalInWindow1To24, bodySignalInWindow25To64: candidate.bodySignalInWindow25To64,
      bodySignalBeyond64Known: candidate.bodySignalBeyond64Known, bodySignalBeyond64: candidate.bodySignalBeyond64,
      firstBodySignalReducedOrdinal: candidate.firstBodySignalReducedOrdinal, reducedBodySignalCount: candidate.reducedBodySignalCount,
      parentLinksMissingBecauseParentOutsideReducedSet: candidate.parentLinksMissingBecauseParentOutsideReducedSet,
      containsZeroWidthChar: candidate.containsZeroWidthChar, containsBidiControl: candidate.containsBidiControl, containsSoftHyphen: candidate.containsSoftHyphen, containsNBSP: candidate.containsNBSP, containsCRLFNormalization: candidate.containsCRLFNormalization,
      captureStageResult: candidate.captureStageResult,
    });
    for (const key of ['captureDiagnostics', 'baselineCaptureDiagnostics']) {
      if (Array.isArray(reload[key]?.candidates)) reload[key].candidates = reload[key].candidates.map(minimalCandidate);
    }
    reload.captureDiagnosticDetailTruncated = true;
    for (const limit of [8, 4, 2, 1, 0]) {
      if (Buffer.byteLength(JSON.stringify(compacted), 'utf8') <= maxBytes) break;
      for (const key of ['captureDiagnostics', 'baselineCaptureDiagnostics']) reload[key].candidates = reload[key].candidates.slice(0, limit);
    }
    return compacted;
  }
  if (key && compacted[key] && Array.isArray(compacted[key].candidates)) {
    compacted[key].candidates = [];
    compacted[key].detailTruncated = true;
  }
  return compacted;
}

function evictForRequiredCritical(records) {
  let bestIndex = -1; let bestPriority = Infinity;
  for (let index = 0; index < records.length; index += 1) {
    if (isRequiredCritical(records[index])) continue;
    const priority = recordPriority(records[index]);
    if (priority < bestPriority) { bestIndex = index; bestPriority = priority; }
  }
  if (bestIndex < 0) return false;
  records.splice(bestIndex, 1);
  return true;
}

// Deterministic oldest-first eviction inside a priority class.  A new record
// can displace only lower-priority evidence; critical terminal summaries
// therefore never displace each other and are never sacrificed for snapshots.
function evictLowerPriority(records, incomingPriority) {
  let bestIndex = -1; let bestPriority = Infinity;
  for (let index = 0; index < records.length; index += 1) {
    const priority = recordPriority(records[index]);
    if (priority < incomingPriority && priority < bestPriority) { bestIndex = index; bestPriority = priority; }
  }
  if (bestIndex < 0) return false;
  records.splice(bestIndex, 1);
  return true;
}

function createComposerAcquisitionDiagnosticSink(options = {}) {
  const directory = options.directory || path.join(logsPath, 'local-agent-composer-diagnostics');
  const now = options.now || (() => new Date().toISOString());
  const maxRecords = Math.max(4, Math.min(Number(options.maxRecords) || MAX_RECORDS_PER_TASK, MAX_RECORDS_PER_TASK));
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || MAX_FILE_BYTES, MAX_FILE_BYTES));
  const criticalReservationEnabled = maxBytes >= REQUIRED_CRITICAL_RESERVE_BYTES;
  const nonCriticalByteBudget = criticalReservationEnabled ? maxBytes - REQUIRED_CRITICAL_RESERVE_BYTES : maxBytes;

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
        } else if (shape?.acknowledgementSemantic === true) {
          record.acknowledgementSemantic = sanitizeAcknowledgementSemantic(shape.value);
        } else if (shape?.postPublicationStructural === true) {
          record.postPublicationStructural = sanitizePostPublicationStructural(shape.value);
        } else if (shape?.postCandidateTextParity === true) {
          record.postCandidateTextParity = sanitizePostCandidateTextParity(shape.value);
        } else if (shape?.postCandidateBodySubtree === true) {
          record.postCandidateBodySubtree = sanitizePostCandidateBodySubtreeSummary(shape.value);
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
        const terminal = summary || TERMINAL_STAGES.has(stage) || stage === 'EDITOR_SHAPE_SNAPSHOT' || stage === 'EDITOR_SHAPE_DIAGNOSTIC_SUMMARY' || stage === PRE_SELECTOR_SNAPSHOT_STAGE || stage === PRE_SELECTOR_SUMMARY_STAGE || stage === SELECTOR_PARITY_SNAPSHOT_STAGE || stage === SELECTOR_PARITY_SUMMARY_STAGE || stage === CONTENT_MISMATCH_SUMMARY_STAGE || stage === ZERO_MEDIA_INSPECTION_SUMMARY_STAGE || stage === PUBLISH_CONTROL_DISCOVERY_SUMMARY_STAGE || stage === POST_SUBMIT_VERIFICATION_SUMMARY_STAGE || stage === 'POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY' || stage === POST_CANDIDATE_TEXT_PARITY_STAGE || stage === POST_CANDIDATE_BODY_SUBTREE_STAGE;
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
        const requiredCritical = isRequiredCritical(record);
        const incomingPriority = recordPriority(record);
        const effectiveMaxRecords = criticalReservationEnabled ? Math.max(maxRecords, REQUIRED_CRITICAL_TERMINAL_STAGES.size) : maxRecords;
        let incomingRecord = requiredCritical ? compactRequiredCriticalRecord(record, REQUIRED_CRITICAL_RECORD_MAX_BYTES) : record;

        // A repeated required summary supersedes its earlier snapshot without
        // displacing any other required terminal summary.
        if (requiredCritical) {
          const priorIndex = records.findIndex((item) => item.stage === incomingRecord.stage);
          if (priorIndex >= 0) records.splice(priorIndex, 1);
        }

        if (requiredCritical && criticalReservationEnabled) {
          while (records.length >= effectiveMaxRecords && evictForRequiredCritical(records)) { /* required terminals yield only lower classes */ }
          while (serializedTaskBytes(safeId, [...records, incomingRecord]) > maxBytes && evictForRequiredCritical(records)) { /* ordinary -> protected -> terminal -> non-required critical */ }
        } else if (criticalReservationEnabled && terminal) {
          // Protected terminal diagnostics may use currently unoccupied
          // critical capacity. Required critical summaries deterministically
          // evict these records later if they need that reserved space.
          while (records.length >= effectiveMaxRecords && evictLowerPriority(records, incomingPriority)) { /* lower priorities yield first */ }
          while (records.length && serializedTaskBytes(safeId, [...records, incomingRecord]) > maxBytes
            && evictLowerPriority(records, incomingPriority)) { /* remain bounded while retaining protected summaries */ }
        } else if (criticalReservationEnabled) {
          // Non-required records never consume capacity reserved for any of the
          // four required terminals, even before those terminals are emitted.
          const nonCriticalRecords = () => records.filter((item) => !isRequiredCritical(item));
          while (serializedTaskBytes(safeId, [...nonCriticalRecords(), incomingRecord]) > nonCriticalByteBudget
            && evictLowerPriority(records, incomingPriority)) { /* lower priorities yield first */ }
          if (serializedTaskBytes(safeId, [...nonCriticalRecords(), incomingRecord]) > nonCriticalByteBudget) return;
        } else if (terminal) {
          while (records.length >= effectiveMaxRecords && evictLowerPriority(records, incomingPriority)) { /* lower priorities yield first */ }
          while (records.length && serializedTaskBytes(safeId, [...records, incomingRecord]) > maxBytes && evictLowerPriority(records, incomingPriority)) { /* preserve critical terminals */ }
        }

        if (records.length < effectiveMaxRecords && serializedTaskBytes(safeId, [...records, incomingRecord]) <= maxBytes) records.push(incomingRecord);
        const value = { version: 1, task_id: safeId, records };
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
      acknowledgementSemanticSummary: (value) => persist('ACKNOWLEDGEMENT_SEMANTIC_DIAGNOSTIC_SUMMARY', 'ACKNOWLEDGEMENT_SEMANTIC', {}, true, { value, acknowledgementSemantic: true }),
      postPublicationStructuralSummary: (value) => persist('POST_PUBLICATION_STRUCTURAL_DIAGNOSTIC_SUMMARY', 'POST_PUBLICATION_STRUCTURAL', {}, true, { value, postPublicationStructural: true }),
      postCandidateTextParitySummary: (value) => persist(POST_CANDIDATE_TEXT_PARITY_STAGE, 'POST_CANDIDATE_TEXT_PARITY', {}, true, { value, postCandidateTextParity: true }),
      postCandidateBodySubtreeSummary: (value) => persist(POST_CANDIDATE_BODY_SUBTREE_STAGE, 'POST_CANDIDATE_BODY_SUBTREE', {}, true, { value, postCandidateBodySubtree: true }),
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
  sanitizeAcknowledgementSemanticCandidate,
  sanitizeAcknowledgementSemantic,
  sanitizePostPublicationStructural,
  sanitizePostCandidateTextParity,
  sanitizePostCandidateBodySubtreeSummary,
  MAX_PUBLISH_CONTROL_CANDIDATES,
  MAX_PUBLISH_CONTROL_SNAPSHOTS,
  DIAGNOSTIC_PRIORITY,
  recordPriority,
  STAGES,
  createComposerAcquisitionDiagnosticSink,
};
