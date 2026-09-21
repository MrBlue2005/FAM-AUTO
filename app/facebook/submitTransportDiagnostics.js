'use strict';

const crypto = require('node:crypto');

const MAX_EVENTS = 8;
const MAX_PENDING_RESPONSES = 8;
const MAX_RESPONSE_INSPECTION_BYTES = 64 * 1024;
const DEFAULT_WINDOW_MS = 30000;
const SAFE_OPERATION_NAME = /^(?=[A-Za-z][A-Za-z0-9_]{0,79}$)(?=[A-Za-z0-9_]*(?:Composer|Story|Post|Publish|Create)[A-Za-z0-9_]*Mutation$)[A-Za-z0-9_]+$/;
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'web.facebook.com']);
const PERMISSION_OR_MODERATION_CODES = new Set([10, 190, 200, 368, 506, 1357004]);
const COMPOSER_CREATE_OPERATION = 'ComposerStoryCreateMutation';
const SAFE_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const SAFE_TYPENAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const PENDING_STATUSES = new Set(['PENDING', 'PENDING_APPROVAL', 'PENDING_REVIEW', 'AWAITING_APPROVAL', 'AWAITING_REVIEW', 'SUBMITTED_FOR_APPROVAL', 'IN_REVIEW']);
const FAILURE_STATUSES = new Set(['FAILED', 'FAILURE', 'ERROR', 'REJECTED', 'DENIED', 'BLOCKED', 'NOT_AUTHORIZED', 'PERMISSION_DENIED', 'POLICY_VIOLATION']);
const SUCCESS_STATUSES = new Set(['SUCCESS', 'SUCCEEDED', 'OK', 'CREATED', 'PUBLISHED', 'ACCEPTED']);
const MAX_STRUCTURAL_DEPTH = 5;
const MAX_STRUCTURAL_PATHS = 32;
const MAX_STRUCTURAL_KEYS_PER_OBJECT = 16;
const MAX_STRUCTURAL_ARRAY_ITEMS = 3;
const SAFE_STRUCTURAL_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;
const PRIVATE_STRUCTURAL_KEY = /(?:message|body|text|content|caption|description|actor|author|user|profile|name|token|session|auth|cookie|header|comment|attachment|media|image|video|url|uri|email|phone|password|secret)/i;

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
    if (candidate) return SAFE_OPERATION_NAME.test(candidate) ? candidate : null;
  } catch { /* try the bounded JSON shape */ }
  try {
    const value = JSON.parse(postData);
    return SAFE_OPERATION_NAME.test(value?.operationName || '') ? value.operationName : null;
  } catch { return null; }
}

function safeDocumentId(postData) {
  if (typeof postData !== 'string' || postData.length === 0 || postData.length > MAX_RESPONSE_INSPECTION_BYTES) return null;
  try {
    const value = new URLSearchParams(postData).get('doc_id');
    if (value) return /^\d{1,32}$/.test(value) ? value : null;
  } catch { /* try the bounded JSON shape */ }
  try {
    const value = JSON.parse(postData)?.doc_id;
    return /^\d{1,32}$/.test(String(value || '')) ? String(value) : null;
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
  return { method, resourceType: resourceType.toUpperCase(), ...urlClass, operationName, documentId: safeDocumentId(request?.postData?.()) };
}

function normalizeKey(value) { return String(value || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase(); }
function safeOpaqueId(value) { return typeof value === 'string' || typeof value === 'number' ? SAFE_OPAQUE_ID.test(String(value)) ? String(value) : null : null; }
function safeEnum(value) { const result = String(value || '').toUpperCase(); return /^[A-Z][A-Z0-9_]{0,47}$/.test(result) ? result : null; }

function structuralValueKind(value) {
  if (value === null) return 'NULL';
  if (Array.isArray(value)) return value.length === 0 ? 'ARRAY_EMPTY' : value.length === 1 ? 'ARRAY_ONE' : value.length <= 4 ? 'ARRAY_FEW' : 'ARRAY_MANY';
  if (typeof value === 'object') return 'OBJECT';
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return 'NUMBER';
  return 'OTHER';
}

function structuralFingerprint(value) {
  const paths = [];
  let maxDepthObserved = 0; let depthLimitReached = false; let pathLimitReached = false; let keyLimitReached = false;
  const add = (path, kind) => {
    if (paths.length >= MAX_STRUCTURAL_PATHS) { pathLimitReached = true; return false; }
    paths.push(`${path || '$'}:${kind}`); return true;
  };
  function visit(node, path, depth) {
    maxDepthObserved = Math.max(maxDepthObserved, depth);
    if (!add(path, structuralValueKind(node))) return;
    if (!node || typeof node !== 'object') return;
    if (depth >= MAX_STRUCTURAL_DEPTH) { depthLimitReached = true; return; }
    if (Array.isArray(node)) {
      node.slice(0, MAX_STRUCTURAL_ARRAY_ITEMS).forEach((item) => visit(item, `${path || '$'}[]`, depth + 1));
      if (node.length > MAX_STRUCTURAL_ARRAY_ITEMS) keyLimitReached = true;
      return;
    }
    const keys = Object.keys(node).filter((key) => SAFE_STRUCTURAL_KEY.test(key) && !PRIVATE_STRUCTURAL_KEY.test(key)).sort();
    if (keys.length > MAX_STRUCTURAL_KEYS_PER_OBJECT) keyLimitReached = true;
    keys.slice(0, MAX_STRUCTURAL_KEYS_PER_OBJECT).forEach((key) => visit(node[key], `${path || '$'}.${key}`, depth + 1));
  }
  visit(value, '$', 0);
  const normalized = paths.join('\n');
  return {
    version: 1,
    topLevelKind: structuralValueKind(value),
    pathCount: paths.length,
    maxDepthObserved: Math.min(MAX_STRUCTURAL_DEPTH, maxDepthObserved),
    depthLimitReached,
    pathLimitReached,
    keyLimitReached,
    paths,
    sha256: crypto.createHash('sha256').update(normalized, 'utf8').digest('hex'),
  };
}

function inspectEnvelope(value, operationName) {
  const topLevelGraphqlErrors = Array.isArray(value?.errors) && value.errors.length > 0;
  const evidence = {
    errorsPresent: topLevelGraphqlErrors, permissionOrModerationFailure: false, mutationAcknowledgement: false,
    storyId: null, postId: null, feedbackId: null, creationId: null, pendingPostId: null, submissionId: null,
    resultTypename: null, resultStatus: null, semanticSuccess: null, pendingStateObserved: false, embeddedSemanticFailureObserved: false,
  };
  const queue = [{ value, path: [], depth: 0 }]; let inspected = 0;
  while (queue.length && inspected < 128) {
    const node = queue.shift(); const current = node.value; inspected += 1;
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) { if (node.depth < 12) current.slice(0, 16).forEach((item) => queue.push({ value: item, path: node.path, depth: node.depth + 1 })); continue; }
    for (const [key, item] of Object.entries(current).slice(0, 24)) {
      const lowerKey = key.toLowerCase();
      const normalizedKey = normalizeKey(key); const parentKey = normalizeKey(node.path[node.path.length - 1]);
      const opaque = safeOpaqueId(item);
      if (lowerKey === 'data' && item && typeof item === 'object') evidence.mutationAcknowledgement = true;
      if (['error', 'errors', 'failure', 'failures'].includes(lowerKey) && item !== null && item !== false && item !== '' && (!Array.isArray(item) || item.length > 0)) evidence.embeddedSemanticFailureObserved = true;
      if (['code', 'error_code', 'errorcode'].includes(lowerKey) && PERMISSION_OR_MODERATION_CODES.has(Number(item))) evidence.permissionOrModerationFailure = true;
      if (['message', 'error_user_msg', 'errorsummary', 'error_user_title'].includes(lowerKey)
        && /permission|not authorized|moderation|policy|blocked|spam|restrict/i.test(String(item || ''))) evidence.permissionOrModerationFailure = true;
      if (normalizedKey === 'typename' && SAFE_TYPENAME.test(String(item || '')) && !evidence.resultTypename
        && /(?:create|story|post|feedback|submission|mutation|result)/i.test(`${parentKey}${item}`)) evidence.resultTypename = String(item);
      if (['status', 'publishstatus', 'publicationstatus', 'submissionstatus', 'moderationstatus', 'state'].includes(normalizedKey)) {
        const status = safeEnum(item);
        if (status && (PENDING_STATUSES.has(status) || FAILURE_STATUSES.has(status) || SUCCESS_STATUSES.has(status))) evidence.resultStatus = evidence.resultStatus || status;
        if (PENDING_STATUSES.has(status)) evidence.pendingStateObserved = true;
        if (FAILURE_STATUSES.has(status)) evidence.embeddedSemanticFailureObserved = true;
      }
      if (['success', 'issuccess', 'succeeded', 'didcreate', 'created'].includes(normalizedKey) && typeof item === 'boolean') {
        evidence.semanticSuccess = item; if (item === false) evidence.embeddedSemanticFailureObserved = true;
      }
      if (opaque) {
        if (['storyid', 'legacystoryid', 'legacystoryhideableid'].includes(normalizedKey) || (normalizedKey === 'id' && /^(story|storycreate|createdstory)$/.test(parentKey))) evidence.storyId = evidence.storyId || opaque;
        else if (['postid', 'createdpostid'].includes(normalizedKey) || (normalizedKey === 'id' && /^(post|postcreate|createdpost)$/.test(parentKey))) evidence.postId = evidence.postId || opaque;
        else if (['feedbackid'].includes(normalizedKey) || (normalizedKey === 'id' && parentKey === 'feedback')) evidence.feedbackId = evidence.feedbackId || opaque;
        else if (['pendingpostid'].includes(normalizedKey) || (normalizedKey === 'id' && parentKey === 'pendingpost')) evidence.pendingPostId = evidence.pendingPostId || opaque;
        else if (['submissionid'].includes(normalizedKey) || (normalizedKey === 'id' && parentKey === 'submission')) evidence.submissionId = evidence.submissionId || opaque;
        else if (['creationid', 'clientmutationid'].includes(normalizedKey)) evidence.creationId = evidence.creationId || opaque;
      }
      if (item && typeof item === 'object' && node.depth < 12) queue.push({ value: item, path: [...node.path, key].slice(-8), depth: node.depth + 1 });
    }
  }
  evidence.mutationAcknowledgement = evidence.mutationAcknowledgement && !evidence.errorsPresent;
  if (operationName !== COMPOSER_CREATE_OPERATION) return evidence;
  if (evidence.permissionOrModerationFailure || evidence.embeddedSemanticFailureObserved) evidence.responseClassification = 'CREATE_RESULT_EXPLICIT_FAILURE';
  else if (evidence.pendingStateObserved || evidence.pendingPostId || evidence.submissionId) evidence.responseClassification = 'CREATE_RESULT_PENDING';
  else if (evidence.storyId) evidence.responseClassification = 'CREATE_RESULT_WITH_STORY_ID';
  else if (evidence.postId) evidence.responseClassification = 'CREATE_RESULT_WITH_POST_ID';
  else if (evidence.feedbackId) evidence.responseClassification = 'CREATE_RESULT_WITH_FEEDBACK_ID';
  else if (evidence.semanticSuccess === true || SUCCESS_STATUSES.has(evidence.resultStatus)) evidence.responseClassification = 'CREATE_RESULT_ACK_WITHOUT_OBJECT';
  else evidence.responseClassification = 'CREATE_RESULT_UNKNOWN';
  return evidence;
}

function safeResponseEvidence(envelope) {
  return {
    graphqlErrorsPresent: envelope.errorsPresent,
    resultTypename: envelope.resultTypename,
    resultStatus: envelope.resultStatus,
    semanticSuccess: envelope.semanticSuccess,
    storyIdPresent: Boolean(envelope.storyId), storyId: envelope.storyId,
    postIdPresent: Boolean(envelope.postId), postId: envelope.postId,
    feedbackIdPresent: Boolean(envelope.feedbackId), feedbackId: envelope.feedbackId,
    creationIdPresent: Boolean(envelope.creationId), creationId: envelope.creationId,
    pendingPostIdPresent: Boolean(envelope.pendingPostId), pendingPostId: envelope.pendingPostId,
    submissionIdPresent: Boolean(envelope.submissionId), submissionId: envelope.submissionId,
    pendingStateObserved: envelope.pendingStateObserved,
    embeddedSemanticFailureObserved: envelope.embeddedSemanticFailureObserved,
  };
}

async function classifyResponse(response, metadata = {}) {
  const status = Math.max(0, Math.min(599, Number(response?.status?.()) || 0));
  if (status >= 500) return { status, statusClass: 'HTTP_5XX', responseClassification: 'SERVER_REJECTION' };
  if (status >= 400) return { status, statusClass: 'HTTP_4XX', responseClassification: 'CLIENT_REJECTION' };
  const statusClass = status >= 200 && status < 300 ? 'HTTP_2XX' : 'HTTP_OTHER';
  try {
    const text = await response.text();
    if (typeof text !== 'string') return { status, statusClass, responseClassification: 'UNKNOWN_RESPONSE_SHAPE', structuralFingerprintReason: 'BODY_UNAVAILABLE' };
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_INSPECTION_BYTES) return { status, statusClass, responseClassification: 'UNKNOWN_RESPONSE_SHAPE', structuralFingerprintReason: 'RESPONSE_TOO_LARGE' };
    const operationName = metadata.operationName || safeOperationName(response?.request?.()?.postData?.());
    const parsed = JSON.parse(text);
    const envelope = inspectEnvelope(parsed, operationName);
    if (envelope.permissionOrModerationFailure && envelope.errorsPresent) return { status, statusClass, responseClassification: 'PERMISSION_OR_MODERATION_FAILURE', graphqlErrorsPresent: true };
    if (envelope.errorsPresent) return { status, statusClass, responseClassification: 'GRAPHQL_ERRORS_PRESENT', graphqlErrorsPresent: true };
    if (operationName === COMPOSER_CREATE_OPERATION) {
      const result = { status, statusClass, responseClassification: envelope.responseClassification, ...safeResponseEvidence(envelope) };
      if (envelope.responseClassification === 'CREATE_RESULT_UNKNOWN') result.structuralFingerprint = structuralFingerprint(parsed);
      return result;
    }
    if (envelope.permissionOrModerationFailure) return { status, statusClass, responseClassification: 'PERMISSION_OR_MODERATION_FAILURE', graphqlErrorsPresent: false };
    if (envelope.mutationAcknowledgement) return { status, statusClass, responseClassification: 'MUTATION_ACKNOWLEDGEMENT', ...safeResponseEvidence(envelope) };
    return { status, statusClass, responseClassification: 'UNKNOWN_RESPONSE_SHAPE', graphqlErrorsPresent: false, structuralFingerprintReason: 'UNRECOGNIZED_STRUCTURE', structuralFingerprint: structuralFingerprint(parsed) };
  } catch { return { status, statusClass, responseClassification: 'UNKNOWN_RESPONSE_SHAPE', structuralFingerprintReason: 'MALFORMED_JSON' }; }
}

const OPAQUE_ID_FIELDS = ['storyId', 'postId', 'feedbackId', 'pendingPostId', 'submissionId'];
function sharedOpaqueIdTypes(left, right) { return OPAQUE_ID_FIELDS.filter((key) => left?.[key] && left[key] === right?.[key]).map((key) => key.replace(/Id$/, '').toUpperCase()); }

function correlateResponses(responses) {
  const primary = responses.find((item) => item.operationName === COMPOSER_CREATE_OPERATION);
  if (!primary) return;
  primary.correlation = 'PRIMARY_CREATE_RESPONSE';
  const primaryIndex = responses.indexOf(primary);
  responses.forEach((item, index) => {
    if (item === primary || item.pathClass !== 'GRAPHQL') return;
    item.sharedOpaqueIdTypes = sharedOpaqueIdTypes(primary, item);
    item.correlation = item.sharedOpaqueIdTypes.length ? 'PROVEN_SHARED_ID'
      : item.operationName === COMPOSER_CREATE_OPERATION || (item.documentId && primary.documentId && item.documentId === primary.documentId) ? 'PROVEN_REQUEST_CHAIN'
        : index > primaryIndex ? 'LIKELY_TEMPORAL_ONLY' : 'UNPROVEN';
  });
}

function compactResponseSummary(item, responseIndex) {
  if (!item) return null;
  return {
    responseIndex,
    timestamp: item.timestamp,
    relativeToClickMs: item.relativeToClickMs,
    requestCorrelationId: item.requestCorrelationId,
    operationName: item.operationName,
    documentId: item.documentId,
    status: item.status,
    statusClass: item.statusClass,
    responseClassification: item.responseClassification,
    graphqlErrorsPresent: item.graphqlErrorsPresent === true,
    correlation: item.correlation || 'UNPROVEN',
    sharedOpaqueIdTypes: item.sharedOpaqueIdTypes || [],
    structuralFingerprint: item.structuralFingerprint || null,
    structuralFingerprintReason: item.structuralFingerprintReason || null,
  };
}

function classifyConsoleError(text) {
  const value = String(text || '');
  if (/extension|chrome-extension:|moz-extension:/i.test(value)) return 'EXTENSION_NOISE';
  if (/network|fetch|connection|dns|ERR_/i.test(value)) return 'NETWORK';
  if (/graphql|mutation|query/i.test(value)) return 'GRAPHQL';
  if (/permission|not authorized|forbidden|denied/i.test(value)) return 'PERMISSION';
  if (/react|hydration|component|render/i.test(value)) return 'REACT_UI';
  if (/telemetry|logging|analytics|pixel/i.test(value)) return 'PLATFORM_TELEMETRY';
  return 'UNKNOWN';
}

function createdObjectVerificationReference(responses) {
  const primary = responses.find((item) => item.operationName === COMPOSER_CREATE_OPERATION);
  if (!primary) return null;
  if (primary.storyId) return { objectType: 'STORY', opaqueId: primary.storyId };
  if (primary.postId) return { objectType: 'POST', opaqueId: primary.postId };
  if (primary.feedbackId) return { objectType: 'FEEDBACK', opaqueId: primary.feedbackId };
  return null;
}

function createFacebookSubmitTransportObserver(page, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const observationWindowMs = Math.max(1000, Math.min(30000, Number(options.observationWindowMs) || DEFAULT_WINDOW_MS));
  const responseDrainMs = Math.max(10, Math.min(2000, Number(options.responseDrainMs) || 1000));
  const state = { clickAt: null, clickTimestamp: null, clickReturnedTimestamp: null, composerHiddenTimestamp: null, acknowledgementTimestamp: null, reloadTimestamp: null, firstResponseTimestamp: null, requests: [], responses: [], requestFailures: [], consoleErrors: [], pageErrors: [], navigations: [], frameDetachCount: 0 };
  const relevantRequests = new WeakMap(); const pending = new Set(); const attachedHandlers = []; let listening = false; let stopped = false; let requestSequence = 0;
  const withinWindow = () => state.clickAt !== null && now() - state.clickAt <= observationWindowMs;
  const timed = () => ({ timestamp: timestamp(now()), relativeToClickMs: boundedRelative(now(), state.clickAt) });
  const push = (array, value) => { if (array.length < MAX_EVENTS) array.push(value); };

  const handlers = {
    request(request) {
      if (!withinWindow()) return;
      const metadata = requestMetadata(request); if (!metadata) return;
      metadata.requestCorrelationId = `REQ_${Math.min(MAX_EVENTS, ++requestSequence)}`;
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
      const work = classifyResponse(response, metadata).then((classified) => Object.assign(entry, classified)).catch(() => {});
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
      push(state.consoleErrors, { ...timed(), sourceClass: location?.pathClass || 'UNCLASSIFIED', category: classifyConsoleError(message?.text?.()) });
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
    correlateResponses(state.responses);
    const primaryIndex = state.responses.findIndex((item) => item.operationName === COMPOSER_CREATE_OPERATION);
    const secondaryIndex = primaryIndex < 0 ? -1 : state.responses.findIndex((item, index) => index > primaryIndex && item.responseClassification === 'MUTATION_ACKNOWLEDGEMENT');
    const consoleErrorSummary = state.consoleErrors.reduce((summary, item) => { summary.counts[item.category] = (summary.counts[item.category] || 0) + 1; return summary; }, { counts: {} });
    const explicitFailureObserved = state.requestFailures.length > 0 || state.responses.some((item) => ['HTTP_4XX', 'HTTP_5XX'].includes(item.statusClass) || ['GRAPHQL_ERRORS_PRESENT', 'PERMISSION_OR_MODERATION_FAILURE', 'CREATE_RESULT_EXPLICIT_FAILURE', 'SERVER_REJECTION', 'CLIENT_REJECTION'].includes(item.responseClassification));
    const transportClassification = state.requestFailures.length ? 'REQUEST_FAILED'
      : state.responses.some((item) => item.responseClassification === 'PERMISSION_OR_MODERATION_FAILURE') ? 'PERMISSION_OR_MODERATION_FAILURE'
        : state.responses.some((item) => item.responseClassification === 'GRAPHQL_ERRORS_PRESENT') ? 'GRAPHQL_ERRORS_PRESENT'
          : state.responses.some((item) => item.responseClassification === 'CREATE_RESULT_EXPLICIT_FAILURE') ? 'CREATE_RESULT_EXPLICIT_FAILURE'
          : state.responses.some((item) => item.statusClass === 'HTTP_5XX') ? 'HTTP_5XX'
            : state.responses.some((item) => item.statusClass === 'HTTP_4XX') ? 'HTTP_4XX'
              : state.responses.some((item) => item.responseClassification === 'MUTATION_ACKNOWLEDGEMENT') ? 'MUTATION_ACKNOWLEDGEMENT'
                : state.responses.length ? 'TRANSPORT_RESPONSE_OBSERVED' : state.requests.length ? 'REQUEST_WITHOUT_RESPONSE' : 'NO_RELEVANT_REQUEST';
    return { observationWindowMs, clickTimestamp: state.clickTimestamp, clickReturnedTimestamp: state.clickReturnedTimestamp, composerHiddenTimestamp: state.composerHiddenTimestamp, acknowledgementTimestamp: state.acknowledgementTimestamp, reloadTimestamp: state.reloadTimestamp, firstRequestTimestamp: state.requests[0]?.timestamp || null, firstResponseTimestamp: state.firstResponseTimestamp, relevantRequestCount: state.requests.length, responseCount: state.responses.length, requestFailureCount: state.requestFailures.length, consoleErrorCount: state.consoleErrors.length, pageErrorCount: state.pageErrors.length, navigationCount: state.navigations.length, frameDetachCount: state.frameDetachCount, explicitFailureObserved, mutationAcknowledgementObserved: state.responses.some((item) => item.responseClassification === 'MUTATION_ACKNOWLEDGEMENT'), transportClassification, createdObjectVerificationReference: createdObjectVerificationReference(state.responses), primaryMutationSummary: compactResponseSummary(state.responses[primaryIndex], primaryIndex), secondaryAcknowledgementSummary: compactResponseSummary(state.responses[secondaryIndex], secondaryIndex), consoleErrorSummary, requests: state.requests, responses: state.responses, requestFailures: state.requestFailures, consoleErrors: state.consoleErrors, pageErrors: state.pageErrors, navigations: state.navigations };
  }

  return Object.freeze({ start, stop, markClickStarted() { if (state.clickAt === null) { state.clickAt = now(); state.clickTimestamp = timestamp(state.clickAt); } }, markClickReturned() { mark('clickReturnedTimestamp'); }, markComposerHidden() { mark('composerHiddenTimestamp'); }, markAcknowledgement() { mark('acknowledgementTimestamp'); }, markReload() { mark('reloadTimestamp'); } });
}

module.exports = { MAX_EVENTS, MAX_STRUCTURAL_DEPTH, MAX_STRUCTURAL_PATHS, classifyUrl, safeOperationName, safeDocumentId, requestMetadata, structuralFingerprint, classifyResponse, createdObjectVerificationReference, classifyConsoleError, createFacebookSubmitTransportObserver };
