'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BODY_DESCENT_RESULT: TERMINAL, MAX_DESCENT_DEPTH, MAX_CHILDREN_PER_LEVEL, MAX_INSPECTED_NODES, resolveUniqueBodyBranch } = require('../app/facebook/uniqueBodyBranchDescent');

const TEXT = 'Exact immutable smoke body\nSecond line';
function shape(overrides = {}, children = []) { return { visible: true, attached: true, articleRelation: 'DESCENDANT_OF_SELECTED_POST', value: '', interactive: false, interactiveAncestor: false, hasInteractiveDescendant: false, commentReplyAncestor: false, nestedArticle: false, structuralUiExcluded: false, children, ...overrides }; }
const signal = (children = [], overrides = {}) => shape({ value: `prefix ${TEXT}`, containsImmutableText: true, ...overrides }, children);
const leaf = (overrides = {}) => shape({ value: TEXT, containsImmutableText: true, exactImmutableMatch: true, ...overrides });
function repeated(count, end, options = {}) { let current = end; for (let index = 0; index < count; index += 1) current = signal([current], options); return current; }
function blocks(root) {
  const result = []; const visit = (item, parent = null) => { const blockIndex = result.length + 1; result.push({ ...item, blockIndex, parentBlockIndex: parent, children: undefined }); item.children.forEach((child) => visit(child, blockIndex)); };
  visit(root); return result;
}
function run(root, limits) { return resolveUniqueBodyBranch(blocks(root), TEXT, limits); }

test('G5.7EV production unique body descent classifies fixtures A-P', () => {
  const fixtures = {
    A: [repeated(12, leaf()), TERMINAL.EXACT_SAFE_BODY_REGION],
    B: [repeated(20, leaf()), TERMINAL.EXACT_SAFE_BODY_REGION],
    C: [signal([signal([leaf()]), shape({ interactive: true })]), TERMINAL.EXACT_SAFE_BODY_REGION],
    D: [repeated(3, signal([signal([leaf()]), shape({ interactive: true })])), TERMINAL.EXACT_SAFE_BODY_REGION],
    E: [repeated(4, shape({ value: `prefix ${TEXT}`, containsImmutableText: true, bodyControlInseparable: true })), TERMINAL.BODY_CONTROL_INSEPARABLE],
    F: [signal([signal(), signal()]), TERMINAL.BODY_SIGNAL_SPLIT_AMBIGUOUS],
    G: [signal([shape({ value: 'other', containsImmutableText: false })]), TERMINAL.BODY_SIGNAL_LOST],
    H: [leaf({ interactive: true }), TERMINAL.INTERACTIVE_ANCESTOR_BOUNDARY],
    I: [leaf({ interactiveAncestor: true }), TERMINAL.INTERACTIVE_ANCESTOR_BOUNDARY],
    J: [leaf({ commentReplyAncestor: true }), TERMINAL.COMMENT_REPLY_BOUNDARY],
    K: [leaf({ nestedArticle: true, articleRelation: 'INDEPENDENT_NESTED_ARTICLE' }), TERMINAL.INDEPENDENT_ARTICLE_BOUNDARY],
    L: [leaf({ visible: false }), TERMINAL.HIDDEN_OR_DETACHED_BOUNDARY],
    M: [leaf({ attached: false }), TERMINAL.HIDDEN_OR_DETACHED_BOUNDARY],
    N: [repeated(25, leaf()), TERMINAL.DEPTH_LIMIT_REACHED],
    O: [repeated(12, leaf()), TERMINAL.NODE_LIMIT_REACHED, { maxNodes: 10 }],
    P: [signal([leaf(), leaf()]), TERMINAL.BODY_SIGNAL_SPLIT_AMBIGUOUS],
  };
  for (const [name, [root, expected, limits]] of Object.entries(fixtures)) assert.equal(run(root, limits).bodyDescentResult, expected, name);
});

test('G5.7EV bounds are independent and preserve the 20-wrapper safe path', () => {
  assert.deepEqual([MAX_DESCENT_DEPTH, MAX_CHILDREN_PER_LEVEL, MAX_INSPECTED_NODES], [24, 16, 128]);
  const result = run(repeated(20, leaf()));
  assert.equal(result.bodyDescentResult, TERMINAL.EXACT_SAFE_BODY_REGION);
  assert.equal(result.bodyDescentDepth, 21);
});

test('G5.7EV never promotes substring, broad wrapper, or interactive text to exact proof', () => {
  for (const root of [signal([]), leaf({ structuralUiExcluded: true }), leaf({ interactive: true }), leaf({ interactiveAncestor: true })]) assert.notEqual(run(root).bodyDescentResult, TERMINAL.EXACT_SAFE_BODY_REGION);
});

test('G5.7FA hidden and detached body-branch matrix remains fail closed without polluting control-only paths', () => {
  const hiddenBodyLeaf = leaf({ visible: false });
  const hiddenBodyWrapper = signal([leaf()], { visible: false });
  const hiddenControl = shape({ visible: false, interactive: true });
  const detachedBodyDuplicate = leaf({ visible: false, attached: false });
  const hiddenBodyDuplicate = leaf({ visible: false });
  const detachedControl = shape({ visible: false, attached: false, interactive: true });

  const fixtures = {
    A: [repeated(5, hiddenBodyLeaf), TERMINAL.HIDDEN_OR_DETACHED_BOUNDARY],
    B: [repeated(5, hiddenBodyWrapper), TERMINAL.HIDDEN_OR_DETACHED_BOUNDARY],
    C: [repeated(5, signal([leaf(), hiddenControl])), TERMINAL.EXACT_SAFE_BODY_REGION],
    D: [repeated(5, signal([leaf(), detachedBodyDuplicate])), TERMINAL.BODY_SIGNAL_SPLIT_AMBIGUOUS],
    E: [repeated(5, signal([leaf(), hiddenBodyDuplicate])), TERMINAL.BODY_SIGNAL_SPLIT_AMBIGUOUS],
    F: [repeated(5, signal([leaf(), detachedControl])), TERMINAL.EXACT_SAFE_BODY_REGION],
    G: [repeated(5, signal([signal([leaf(), hiddenBodyDuplicate])])), TERMINAL.BODY_SIGNAL_SPLIT_AMBIGUOUS],
  };

  for (const [name, [root, expected]] of Object.entries(fixtures)) {
    const outcome = run(root);
    assert.equal(outcome.bodyDescentResult, expected, name);
    assert.equal(outcome.bodyDescentBodySignalSplits, expected === TERMINAL.BODY_SIGNAL_SPLIT_AMBIGUOUS ? 1 : 0, `${name} split count`);
  }
});
