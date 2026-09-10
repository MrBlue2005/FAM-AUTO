'use strict';

const LIVE_CAMPAIGN_EXECUTION_TASK_TYPE = 'LIVE_CAMPAIGN_EXECUTION';

function createLiveCampaignExecutionExecutor({ enabled = false } = {}) {
  return async (task) => {
    if (task.task_type !== LIVE_CAMPAIGN_EXECUTION_TASK_TYPE) throw Object.assign(new Error('Unsupported live task type.'), { code: 'UNSUPPORTED_TASK_TYPE' });
    if (!enabled) throw Object.assign(new Error('Live campaign execution is disabled.'), { code: 'LIVE_EXECUTION_DISABLED' });
    throw Object.assign(new Error('Live campaign execution is not implemented.'), { code: 'LIVE_EXECUTION_NOT_IMPLEMENTED' });
  };
}

module.exports = { LIVE_CAMPAIGN_EXECUTION_TASK_TYPE, createLiveCampaignExecutionExecutor };
