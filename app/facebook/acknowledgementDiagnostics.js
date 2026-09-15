'use strict';

// This module is deliberately observation-only.  It never supplies a success
// predicate and must not retain Facebook text, accessible names, or DOM IDs.
const ACKNOWLEDGEMENT_PATTERN = /postarea (ta )?(a fost|este acum) publicat[ăa]|your post (was|is now) published/i;
const MAX_ACKNOWLEDGEMENT_CANDIDATES = 16;
const MAX_ACKNOWLEDGEMENT_SNAPSHOTS = 6;
const SNAPSHOT_DELAYS_MS = Object.freeze([0, 250, 1000, 5000, 30000, 90000]);
const SEMANTIC_CLASSIFICATIONS = new Set(['PUBLICATION_SUCCESS_LIKE', 'PUBLICATION_FAILURE_LIKE', 'GENERIC_SUCCESS_LIKE', 'GENERIC_ERROR_LIKE', 'UNRELATED_NOTIFICATION_LIKE', 'EMPTY_OR_UNAVAILABLE', 'AMBIGUOUS', 'SAFE_EVALUATION_ERROR']);
const LANGUAGE_CLASSIFICATIONS = new Set(['RO', 'EN', 'OTHER', 'UNKNOWN']);

function normaliseEphemeralText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// This accepts transient page text only to immediately reduce it to fixed,
// non-reversible semantic booleans and enums.  It must never return text.
function classifyAcknowledgementSemanticText(renderedText, accessibilityText) {
  try {
    const value = normaliseEphemeralText(`${String(renderedText || '')} ${String(accessibilityText || '')}`);
    if (!value) return { semanticClassification: 'EMPTY_OR_UNAVAILABLE', languageClassification: 'UNKNOWN', hasPublicationConcept: false, hasSuccessConcept: false, hasFailureConcept: false, hasPostObjectConcept: false, hasGroupConcept: false, hasRetryConcept: false, hasErrorConcept: false };
    const hasPublicationConcept = /\b(publicat|publicata|publicare|publica|publish(?:ed|ing)?|posted)\b/.test(value);
    const hasSuccessConcept = /\b(succes(?:ful(?:ly)?)?|reusit|finalizat|completed?|done|publicat|publicata|published|posted)\b/.test(value);
    const hasFailureConcept = /\b(esuat|nereusit|failed|failure|could not|nu s-a putut|nu poate)\b/.test(value);
    const hasPostObjectConcept = /\b(postarea|postul|postare|your post|post)\b/.test(value);
    const hasGroupConcept = /\b(grup|group)\b/.test(value);
    const hasRetryConcept = /\b(reincearca|incearca din nou|retry|try again)\b/.test(value);
    const hasErrorConcept = /\b(eroare|error|problem|went wrong)\b/.test(value);
    const roSignals = /\b(postarea|postul|publicata|publicare|succes|reusit|eroare|grup|incearca)\b/g;
    const enSignals = /\b(your|post|published|publish|success|failed|error|group|retry)\b/g;
    const roCount = (value.match(roSignals) || []).length; const enCount = (value.match(enSignals) || []).length;
    const languageClassification = roCount > enCount ? 'RO' : enCount > roCount ? 'EN' : roCount || enCount ? 'OTHER' : 'OTHER';
    const publicationSpecific = hasPublicationConcept && hasPostObjectConcept;
    const semanticClassification = publicationSpecific && (hasFailureConcept || hasErrorConcept || hasRetryConcept) ? 'PUBLICATION_FAILURE_LIKE'
      : publicationSpecific && hasSuccessConcept ? 'PUBLICATION_SUCCESS_LIKE'
        : hasFailureConcept || hasErrorConcept ? 'GENERIC_ERROR_LIKE'
          : hasSuccessConcept ? 'GENERIC_SUCCESS_LIKE'
            : 'UNRELATED_NOTIFICATION_LIKE';
    return { semanticClassification, languageClassification, hasPublicationConcept, hasSuccessConcept, hasFailureConcept, hasPostObjectConcept, hasGroupConcept, hasRetryConcept, hasErrorConcept };
  } catch {
    return { semanticClassification: 'SAFE_EVALUATION_ERROR', languageClassification: 'UNKNOWN', hasPublicationConcept: false, hasSuccessConcept: false, hasFailureConcept: false, hasPostObjectConcept: false, hasGroupConcept: false, hasRetryConcept: false, hasErrorConcept: false };
  }
}

function elapsedBucket(value) {
  const elapsed = Math.max(0, Number(value) || 0);
  if (elapsed < 1000) return 'UNDER_1_SECOND';
  if (elapsed < 5000) return 'UNDER_5_SECONDS';
  if (elapsed < 30000) return 'UNDER_30_SECONDS';
  if (elapsed < 120000) return 'UNDER_120_SECONDS';
  return 'AT_OR_OVER_TIMEOUT';
}

function relativeBucket(value) {
  const elapsed = Math.max(0, Number(value) || 0);
  if (elapsed < 1000) return 'UNDER_1S';
  if (elapsed < 5000) return 'UNDER_5S';
  if (elapsed < 15000) return 'UNDER_15S';
  if (elapsed < 30000) return 'UNDER_30S';
  return 'OVER_30S';
}

function safeCandidate(value = {}) {
  const semantic = classifyAcknowledgementSemanticText(value.semanticText, value.semanticAccessibilityText);
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
    semanticClassification: SEMANTIC_CLASSIFICATIONS.has(value.semanticClassification) ? value.semanticClassification : semantic.semanticClassification,
    languageClassification: LANGUAGE_CLASSIFICATIONS.has(value.languageClassification) ? value.languageClassification : semantic.languageClassification,
    hasPublicationConcept: typeof value.hasPublicationConcept === 'boolean' ? value.hasPublicationConcept : semantic.hasPublicationConcept,
    hasSuccessConcept: typeof value.hasSuccessConcept === 'boolean' ? value.hasSuccessConcept : semantic.hasSuccessConcept,
    hasFailureConcept: typeof value.hasFailureConcept === 'boolean' ? value.hasFailureConcept : semantic.hasFailureConcept,
    hasPostObjectConcept: typeof value.hasPostObjectConcept === 'boolean' ? value.hasPostObjectConcept : semantic.hasPostObjectConcept,
    hasGroupConcept: typeof value.hasGroupConcept === 'boolean' ? value.hasGroupConcept : semantic.hasGroupConcept,
    hasRetryConcept: typeof value.hasRetryConcept === 'boolean' ? value.hasRetryConcept : semantic.hasRetryConcept,
    hasErrorConcept: typeof value.hasErrorConcept === 'boolean' ? value.hasErrorConcept : semantic.hasErrorConcept,
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
      const readTextValue = (node) => { try { return { value: String(node.innerText || node.textContent || '').trim(), error: false }; } catch { return { value: '', error: true }; } };
      const readAccessibilityValue = (node) => { try { return { value: String(node.getAttribute('aria-label') || node.getAttribute('title') || '').trim(), error: false }; } catch { return { value: '', error: true }; } };
      const readText = (value) => value.error ? 'SAFE_TEXT_EVALUATION_ERROR' : value.value ? (expression.test(value.value) ? 'MATCHES_CURRENT_ACK_PATTERN' : 'NON_MATCHING_TEXT_PRESENT') : 'EMPTY_OR_UNAVAILABLE';
      const readAccessibility = (value) => value.error ? 'SAFE_ACCESSIBILITY_EVALUATION_ERROR' : value.value ? (expression.test(value.value) ? 'MATCHES_CURRENT_ACK_PATTERN' : 'NON_MATCHING_ACCESSIBLE_NAME_PRESENT') : 'EMPTY_OR_UNAVAILABLE';
      const semantic = (text, accessibility) => {
        try {
          const value = `${text || ''} ${accessibility || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (!value) return { semanticClassification: 'EMPTY_OR_UNAVAILABLE', languageClassification: 'UNKNOWN', hasPublicationConcept: false, hasSuccessConcept: false, hasFailureConcept: false, hasPostObjectConcept: false, hasGroupConcept: false, hasRetryConcept: false, hasErrorConcept: false };
          const hasPublicationConcept = /\b(publicat|publicata|publicare|publica|publish(?:ed|ing)?|posted)\b/.test(value);
          const hasSuccessConcept = /\b(succes(?:ful(?:ly)?)?|reusit|finalizat|completed?|done|publicat|publicata|published|posted)\b/.test(value);
          const hasFailureConcept = /\b(esuat|nereusit|failed|failure|could not|nu s-a putut|nu poate)\b/.test(value);
          const hasPostObjectConcept = /\b(postarea|postul|postare|your post|post)\b/.test(value);
          const hasGroupConcept = /\b(grup|group)\b/.test(value); const hasRetryConcept = /\b(reincearca|incearca din nou|retry|try again)\b/.test(value); const hasErrorConcept = /\b(eroare|error|problem|went wrong)\b/.test(value);
          const roCount = (value.match(/\b(postarea|postul|publicata|publicare|succes|reusit|eroare|grup|incearca)\b/g) || []).length;
          const enCount = (value.match(/\b(your|post|published|publish|success|failed|error|group|retry)\b/g) || []).length;
          const languageClassification = roCount > enCount ? 'RO' : enCount > roCount ? 'EN' : roCount || enCount ? 'OTHER' : 'OTHER';
          const publicationSpecific = hasPublicationConcept && hasPostObjectConcept;
          const semanticClassification = publicationSpecific && (hasFailureConcept || hasErrorConcept || hasRetryConcept) ? 'PUBLICATION_FAILURE_LIKE' : publicationSpecific && hasSuccessConcept ? 'PUBLICATION_SUCCESS_LIKE' : hasFailureConcept || hasErrorConcept ? 'GENERIC_ERROR_LIKE' : hasSuccessConcept ? 'GENERIC_SUCCESS_LIKE' : 'UNRELATED_NOTIFICATION_LIKE';
          return { semanticClassification, languageClassification, hasPublicationConcept, hasSuccessConcept, hasFailureConcept, hasPostObjectConcept, hasGroupConcept, hasRetryConcept, hasErrorConcept };
        } catch { return { semanticClassification: 'SAFE_EVALUATION_ERROR', languageClassification: 'UNKNOWN', hasPublicationConcept: false, hasSuccessConcept: false, hasFailureConcept: false, hasPostObjectConcept: false, hasGroupConcept: false, hasRetryConcept: false, hasErrorConcept: false }; }
      };
      const selector = '[role="status"], [role="alert"], [aria-live], [aria-label], [title]';
      const out = [];
      for (const [index, node] of Array.from(document.querySelectorAll(selector)).slice(0, 160).entries()) {
        const candidateRole = role(node); const live = ariaLive(node); const textValue = readTextValue(node); const accessibilityValue = readAccessibilityValue(node); const textClassification = readText(textValue); const accessibilityClassification = readAccessibility(accessibilityValue); const semanticClassification = semantic(textValue.value, accessibilityValue.value);
        const included = candidateRole === 'status' || candidateRole === 'alert' || live !== 'NONE'
          || textClassification === 'MATCHES_CURRENT_ACK_PATTERN' || accessibilityClassification === 'MATCHES_CURRENT_ACK_PATTERN';
        if (!included) continue;
        const family = textClassification === 'MATCHES_CURRENT_ACK_PATTERN' ? 'CURRENT_TEXT_MATCH'
          : candidateRole === 'status' ? 'ROLE_STATUS'
            : candidateRole === 'alert' ? 'ROLE_ALERT'
              : live !== 'NONE' ? 'ARIA_LIVE_REGION' : 'OTHER_SAFE_ACK_SURFACE';
        const nestedTextPresent = node.children.length > 0 && Array.from(node.children).some((child) => String(child.textContent || '').trim().length > 0);
        out.push({ key: `${index}:${node.tagName}:${candidateRole || 'none'}:${live}`, candidateFamily: family, tagName: tagName(node), role: candidateRole, visible: visible(node), attached: node.isConnected === true, ariaLive: live, textClassification, accessibilityClassification, nestedTextPresent, candidateDepth: depth(node), ...semanticClassification });
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
      if (existing) {
        existing.lastSnapshot = currentSnapshot;
        existing.lastObservedBucket = elapsedBucket(now() - startedAt);
        existing.lastObservedRelativeBucket = relativeBucket(now() - startedAt);
        existing.observationCount = Math.min(1000, existing.observationCount + 1);
        for (const feature of ['hasPublicationConcept', 'hasSuccessConcept', 'hasFailureConcept', 'hasPostObjectConcept', 'hasGroupConcept', 'hasRetryConcept', 'hasErrorConcept']) existing[feature] = existing[feature] || candidate[feature];
        existing.languageSeen.add(candidate.languageClassification);
        // Preserve the strongest observation for the bounded candidate while
        // retaining the existing strict matcher as the sole success authority.
        const rank = { PUBLICATION_SUCCESS_LIKE: 5, PUBLICATION_FAILURE_LIKE: 5, GENERIC_SUCCESS_LIKE: 4, GENERIC_ERROR_LIKE: 4, UNRELATED_NOTIFICATION_LIKE: 3, AMBIGUOUS: 2, EMPTY_OR_UNAVAILABLE: 1, SAFE_EVALUATION_ERROR: 0 };
        if ((rank[candidate.semanticClassification] || 0) > (rank[existing.semanticClassification] || 0)) existing.semanticClassification = candidate.semanticClassification;
        continue;
      }
      if (entries.size >= MAX_ACKNOWLEDGEMENT_CANDIDATES) continue;
      entries.set(key, {
        ...candidate,
        firstSnapshot: currentSnapshot,
        lastSnapshot: currentSnapshot,
        firstObservedBucket: elapsedBucket(now() - startedAt),
        lastObservedBucket: elapsedBucket(now() - startedAt),
        firstObservedRelativeBucket: relativeBucket(now() - startedAt),
        lastObservedRelativeBucket: relativeBucket(now() - startedAt),
        observationCount: 1,
        languageSeen: new Set([candidate.languageClassification]),
      });
    }
    if (currentSnapshot === 0) startVisible = visibleAtThisSnapshot;
  };
  return Object.freeze({
    start() { for (const delay of SNAPSHOT_DELAYS_MS) timers.push(schedule(() => { observe().catch(() => {}); }, delay)); },
    observe,
    stop() {
      stopped = true; for (const timer of timers) cancel(timer);
      const candidates = [...entries.values()].map(({ key, firstSnapshot, lastSnapshot, languageSeen, firstObservedRelativeBucket, lastObservedRelativeBucket, ...candidate }) => candidate);
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
    semanticSummary() {
      const candidates = [...entries.values()].map((entry) => ({
        candidateFamily: entry.candidateFamily,
        role: entry.role,
        ariaLive: entry.ariaLive,
        visible: entry.visible,
        attached: entry.attached,
        semanticClassification: entry.semanticClassification,
        languageClassification: entry.languageSeen.size === 1 ? [...entry.languageSeen][0] : 'OTHER',
        hasPublicationConcept: entry.hasPublicationConcept,
        hasSuccessConcept: entry.hasSuccessConcept,
        hasFailureConcept: entry.hasFailureConcept,
        hasPostObjectConcept: entry.hasPostObjectConcept,
        hasGroupConcept: entry.hasGroupConcept,
        hasRetryConcept: entry.hasRetryConcept,
        hasErrorConcept: entry.hasErrorConcept,
        firstObservedRelativeBucket: entry.firstObservedRelativeBucket,
        lastObservedRelativeBucket: entry.lastObservedRelativeBucket,
        observationCount: entry.observationCount,
        transient: entry.lastSnapshot < snapshot - 1,
        currentMatcherMatched: entry.textClassification === 'MATCHES_CURRENT_ACK_PATTERN',
        languageSeen: entry.languageSeen,
      }));
      const count = (classification) => candidates.filter((candidate) => candidate.semanticClassification === classification).length;
      const publicationSuccess = candidates.filter((candidate) => candidate.semanticClassification === 'PUBLICATION_SUCCESS_LIKE');
      const observed = (field) => candidates.some((candidate) => candidate[field] === true);
      const languageObserved = (language) => candidates.some((candidate) => candidate.languageSeen.has(language));
      return {
        totalSemanticCandidates: candidates.length,
        publicationSuccessLikeCount: publicationSuccess.length,
        publicationFailureLikeCount: count('PUBLICATION_FAILURE_LIKE'),
        genericSuccessLikeCount: count('GENERIC_SUCCESS_LIKE'),
        genericErrorLikeCount: count('GENERIC_ERROR_LIKE'),
        unrelatedNotificationLikeCount: count('UNRELATED_NOTIFICATION_LIKE'),
        ambiguousCount: count('AMBIGUOUS'),
        roleAlertPublicationSuccessLikeCount: publicationSuccess.filter((candidate) => candidate.role === 'alert').length,
        roleStatusPublicationSuccessLikeCount: publicationSuccess.filter((candidate) => candidate.role === 'status').length,
        ariaLivePublicationSuccessLikeCount: publicationSuccess.filter((candidate) => candidate.ariaLive !== 'NONE').length,
        transientPublicationSuccessLikeCount: publicationSuccess.filter((candidate) => candidate.transient).length,
        publicationConceptObserved: observed('hasPublicationConcept'),
        successConceptObserved: observed('hasSuccessConcept'),
        failureConceptObserved: observed('hasFailureConcept'),
        postObjectConceptObserved: observed('hasPostObjectConcept'),
        groupConceptObserved: observed('hasGroupConcept'),
        retryConceptObserved: observed('hasRetryConcept'),
        errorConceptObserved: observed('hasErrorConcept'),
        languageROObserved: languageObserved('RO'),
        languageENObserved: languageObserved('EN'),
        languageOtherObserved: languageObserved('OTHER'),
        currentMatcherMatched: candidates.some((candidate) => candidate.currentMatcherMatched),
        semanticPublicationSuccessObserved: publicationSuccess.length > 0,
        candidates: candidates.map(({ languageSeen, currentMatcherMatched, ...candidate }) => candidate),
      };
    },
  });
}

module.exports = {
  ACKNOWLEDGEMENT_PATTERN,
  MAX_ACKNOWLEDGEMENT_CANDIDATES,
  SEMANTIC_CLASSIFICATIONS,
  LANGUAGE_CLASSIFICATIONS,
  classifyAcknowledgementSemanticText,
  createAcknowledgementShapeObserver,
  inspectAcknowledgementShapes,
};
