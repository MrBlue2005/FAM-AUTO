'use strict';

const MAX_EVENTS = 8;
const MAX_PENDING_RESPONSES = 8;
const MAX_RESPONSE_INSPECTION_BYTES = 64 * 1024;
const DEFAULT_WINDOW_MS = 30000;
const SAFE_OPERATION_NAME = /^(?=[A-Za-z][A-Za-z0-9_]{0,79}$)(?=[A-Za-z0-9_]*(?:Composer|Story|Post|Publish|Create)[A-Za-z0-9_]*Mutation$)[A-Za-z0-9_]+$/;
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'web.facebook.com']);
const PERMISSION_OR_MODERATION_CODES = new Set([10, 190, 200, 368, 506, 1357004]);

function timestamp(value) { return new Date(value).toISOString(); }
function boundedRelative(now, clickAt) { return clickAt === null ? null : Math.max(-1000, Math.min(120000, Math.trunc(now - clickAt))); }

function classifyUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !FACEBOOK_HOSTS.has(hostname)) return null;
    const path = url.pathname.toLowerCase();
    return {
      hostnameClass: hostname === 'www.facebook.com' ? 'FACEBOOK_WWW' : hostname === 'web.facebook.com' ? 'FACEBOOK_WEB' : 'FACEBOOK_ROOT',
      pathClass: path.includes('graphql') ? 'GRAPHQL' : path.startsWith('/ajax/') ? 'AJAX' : path.startsWith('/api/') ? 'API' : 'OTHER_FACEBOOK',
    };
  } catch { return null; }
}

function safeOperationName(postData) {
  if (typeof postData !== 'string' || postData.length === 0 || postData.length > MAX_RESPONSE_INSPECTION_BYTES) return null;
  try {
    const params = new URLSearchParams(postData);
    const candidate = params.get('fb_api_req_friendly_name') || params.get('operationName');
    return SAFE_OPERATION_NAME.test(candidate || '') ? candidate : null;
  } catch { /* try the bounded JSON shape */ }
  try {
    const value = JSON.parse(postData);
    return SAFE_OPERATION_NAME.test(value?.operationName || '') ? value.operationName : null;
  } catch { return null; }
}

function requestMetadata(request) {
  const urlClass = classifyUrl(request?.url?.());
  const method = String(request?.method?.() || '').toUpperCase();
  const resourceType = String(request?.resourceType?.() || '').toLowerCase();
  if (!urlClass || method !== 'POST' || !['fetch', 'xhr', 'document'].includes(resourceType)) return null;
  const operationName = safeOperationName(request?.postData?.());
  const pathRelevant = ['GRAPHQL', 'AJAX', 'API'].includes(urlClass.pathClass);
  const operationRelevant = /(?:composer|story|post|publish|create).*mutation|mutation.*(?:composer|story|post|publish|create)/i.test(operationName || '');
  if (!pathRelevant && !operationRelevant) return null;
  return { method, resourceType: resourceType.toUpperCase(), ...urlClass, operationName };
}

function errorEnvelope(value) {
  let errorsPresent = false; let permissionOrModerationFailure = false; let mutationAcknowledgement = false;
  const queue = [value]; let inspected = 0;
  while (queue.length && inspected < 128) {
    const current = queue.shift(); inspected += 1;
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) { queue.push(...current.slice(0, 16)); continue; }
    for (const [key, item] of Object.entries(current).slice(0, 24)) {
      const lowerKey = key.toLowerCase();
      if ((lowerKey === 'errors' && Array.isArray(item) && item.length > 0) || (lowerKey === 'error' && item !== null && item !== false && item !== '')) errorsPresent = true;
      if (['code', 'error_code', 'errorcode'].includes(lowerKey) && PERMISSION_OR_MODERATION_CODES.has(Number(item))) permissionOrModerationFailure = true;
      if (['message', 'error_user_msg', 'errorsummary', 'error_user_title'].includes(lowerKey)
        && /permission|not authorized|moderation|policy|blocked|spam|restrict/i.test(String(item || ''))) permissionOrModerationFailure = true;
      if (lowerKey === 'data' && item && typeof item === 'object') mutationAcknowledgement = true;
      if (item && typeof item === 'object') queue.push(item);
    }
  }
  return { errorsPresent, permissionOrModerationFailure, mutationAcknowledgement: mutationAcknowledgement && !errorsPresent };
}

async function classifyResponse(response) {
  const status = Math.max(0, Math.min(599, Number(response?.status?.()) || 0));
  if (status >= 500) return { status, statusClass: 'HTTP_5XX', responseClassification: 'SERVER_REJECTION' };
  if (status >= 400) return { status, statusClass: 'HTTP_4XX', responseClassification: 'CLIENT_REJECTION' };
  const statusClass = status >= 200 && status < 300 ? 'HTTP_2XX' : 'HTTP_OTHER';
  try {
    const text = await response.text();
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_INSPECTION_BYTES) return { status, statusClass, responseClassification: 'UNKNOWN_RESPONSE_SHAPE' };
    const envelope = errorEnvelope(JSON.parse(text));
    if (envelope.permissionOrModerationFailure) return { status, statusClass, responseClassification: 'PERMISSION_OR_MODERATION_FAILURE', graphqlErrorsPresent: envelope.errorsPresent };
    if (envelope.errorsPresent) return { status, statusClass, responseClassification: 'GRAPHQL_ERRORS_PRESENT', graphqlErrorsPresent: true };
    if (envelope.mutationAcknowledgement) return { status, statusClass, responseClassification: 'MUTATION_ACKNOWLEDGEMENT', graphqlErrorsPresent: false };
    return { status, statusClass, responseClassification: 'UNKNOWN_RESPONSE_SHAPE', graphqlErrorsPresent: false };
  } catch { return { status, statusClass, responseClassification: 'UNKNOWN_RESPONSE_SHAPE' }; }
}

function createFacebookSubmitTransportObserver(page, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const observationWindowMs = Math.max(1000, Math.min(30000, Number(options.observationWindowMs) || DEFAULT_WINDOW_MS));
  const responseDrainMs = Math.max(10, Math.min(2000, Number(options.responseDrainMs) || 1000));
  const state = { clickAt: null, clickTimestamp: null, clickReturnedTimestamp: null, composerHiddenTimestamp: null, acknowledgementTimestamp: null, reloadTimestamp: null, firstResponseTimestamp: null, requests: [], responses: [], requestFailures: [], consoleErrors: [], pageErrors: [], navigations: [], frameDetachCount: 0 };
  const relevantRequests = new WeakMap(); const pending = new Set(); const attachedHandlers = []; let listening = false; let stopped = false;
  const withinWindow = () => state.clickAt !== null && now() - state.clickAt <= observationWindowMs;
  const timed = () => ({ timestamp: timestamp(now()), relativeToClickMs: boundedRelative(now(), state.clickAt) });
  const push = (array, value) => { if (array.length < MAX_EVENTS) array.push(value); };

  const handlers = {
    request(request) {
      if (!withinWindow()) return;
      const metadata = requestMetadata(request); if (!metadata) return;
      relevantRequests.set(request, metadata); push(state.requests, { ...timed(), ...metadata });
    },
    response(response) {
      if (!withinWindow()) return;
      const request = response?.request?.(); const metadata = request && relevantRequests.get(request); if (!metadata || pending.size >= MAX_PENDING_RESPONSES || state.responses.length >= MAX_EVENTS) return;
      const timing = timed();
      if (!state.firstResponseTimestamp) state.firstResponseTimestamp = timing.timestamp;
      const status = Math.max(0, Math.min(599, Number(response?.status?.()) || 0));
      const entry = { ...timing, ...metadata, status, statusClass: status >= 500 ? 'HTTP_5XX' : status >= 400 ? 'HTTP_4XX' : status >= 200 && status < 300 ? 'HTTP_2XX' : 'HTTP_OTHER', responseClassification: status >= 500 ? 'SERVER_REJECTION' : status >= 400 ? 'CLIENT_REJECTION' : 'UNKNOWN_RESPONSE_SHAPE' };
      state.responses.push(entry);
      const work = classifyResponse(response).then((classified) => Object.assign(entry, classified)).catch(() => {});
      pending.add(work); work.finally(() => pending.delete(work));
    },
    requestfailed(request) {
      if (!withinWindow()) return;
      const metadata = relevantRequests.get(request) || requestMetadata(request); if (!metadata) return;
      const failure = String(request?.failure?.()?.errorText || '');
      const failureClass = /abort/i.test(failure) ? 'ABORTED' : /timeout/i.test(failure) ? 'TIMEOUT' : /internet|network|connection|dns/i.test(failure) ? 'NETWORK' : 'OTHER_SAFE_FAILURE';
      push(state.requestFailures, { ...timed(), ...metadata, failureClass });
    },
    console(message) {
      if (!withinWindow() || message?.type?.() !== 'error') return;
      const location = classifyUrl(message?.location?.()?.url);
      push(state.consoleErrors, { ...timed(), sourceClass: location?.pathClass || 'UNCLASSIFIED' });
    },
    pageerror(error) {
      if (!withinWindow()) return;
      const name = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(error?.name) ? error.name : 'OTHER_ERROR';
      push(state.pageErrors, { ...timed(), errorClass: name });
    },
    framenavigated(frame) {
      if (!withinWindow()) return;
      const location = classifyUrl(frame?.url?.()); if (!location) return;
      push(state.navigations, { ...timed(), ...location, mainFrame: frame === page?.mainFrame?.() });
    },
    framedetached() { if (withinWindow()) state.frameDetachCount = Math.min(MAX_EVENTS, state.frameDetachCount + 1); },
  };
  const boundHandlers = Object.fromEntries(Object.entries(handlers).map(([event, handler]) => [event, (...args) => { try { handler(...args); } catch { /* diagnostics never affect publishing */ } }]));

  function start() {
    if (listening || !page?.on) return;
    Object.entries(boundHandlers).forEach(([event, handler]) => { try { page.on(event, handler); attachedHandlers.push([event, handler]); } catch { /* unsupported event */ } });
    listening = attachedHandlers.length > 0;
  }
  function detach() {
    if (!listening) return;
    attachedHandlers.splice(0).forEach(([event, handler]) => { try { page.off?.(event, handler); } catch { /* already closed */ } }); listening = false;
  }
  function mark(field) { if (!state[field]) state[field] = timestamp(now()); }
  async function stop() {
    if (stopped) return buildSummary();
    stopped = true; detach();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, responseDrainMs);
      Promise.allSettled([...pending]).then(() => { clearTimeout(timer); resolve(); });
    });
    return buildSummary();
  }
  function buildSummary() {
    const explicitFailureObserved = state.requestFailures.length > 0 || state.responses.some((item) => ['HTTP_4XX', 'HTTP_5XX'].includes(item.statusClass) || ['GRAPHQL_ERRORS_PRESENT', 'PERMISSION_OR_MODERATION_FAILURE', 'SERVER_REJECTION', 'CLIENT_REJECTION'].includes(item.responseClassification));
    const transportClassification = state.requestFailures.length ? 'REQUEST_FAILED'
      : state.responses.some((item) => item.responseClassification === 'PERMISSION_OR_MODERATION_FAILURE') ? 'PERMISSION_OR_MODERATION_FAILURE'
        : state.responses.some((item) => item.responseClassification === 'GRAPHQL_ERRORS_PRESENT') ? 'GRAPHQL_ERRORS_PRESENT'
          : state.responses.some((item) => item.statusClass === 'HTTP_5XX') ? 'HTTP_5XX'
            : state.responses.some((item) => item.statusClass === 'HTTP_4XX') ? 'HTTP_4XX'
              : state.responses.some((item) => item.responseClassification === 'MUTATION_ACKNOWLEDGEMENT') ? 'MUTATION_ACKNOWLEDGEMENT'
                : state.responses.length ? 'TRANSPORT_RESPONSE_OBSERVED' : state.requests.length ? 'REQUEST_WITHOUT_RESPONSE' : 'NO_RELEVANT_REQUEST';
    return { observationWindowMs, clickTimestamp: state.clickTimestamp, clickReturnedTimestamp: state.clickReturnedTimestamp, composerHiddenTimestamp: state.composerHiddenTimestamp, acknowledgementTimestamp: state.acknowledgementTimestamp, reloadTimestamp: state.reloadTimestamp, firstRequestTimestamp: state.requests[0]?.timestamp || null, firstResponseTimestamp: state.firstResponseTimestamp, relevantRequestCount: state.requests.length, responseCount: state.responses.length, requestFailureCount: state.requestFailures.length, consoleErrorCount: state.consoleErrors.length, pageErrorCount: state.pageErrors.length, navigationCount: state.navigations.length, frameDetachCount: state.frameDetachCount, explicitFailureObserved, mutationAcknowledgementObserved: state.responses.some((item) => item.responseClassification === 'MUTATION_ACKNOWLEDGEMENT'), transportClassification, requests: state.requests, responses: state.responses, requestFailures: state.requestFailures, consoleErrors: state.consoleErrors, pageErrors: state.pageErrors, navigations: state.navigations };
  }

  return Object.freeze({ start, stop, markClickStarted() { if (state.clickAt === null) { state.clickAt = now(); state.clickTimestamp = timestamp(state.clickAt); } }, markClickReturned() { mark('clickReturnedTimestamp'); }, markComposerHidden() { mark('composerHiddenTimestamp'); }, markAcknowledgement() { mark('acknowledgementTimestamp'); }, markReload() { mark('reloadTimestamp'); } });
}

module.exports = { MAX_EVENTS, classifyUrl, safeOperationName, requestMetadata, classifyResponse, createFacebookSubmitTransportObserver };
