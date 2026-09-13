'use strict';

function failure(code, message) { return Object.assign(new Error(message), { code }); }

// These are the reviewed group-composer entry labels seen in Facebook's
// Romanian and English UI. They intentionally are exact strings: broad text
// matching would make a comment or another publishing surface eligible.
const COMPOSER_ENTRY_LABELS = Object.freeze([
  'Scrie ceva...',
  'Scrie ceva',
  'Write something...',
  'Write something',
]);

const GROUP_COMPOSER_STRUCTURAL_SELECTOR = '[role="main"] [data-pagelet="GroupFeed"] [role="textbox"][contenteditable="true"][aria-label]';
// This selector is evaluated only below an already retained, uniquely
// transitioned composer root.  It intentionally describes possible text-entry
// shapes rather than granting page-wide editor discovery authority.
const COMPOSER_EDITOR_SELECTOR = [
  '[contenteditable="true"]',
  '[role="textbox"]',
  'textarea',
  '[data-lexical-editor="true"]',
  '.ProseMirror[contenteditable="true"]',
].join(', ');
// Deliberately small root set.  A root is never selected for publishing merely
// because it exists: it must make a unique pre/post-click transition into the
// full composer contract below.
const COMPOSER_ROOT_SELECTOR = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-pagelet*="Composer" i]',
  '[data-pagelet*="CreatePost" i]',
].join(', ');
const COMPOSER_TRANSITION_TIMEOUT_MS = 10000;
const COMPOSER_TRANSITION_POLL_MS = 100;
const EDITOR_SHAPE_MAX_CANDIDATES = 12;

// This is intentionally structural-only. It is evaluated only against a root
// that has already passed the composer structural contract; it never reads a
// label, value, text node, HTML, class, id, or selector from Facebook.
async function inspectRootLocalEditorShapes(handle) {
  if (!handle || typeof handle.evaluate !== 'function') return { candidates: [], summary: {} };
  const raw = await handle.evaluate((root, max) => {
    const selector = '[contenteditable],[role],textarea,input,[data-lexical-editor],[tabindex],[aria-multiline]';
    const visible = (node) => { const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node); const box = node.getBoundingClientRect?.(); return Boolean(node.isConnected && style?.display !== 'none' && style?.visibility !== 'hidden' && box && box.width >= 0 && box.height >= 0); };
    const depth = (node) => { let value = 0; for (let current = node; current && current !== root; current = current.parentElement) value += 1; return value; };
    const classFor = (value) => value === 'true' ? 'true' : value === 'false' ? 'false' : value === 'plaintext-only' ? 'plaintext-only' : value === '' ? 'empty' : 'inherited/absent';
    return Array.from(root.querySelectorAll(selector)).slice(0, max).map((node) => {
      const ce = node.getAttribute('contenteditable'); const role = node.getAttribute('role');
      const tag = String(node.tagName || '').toLowerCase();
      const editableAncestor = Boolean(node.parentElement?.closest?.('[contenteditable], [data-lexical-editor]')) || node.ownerDocument?.designMode === 'on';
      const reason = node.hasAttribute('contenteditable') ? 'CONTENTEDITABLE_ATTRIBUTE' : role ? 'ROLE_ATTRIBUTE' : tag === 'textarea' ? 'TEXTAREA_TAG' : tag === 'input' ? 'INPUT_TAG' : node.hasAttribute('data-lexical-editor') ? 'LEXICAL_ATTRIBUTE' : node.hasAttribute('aria-multiline') ? 'ARIA_MULTILINE' : 'TABINDEX';
      return { tagName: ['textarea', 'input', 'div', 'span', 'p'].includes(tag) ? tag : 'other', role: role === 'textbox' ? 'textbox' : role === 'combobox' ? 'combobox' : role === 'searchbox' ? 'searchbox' : role ? 'other' : null, contenteditable: classFor(ce), hasDataLexicalEditor: node.hasAttribute('data-lexical-editor'), ariaMultiline: node.hasAttribute('aria-multiline') ? node.getAttribute('aria-multiline') === 'true' : null, tabIndex: Math.max(-1, Math.min(1000, Number(node.tabIndex) || 0)), isContentEditable: node.isContentEditable === true, disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true', readOnly: node.readOnly === true || node.getAttribute('aria-readonly') === 'true', visible: visible(node), attached: node.isConnected === true, ancestorEditable: editableAncestor, childElementCount: Math.min(12, node.children?.length || 0), descendantEditableCount: Math.min(12, node.querySelectorAll?.('[contenteditable], [data-lexical-editor], textarea, input').length || 0), candidateDepth: Math.min(12, depth(node)), reason };
    });
  }, EDITOR_SHAPE_MAX_CANDIDATES).catch(() => []);
  const candidates = Array.isArray(raw) ? raw.slice(0, EDITOR_SHAPE_MAX_CANDIDATES) : [];
  return { candidates, summary: summarizeEditorShapes(candidates) };
}

function summarizeEditorShapes(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  return { candidateCount: list.length, visibleCandidateCount: list.filter((item) => item.visible).length, isContentEditableCount: list.filter((item) => item.isContentEditable).length, contenteditableAttributePresentCount: list.filter((item) => item.contenteditable !== 'inherited/absent').length, roleTextboxCount: list.filter((item) => item.role === 'textbox').length, textareaCount: list.filter((item) => item.tagName === 'textarea').length, lexicalCount: list.filter((item) => item.hasDataLexicalEditor).length, editableAncestorCount: list.filter((item) => item.ancestorEditable).length, plaintextOnlyCount: list.filter((item) => item.contenteditable === 'plaintext-only').length, otherRoleCount: list.filter((item) => item.role === 'other').length };
}

async function visibleEnabledCandidates(locator) {
  const candidates = [];
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) candidates.push(candidate);
  }
  return candidates;
}

async function findComposerOpener(page) {
  const labelled = [];
  for (const label of COMPOSER_ENTRY_LABELS) {
    for (const role of ['button', 'textbox']) {
      labelled.push(...await visibleEnabledCandidates(page.getByRole(role, { name: label, exact: true })));
    }
  }
  if (labelled.length === 1) return labelled[0];
  if (labelled.length > 1) throw failure('FACEBOOK_COMPOSER_OPENER_AMBIGUOUS', 'The group composer opener is ambiguous.');

  // The fallback is deliberately bounded to Facebook's GroupFeed creation
  // area. It is never a generic page-wide contenteditable search, so comment
  // boxes and unrelated dialogs remain ineligible.
  const structural = await visibleEnabledCandidates(page.locator(GROUP_COMPOSER_STRUCTURAL_SELECTOR));
  if (structural.length === 1) return structural[0];
  if (structural.length > 1) throw failure('FACEBOOK_COMPOSER_OPENER_AMBIGUOUS', 'The group composer opener is ambiguous.');
  throw failure('FACEBOOK_COMPOSER_OPENER_MISSING', 'The group composer opener is unavailable.');
}

async function sameDomNode(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left.evaluate !== 'function') return false;
  return left.evaluate((node, other) => node === other, right).catch(() => false);
}

async function rootSignals(handle) {
  if (!handle || typeof handle.evaluate !== 'function') return { structural: false, actionRegion: false, excluded: true, hasRoleDialog: false, hasAriaModal: false, hasComposerPageletSignal: false };
  return handle.evaluate((node) => {
    const attr = (name) => String(node.getAttribute?.(name) || '');
    const ownPagelet = attr('data-pagelet');
    const ancestorPagelet = String(node.closest?.('[data-pagelet]')?.getAttribute?.('data-pagelet') || '');
    const rootText = `${attr('role')} ${attr('aria-modal')} ${ownPagelet} ${ancestorPagelet} ${attr('aria-label')} ${attr('data-testid')}`;
    const lower = rootText.toLowerCase();
    const hasRoleDialog = attr('role') === 'dialog';
    const hasAriaModal = attr('aria-modal') === 'true';
    const hasComposerPageletSignal = /(composer|createpost)/i.test(`${ownPagelet} ${ancestorPagelet}`);
    const structural = hasRoleDialog || hasAriaModal || hasComposerPageletSignal;
    // A root must look like a create-post surface, rather than merely any
    // overlay that happens to contain a textbox.  Pagelet evidence is locale
    // independent; controls are supplemental evidence for the current FB UI.
    const actionRegion = /(composer|createpost)/i.test(`${ownPagelet} ${ancestorPagelet}`)
      || Boolean(node.querySelector?.([
        'input[type="file"]',
        '[data-pagelet*="Composer" i]',
        '[data-pagelet*="CreatePost" i]',
        '[data-testid*="composer" i]',
        '[data-testid*="post" i]',
        '[role="button"][aria-label*="post" i]',
        '[role="button"][aria-label*="photo" i]',
        '[role="button"][aria-label*="media" i]',
        '[role="button"][aria-label*="fotograf" i]',
      ].join(', ')));
    const excluded = /(comment|reply|ufi|search|settings|report)/i.test(lower);
    return { structural, actionRegion, excluded, hasRoleDialog, hasAriaModal, hasComposerPageletSignal };
  }).catch(() => ({ structural: false, actionRegion: false, excluded: true, hasRoleDialog: false, hasAriaModal: false, hasComposerPageletSignal: false }));
}

async function eligibleEditors(handle) {
  const editors = handle?.locator?.(COMPOSER_EDITOR_SELECTOR);
  const count = await editors?.count?.().catch(() => 0);
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const editor = editors.nth(index);
    const [visible, enabled, editable, metadata] = await Promise.all([
      editor?.isVisible?.().catch(() => false),
      editor?.isEnabled?.().catch(() => false),
      typeof editor?.isEditable === 'function' ? editor.isEditable().catch(() => false) : Promise.resolve(null),
      editor?.evaluate?.((node) => {
        const attr = (name) => String(node.getAttribute?.(name) || '');
        const text = `${attr('aria-label')} ${attr('placeholder')} ${attr('data-testid')} ${attr('data-pagelet')}`.toLowerCase();
        const context = String(node.closest?.('[data-pagelet], [aria-label], [data-testid]')?.getAttribute?.('data-pagelet') || '').toLowerCase();
        const contentEditable = attr('contenteditable') === 'true';
        const inheritedEditable = node.isContentEditable === true;
        const roleTextbox = attr('role') === 'textbox';
        const isTextarea = String(node.tagName || '').toLowerCase() === 'textarea';
        const lexical = attr('data-lexical-editor') === 'true'
          || Boolean(node.closest?.('[data-lexical-editor="true"], .ProseMirror'));
        return {
          postShape: isTextarea || contentEditable || (roleTextbox && inheritedEditable) || (lexical && inheritedEditable),
          contentEditable,
          roleTextbox,
          lexical,
          isTextarea,
          inheritedEditable,
          excluded: /(comment|reply|ufi|search)/i.test(`${text} ${context}`),
        };
      }).catch(() => ({ postShape: false, excluded: true, contentEditable: false, roleTextbox: false, lexical: false, isTextarea: false, inheritedEditable: false })),
    ]);
    const isEditable = editable === null ? metadata?.inheritedEditable === true || metadata?.isTextarea === true : editable === true;
    if (visible === true && enabled === true && isEditable && metadata?.postShape === true && metadata.excluded !== true) {
      const exactHandle = await editor?.elementHandle?.().catch(() => null);
      candidates.push({ locator: editor, handle: exactHandle || editor, evidence: { ...metadata, isEditable } });
    }
  }
  return candidates;
}

async function composerContract(handle) {
  const attachedPromise = typeof handle?.evaluate === 'function'
    ? handle.evaluate((node) => node.isConnected).catch(() => false)
    : Promise.resolve(false);
  const visiblePromise = typeof handle?.isVisible === 'function'
    ? handle.isVisible().catch(() => false)
    : Promise.resolve(false);
  const [attached, visible] = await Promise.all([
    attachedPromise,
    visiblePromise,
  ]);
  if (attached !== true || visible !== true) return {
    contract: 'inactive',
    evidence: { isAttached: attached === true, isVisible: visible === true, hasRoleDialog: false, hasAriaModal: false, hasComposerPageletSignal: false, structurallyEligible: false, eligibleEditorCount: 0 },
  };
  const signals = await rootSignals(handle);
  const structurallyEligible = signals.structural && signals.actionRegion && !signals.excluded;
  if (!structurallyEligible) return {
    contract: 'not-composer',
    evidence: { isAttached: true, isVisible: true, ...signals, structurallyEligible: false, eligibleEditorCount: 0 },
  };
  const editors = await eligibleEditors(handle);
  const editorEvidence = editors[0]?.evidence || {};
  const evidence = { isAttached: true, isVisible: true, ...signals, structurallyEligible: true, eligibleEditorCount: editors.length, ...editorEvidence };
  if (editors.length === 1) return { contract: 'eligible', evidence, editor: editors[0] };
  return { contract: editors.length > 1 ? 'ambiguous' : 'not-composer', evidence, editor: null };
}

async function snapshotComposerRoots(page) {
  const roots = page.locator(COMPOSER_ROOT_SELECTOR);
  const records = [];
  const count = await roots.count();
  for (let index = 0; index < count; index += 1) {
    const locator = roots.nth(index);
    const handle = await locator.elementHandle?.().catch(() => null);
    if (!handle) continue;
    const inspected = await composerContract(handle);
    records.push({ handle, locator, ...inspected });
  }
  return records;
}

function diagnosticEvidence(records, transition = null) {
  const counters = {
    potentialRootCount: records.length,
    visibleRootCount: records.filter((record) => record.evidence.isVisible).length,
    structurallyEligibleRootCount: records.filter((record) => record.evidence.structurallyEligible).length,
    rootsWithZeroEditor: records.filter((record) => record.evidence.structurallyEligible && record.evidence.eligibleEditorCount === 0).length,
    rootsWithOneEditor: records.filter((record) => record.evidence.structurallyEligible && record.evidence.eligibleEditorCount === 1).length,
    rootsWithMultipleEditors: records.filter((record) => record.evidence.structurallyEligible && record.evidence.eligibleEditorCount > 1).length,
    newRootCount: transition?.newRootCount || 0,
    removedRootCount: transition?.removedRootCount || 0,
    transitionedRootCount: transition?.transitionedRootCount || 0,
    eligibleTransitionCount: transition?.eligibleTransitionCount || 0,
  };
  const sample = records[0]?.evidence || {};
  return {
    counters,
    flags: {
      hasRoleDialog: records.some((record) => record.evidence.hasRoleDialog),
      hasAriaModal: records.some((record) => record.evidence.hasAriaModal),
      hasComposerPageletSignal: records.some((record) => record.evidence.hasComposerPageletSignal),
      hasVisibleEditor: records.some((record) => record.evidence.eligibleEditorCount > 0),
      editorCountIsOne: counters.rootsWithOneEditor === 1,
      hasRoleTextbox: records.some((record) => record.evidence.roleTextbox === true),
      hasContentEditable: records.some((record) => record.evidence.contentEditable === true || record.evidence.inheritedEditable === true),
      hasLexicalSignal: records.some((record) => record.evidence.lexical === true),
      isTextarea: records.some((record) => record.evidence.isTextarea === true),
      isEditable: records.some((record) => record.evidence.isEditable === true),
      isVisible: Boolean(sample.isVisible),
      isAttached: Boolean(sample.isAttached),
      transitionDetected: Boolean(transition && transition.kind !== 'none'),
    },
  };
}

function emitDiagnostic(diagnostic, stage, reasonClass, evidence, summary = false) {
  try {
    if (summary) diagnostic?.summary?.(stage, reasonClass, evidence);
    else diagnostic?.emit?.(stage, reasonClass, evidence);
  } catch {
    // Observability must not alter the reviewed composer contract.
  }
}

function emitObservationDiagnostics(diagnostic, records, transition) {
  const evidence = diagnosticEvidence(records, transition);
  emitDiagnostic(diagnostic, 'COMPOSER_POST_CLICK_OBSERVATION', 'SNAPSHOT', evidence);
  if (records.some((record) => !record.evidence.isAttached)) emitDiagnostic(diagnostic, 'COMPOSER_ROOT_DETACHED', 'ROOT_DETACHED', evidence);
  if (records.some((record) => record.evidence.isAttached && !record.evidence.isVisible)) emitDiagnostic(diagnostic, 'COMPOSER_ROOT_HIDDEN', 'ROOT_HIDDEN', evidence);
  if (records.some((record) => record.evidence.isVisible && !record.evidence.structurallyEligible)) emitDiagnostic(diagnostic, 'COMPOSER_ROOT_STRUCTURAL_REJECTED', 'STRUCTURAL_REJECTED', evidence);
  if (evidence.counters.rootsWithZeroEditor) emitDiagnostic(diagnostic, 'COMPOSER_ROOT_ZERO_EDITOR', 'ZERO_ELIGIBLE_EDITOR', evidence);
  if (evidence.counters.rootsWithMultipleEditors) emitDiagnostic(diagnostic, 'COMPOSER_ROOT_MULTIPLE_EDITORS', 'MULTIPLE_ELIGIBLE_EDITORS', evidence);
  return evidence;
}

async function findBeforeRecord(before, postRecord) {
  for (const record of before) {
    if (await sameDomNode(record.handle, postRecord.handle)) return record;
  }
  return null;
}

async function transitionResult(before, after) {
  const candidates = [];
  let ambiguous = false;
  let removed = 0;
  for (const record of before) {
    let retained = false;
    for (const post of after) {
      if (await sameDomNode(record.handle, post.handle)) { retained = true; break; }
    }
    if (!retained) removed += 1;
  }
  let newRootCount = 0;
  let transitionedRootCount = 0;
  let eligibleTransitionCount = 0;
  for (const post of after) {
    const prior = await findBeforeRecord(before, post);
    const transitioned = !prior || prior.contract !== post.contract;
    if (!prior) newRootCount += 1;
    if (transitioned) transitionedRootCount += 1;
    if (post.contract === 'ambiguous' && transitioned) ambiguous = true;
    if (post.contract === 'eligible' && (!prior || prior.contract !== 'eligible')) {
      candidates.push({ post, prior });
      eligibleTransitionCount += 1;
    }
  }
  const metrics = { newRootCount, removedRootCount: removed, transitionedRootCount, eligibleTransitionCount };
  if (ambiguous || candidates.length > 1) return { kind: 'ambiguous', ...metrics };
  if (!candidates.length) return { kind: 'none', ...metrics };
  const candidate = candidates[0];
  if (!candidate.prior) return { kind: removed > 0 ? 'replacement' : 'new', record: candidate.post, ...metrics };
  return { kind: 'reuse', record: candidate.post, ...metrics };
}

async function waitForComposerTransition(page, before, options = {}) {
  const timeoutMs = Number.isFinite(options.transitionTimeoutMs) ? options.transitionTimeoutMs : COMPOSER_TRANSITION_TIMEOUT_MS;
  const pollMs = Number.isFinite(options.transitionPollMs) ? options.transitionPollMs : COMPOSER_TRANSITION_POLL_MS;
  const started = Date.now();
  do {
    const after = await snapshotComposerRoots(page);
    const result = await transitionResult(before, after);
    await options.onObservation?.(after, result);
    if (result.kind !== 'none') return result;
    if (Date.now() - started >= timeoutMs) break;
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(pollMs);
    else await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (true);
  return { kind: 'none' };
}

async function openComposer(page, options = {}) {
  const trace = typeof options.trace === 'function' ? options.trace : () => {};
  const diagnostic = options.diagnostic;
  let finalEvidence = null;
  let diagnosticSummaryWritten = false;
  let lastShapeSummary = null;
  // The real publisher supplies this immediately after canonical target
  // verification. Do not discover a composer when that target proof fails.
  if (typeof options.assertTargetReady === 'function') options.assertTargetReady();
  try {
    emitDiagnostic(diagnostic, 'COMPOSER_DISCOVERY_START', 'DISCOVERY_STARTED');
    const composerButton = await findComposerOpener(page);
    trace('COMPOSER_OPENER_FOUND');
    emitDiagnostic(diagnostic, 'COMPOSER_OPENER_FOUND', 'OPENER_FOUND');
    const before = await snapshotComposerRoots(page);
    emitDiagnostic(diagnostic, 'COMPOSER_POTENTIAL_ROOTS_SNAPSHOT', 'SNAPSHOT', diagnosticEvidence(before));

    await composerButton.click();
    emitDiagnostic(diagnostic, 'COMPOSER_OPENER_CLICKED', 'OPENER_CLICKED');
    let shapeSnapshots = 0;
    const transition = await waitForComposerTransition(page, before, {
      ...options,
      onObservation: async (records, result) => {
        finalEvidence = emitObservationDiagnostics(diagnostic, records, result);
        // At most three root-local snapshots are diagnostic-only; composer
        // eligibility and transition decisions remain exactly as before.
        if (shapeSnapshots < 3 && diagnostic?.shape) {
          const root = records.find((record) => record.evidence.structurallyEligible && record.evidence.eligibleEditorCount === 0);
          if (root) { shapeSnapshots += 1; const shape = await inspectRootLocalEditorShapes(root.handle); lastShapeSummary = shape.summary; diagnostic.shape(shape.candidates, shape.summary); }
        }
      },
    });
    if (transition.kind === 'none') {
      trace('COMPOSER_OPEN_TIMEOUT');
      emitDiagnostic(diagnostic, 'COMPOSER_ROOT_NO_TRANSITION', 'NO_ELIGIBLE_TRANSITION', finalEvidence);
      emitDiagnostic(diagnostic, 'COMPOSER_ACQUISITION_TIMEOUT', 'ACQUISITION_TIMEOUT', finalEvidence);
      emitDiagnostic(diagnostic, 'COMPOSER_ACQUISITION_FAILED', 'NO_ELIGIBLE_TRANSITION', finalEvidence, true);
      diagnostic?.shapeSummary?.(lastShapeSummary || {});
      diagnosticSummaryWritten = true;
      throw failure('FACEBOOK_COMPOSER_OPEN_FAILED', 'The selected group composer opener did not open a composer.');
    }
    trace('COMPOSER_TRANSITION_OBSERVED');
    trace('COMPOSER_ROOT_CANDIDATE_OBSERVED');
    emitDiagnostic(diagnostic, 'COMPOSER_ROOT_CANDIDATE_SEEN', 'SNAPSHOT', finalEvidence);
    if (transition.kind === 'ambiguous') {
      trace('COMPOSER_TRANSITION_AMBIGUOUS');
      trace('COMPOSER_ROOT_AMBIGUOUS');
      emitDiagnostic(diagnostic, 'COMPOSER_ROOT_AMBIGUOUS', 'AMBIGUOUS_TRANSITION', finalEvidence);
      emitDiagnostic(diagnostic, 'COMPOSER_ACQUISITION_FAILED', 'AMBIGUOUS_TRANSITION', finalEvidence, true);
      diagnosticSummaryWritten = true;
      throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The opened Facebook composer cannot be uniquely identified.');
    }
    if (transition.kind === 'new') { trace('COMPOSER_UNIQUE_NEW'); trace('COMPOSER_ROOT_UNIQUE_NEW'); emitDiagnostic(diagnostic, 'COMPOSER_ROOT_TRANSITION_NEW', 'TRANSITION_NEW', finalEvidence); }
    if (transition.kind === 'replacement') { trace('COMPOSER_UNIQUE_REPLACEMENT'); trace('COMPOSER_ROOT_UNIQUE_REPLACEMENT'); emitDiagnostic(diagnostic, 'COMPOSER_ROOT_TRANSITION_REPLACEMENT', 'TRANSITION_REPLACEMENT', finalEvidence); }
    if (transition.kind === 'reuse') { trace('COMPOSER_UNIQUE_REUSE'); trace('COMPOSER_ROOT_UNIQUE_REUSE'); emitDiagnostic(diagnostic, 'COMPOSER_ROOT_TRANSITION_REUSE', 'TRANSITION_REUSE', finalEvidence); }
    const { locator, handle, editor } = transition.record;
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    if (!handle || !editor?.handle) throw failure('FACEBOOK_COMPOSER_UNVERIFIED', 'The opened Facebook composer cannot be retained.');

    emitDiagnostic(diagnostic, 'COMPOSER_ROOT_ACCEPTED', 'ROOT_ACCEPTED', finalEvidence);
    trace('COMPOSER_EDITOR_BOUND');
    emitDiagnostic(diagnostic, 'COMPOSER_EDITOR_BOUND', 'EDITOR_BOUND', finalEvidence);
    trace('COMPOSER_OPENED');
    console.log('Composerul a fost deschis.');
    return { handle, locator, editor: editor.handle };
  } catch (error) {
    if (!diagnosticSummaryWritten) emitDiagnostic(diagnostic, 'COMPOSER_ACQUISITION_FAILED', 'UNKNOWN_SAFE_FAILURE', finalEvidence, true);
    if (error?.code === 'FACEBOOK_COMPOSER_OPENER_AMBIGUOUS') trace('COMPOSER_OPENER_AMBIGUOUS');
    else if (error?.code === 'FACEBOOK_COMPOSER_UNVERIFIED') trace('COMPOSER_TRANSITION_AMBIGUOUS');
    else {
      if (error?.code === 'FACEBOOK_COMPOSER_OPEN_FAILED') trace('COMPOSER_ROOT_TIMEOUT');
      trace('COMPOSER_OPEN_FAILED');
    }
    throw error;
  }
}

module.exports = {
  COMPOSER_ENTRY_LABELS,
  COMPOSER_EDITOR_SELECTOR,
  COMPOSER_ROOT_SELECTOR,
  EDITOR_SHAPE_MAX_CANDIDATES,
  GROUP_COMPOSER_STRUCTURAL_SELECTOR,
  findComposerOpener,
  snapshotComposerRoots,
  transitionResult,
  openComposer,
  inspectRootLocalEditorShapes,
  summarizeEditorShapes,
};
