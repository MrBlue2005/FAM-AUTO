'use strict';

// Strict, bounded body isolation for an already-selected canonical post.  It
// receives only the privacy-reduced structural body-block capture; candidate
// discovery, target selection, and any browser action remain outside it.
const MAX_DESCENT_DEPTH = 24;
const MAX_CHILDREN_PER_LEVEL = 16;
const MAX_INSPECTED_NODES = 128;

const BODY_DESCENT_RESULT = Object.freeze({
  EXACT_SAFE_BODY_REGION: 'EXACT_SAFE_BODY_REGION', BODY_SIGNAL_LOST: 'BODY_SIGNAL_LOST',
  BODY_SIGNAL_SPLIT_AMBIGUOUS: 'BODY_SIGNAL_SPLIT_AMBIGUOUS', BODY_CONTROL_INSEPARABLE: 'BODY_CONTROL_INSEPARABLE',
  COMMENT_REPLY_BOUNDARY: 'COMMENT_REPLY_BOUNDARY', INDEPENDENT_ARTICLE_BOUNDARY: 'INDEPENDENT_ARTICLE_BOUNDARY',
  HIDDEN_OR_DETACHED_BOUNDARY: 'HIDDEN_OR_DETACHED_BOUNDARY', INTERACTIVE_ANCESTOR_BOUNDARY: 'INTERACTIVE_ANCESTOR_BOUNDARY',
  DEPTH_LIMIT_REACHED: 'DEPTH_LIMIT_REACHED', NODE_LIMIT_REACHED: 'NODE_LIMIT_REACHED', SAFE_EVALUATION_ERROR: 'SAFE_EVALUATION_ERROR',
});

function normalize(value) { return String(value || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim(); }
function result(value, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits, proof = 'NONE') {
  return { bodyDescentAttempted: true, bodyDescentResult: value, bodyDescentDepth: depth, bodyDescentNodesInspected: nodesInspected, bodyDescentUniqueBranchSteps: uniqueBranchSteps, bodyDescentControlOnlyBranchesIgnored: controlOnlyBranchesIgnored, bodyDescentBodySignalSplits: bodySignalSplits, proof };
}
function samePost(block) { return block?.articleRelation === 'SELECTED_POST_ROOT' || block?.articleRelation === 'DESCENDANT_OF_SELECTED_POST' || block?.articleRelation === undefined; }
function unsafeBoundary(block) {
  if (!block?.visible || !block?.attached || block?.hidden || block?.detached) return BODY_DESCENT_RESULT.HIDDEN_OR_DETACHED_BOUNDARY;
  if (block?.commentReplyAncestor || block?.articleRelation === 'COMMENT_REPLY_ARTICLE') return BODY_DESCENT_RESULT.COMMENT_REPLY_BOUNDARY;
  if (!samePost(block) || block?.nestedArticle || block?.independentNestedArticle || block?.articleRelation === 'INDEPENDENT_NESTED_ARTICLE') return BODY_DESCENT_RESULT.INDEPENDENT_ARTICLE_BOUNDARY;
  if (block?.interactive || block?.interactiveAncestor) return BODY_DESCENT_RESULT.INTERACTIVE_ANCESTOR_BOUNDARY;
  return null;
}

function resolveUniqueBodyBranch(subtrees, immutableText, limits = {}) {
  const maxDepth = Math.max(1, Math.min(MAX_DESCENT_DEPTH, Number(limits.maxDepth) || MAX_DESCENT_DEPTH));
  const maxChildren = Math.max(1, Math.min(MAX_CHILDREN_PER_LEVEL, Number(limits.maxChildren) || MAX_CHILDREN_PER_LEVEL));
  const maxNodes = Math.max(1, Math.min(MAX_INSPECTED_NODES, Number(limits.maxNodes) || MAX_INSPECTED_NODES));
  try {
    const body = normalize(immutableText);
    if (!body || !Array.isArray(subtrees)) return result(BODY_DESCENT_RESULT.SAFE_EVALUATION_ERROR, 0, 0, 0, 0, 0);
    const blocks = subtrees.slice(0, MAX_INSPECTED_NODES).filter((block) => block && Number.isInteger(block.blockIndex));
    const byParent = new Map();
    for (const block of blocks) {
      const key = Number.isInteger(block.parentBlockIndex) ? block.parentBlockIndex : null;
      const list = byParent.get(key) || []; list.push(block); byParent.set(key, list);
    }
    let current = null; let depth = 0; let nodesInspected = 0; let uniqueBranchSteps = 0; let controlOnlyBranchesIgnored = 0; let bodySignalSplits = 0;
    while (true) {
      const children = current ? (byParent.get(current.blockIndex) || []) : (byParent.get(null) || []);
      if (children.length > maxChildren) return result(BODY_DESCENT_RESULT.NODE_LIMIT_REACHED, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits);
      nodesInspected += children.length;
      if (nodesInspected > maxNodes) return result(BODY_DESCENT_RESULT.NODE_LIMIT_REACHED, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits);
      // A body may be represented by strict contiguous body-text siblings.
      // Evaluate that representation before the whole-body-signal branch
      // count: individual line blocks do not each contain the full immutable
      // body, but their exact normalized sequence can safely prove it.
      const contiguousCandidates = children.filter((block) => block.visible && block.attached && samePost(block)
        && !block.commentReplyAncestor && !block.nestedArticle && !block.independentNestedArticle
        && !block.interactive && !block.interactiveAncestor && !block.structuralUiExcluded
        && block.hasInteractiveDescendant !== true && normalize(block.value));
      const joinedChildren = normalize(contiguousCandidates.map((block) => block.value).join('\n'));
      if (contiguousCandidates.length > 1 && joinedChildren === body) {
        return result(BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION, depth + 1, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits, 'CONTIGUOUS_EXACT_BLOCKS');
      }
      const bodyChildren = children.filter((block) => block.containsImmutableText === true);
      controlOnlyBranchesIgnored += children.filter((block) => block.containsImmutableText !== true && (block.interactive === true || block.interactiveAncestor === true || block.hasInteractiveDescendant === true || block.actionLikeAncestor === true)).length;
      if (!bodyChildren.length) return result(BODY_DESCENT_RESULT.BODY_SIGNAL_LOST, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits);
      if (bodyChildren.length > 1) { bodySignalSplits += 1; return result(BODY_DESCENT_RESULT.BODY_SIGNAL_SPLIT_AMBIGUOUS, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits); }
      current = bodyChildren[0]; depth += 1; uniqueBranchSteps += 1;
      if (depth > maxDepth) return result(BODY_DESCENT_RESULT.DEPTH_LIMIT_REACHED, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits);
      const boundary = unsafeBoundary(current);
      if (boundary) return result(boundary, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits);
      if (current.exactImmutableMatch === true && normalize(current.value) === body && current.structuralUiExcluded !== true && current.hasInteractiveDescendant !== true) {
        return result(BODY_DESCENT_RESULT.EXACT_SAFE_BODY_REGION, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits, 'EXACT_NODE');
      }
      if (current.bodyControlInseparable === true) return result(BODY_DESCENT_RESULT.BODY_CONTROL_INSEPARABLE, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits);
      // A body-bearing leaf that is neither exact nor structurally separable
      // cannot be promoted from substring evidence.
      if (!(byParent.get(current.blockIndex) || []).length && current.hasInteractiveDescendant === true) return result(BODY_DESCENT_RESULT.BODY_CONTROL_INSEPARABLE, depth, nodesInspected, uniqueBranchSteps, controlOnlyBranchesIgnored, bodySignalSplits);
    }
  } catch { return result(BODY_DESCENT_RESULT.SAFE_EVALUATION_ERROR, 0, 0, 0, 0, 0); }
}

module.exports = { BODY_DESCENT_RESULT, MAX_DESCENT_DEPTH, MAX_CHILDREN_PER_LEVEL, MAX_INSPECTED_NODES, resolveUniqueBodyBranch };
