'use strict';

// Post-click verification deliberately has a much narrower authority than the
// publisher. It can visit only the already-canonical task target and it never
// holds, discovers, or clicks a publication control.
const { diagnoseArticleBodySubtrees } = require('./acknowledgementDiagnostics');

const RESULT = Object.freeze({
  VERIFIED_EXACT_TARGET_POST: 'VERIFIED_EXACT_TARGET_POST',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
  TARGET_MISMATCH: 'TARGET_MISMATCH',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  STRUCTURE_UNTRUSTED: 'STRUCTURE_UNTRUSTED',
  DUPLICATE_UNRESOLVED: 'DUPLICATE_UNRESOLVED',
  SAFE_EVALUATION_ERROR: 'SAFE_EVALUATION_ERROR',
});

function summary(result = {}) {
  return {
    navigationAttempted: result.navigationAttempted === true,
    navigationCount: Math.max(0, Math.min(1, Number(result.navigationCount) || 0)),
    canonicalTargetBeforeNavigation: result.canonicalTargetBeforeNavigation === true,
    canonicalTargetAfterNavigation: result.canonicalTargetAfterNavigation === true,
    navigationSucceeded: result.navigationSucceeded === true,
    candidateCount: Math.max(0, Math.min(16, Number(result.candidateCount) || 0)),
    visibleAttachedCandidateCount: Math.max(0, Math.min(16, Number(result.visibleAttachedCandidateCount) || 0)),
    exactBodyCandidateCount: Math.max(0, Math.min(16, Number(result.exactBodyCandidateCount) || 0)),
    structurallyTrustedExactCandidateCount: Math.max(0, Math.min(16, Number(result.structurallyTrustedExactCandidateCount) || 0)),
    duplicateExactCandidateCount: Math.max(0, Math.min(16, Number(result.duplicateExactCandidateCount) || 0)),
    resultClass: Object.values(RESULT).includes(result.resultClass) ? result.resultClass : RESULT.SAFE_EVALUATION_ERROR,
    ambiguityReason: ['NONE', 'MULTIPLE_EXACT_CANDIDATES', 'NO_TRUSTED_NEWNESS', 'NESTED_ARTICLE', 'SAFE_EVALUATION_ERROR'].includes(result.ambiguityReason) ? result.ambiguityReason : 'SAFE_EVALUATION_ERROR',
    verificationElapsedMs: Math.max(0, Math.min(120000, Number(result.verificationElapsedMs) || 0)),
  };
}

// `trustedNewness` is intentionally an explicit input, not a heuristic. The
// current Facebook DOM has no privacy-safe, stable newness signal; production
// capture therefore supplies false and identical historical posts fail closed.
function classifyRefreshedTargetCandidates(candidates, immutableText, options = {}) {
  try {
    const rows = Array.isArray(candidates) ? candidates.slice(0, 16) : [];
    const reduced = rows.map((raw, index) => ({ raw, body: diagnoseArticleBodySubtrees({ ...raw, candidateCorrelationId: `RELOAD_CANDIDATE_${index + 1}` }, immutableText) }));
    const visibleAttached = reduced.filter(({ body }) => body.candidate?.visible && body.candidate?.attached);
    const exact = visibleAttached.filter(({ body }) => body.minimalExactBodySubtreeFound || body.exactContiguousBlockSequenceFound);
    const trusted = exact.filter(({ body }) => body.candidate?.hasNestedArticleTextSurface !== true);
    const base = { candidateCount: rows.length, visibleAttachedCandidateCount: visibleAttached.length, exactBodyCandidateCount: exact.length, structurallyTrustedExactCandidateCount: trusted.length, duplicateExactCandidateCount: trusted.length > 1 ? trusted.length : 0 };
    if (!trusted.length) return { ...base, resultClass: exact.length ? RESULT.STRUCTURE_UNTRUSTED : RESULT.NOT_FOUND, ambiguityReason: exact.length ? 'NESTED_ARTICLE' : 'NONE' };
    if (trusted.length > 1) return { ...base, resultClass: RESULT.AMBIGUOUS, ambiguityReason: 'MULTIPLE_EXACT_CANDIDATES' };
    if (options.trustedNewness !== true) return { ...base, resultClass: RESULT.DUPLICATE_UNRESOLVED, ambiguityReason: 'NO_TRUSTED_NEWNESS' };
    return { ...base, resultClass: RESULT.VERIFIED_EXACT_TARGET_POST, ambiguityReason: 'NONE' };
  } catch {
    return { candidateCount: 0, visibleAttachedCandidateCount: 0, exactBodyCandidateCount: 0, structurallyTrustedExactCandidateCount: 0, duplicateExactCandidateCount: 0, resultClass: RESULT.SAFE_EVALUATION_ERROR, ambiguityReason: 'SAFE_EVALUATION_ERROR' };
  }
}

async function captureTargetCandidates(page) {
  return page.evaluate(() => {
    const visible = (node) => { try { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return node.isConnected && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0; } catch { return false; } };
    const depth = (node, root) => { let current = node; let value = 0; while (current?.parentElement && current !== root && value < 24) { current = current.parentElement; value += 1; } return value; };
    return Array.from(document.querySelectorAll('[role="article"], article')).slice(0, 16).map((node) => ({
      candidateFamily: String(node.getAttribute('role') || '').toLowerCase() === 'article' ? 'ARTICLE_ROLE' : node.tagName === 'ARTICLE' ? 'POST_CONTAINER_LIKE' : 'UNKNOWN_ARTICLE_LIKE',
      visible: visible(node), attached: node.isConnected === true,
      // A reply/comment article nested inside another article is not an
      // independently trusted target-post surface. Treat either nesting
      // direction as ambiguity rather than selecting it.
      hasNestedArticleTextSurface: node.querySelector('article,[role="article"]') !== null || node.parentElement?.closest('article,[role="article"]') !== null,
      hasAuthorHeaderTextSurface: node.querySelector('header,[role="heading"]') !== null,
      hasActionControlTextSurface: node.querySelector('button,[role="button"]') !== null,
      hasTimestampTextSurface: node.querySelector('time') !== null,
      textViews: { currentReader: { value: String(node.innerText || ''), readSucceeded: true }, textContent: { value: String(node.textContent || ''), readSucceeded: true }, innerText: { value: String(node.innerText || ''), readSucceeded: true }, visualText: { value: String(node.innerText || ''), readSucceeded: true }, descendantTextBlocks: { value: '', readSucceeded: true } },
      descendantTexts: Array.from(node.querySelectorAll('div,span,p')).slice(0, 24).map((child) => ({ value: String(child.innerText || child.textContent || ''), visible: visible(child), attached: child.isConnected === true })),
      bodySubtrees: Array.from(node.querySelectorAll('div,span,p,article,section')).slice(0, 24).map((child) => ({ value: String(child.innerText || child.textContent || ''), visible: visible(child), attached: child.isConnected === true, depthRelativeToCandidate: depth(child, node), tagFamily: ['DIV','SPAN','P','ARTICLE','SECTION'].includes(child.tagName) ? child.tagName : 'OTHER', hasDirectTextNode: Array.from(child.childNodes).some((item) => item.nodeType === Node.TEXT_NODE && String(item.nodeValue || '').trim()), hasDescendantText: child.children.length > 0, hasInteractiveDescendant: child.querySelector('button,[role="button"],a') !== null, hasArticleDescendant: child.querySelector('article,[role="article"]') !== null, readSucceeded: true })),
    }));
  });
}

async function verifyRefreshedTargetPost(page, options = {}) {
  const startedAt = typeof options.now === 'function' ? options.now() : Date.now();
  const finish = (value) => summary({ ...value, verificationElapsedMs: (typeof options.now === 'function' ? options.now() : Date.now()) - startedAt });
  const verifyTarget = options.verifyTarget;
  try {
    verifyTarget?.(page.url(), options.targetCanonical);
  } catch { return finish({ navigationAttempted: false, navigationCount: 0, canonicalTargetBeforeNavigation: false, canonicalTargetAfterNavigation: false, navigationSucceeded: false, resultClass: RESULT.TARGET_MISMATCH, ambiguityReason: 'NONE' }); }
  try {
    await page.goto(options.targetCanonical, { waitUntil: 'domcontentloaded', timeout: Math.max(1000, Math.min(30000, Number(options.timeout) || 30000)) });
  } catch { return finish({ navigationAttempted: true, navigationCount: 1, canonicalTargetBeforeNavigation: true, canonicalTargetAfterNavigation: false, navigationSucceeded: false, resultClass: RESULT.NAVIGATION_FAILED, ambiguityReason: 'NONE' }); }
  try {
    verifyTarget?.(page.url(), options.targetCanonical);
  } catch { return finish({ navigationAttempted: true, navigationCount: 1, canonicalTargetBeforeNavigation: true, canonicalTargetAfterNavigation: false, navigationSucceeded: true, resultClass: RESULT.TARGET_MISMATCH, ambiguityReason: 'NONE' }); }
  try {
    const classified = classifyRefreshedTargetCandidates(await (options.captureCandidates || captureTargetCandidates)(page), options.immutableText, { trustedNewness: options.trustedNewness === true });
    return finish({ navigationAttempted: true, navigationCount: 1, canonicalTargetBeforeNavigation: true, canonicalTargetAfterNavigation: true, navigationSucceeded: true, ...classified });
  } catch { return finish({ navigationAttempted: true, navigationCount: 1, canonicalTargetBeforeNavigation: true, canonicalTargetAfterNavigation: true, navigationSucceeded: true, resultClass: RESULT.SAFE_EVALUATION_ERROR, ambiguityReason: 'SAFE_EVALUATION_ERROR' }); }
}

module.exports = { RESULT, summary, classifyRefreshedTargetCandidates, verifyRefreshedTargetPost };
