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
  'CLIPBOARD_PASTE', 'FILL', 'TYPE', 'PRESS_INSERT_TEXT', 'DOM_SETTER', 'OTHER_FIXED_METHOD',
]);
const CONTENT_MISMATCH_READ_TIMINGS = new Set([
  'IMMEDIATELY_AFTER_INSERTION', 'AFTER_EXISTING_SETTLE', 'FIRST_VERIFICATION_READ',
]);
const CONTENT_MISMATCH_SUMMARY_STAGE = 'CONTENT_MISMATCH_DIAGNOSTIC_SUMMARY';
const PROTECTED_STAGES = new Set([
  PRE_SELECTOR_SNAPSHOT_STAGE,
  PRE_SELECTOR_SUMMARY_STAGE,
  SELECTOR_PARITY_SUMMARY_STAGE,
  CONTENT_MISMATCH_SUMMARY_STAGE,
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
    verificationReadCount: Math.max(1, count('verificationReadCount')),
    verificationReadTiming: CONTENT_MISMATCH_READ_TIMINGS.has(value.verificationReadTiming) ? value.verificationReadTiming : 'FIRST_VERIFICATION_READ',
    normalizationStages: {
      raw: sanitizeContentMismatchStage(stages.raw),
      nfc: sanitizeContentMismatchStage(stages.nfc),
      crlfToLf: sanitizeContentMismatchStage(stages.crlfToLf),
      nbspToSpace: sanitizeContentMismatchStage(stages.nbspToSpace),
      final: sanitizeContentMismatchStage(stages.final),
    },
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

function removeOldestUnprotected(records) {
  const index = records.findIndex((record) => !PROTECTED_STAGES.has(record.stage));
  if (index < 0) return false;
  records.splice(index, 1);
  return true;
}

function createComposerAcquisitionDiagnosticSink(options = {}) {
  const directory = options.directory || path.join(logsPath, 'local-agent-composer-diagnostics');
  const now = options.now || (() => new Date().toISOString());
  // These four protected records are the minimum useful evidence for a
  // reviewed selector miss: its root-local shape, both terminal aggregates,
  // and terminal acquisition result. Do not let a tiny caller cap make that
  // evidence impossible to retain.
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
        const terminal = summary || TERMINAL_STAGES.has(stage) || stage === 'EDITOR_SHAPE_SNAPSHOT' || stage === 'EDITOR_SHAPE_DIAGNOSTIC_SUMMARY' || stage === PRE_SELECTOR_SNAPSHOT_STAGE || stage === PRE_SELECTOR_SUMMARY_STAGE || stage === SELECTOR_PARITY_SNAPSHOT_STAGE || stage === SELECTOR_PARITY_SUMMARY_STAGE || stage === CONTENT_MISMATCH_SUMMARY_STAGE;
        if (stage === 'EDITOR_SHAPE_SNAPSHOT' && records.filter((item) => item.stage === stage).length >= MAX_EDITOR_SHAPE_SNAPSHOTS) return;
        // One snapshot is sufficient to explain a selector miss. Keeping the
        // first bounded sample reserves space for its terminal summary.
        if (stage === PRE_SELECTOR_SNAPSHOT_STAGE && records.some((item) => item.stage === stage)) return;
        if (stage === SELECTOR_PARITY_SNAPSHOT_STAGE && records.some((item) => item.stage === stage)) return;
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
  STAGES,
  createComposerAcquisitionDiagnosticSink,
};
