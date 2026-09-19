'use strict';

const { createQaPreviewBrowser, QaSessionError } = require('../app/qa/QaPreviewBrowser');

const mode = process.argv[2];
const confirmedReset = process.argv.includes('--confirm-reset');

function safeResult(result) {
  return {
    ok: true,
    code: result.code,
    username: result.username,
    campaignVisibility: result.campaignVisibility,
    safeTargetVisible: result.safeTargetVisible,
    targetId: result.targetId,
    targetGroup: result.targetGroup,
    assignmentCount: result.assignmentCount,
    managedProfileAssignmentMatched: result.managedProfileAssignmentMatched,
    activeTasks: result.activeTasks,
    profileConflicts: result.profileConflicts,
  };
}

function safeFailure(error) {
  const code = error instanceof QaSessionError || error?.code === 'PROFILE_BUSY' ? error.code : 'QA_BROWSER_FAILED';
  return { ok: false, code, message: code === 'PROFILE_BUSY' ? 'The dedicated QA browser profile is already in use.' : error.message };
}

(async () => {
  const browser = createQaPreviewBrowser();
  if (mode === 'bootstrap') {
    console.log('QA_AUTH_REQUIRED: complete Vercel access and application login as qa_user_b4 in the opened browser. Credentials remain in the browser UI.');
    console.log(JSON.stringify(safeResult(await browser.bootstrap())));
    return;
  }
  if (mode === 'verify') {
    console.log(JSON.stringify(safeResult(await browser.verify())));
    return;
  }
  if (mode === 'reset') {
    if (!confirmedReset) throw new QaSessionError('QA_RESET_CONFIRMATION_REQUIRED', 'Run the reset command with --confirm-reset to delete only the dedicated QA browser profile.');
    await browser.reset();
    console.log(JSON.stringify({ ok: true, code: 'QA_SESSION_RESET' }));
    return;
  }
  throw new QaSessionError('QA_BROWSER_MODE_REQUIRED', 'Use bootstrap, verify, or reset mode.');
})().catch((error) => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
