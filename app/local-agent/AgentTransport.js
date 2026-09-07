class AgentTransport {
  register() { throw new Error('AgentTransport.register must be implemented.'); }
  heartbeat() { throw new Error('AgentTransport.heartbeat must be implemented.'); }
  publishProfiles() { throw new Error('AgentTransport.publishProfiles must be implemented.'); }
  claimNextTask() { throw new Error('AgentTransport.claimNextTask must be implemented.'); }
  acknowledgeTask() { throw new Error('AgentTransport.acknowledgeTask must be implemented.'); }
  reportRunning() { throw new Error('AgentTransport.reportRunning must be implemented.'); }
  renewLease() { throw new Error('AgentTransport.renewLease must be implemented.'); }
  reportProgress() { throw new Error('AgentTransport.reportProgress must be implemented.'); }
  reportCompletion() { throw new Error('AgentTransport.reportCompletion must be implemented.'); }
  reportFailure() { throw new Error('AgentTransport.reportFailure must be implemented.'); }
  reportOutcomeUnknown() { throw new Error('AgentTransport.reportOutcomeUnknown must be implemented.'); }
  reportCancelled() { throw new Error('AgentTransport.reportCancelled must be implemented.'); }
  getCancellationState() { throw new Error('AgentTransport.getCancellationState must be implemented.'); }
}

module.exports = { AgentTransport };
