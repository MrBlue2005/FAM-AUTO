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
]);

const REASON_CLASSES = new Set([
  'DISCOVERY_STARTED', 'OPENER_FOUND', 'OPENER_CLICKED', 'SNAPSHOT',
  'STRUCTURAL_REJECTED', 'ZERO_ELIGIBLE_EDITOR', 'MULTIPLE_ELIGIBLE_EDITORS',
  'ROOT_HIDDEN', 'ROOT_DETACHED', 'TRANSITION_NEW', 'TRANSITION_REPLACEMENT',
  'TRANSITION_REUSE', 'NO_ELIGIBLE_TRANSITION', 'AMBIGUOUS_TRANSITION',
  'ROOT_ACCEPTED', 'EDITOR_BOUND', 'ACQUISITION_TIMEOUT', 'UNKNOWN_SAFE_FAILURE',
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
const TERMINAL_STAGES = new Set([
  'COMPOSER_ROOT_ACCEPTED', 'COMPOSER_EDITOR_BOUND', 'COMPOSER_ACQUISITION_FAILED',
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

function createComposerAcquisitionDiagnosticSink(options = {}) {
  const directory = options.directory || path.join(logsPath, 'local-agent-composer-diagnostics');
  const now = options.now || (() => new Date().toISOString());
  const maxRecords = Math.max(1, Math.min(Number(options.maxRecords) || MAX_RECORDS_PER_TASK, MAX_RECORDS_PER_TASK));
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || MAX_FILE_BYTES, MAX_FILE_BYTES));

  function forTask(taskId) {
    const safeId = safeTaskId(taskId);
    const filePath = safeId ? path.join(directory, `${safeId}.json`) : null;

    function persist(stage, reasonClass, evidence = {}, summary = false) {
      if (!safeId || !filePath || !STAGES.has(stage) || !REASON_CLASSES.has(reasonClass)) return;
      try {
        const { counters, flags } = sanitizeEvidence(evidence);
        const record = { timestamp: now(), task_id: safeId, stage, reason_class: reasonClass, counters, flags };
        rotate(directory);
        const records = readRecords(filePath);
        const terminal = summary || TERMINAL_STAGES.has(stage);
        const previous = records[records.length - 1];
        // Repeated polling snapshots carry no additional safe diagnostic
        // meaning. Coalesce them so terminal evidence cannot be crowded out.
        if (!terminal && previous
          && previous.stage === stage
          && previous.reason_class === reasonClass
          && JSON.stringify(previous.counters) === JSON.stringify(counters)
          && JSON.stringify(previous.flags) === JSON.stringify(flags)) return;
        if (terminal) {
          while (records.length >= maxRecords) records.shift();
          while (records.length && Buffer.byteLength(JSON.stringify({ version: 1, task_id: safeId, records: [...records, record] }), 'utf8') > maxBytes) records.shift();
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
    });
  }

  return Object.freeze({ forTask });
}

module.exports = {
  COUNTERS,
  FLAGS,
  MAX_FILE_BYTES,
  MAX_RECORDS_PER_TASK,
  MAX_TASK_FILES,
  REASON_CLASSES,
  STAGES,
  createComposerAcquisitionDiagnosticSink,
};
