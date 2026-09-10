'use strict';

// This module intentionally owns only the future live-publish seam. G5.2 has
// no Facebook/Chromium implementation: a reviewed publisher adapter must be
// injected explicitly, and production startup injects none.
const LIVE_CAMPAIGN_EXECUTION_TASK_TYPE = 'LIVE_CAMPAIGN_EXECUTION';
const LIVE_EXECUTION_MODE = 'LIVE_EXECUTION';

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function uncertain(reason, message) { return Object.assign(new Error(message), { code: 'EXECUTION_OUTCOME_UNKNOWN', reason }); }

function requireLiveSnapshot(task, registry, runtimeProfiles, transport) {
  const payload = task.payload || {};
  if (payload.mode !== LIVE_EXECUTION_MODE || payload.publishEnabled !== true || payload.execution_config?.publishEnabled !== true) throw failure('LIVE_EXECUTION_SNAPSHOT_INVALID', 'Live execution requires a server-owned publish-enabled snapshot.');
  if (!task.agent_id || !task.profile_id || (transport?.agentId && String(task.agent_id) !== String(transport.agentId))) throw failure('LIVE_EXECUTION_ROUTING_INVALID', 'Live execution routing is invalid.');
  if (!payload.campaign?.campaign_id || !payload.post?.post_id || !Number.isInteger(payload.post?.day) || !payload.target?.target_id || !payload.target?.url) throw failure('LIVE_EXECUTION_SNAPSHOT_INVALID', 'Live execution snapshot is incomplete.');
  const profile = registry?.getProfile?.(task.profile_id, runtimeProfiles());
  if (!profile || profile.status !== 'READY') throw failure('PROFILE_UNAVAILABLE', 'Local profile is unavailable for live execution.');
  const media = Array.isArray(payload.media) ? payload.media : [];
  const localMedia = Array.isArray(payload.local_media_paths) ? payload.local_media_paths : [];
  if (media.length !== localMedia.length) throw failure('MEDIA_EXECUTION_INCOMPLETE', 'Live execution media was not verified before publishing.');
}

function requirePublisher(publisher) {
  if (!publisher || ['prepare', 'verifyReady', 'submit', 'verifyOutcome'].some((method) => typeof publisher[method] !== 'function')) throw failure('LIVE_EXECUTION_NOT_IMPLEMENTED', 'No reviewed live publisher adapter is configured.');
  return publisher;
}

function readinessAccepted(value) { return value === true || (value && value.sessionReady === true && value.targetReady === true && value.composerReady === true); }

function createLiveCampaignExecutionExecutor(registry, runtimeProfiles, options = {}) {
  // Preserve the G5.1 factory shape for callers that only need the fail-closed
  // gate, while the G5.2 execution path uses (registry, runtimeProfiles, opts).
  if (arguments.length <= 1 && registry && typeof registry === 'object' && Object.prototype.hasOwnProperty.call(registry, 'enabled')) { options = registry; registry = null; runtimeProfiles = () => []; }
  const { enabled = false, publisher = null } = options;
  return async (task, context = {}) => {
    if (task?.task_type !== LIVE_CAMPAIGN_EXECUTION_TASK_TYPE) throw failure('UNSUPPORTED_TASK_TYPE', 'Unsupported live task type.');
    if (enabled !== true) throw failure('LIVE_EXECUTION_DISABLED', 'Live campaign execution is disabled.');

    // A claimed/reconnected attempted task is never a license to submit again.
    if (task.side_effect_state === 'ATTEMPT_STARTED') throw uncertain('ATTEMPT_ALREADY_STARTED', 'A prior live publish attempt requires manual review.');
    if (task.side_effect_state === 'VERIFIED_SUCCESS') return { liveExecution: true, publishEnabled: true, sideEffectState: 'VERIFIED_SUCCESS', recoveredVerifiedSuccess: true, manualReviewRequired: false, blockers: [] };

    const adapter = requirePublisher(publisher);
    const transport = context.transport;
    const trace = typeof context.trace === 'function' ? context.trace : () => {};
    const cancellationRequested = typeof context.isCancellationRequested === 'function' ? context.isCancellationRequested : async () => false;
    requireLiveSnapshot(task, registry, runtimeProfiles, transport);
    if (await cancellationRequested()) return { cancelled: true, publishEnabled: true, blockers: [] };
    await adapter.prepare(task);
    trace('PREPARE_COMPLETE');
    const readiness = await adapter.verifyReady(task);
    if (!readinessAccepted(readiness)) throw failure('PUBLISHER_NOT_READY', 'The reviewed publisher is not ready.');
    trace('PUBLISHER_READY');
    if (await cancellationRequested()) return { cancelled: true, publishEnabled: true, blockers: [] };
    if (!transport || typeof transport.renewLease !== 'function' || typeof transport.markSideEffectAttemptStarted !== 'function' || typeof transport.markSideEffectVerifiedSuccess !== 'function') throw failure('LIVE_TRANSPORT_UNAVAILABLE', 'Live control-plane transport is unavailable.');

    // The final server-side lease validation is deliberately adjacent to the
    // durable marker; no publisher method may run before both have succeeded.
    await transport.renewLease(task);
    trace('LEASE_VALID');
    await transport.markSideEffectAttemptStarted(task);
    trace('ATTEMPT_STARTED_PERSISTED');
    if (await cancellationRequested()) throw uncertain('CANCELLED_AFTER_ATTEMPT_STARTED', 'Cancellation arrived after live publication authorization.');
    try { trace('SUBMIT_CALLED'); await adapter.submit(task); }
    catch (error) { throw uncertain('SUBMIT_UNCERTAIN', 'Live publish submission may have reached the publisher.'); }

    let outcome;
    try { outcome = await adapter.verifyOutcome(task); }
    catch (error) { throw uncertain('VERIFY_UNCERTAIN', 'Live publish outcome could not be verified.'); }
    if (outcome !== true && outcome?.verified !== true) throw uncertain('VERIFY_NEGATIVE_OR_UNCERTAIN', 'No authoritative proof of publication was recorded.');
    trace('VERIFY_SUCCESS');
    try { await transport.markSideEffectVerifiedSuccess(task); }
    catch (error) { throw uncertain('VERIFIED_SUCCESS_PERSISTENCE_FAILED', 'Verified publication could not be durably recorded.'); }
    trace('VERIFIED_SUCCESS_PERSISTED');
    return { liveExecution: true, publishEnabled: true, sideEffectState: 'VERIFIED_SUCCESS', outcomeVerified: true, manualReviewRequired: false, blockers: [] };
  };
}

module.exports = { LIVE_CAMPAIGN_EXECUTION_TASK_TYPE, LIVE_EXECUTION_MODE, createLiveCampaignExecutionExecutor };
