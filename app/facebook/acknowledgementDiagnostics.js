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

// This is deliberately the existing immutable-post comparison normalization:
// diagnostics may explain its result, but never alter it.
function normalizeImmutablePostText(value) {
  return String(value || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}

function bounded(value, maximum = 1000) { return Math.max(0, Math.min(maximum, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0)); }

function textViewParity(readerType, rawValue, immutableText, readSucceeded = true) {
  const value = normalizeImmutablePostText(rawValue);
  const immutable = normalizeImmutablePostText(immutableText);
  const lengthRelation = !value ? 'EMPTY' : value.length === immutable.length ? 'EXACT_LENGTH' : value.length < immutable.length ? 'SHORTER' : 'LONGER';
  return {
    readerType,
    readSucceeded: readSucceeded === true,
    normalizedLength: bounded(value.length),
    lineCount: value ? bounded(value.split('\n').length) : 0,
    newlineCount: value ? bounded((value.match(/\n/g) || []).length) : 0,
    exactImmutableMatch: Boolean(immutable) && value === immutable,
    containsImmutableText: Boolean(immutable) && value.includes(immutable),
    immutableTextPrefixMatch: Boolean(immutable) && value.startsWith(immutable),
    immutableTextSuffixMatch: Boolean(immutable) && value.endsWith(immutable),
    lengthRelation,
  };
}

function classifyCandidateTextShape(candidate, views) {
  if (candidate.hasNestedArticleTextSurface === true) return 'AMBIGUOUS';
  if (!views.some((view) => view.readSucceeded)) return 'EMPTY_OR_UNAVAILABLE';
  if (views.some((view) => view.readerType !== 'DESCENDANT_TEXT_BLOCKS' && view.exactImmutableMatch)) return 'EXACT_POST_BODY_ONLY';
  const contains = views.some((view) => view.containsImmutableText);
  if (!contains) return views.every((view) => view.lengthRelation === 'EMPTY') ? 'EMPTY_OR_UNAVAILABLE' : 'NO_BODY_MATCH';
  if (candidate.hasAuthorHeaderTextSurface && candidate.hasActionControlTextSurface) return 'POST_BODY_PLUS_HEADER_AND_ACTIONS';
  if (candidate.hasAuthorHeaderTextSurface) return 'POST_BODY_PLUS_HEADER';
  if (candidate.hasActionControlTextSurface) return 'POST_BODY_PLUS_ACTIONS';
  return 'BODY_SUBSTRING_PRESENT';
}

// Raw DOM strings are accepted only within this function and reduced
// immediately to privacy-safe comparison metadata.
function diagnoseArticleTextParity(raw = {}, immutableText) {
  try {
    const viewValues = raw.textViews || {};
    const views = [
      ['CURRENT_READER', viewValues.currentReader], ['TEXT_CONTENT', viewValues.textContent],
      ['INNER_TEXT', viewValues.innerText], ['VISUAL_TEXT', viewValues.visualText],
      ['DESCENDANT_TEXT_BLOCKS', viewValues.descendantTextBlocks],
    ].map(([readerType, source]) => textViewParity(readerType, source?.value, immutableText, source?.readSucceeded !== false));
    const immutable = normalizeImmutablePostText(immutableText);
    const descendants = Array.isArray(raw.descendantTexts) ? raw.descendantTexts.slice(0, 24) : [];
    const exactDescendants = descendants.filter((item) => normalizeImmutablePostText(item?.value) === immutable && immutable);
    const containsView = views.find((view) => view.containsImmutableText);
    const legacyExact = raw.immutableTextExactMatch === true;
    const candidate = {
      candidateFamily: raw.candidateFamily,
      visible: raw.visible === true,
      attached: raw.attached === true,
      hasActionControlTextSurface: raw.hasActionControlTextSurface === true,
      hasTimestampTextSurface: raw.hasTimestampTextSurface === true,
      hasAuthorHeaderTextSurface: raw.hasAuthorHeaderTextSurface === true,
      hasNestedArticleTextSurface: raw.hasNestedArticleTextSurface === true,
      hasExtraTextBeforeImmutable: containsView ? !containsView.immutableTextPrefixMatch : false,
      hasExtraTextAfterImmutable: containsView ? !containsView.immutableTextSuffixMatch : false,
      exactImmutableDescendantMatch: exactDescendants.length > 0,
      exactImmutableDescendantMatchCount: bounded(exactDescendants.length),
      matchedDescendantVisible: exactDescendants.some((item) => item.visible === true),
      matchedDescendantAttached: exactDescendants.some((item) => item.attached === true),
      exactTextViewMatchObserved: legacyExact || views.some((view) => view.exactImmutableMatch),
      exactDescendantMatchObserved: exactDescendants.length > 0,
      views,
    };
    candidate.candidateTextShape = classifyCandidateTextShape(candidate, views);
    return candidate;
  } catch {
    return {
      candidateFamily: raw.candidateFamily, visible: raw.visible === true, attached: raw.attached === true,
      hasExtraTextBeforeImmutable: false, hasExtraTextAfterImmutable: false, hasActionControlTextSurface: false,
      hasTimestampTextSurface: false, hasAuthorHeaderTextSurface: false, hasNestedArticleTextSurface: true,
      candidateTextShape: 'AMBIGUOUS', exactImmutableDescendantMatch: false, exactImmutableDescendantMatchCount: 0,
      matchedDescendantVisible: false, matchedDescendantAttached: false, exactTextViewMatchObserved: false,
      exactDescendantMatchObserved: false, views: [],
    };
  }
}

function summarizeArticleTextParity(candidates = []) {
  const countView = (readerType) => candidates.filter((candidate) => candidate.views?.some((view) => view.readerType === readerType && view.exactImmutableMatch)).length;
  const countShape = (shape) => candidates.filter((candidate) => candidate.candidateTextShape === shape).length;
  const exactWhole = countView('CURRENT_READER') || countView('TEXT_CONTENT') || countView('INNER_TEXT');
  const exactDescendant = candidates.filter((candidate) => candidate.exactImmutableDescendantMatch).length;
  const visual = countView('VISUAL_TEXT');
  const bodySubstring = candidates.filter((candidate) => candidate.views?.some((view) => view.containsImmutableText)).length;
  const bestSupportedTextParityClass = exactWhole ? 'EXACT_WHOLE_CANDIDATE_MATCH'
    : exactDescendant ? 'EXACT_DESCENDANT_BODY_MATCH'
      : visual ? 'VISUAL_RECONSTRUCTION_REQUIRED'
        : bodySubstring ? 'IMMUTABLE_BODY_PRESENT_WITH_EXTRA_UI_TEXT'
          : candidates.some((candidate) => candidate.candidateTextShape === 'AMBIGUOUS') ? 'SAFE_EVALUATION_ERROR'
            : 'NO_IMMUTABLE_BODY_SIGNAL';
  return {
    candidateCountInspected: candidates.length,
    currentReaderExactMatchCount: countView('CURRENT_READER'), textContentExactMatchCount: countView('TEXT_CONTENT'),
    innerTextExactMatchCount: countView('INNER_TEXT'), visualTextExactMatchCount: visual,
    descendantBlockExactMatchCount: countView('DESCENDANT_TEXT_BLOCKS'), bodySubstringCandidateCount: bodySubstring,
    exactImmutableDescendantCandidateCount: exactDescendant,
    postBodyPlusHeaderCount: countShape('POST_BODY_PLUS_HEADER'), postBodyPlusActionsCount: countShape('POST_BODY_PLUS_ACTIONS'),
    postBodyPlusHeaderAndActionsCount: countShape('POST_BODY_PLUS_HEADER_AND_ACTIONS'), noBodyMatchCount: countShape('NO_BODY_MATCH'),
    ambiguousCount: countShape('AMBIGUOUS'), bestSupportedTextParityClass,
    candidates,
  };
}

// Raw subtree values exist only while this helper reduces them to bounded,
// privacy-safe comparison metadata. They are never kept by the observer.
function diagnoseArticleBodySubtrees(raw = {}, immutableText) {
  try {
    const immutable = normalizeImmutablePostText(immutableText);
    const candidate = diagnoseArticleTextParity(raw, immutable);
    const plausible = candidate.visible && candidate.attached && candidate.views.some((view) => view.containsImmutableText);
    if (!plausible) return { candidateCorrelationId: raw.candidateCorrelationId, inspected: false, candidate, subtrees: [], bodyIsolationClass: candidate.hasNestedArticleTextSurface ? 'AMBIGUOUS' : 'NO_BODY_SIGNAL' };
    const rawSubtrees = Array.isArray(raw.bodySubtrees) ? raw.bodySubtrees.slice(0, 24) : [];
    const subtrees = rawSubtrees.map((subtree, index) => {
      const parity = textViewParity('INNER_TEXT', subtree?.value, immutable, subtree?.readSucceeded !== false);
      return {
        candidateCorrelationId: raw.candidateCorrelationId,
        subtreeIndex: index + 1,
        depthRelativeToCandidate: bounded(subtree?.depthRelativeToCandidate, 24),
        tagFamily: ['DIV', 'SPAN', 'P', 'ARTICLE', 'SECTION'].includes(subtree?.tagFamily) ? subtree.tagFamily : 'OTHER',
        visible: subtree?.visible === true, attached: subtree?.attached === true,
        hasDirectTextNode: subtree?.hasDirectTextNode === true, hasDescendantText: subtree?.hasDescendantText === true,
        hasInteractiveDescendant: subtree?.hasInteractiveDescendant === true, hasArticleDescendant: subtree?.hasArticleDescendant === true,
        ...parity,
      };
    });
    const exact = subtrees.filter((subtree) => subtree.visible && subtree.attached && subtree.exactImmutableMatch);
    let sequenceCount = 0; let bestBlockCount = 0; let sequenceVisible = false; let sequenceAttached = false;
    if (!exact.length && immutable) {
      for (let start = 0; start < subtrees.length; start += 1) {
        let joined = '';
        for (let end = start; end < Math.min(subtrees.length, start + 8); end += 1) {
          const source = rawSubtrees[end]; const next = normalizeImmutablePostText(source?.value);
          joined = joined ? `${joined}\n${next}` : next;
          if (normalizeImmutablePostText(joined) !== immutable) continue;
          const sequence = subtrees.slice(start, end + 1);
          if (sequence.every((item) => item.visible && item.attached)) { sequenceCount += 1; bestBlockCount = bestBlockCount || sequence.length; sequenceVisible = true; sequenceAttached = true; }
        }
      }
    }
    const hasBody = candidate.views.some((view) => view.containsImmutableText);
    const header = candidate.hasAuthorHeaderTextSurface; const actions = candidate.hasActionControlTextSurface;
    const isolate = exact.length || sequenceCount;
    const bodyIsolationClass = candidate.hasNestedArticleTextSurface ? 'AMBIGUOUS'
      : isolate && header && actions ? 'BODY_WITH_HEADER_AND_ACTIONS_OUTSIDE'
        : isolate && header ? 'BODY_WITH_HEADER_OUTSIDE'
          : isolate && actions ? 'BODY_WITH_ACTIONS_OUTSIDE'
            : exact.length ? 'EXACT_SINGLE_SUBTREE'
              : sequenceCount ? 'EXACT_CONTIGUOUS_BLOCK_SEQUENCE'
                : hasBody ? 'BODY_PRESENT_BUT_NOT_ISOLATABLE' : 'NO_BODY_SIGNAL';
    return {
      candidateCorrelationId: raw.candidateCorrelationId, inspected: true, candidate, subtrees,
      minimalExactBodySubtreeFound: exact.length > 0, minimalExactBodySubtreeCount: bounded(exact.length),
      minimalMatchVisible: exact.some((item) => item.visible), minimalMatchAttached: exact.some((item) => item.attached),
      minimalMatchDepth: bounded(exact[0]?.depthRelativeToCandidate, 24),
      minimalMatchHasInteractiveDescendant: exact.some((item) => item.hasInteractiveDescendant), minimalMatchHasArticleDescendant: exact.some((item) => item.hasArticleDescendant),
      exactContiguousBlockSequenceFound: sequenceCount > 0, exactContiguousBlockSequenceCount: bounded(sequenceCount), blockCountInBestMatch: bounded(bestBlockCount, 24),
      bestSequenceVisible: sequenceVisible, bestSequenceAttached: sequenceAttached,
      bodyIsolationClass, extraTextBeforeBody: candidate.hasExtraTextBeforeImmutable, extraTextAfterBody: candidate.hasExtraTextAfterImmutable,
      headerOutsideBody: isolate && header, actionsOutsideBody: isolate && actions, timestampOutsideBody: isolate && candidate.hasTimestampTextSurface,
    };
  } catch {
    return { candidateCorrelationId: raw.candidateCorrelationId, inspected: false, candidate: diagnoseArticleTextParity(raw, immutableText), subtrees: [], bodyIsolationClass: 'SAFE_EVALUATION_ERROR' };
  }
}

function summarizeArticleBodySubtrees(candidates = []) {
  const inspected = candidates.filter((candidate) => candidate.inspected);
  const count = (value) => inspected.filter((candidate) => candidate.bodyIsolationClass === value).length;
  const exact = inspected.filter((candidate) => candidate.minimalExactBodySubtreeFound || candidate.exactContiguousBlockSequenceFound);
  const bestSupportedBodyIsolationClass = exact.some((candidate) => candidate.bodyIsolationClass === 'EXACT_SINGLE_SUBTREE') ? 'EXACT_SINGLE_SUBTREE'
    : exact.some((candidate) => candidate.bodyIsolationClass === 'EXACT_CONTIGUOUS_BLOCK_SEQUENCE') ? 'EXACT_CONTIGUOUS_BLOCK_SEQUENCE'
      : exact.length ? 'IMMUTABLE_BODY_ISOLATED_FROM_EXTRA_UI'
        : count('BODY_PRESENT_BUT_NOT_ISOLATABLE') ? 'BODY_PRESENT_BUT_NOT_ISOLATABLE'
          : inspected.some((candidate) => candidate.bodyIsolationClass === 'SAFE_EVALUATION_ERROR') ? 'SAFE_EVALUATION_ERROR' : 'NO_RELIABLE_BODY_SIGNAL';
  return {
    candidateCountInspected: inspected.length,
    bodySubstringCandidateCount: inspected.filter((candidate) => candidate.candidate.views.some((view) => view.containsImmutableText)).length,
    minimalExactBodySubtreeCandidateCount: inspected.filter((candidate) => candidate.minimalExactBodySubtreeFound).length,
    exactContiguousBlockSequenceCandidateCount: inspected.filter((candidate) => candidate.exactContiguousBlockSequenceFound).length,
    bodyWithHeaderOutsideCount: count('BODY_WITH_HEADER_OUTSIDE'), bodyWithActionsOutsideCount: count('BODY_WITH_ACTIONS_OUTSIDE'),
    bodyWithHeaderAndActionsOutsideCount: count('BODY_WITH_HEADER_AND_ACTIONS_OUTSIDE'), bodyPresentButNotIsolatableCount: count('BODY_PRESENT_BUT_NOT_ISOLATABLE'), ambiguousCount: count('AMBIGUOUS'),
    newAfterClickExactBodyCandidateCount: exact.filter((candidate) => candidate.firstObservedAfterClick).length,
    visibleAttachedExactBodyCandidateCount: exact.filter((candidate) => candidate.candidate.visible && candidate.candidate.attached).length,
    bestSupportedBodyIsolationClass, candidates,
  };
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
    accessibleNameSource: ['NONE', 'TEXT_CONTENT', 'ARIA_LABEL', 'ARIA_LABELLEDBY', 'DESCENDANT_TEXT', 'OTHER_ACCESSIBLE_SOURCE', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR'].includes(value.accessibleNameSource) ? value.accessibleNameSource : 'SAFE_EVALUATION_ERROR',
    textSource: ['NONE', 'DIRECT_TEXT_NODE', 'DESCENDANT_TEXT', 'MIXED_TEXT_STRUCTURE', 'UNAVAILABLE', 'SAFE_EVALUATION_ERROR'].includes(value.textSource) ? value.textSource : 'SAFE_EVALUATION_ERROR',
    semanticContainer: ['TOAST_LIKE', 'LIVE_REGION_LIKE', 'DIALOG_LIKE', 'BUTTON_LIKE', 'STATUS_CONTAINER_LIKE', 'ALERT_CONTAINER_LIKE', 'GENERIC_CONTAINER', 'UNKNOWN'].includes(value.semanticContainer) ? value.semanticContainer : 'UNKNOWN',
    interactiveAncestor: value.interactiveAncestor === true, dialogAncestor: value.dialogAncestor === true, formAncestor: value.formAncestor === true, liveRegionAncestor: value.liveRegionAncestor === true,
    nearestSemanticAncestor: ['DIALOG', 'ALERT', 'STATUS', 'LIVE_REGION', 'FORM', 'NAVIGATION', 'MAIN', 'ARTICLE', 'BUTTON', 'GENERIC', 'NONE'].includes(value.nearestSemanticAncestor) ? value.nearestSemanticAncestor : 'NONE',
    ancestorRoleCount: Math.max(0, Math.min(1000, Number(value.ancestorRoleCount) || 0)), ancestorLiveRegionCount: Math.max(0, Math.min(1000, Number(value.ancestorLiveRegionCount) || 0)), interactiveAncestorCount: Math.max(0, Math.min(1000, Number(value.interactiveAncestorCount) || 0)),
  };
}

async function inspectAcknowledgementShapes(page, options = {}) {
  if (!page || typeof page.evaluate !== 'function') return { result: 'UNAVAILABLE', candidates: [] };
  try {
    const captured = await page.evaluate(({ source, flags, immutableText }) => {
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
      const sourceInfo = (node) => {
        try {
          const direct = Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && String(child.nodeValue || '').trim());
          const descendant = Array.from(node.children).some((child) => String(child.innerText || child.textContent || '').trim());
          const ariaLabelledby = Boolean(node.getAttribute('aria-labelledby'));
          const ariaLabel = Boolean(node.getAttribute('aria-label'));
          const textSource = direct && descendant ? 'MIXED_TEXT_STRUCTURE' : direct ? 'DIRECT_TEXT_NODE' : descendant ? 'DESCENDANT_TEXT' : 'NONE';
          const accessibleNameSource = ariaLabel ? 'ARIA_LABEL' : ariaLabelledby ? 'ARIA_LABELLEDBY' : direct ? 'TEXT_CONTENT' : descendant ? 'DESCENDANT_TEXT' : 'NONE';
          let current = node.parentElement; let nearestSemanticAncestor = 'NONE'; let ancestorRoleCount = 0; let ancestorLiveRegionCount = 0; let interactiveAncestorCount = 0; let interactiveAncestor = false; let dialogAncestor = false; let formAncestor = false; let liveRegionAncestor = false;
          for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
            const roleValue = String(current.getAttribute('role') || '').toLowerCase(); const live = String(current.getAttribute('aria-live') || '').trim();
            if (roleValue) ancestorRoleCount += 1; if (live) ancestorLiveRegionCount += 1;
            const interactive = current.tagName === 'BUTTON' || roleValue === 'button' || current.tagName === 'A'; if (interactive) { interactiveAncestor = true; interactiveAncestorCount += 1; }
            if (roleValue === 'dialog') { dialogAncestor = true; if (nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'DIALOG'; }
            else if (roleValue === 'alert') { if (nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'ALERT'; }
            else if (roleValue === 'status') { if (nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'STATUS'; }
            else if (live) { liveRegionAncestor = true; if (nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'LIVE_REGION'; }
            else if (current.tagName === 'FORM') { formAncestor = true; if (nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'FORM'; }
            else if (current.tagName === 'ARTICLE' && nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'ARTICLE';
            else if (current.tagName === 'MAIN' && nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'MAIN';
            else if ((current.tagName === 'NAV' || roleValue === 'navigation') && nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'NAVIGATION';
            else if (interactive && nearestSemanticAncestor === 'NONE') nearestSemanticAncestor = 'BUTTON';
          }
          return { accessibleNameSource, textSource, semanticContainer: role(node) === 'alert' ? 'ALERT_CONTAINER_LIKE' : role(node) === 'status' ? 'STATUS_CONTAINER_LIKE' : ariaLive(node) !== 'NONE' ? 'LIVE_REGION_LIKE' : dialogAncestor ? 'DIALOG_LIKE' : interactiveAncestor ? 'BUTTON_LIKE' : 'GENERIC_CONTAINER', interactiveAncestor, dialogAncestor, formAncestor, liveRegionAncestor, nearestSemanticAncestor, ancestorRoleCount: Math.min(1000, ancestorRoleCount), ancestorLiveRegionCount: Math.min(1000, ancestorLiveRegionCount), interactiveAncestorCount: Math.min(1000, interactiveAncestorCount) };
        } catch { return { accessibleNameSource: 'SAFE_EVALUATION_ERROR', textSource: 'SAFE_EVALUATION_ERROR', semanticContainer: 'UNKNOWN', interactiveAncestor: false, dialogAncestor: false, formAncestor: false, liveRegionAncestor: false, nearestSemanticAncestor: 'NONE', ancestorRoleCount: 0, ancestorLiveRegionCount: 0, interactiveAncestorCount: 0 }; }
      };
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
        out.push({ key: `${index}:${node.tagName}:${candidateRole || 'none'}:${live}`, candidateFamily: family, tagName: tagName(node), role: candidateRole, visible: visible(node), attached: node.isConnected === true, ariaLive: live, textClassification, accessibilityClassification, nestedTextPresent, candidateDepth: depth(node), ...semanticClassification, ...sourceInfo(node) });
        if (out.length >= 64) break;
      }
      const visualText = (root) => {
        try {
          const blockTags = new Set(['DIV', 'P', 'LI', 'SECTION', 'ARTICLE']); const lines = [];
          const visit = (node, line) => {
            if (node.nodeType === Node.TEXT_NODE) { line.value += String(node.nodeValue || ''); return; }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.tagName === 'BR') { lines.push(line.value); line.value = ''; return; }
            const block = blockTags.has(node.tagName) && line.value.length > 0;
            if (block) { lines.push(line.value); line.value = ''; }
            for (const child of Array.from(node.childNodes)) visit(child, line);
            if (block && line.value.length > 0) { lines.push(line.value); line.value = ''; }
          };
          const line = { value: '' }; visit(root, line); if (line.value.length > 0) lines.push(line.value);
          return lines.join('\n');
        } catch { return ''; }
      };
      const articleNodes = Array.from(document.querySelectorAll('[role="article"], [role="feed"] > *, article')).slice(0, 16);
      const articles = articleNodes.map((node, index) => {
        const roleValue = String(node.getAttribute('role') || '').toLowerCase();
        const textContent = String(node.textContent || ''); const innerText = String(node.innerText || '');
        const currentReader = String(node.innerText || node.textContent || '');
        const articleFamily = roleValue === 'article' ? 'ARTICLE_ROLE' : roleValue === 'feeditem' ? 'FEED_ITEM_ROLE' : node.tagName === 'ARTICLE' ? 'POST_CONTAINER_LIKE' : 'UNKNOWN_ARTICLE_LIKE';
        const descendants = Array.from(node.querySelectorAll('div,span,p,[role="textbox"],article,[role="article"]')).filter((child) => child !== node).slice(0, 24).map((child) => ({ value: String(child.innerText || child.textContent || ''), visible: visible(child), attached: child.isConnected === true }));
        const relativeDepth = (child) => { let value = 0; let current = child; while (current?.parentElement && current.parentElement !== node && value < 24) { value += 1; current = current.parentElement; } return value + 1; };
        const bodySubtrees = Array.from(node.querySelectorAll('div,span,p,article,section')).filter((child) => child !== node).slice(0, 24).map((child) => ({
          value: String(child.innerText || child.textContent || ''), visible: visible(child), attached: child.isConnected === true,
          depthRelativeToCandidate: relativeDepth(child), tagFamily: ['DIV', 'SPAN', 'P', 'ARTICLE', 'SECTION'].includes(child.tagName) ? child.tagName : 'OTHER',
          hasDirectTextNode: Array.from(child.childNodes).some((item) => item.nodeType === Node.TEXT_NODE && String(item.nodeValue || '').trim()),
          hasDescendantText: Array.from(child.children).some((item) => String(item.innerText || item.textContent || '').trim()),
          hasInteractiveDescendant: child.querySelector('button,[role="button"],a') !== null,
          hasArticleDescendant: child.querySelector('article,[role="article"]') !== null,
          readSucceeded: true,
        }));
        return {
          key: `${index}:${articleFamily}`, candidateFamily: articleFamily, visible: visible(node), attached: node.isConnected === true,
          containsTextSurface: Boolean(currentReader.trim()), containsMediaSurface: node.querySelector('img,video') !== null,
          containsTimestampLikeSurface: node.querySelector('time') !== null, containsActionBarLikeSurface: node.querySelector('[role="button"], button') !== null,
          hasAuthorHeaderTextSurface: node.querySelector('header,[role="heading"]') !== null,
          hasNestedArticleTextSurface: node.querySelector('article,[role="article"]') !== null,
          textViews: {
            currentReader: { value: currentReader, readSucceeded: true }, textContent: { value: textContent, readSucceeded: true },
            innerText: { value: innerText, readSucceeded: true }, visualText: { value: visualText(node), readSucceeded: true },
            descendantTextBlocks: { value: descendants.map((child) => child.value).join('\n'), readSucceeded: true },
          },
          descendantTexts: descendants, bodySubtrees,
        };
      });
      return { candidates: out, articles };
    }, { source: ACKNOWLEDGEMENT_PATTERN.source, flags: ACKNOWLEDGEMENT_PATTERN.flags, immutableText: String(options.immutableText || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim() });
    return { result: 'AVAILABLE', candidates: Array.isArray(captured?.candidates) ? captured.candidates : [], articles: Array.isArray(captured?.articles) ? captured.articles : [] };
  } catch {
    return { result: 'SAFE_EVALUATION_ERROR', candidates: [] };
  }
}

function createAcknowledgementShapeObserver(page, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const capture = typeof options.capture === 'function' ? options.capture : () => inspectAcknowledgementShapes(page, { immutableText: options.immutableText });
  const schedule = typeof options.schedule === 'function' ? options.schedule : setTimeout;
  const cancel = typeof options.cancel === 'function' ? options.cancel : clearTimeout;
  const startedAt = now(); const entries = new Map(); const articleEntries = new Map(); const timers = []; let snapshot = 0; let stopped = false; let result = 'UNAVAILABLE'; let startVisible = 0;
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
    for (const raw of (Array.isArray(captureResult?.articles) ? captureResult.articles : [])) {
      if (!raw?.key || articleEntries.size >= 16 && !articleEntries.has(raw.key)) continue;
      // Raw DOM text is reduced here, before any observer state or terminal
      // diagnostic can retain it.
      const correlationId = `POST_CANDIDATE_${articleEntries.size + 1}`;
      raw.candidateCorrelationId = articleEntries.get(raw.key)?.candidateCorrelationId || correlationId;
      const article = diagnoseArticleTextParity(raw, options.immutableText);
      const subtree = diagnoseArticleBodySubtrees(raw, options.immutableText);
      const existing = articleEntries.get(raw.key);
      if (existing) {
        existing.lastSnapshot = currentSnapshot; existing.lastObservedRelativeBucket = relativeBucket(now() - startedAt);
        existing.observationCount = Math.min(1000, existing.observationCount + 1);
        existing.immutableTextExactMatch = existing.immutableTextExactMatch || article.exactTextViewMatchObserved === true;
        existing.exactTextViewMatchObserved = existing.exactTextViewMatchObserved || article.exactTextViewMatchObserved === true;
        existing.exactDescendantMatchObserved = existing.exactDescendantMatchObserved || article.exactDescendantMatchObserved === true;
        existing.exactImmutableDescendantMatch = existing.exactImmutableDescendantMatch || article.exactImmutableDescendantMatch === true;
        existing.exactImmutableDescendantMatchCount = Math.max(existing.exactImmutableDescendantMatchCount || 0, article.exactImmutableDescendantMatchCount || 0);
        existing.views = article.views;
        existing.bodySubtree = subtree;
        existing.remainedVisibleThroughObservation = existing.remainedVisibleThroughObservation && article.visible;
        existing.remainedAttachedThroughObservation = existing.remainedAttachedThroughObservation && article.attached;
      } else articleEntries.set(raw.key, { ...article, candidateCorrelationId: raw.candidateCorrelationId, bodySubtree: subtree, immutableTextExactMatch: article.exactTextViewMatchObserved === true, firstSnapshot: currentSnapshot, lastSnapshot: currentSnapshot, firstObservedRelativeBucket: relativeBucket(now() - startedAt), lastObservedRelativeBucket: relativeBucket(now() - startedAt), observationCount: 1, wasPresentBeforeClickObservation: currentSnapshot === 0, firstObservedAfterClick: currentSnapshot > 0, remainedVisibleThroughObservation: article.visible, remainedAttachedThroughObservation: article.attached });
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
    structuralSummary(pageState = {}) {
      const candidates = [...entries.values()];
      const rawArticles = [...articleEntries.values()];
      const newArticles = rawArticles.filter((article) => article.firstSnapshot > 0);
      const articles = rawArticles.map(({ key, firstSnapshot, lastSnapshot, ...article }) => ({ ...article, transient: lastSnapshot < snapshot - 1 }));
      const count = (predicate) => candidates.filter(predicate).length;
      const articleVisible = articles.filter((article) => article.visible).length;
      const exact = articles.filter((article) => article.immutableTextExactMatch).length;
      const composerHiddenObserved = pageState.composerState === 'ATTACHED_HIDDEN' || pageState.composerState === 'DETACHED';
      const structuralSuccessEvidenceClass = exact > 0 && newArticles.some((article) => article.immutableTextExactMatch) ? 'IMMUTABLE_TEXT_POST_CANDIDATE'
        : newArticles.length > 0 && composerHiddenObserved ? 'MULTIPLE_STRUCTURAL_SIGNALS'
          : newArticles.length > 0 ? 'NEW_ARTICLE_STRUCTURE_ONLY'
            : composerHiddenObserved ? 'COMPOSER_ONLY' : 'NONE';
      return {
        ackSurfaceCount: candidates.length, toastLikeCount: count((candidate) => candidate.semanticContainer === 'TOAST_LIKE'), liveRegionLikeCount: count((candidate) => candidate.semanticContainer === 'LIVE_REGION_LIKE'), statusContainerLikeCount: count((candidate) => candidate.semanticContainer === 'STATUS_CONTAINER_LIKE'), alertContainerLikeCount: count((candidate) => candidate.semanticContainer === 'ALERT_CONTAINER_LIKE'),
        accessibleNameFromTextCount: count((candidate) => candidate.accessibleNameSource === 'TEXT_CONTENT' || candidate.accessibleNameSource === 'DESCENDANT_TEXT'), accessibleNameFromAriaCount: count((candidate) => candidate.accessibleNameSource === 'ARIA_LABEL' || candidate.accessibleNameSource === 'ARIA_LABELLEDBY'), accessibleNameUnavailableCount: count((candidate) => candidate.accessibleNameSource === 'UNAVAILABLE' || candidate.accessibleNameSource === 'SAFE_EVALUATION_ERROR'),
        composerHiddenObserved, publishControlGoneObserved: pageState.publishControlPresent === false, canonicalTargetStillValid: pageState.targetCanonicalValid === true,
        articleLikeCandidateCount: articles.length, visibleArticleLikeCandidateCount: articleVisible, immutableTextExactMatchCandidateCount: exact,
        newArticleLikeCandidateObservedAfterClick: newArticles.length > 0, exactImmutableTextCandidateObservedAfterClick: newArticles.some((article) => article.immutableTextExactMatch), structuralSuccessEvidenceClass,
        pageState, acknowledgementCandidates: candidates.map(({ key, firstSnapshot, lastSnapshot, languageSeen, ...candidate }) => candidate), articleCandidates: articles,
      };
    },
    textParitySummary() {
      const candidates = [...articleEntries.values()].map(({ key, firstSnapshot, lastSnapshot, ...article }) => ({
        ...article,
        exactTextViewMatchObserved: article.exactTextViewMatchObserved === true || article.immutableTextExactMatch === true,
        exactDescendantMatchObserved: article.exactDescendantMatchObserved === true,
      }));
      return summarizeArticleTextParity(candidates);
    },
    bodySubtreeSummary() {
      const candidates = [...articleEntries.values()].map((entry) => ({
        ...(entry.bodySubtree || {}), candidateCorrelationId: entry.candidateCorrelationId,
        candidate: { ...entry, candidateCorrelationId: entry.candidateCorrelationId },
        firstObservedRelativeBucket: entry.firstObservedRelativeBucket, lastObservedRelativeBucket: entry.lastObservedRelativeBucket,
        observationCount: entry.observationCount, wasPresentBeforeClickObservation: entry.wasPresentBeforeClickObservation,
        firstObservedAfterClick: entry.firstObservedAfterClick, remainedVisibleThroughObservation: entry.remainedVisibleThroughObservation,
        remainedAttachedThroughObservation: entry.remainedAttachedThroughObservation,
      }));
      return summarizeArticleBodySubtrees(candidates);
    },
  });
}

module.exports = {
  ACKNOWLEDGEMENT_PATTERN,
  MAX_ACKNOWLEDGEMENT_CANDIDATES,
  SEMANTIC_CLASSIFICATIONS,
  LANGUAGE_CLASSIFICATIONS,
  classifyAcknowledgementSemanticText,
  normalizeImmutablePostText,
  diagnoseArticleTextParity,
  diagnoseArticleBodySubtrees,
  summarizeArticleBodySubtrees,
  summarizeArticleTextParity,
  createAcknowledgementShapeObserver,
  inspectAcknowledgementShapes,
};
