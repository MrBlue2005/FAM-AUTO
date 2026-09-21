'use strict';

const crypto = require('node:crypto');
const { canonicalFacebookGroupTarget, normalizeComposerText } = require('../local-agent/FacebookLiveReadiness');

const STORY_REFERENCE_RESULT = Object.freeze({
  VISIBLE_EXACT: 'VISIBLE_EXACT',
  VISIBLE_MISMATCH: 'VISIBLE_MISMATCH',
  PENDING: 'PENDING',
  NOT_FOUND: 'NOT_FOUND',
  INACCESSIBLE: 'INACCESSIBLE',
  UNSUPPORTED: 'UNSUPPORTED',
  AMBIGUOUS: 'AMBIGUOUS',
});
const MAX_STORY_REFERENCE_CANDIDATES = 8;
const MAX_STORY_REFERENCE_NODES = 512;
const STORY_ID_PATTERN = /^\d{1,32}$/;

function invalid(code, message) { return Object.assign(new Error(message), { code }); }

function storyReferenceUrls(expectedTarget, storyId) {
  const targetUrl = canonicalFacebookGroupTarget(expectedTarget);
  const id = String(storyId || '');
  if (!STORY_ID_PATTERN.test(id)) throw invalid('FACEBOOK_STORY_ID_INVALID', 'Facebook Story ID is invalid.');
  return Object.freeze({
    targetUrl,
    permalinkUrl: `${targetUrl}/posts/${id}/`,
    pendingUrl: `${targetUrl}/pending_posts/`,
  });
}

function bounded(value) { return Math.max(0, Math.min(MAX_STORY_REFERENCE_NODES, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0)); }

function safeObservation(value = {}, pathClass) {
  return Object.freeze({
    pathClass,
    routeSupported: value.routeSupported === true,
    targetMatched: value.targetMatched === true,
    storyPathMatched: value.storyPathMatched === true,
    storyBoundCandidateCount: Math.min(MAX_STORY_REFERENCE_CANDIDATES, bounded(value.storyBoundCandidateCount)),
    visibleStoryBoundCandidateCount: Math.min(MAX_STORY_REFERENCE_CANDIDATES, bounded(value.visibleStoryBoundCandidateCount)),
    exactTokenCandidateCount: Math.min(MAX_STORY_REFERENCE_CANDIDATES, bounded(value.exactTokenCandidateCount)),
    exactBodyCandidateCount: Math.min(MAX_STORY_REFERENCE_CANDIDATES, bounded(value.exactBodyCandidateCount)),
    pendingSignal: value.pendingSignal === true,
    explicitNotFound: value.explicitNotFound === true,
    explicitInaccessible: value.explicitInaccessible === true,
    ambiguous: value.ambiguous === true,
    boundsExceeded: value.boundsExceeded === true,
    nodesInspected: bounded(value.nodesInspected),
  });
}

function classifyObservation(permalink, pending) {
  if (permalink.explicitInaccessible) return STORY_REFERENCE_RESULT.INACCESSIBLE;
  if (permalink.explicitNotFound) return STORY_REFERENCE_RESULT.NOT_FOUND;
  if (!permalink.routeSupported || !permalink.targetMatched || !permalink.storyPathMatched) return STORY_REFERENCE_RESULT.UNSUPPORTED;
  if (permalink.ambiguous || permalink.boundsExceeded || permalink.visibleStoryBoundCandidateCount > 1) return STORY_REFERENCE_RESULT.AMBIGUOUS;
  if (permalink.visibleStoryBoundCandidateCount === 1) {
    return permalink.exactTokenCandidateCount === 1 && permalink.exactBodyCandidateCount === 1
      ? STORY_REFERENCE_RESULT.VISIBLE_EXACT : STORY_REFERENCE_RESULT.VISIBLE_MISMATCH;
  }
  if (!pending) return STORY_REFERENCE_RESULT.AMBIGUOUS;
  if (pending.explicitInaccessible) return STORY_REFERENCE_RESULT.INACCESSIBLE;
  if (pending.explicitNotFound) return STORY_REFERENCE_RESULT.NOT_FOUND;
  if (!pending.routeSupported || !pending.targetMatched) return STORY_REFERENCE_RESULT.UNSUPPORTED;
  if (pending.ambiguous || pending.boundsExceeded || pending.visibleStoryBoundCandidateCount > 1) return STORY_REFERENCE_RESULT.AMBIGUOUS;
  if (pending.visibleStoryBoundCandidateCount === 1 && pending.pendingSignal) return STORY_REFERENCE_RESULT.PENDING;
  return STORY_REFERENCE_RESULT.AMBIGUOUS;
}

async function captureStoryReferencePage(page, input) {
  if (!page || typeof page.evaluate !== 'function') return safeObservation({}, input.pathClass);
  const value = await page.evaluate(({ expectedHost, groupId, storyId, expectedToken, expectedBody, pathClass, candidateCap, nodeCap }) => {
    const normalize = (text) => String(text || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
    const visible = (node) => {
      try { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return node.isConnected && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0; } catch { return false; }
    };
    const locationUrl = new URL(location.href);
    const permalinkPath = `/groups/${groupId}/posts/${storyId}/`;
    const pendingPath = `/groups/${groupId}/pending_posts/`;
    const routeSupported = locationUrl.protocol === 'https:' && locationUrl.hostname.toLowerCase() === expectedHost
      && (pathClass === 'GROUP_STORY_PERMALINK' ? locationUrl.pathname === permalinkPath : locationUrl.pathname === pendingPath);
    const targetMatched = locationUrl.pathname.startsWith(`/groups/${groupId}/`);
    const storyPathMatched = locationUrl.pathname === permalinkPath;
    const allRoots = Array.from(document.querySelectorAll('[role="article"],article,[role="dialog"]')).filter(visible);
    const hasStoryLink = (root) => Array.from(root.querySelectorAll('a[href]')).slice(0, nodeCap).some((anchor) => {
      try { const url = new URL(anchor.href, location.href); return url.hostname.toLowerCase() === expectedHost && url.pathname === permalinkPath; } catch { return false; }
    });
    const tokenMatched = (root) => expectedToken && normalize(root.innerText || root.textContent).includes(expectedToken);
    let roots = allRoots.filter((root) => hasStoryLink(root));
    if (pathClass === 'GROUP_PENDING_STORIES') roots = roots.filter((root) => tokenMatched(root) || hasStoryLink(root));
    // Nested Facebook dialogs can expose the same permalink twice. Retain the
    // smallest bound surface so one object cannot become a false ambiguity.
    roots = roots.filter((root) => !roots.some((other) => other !== root && root.contains(other)));
    const boundsExceeded = roots.length > candidateCap;
    roots = roots.slice(0, candidateCap);
    let nodesInspected = 0; let exactBodyCandidateCount = 0; let exactTokenCandidateCount = 0; let nodeCapReached = false; let pendingSignal = false;
    for (const root of roots) {
      const rootText = normalize(root.innerText || root.textContent);
      if (expectedToken && rootText.includes(expectedToken)) exactTokenCandidateCount += 1;
      const descendants = [root, ...Array.from(root.querySelectorAll('div,span,p,section'))];
      if (descendants.length > nodeCap) nodeCapReached = true;
      const inspected = descendants.slice(0, nodeCap); nodesInspected += inspected.length;
      if (inspected.some((node) => visible(node) && normalize(node.innerText || node.textContent) === expectedBody)) exactBodyCandidateCount += 1;
      const semantic = rootText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (/pending|awaiting|submitted for approval|in asteptare|in curs de verificare|in curs de revizuire|trimisa spre aprobare|asteapta aprobarea/.test(semantic)) pendingSignal = true;
    }
    const visibleText = Array.from(document.querySelectorAll('[role="dialog"],[role="alert"],main')).filter(visible).slice(0, 16).map((node) => normalize(node.innerText || node.textContent).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
    const explicitInaccessible = /^\/(?:login|checkpoint|challenge|recover|security)(?:\/|$)/i.test(locationUrl.pathname)
      || Boolean(document.querySelector('input[name="email"],input[name="pass"],form[action*="login" i]'))
      || visibleText.some((text) => /you don.t have permission|access denied|nu ai permisiunea|nu ai acces/.test(text));
    const explicitNotFound = visibleText.some((text) => /content isn.t available|content not available|content not found|continutul nu este disponibil|postarea nu este disponibila|post was removed|postarea a fost stearsa/.test(text));
    return {
      routeSupported, targetMatched, storyPathMatched,
      storyBoundCandidateCount: roots.length, visibleStoryBoundCandidateCount: roots.filter(visible).length,
      exactTokenCandidateCount, exactBodyCandidateCount, pendingSignal,
      explicitNotFound, explicitInaccessible, ambiguous: false,
      boundsExceeded: boundsExceeded || nodeCapReached, nodesInspected,
    };
  }, {
    expectedHost: 'www.facebook.com', groupId: input.groupId, storyId: input.storyId,
    expectedToken: input.expectedToken, expectedBody: input.expectedBody, pathClass: input.pathClass,
    candidateCap: MAX_STORY_REFERENCE_CANDIDATES, nodeCap: MAX_STORY_REFERENCE_NODES,
  });
  return safeObservation(value, input.pathClass);
}

async function navigateAndCapture(page, url, input, options) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeoutMs });
    if (typeof page.waitForTimeout === 'function' && options.settleMs > 0) await page.waitForTimeout(options.settleMs);
    return await options.capture(page, input);
  } catch {
    return safeObservation({ explicitInaccessible: true }, input.pathClass);
  }
}

async function verifyFacebookStoryReference(page, input = {}, options = {}) {
  if (!page || typeof page.goto !== 'function' || typeof page.evaluate !== 'function') {
    return Object.freeze({ result: STORY_REFERENCE_RESULT.UNSUPPORTED, storyId: null, pathClass: 'UNSUPPORTED', targetMatched: false, visible: false, pending: false, tokenMatched: false, bodyHashMatched: false, expectedBodySha256: null, verifiedAt: new Date(options.now?.() || Date.now()).toISOString() });
  }
  const urls = storyReferenceUrls(input.expectedTarget, input.storyId);
  const expectedBody = normalizeComposerText(input.expectedBody);
  const expectedToken = String(input.expectedToken || '');
  if (!expectedBody || !expectedToken || expectedToken.length > 128 || !expectedBody.includes(expectedToken)) throw invalid('FACEBOOK_STORY_EXPECTATION_INVALID', 'Story verification requires a bounded token contained in the exact expected body.');
  const configured = {
    capture: typeof options.capture === 'function' ? options.capture : captureStoryReferencePage,
    now: typeof options.now === 'function' ? options.now : Date.now,
    navigationTimeoutMs: Math.max(1000, Math.min(60000, Number(options.navigationTimeoutMs) || 30000)),
    settleMs: Math.max(0, Math.min(10000, Number(options.settleMs) || 3000)),
  };
  const common = { groupId: urls.targetUrl.split('/').pop(), storyId: String(input.storyId), expectedToken, expectedBody };
  const permalink = safeObservation(await navigateAndCapture(page, urls.permalinkUrl, { ...common, pathClass: 'GROUP_STORY_PERMALINK' }, configured), 'GROUP_STORY_PERMALINK');
  let pending = null;
  if (permalink.routeSupported && !permalink.explicitInaccessible && !permalink.explicitNotFound && permalink.visibleStoryBoundCandidateCount === 0 && !permalink.ambiguous && !permalink.boundsExceeded) {
    pending = safeObservation(await navigateAndCapture(page, urls.pendingUrl, { ...common, pathClass: 'GROUP_PENDING_STORIES' }, configured), 'GROUP_PENDING_STORIES');
  }
  const result = classifyObservation(permalink, pending);
  const decisive = result === STORY_REFERENCE_RESULT.PENDING ? pending : permalink;
  return Object.freeze({
    result, storyId: String(input.storyId), pathClass: decisive?.pathClass || permalink.pathClass,
    targetMatched: decisive?.targetMatched === true, visible: [STORY_REFERENCE_RESULT.VISIBLE_EXACT, STORY_REFERENCE_RESULT.VISIBLE_MISMATCH].includes(result), pending: result === STORY_REFERENCE_RESULT.PENDING,
    tokenMatched: decisive?.exactTokenCandidateCount === 1, bodyHashMatched: decisive?.exactBodyCandidateCount === 1,
    expectedBodySha256: crypto.createHash('sha256').update(expectedBody, 'utf8').digest('hex'),
    verifiedAt: new Date(configured.now()).toISOString(),
    evidence: Object.freeze({ routeSupported: decisive?.routeSupported === true, storyPathMatched: decisive?.storyPathMatched === true, storyBoundCandidateCount: decisive?.storyBoundCandidateCount || 0, nodesInspected: decisive?.nodesInspected || 0, boundsExceeded: decisive?.boundsExceeded === true }),
  });
}

module.exports = {
  MAX_STORY_REFERENCE_CANDIDATES,
  MAX_STORY_REFERENCE_NODES,
  STORY_REFERENCE_RESULT,
  captureStoryReferencePage,
  classifyObservation,
  safeObservation,
  storyReferenceUrls,
  verifyFacebookStoryReference,
};
