'use strict';

const PREPUBLISH_DIAGNOSTIC_TASK_TYPE = 'FACEBOOK_PREPUBLISH_DIAGNOSTIC';
const PREPUBLISH_DIAGNOSTIC_MODE = 'PREPUBLISH_DIAGNOSTIC';

function diagnosticStopRequested(task) {
  const payload = task?.payload || {};
  return task?.task_type === PREPUBLISH_DIAGNOSTIC_TASK_TYPE
    || payload.mode === PREPUBLISH_DIAGNOSTIC_MODE
    || payload.execution_config?.stopBeforePublish === true;
}

function isValidPrepublishDiagnosticSnapshot(task) {
  const payload = task?.payload || {};
  return task?.task_type === PREPUBLISH_DIAGNOSTIC_TASK_TYPE
    && payload.mode === PREPUBLISH_DIAGNOSTIC_MODE
    && payload.publishEnabled === false
    && payload.execution_config?.mode === PREPUBLISH_DIAGNOSTIC_MODE
    && payload.execution_config?.publishEnabled === false
    && payload.execution_config?.stopBeforePublish === true
    && payload.execution_config?.rehearsal !== true;
}

module.exports = {
  PREPUBLISH_DIAGNOSTIC_TASK_TYPE,
  PREPUBLISH_DIAGNOSTIC_MODE,
  diagnosticStopRequested,
  isValidPrepublishDiagnosticSnapshot,
};
