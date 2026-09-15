'use strict';

// This module is deliberately observation-only.  It never supplies a success
// predicate and must not retain Facebook text, accessible names, or DOM IDs.
const ACKNOWLEDGEMENT_PATTERN = /postarea (ta )?(a fost|este acum) publicat[ăa]|your post (was|is now) published/i;
const MAX_ACKNOWLEDGEMENT_CANDIDATES = 16;
const MAX_ACKNOWLEDGEMENT_SNAPSHOTS = 6;
const SNAPSHOT_DELAYS_MS = Object.freeze([0, 250, 1000, 5000, 30000, 90000]);

function elapsedBucket(value) {
  const elapsed = Math.max(0, Number(value) || 0);
  if (elapsed < 1000) return 'UNDER_1_SECOND';
  if (elapsed < 5000) return 'UNDER_5_SECONDS';
  if (elapsed < 30000) return 'UNDER_30_SECONDS';
  if (elapsed < 120000) return 'UNDER_120_SECONDS';
  return 'AT_OR_OVER_TIMEOUT';
}

function safeCandidate(value = {}) {
  return {
    key: String(value.key || ''),
    candidateFamily: ['CURRENT_TEXT_MATCH', 'ROLE_STATUS', 'ROLE_ALERT', 'ARIA_LIVE_REGION', 'OTHER_SAFE_ACK_SURFACE'].includes(value.candidateFamily) ? value.candidateFamily : 'OTHER_SAFE_ACK_SURFACE',
    tagName: ['DIV', 'SPAN', 'P', 'SECTION', 'OTHER'].includes(value.tagName) ? value.tagName : 'OTHER',
    role: [null, 'status', 'alert', 'other'].includes(value.role) ? value.role : 'other',
    visible: value.visible === true,
    attached: value.attached === true,
    ariaLive: ['OFF', 'POLITE', 'ASSERTIVE', 'OTHER', 'NONE'].includes(value.ariaLive) ? value.ariaLive : 'NONE',
    textClassification: ['MATCHES_CURRENT_ACK_PATTERN', 'NON_MATCHING_TEXT_PRESENT', 'EMPTY_OR_UNAVAILABLE', 'SAFE_TEXT_EVALUATION_ERROR'].includes(value.textClassification) ? value.textClassification : 'SAFE_TEXT_EVALUATION_ERROR',
    accessibilityClassification: ['MATCHES_CURRENT_ACK_PATTERN', 'NON_MATCHING_ACCESSIBLE_NAME_PRESENT', 'EMPTY_OR_UNAVAILABLE', 'SAFE_ACCESSIBILITY_EVALUATION_ERROR'].includes(value.accessibilityClassification) ? value.accessibilityClassification : 'SAFE_ACCESSIBILITY_EVALUATION_ERROR',
    nestedTextPresent: value.nestedTextPresent === true,
    candidateDepth: Math.max(0, Math.min(1000, Number.isFinite(Number(value.candidateDepth)) ? Math.trunc(Number(value.candidateDepth)) : 0)),
  };
}

async function inspectAcknowledgementShapes(page) {
  if (!page || typeof page.evaluate !== 'function') return { result: 'UNAVAILABLE', candidates: [] };
  try {
    const candidates = await page.evaluate(({ source, flags }) => {
      const expression = new RegExp(source, flags);
      const visible = (node) => {
        const style = window.getComputedStyle(node); const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const depth = (node) => { let value = 0; let current = node; while (current?.parentElement && value < 1000) { value += 1; current = current.parentElement; } return value; };
      const ariaLive = (node) => { const value = String(node.getAttribute('aria-live') || '').trim().toLowerCase(); return value === 'off' ? 'OFF' : value === 'polite' ? 'POLITE' : value === 'assertive' ? 'ASSERTIVE' : value ? 'OTHER' : 'NONE'; };
      const tagName = (node) => ['DIV', 'SPAN', 'P', 'SECTION'].includes(node.tagName) ? node.tagName : 'OTHER';
      const role = (node) => { const value = String(node.getAttribute('role') || '').trim().toLowerCase(); return value === 'status' || value === 'alert' ? value : value ? 'other' : null; };
      const readText = (node) => { try { const value = String(node.innerText || node.textContent || '').trim(); return value ? (expression.test(value) ? 'MATCHES_CURRENT_ACK_PATTERN' : 'NON_MATCHING_TEXT_PRESENT') : 'EMPTY_OR_UNAVAILABLE'; } catch { return 'SAFE_TEXT_EVALUATION_ERROR'; } };
      const readAccessibility = (node) => { try { const value = String(node.getAttribute('aria-label') || node.getAttribute('title') || '').trim(); return value ? (expression.test(value) ? 'MATCHES_CURRENT_ACK_PATTERN' : 'NON_MATCHING_ACCESSIBLE_NAME_PRESENT') : 'EMPTY_OR_UNAVAILABLE'; } catch { return 'SAFE_ACCESSIBILITY_EVALUATION_ERROR'; } };
      const selector = '[role="status"], [role="alert"], [aria-live], [aria-label], [title]';
      const out = [];
      for (const [index, node] of Array.from(document.querySelectorAll(selector)).slice(0, 160).entries()) {
        const candidateRole = role(node); const live = ariaLive(node); const textClassification = readText(node); const accessibilityClassification = readAccessibility(node);
        const included = candidateRole === 'status' || candidateRole === 'alert' || live !== 'NONE'
          || textClassification === 'MATCHES_CURRENT_ACK_PATTERN' || accessibilityClassification === 'MATCHES_CURRENT_ACK_PATTERN';
        if (!included) continue;
        const family = textClassification === 'MATCHES_CURRENT_ACK_PATTERN' ? 'CURRENT_TEXT_MATCH'
          : candidateRole === 'status' ? 'ROLE_STATUS'
            : candidateRole === 'alert' ? 'ROLE_ALERT'
              : live !== 'NONE' ? 'ARIA_LIVE_REGION' : 'OTHER_SAFE_ACK_SURFACE';
        const nestedTextPresent = node.children.length > 0 && Array.from(node.children).some((child) => String(child.textContent || '').trim().length > 0);
        out.push({ key: `${index}:${node.tagName}:${candidateRole || 'none'}:${live}`, candidateFamily: family, tagName: tagName(node), role: candidateRole, visible: visible(node), attached: node.isConnected === true, ariaLive: live, textClassification, accessibilityClassification, nestedTextPresent, candidateDepth: depth(node) });
        if (out.length >= 64) break;
      }
      return out;
    }, { source: ACKNOWLEDGEMENT_PATTERN.source, flags: ACKNOWLEDGEMENT_PATTERN.flags });
    return { result: 'AVAILABLE', candidates: Array.isArray(candidates) ? candidates : [] };
  } catch {
    return { result: 'SAFE_EVALUATION_ERROR', candidates: [] };
  }
}

function createAcknowledgementShapeObserver(page, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const capture = typeof options.capture === 'function' ? options.capture : () => inspectAcknowledgementShapes(page);
  const schedule = typeof options.schedule === 'function' ? options.schedule : setTimeout;
  const cancel = typeof options.cancel === 'function' ? options.cancel : clearTimeout;
  const startedAt = now(); const entries = new Map(); const timers = []; let snapshot = 0; let stopped = false; let result = 'UNAVAILABLE'; let startVisible = 0;
  const observe = async () => {
    if (stopped || snapshot >= MAX_ACKNOWLEDGEMENT_SNAPSHOTS) return;
    const currentSnapshot = snapshot; snapshot += 1;
    let captureResult;
    try { captureResult = await capture(); } catch { captureResult = { result: 'SAFE_EVALUATION_ERROR', candidates: [] }; }
    if (stopped) return;
    result = captureResult?.result || 'SAFE_EVALUATION_ERROR';
    const candidates = Array.isArray(captureResult?.candidates) ? captureResult.candidates : [];
    let visibleAtThisSnapshot = 0;
    for (const raw of candidates) {
      const candidate = safeCandidate(raw); if (!candidate.key) continue;
      if (candidate.visible) visibleAtThisSnapshot += 1;
      const key = candidate.key;
      const existing = entries.get(key);
      if (existing) { existing.lastSnapshot = currentSnapshot; existing.lastObservedBucket = elapsedBucket(now() - startedAt); existing.observationCount = Math.min(1000, existing.observationCount + 1); continue; }
      if (entries.size >= MAX_ACKNOWLEDGEMENT_CANDIDATES) continue;
      entries.set(key, { ...candidate, firstSnapshot: currentSnapshot, lastSnapshot: currentSnapshot, firstObservedBucket: elapsedBucket(now() - startedAt), lastObservedBucket: elapsedBucket(now() - startedAt), observationCount: 1 });
    }
    if (currentSnapshot === 0) startVisible = visibleAtThisSnapshot;
  };
  return Object.freeze({
    start() { for (const delay of SNAPSHOT_DELAYS_MS) timers.push(schedule(() => { observe().catch(() => {}); }, delay)); },
    observe,
    stop() {
      stopped = true; for (const timer of timers) cancel(timer);
      const candidates = [...entries.values()].map(({ key, firstSnapshot, lastSnapshot, ...candidate }) => candidate);
      const count = (predicate) => candidates.filter(predicate).length;
      const currentMatches = count((candidate) => candidate.textClassification === 'MATCHES_CURRENT_ACK_PATTERN');
      const accessibilityMatches = count((candidate) => candidate.accessibilityClassification === 'MATCHES_CURRENT_ACK_PATTERN');
      return {
        totalDistinctCandidatesObserved: candidates.length,
        currentPatternMatchObservationCount: currentMatches,
        accessibilityPatternMatchObservationCount: accessibilityMatches,
        roleStatusObservationCount: count((candidate) => candidate.role === 'status'),
        roleAlertObservationCount: count((candidate) => candidate.role === 'alert'),
        ariaLiveObservationCount: count((candidate) => candidate.ariaLive !== 'NONE'),
        transientCandidateCount: [...entries.values()].filter((candidate) => candidate.lastSnapshot < snapshot - 1).length,
        candidatesVisibleAtVerificationStart: startVisible,
        candidatesObservedAfterVerificationStart: [...entries.values()].filter((candidate) => candidate.firstSnapshot > 0).length,
        structurallyAckLikeButPatternMismatchCount: count((candidate) => candidate.candidateFamily !== 'CURRENT_TEXT_MATCH' && candidate.textClassification !== 'MATCHES_CURRENT_ACK_PATTERN'),
        currentMatcherWouldHaveMatched: currentMatches > 0,
        exactCurrentMatcherResult: result === 'UNAVAILABLE' ? 'UNAVAILABLE' : result === 'SAFE_EVALUATION_ERROR' ? 'SAFE_EVALUATION_ERROR' : currentMatches > 0 ? 'MATCHED' : 'NO_MATCH',
        candidates,
      };
    },
  });
}

module.exports = { ACKNOWLEDGEMENT_PATTERN, MAX_ACKNOWLEDGEMENT_CANDIDATES, createAcknowledgementShapeObserver, inspectAcknowledgementShapes };
