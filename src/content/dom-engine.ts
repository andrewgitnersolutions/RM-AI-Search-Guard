/**
 * DOM matching and hiding engine: collects AI Overview, AI Mode and auxiliary AI candidates
 * and hides them, guarded by the Organic Results Safety Guard (isUnsafeToHide).
 * Runs in: content script on google.com (isolated world).
 * Must never: read or report page text beyond fixed label comparisons, or hide core search UI.
 * Don't weaken isUnsafeToHide (AGENTS.md hard rule).
 * Shared with: shared/policy.ts, shared/selectors.ts, content/content.ts.
 */

import { trimCssWhitespace } from "../shared/policy";
import { SELECTORS, resolveUiLanguage } from "../shared/selectors";
import type { SupportedUiLanguage } from "../shared/selectors";
import type { ExtraHideSelectors, PolicyError, Toggles } from "../shared/types";

/** Policy toggles plus optional managed extraHideSelectors (BP-04). */
export type SweepPolicy = Toggles & { extraHideSelectors?: ExtraHideSelectors };

/** Which policy toggle an element was hidden under (stored in data-rmsg-hidden). */
export type HideCategory = "overview" | "aimode" | "aux";

/** Page-key sets used to count each hidden category at most once per page (BP-14). */
export interface SeenCategoryPages {
  overview: Set<string>;
  aimode: Set<string>;
  aux: Set<string>;
}

/** Per-sweep DOM snapshot of search inputs and protected landmarks (BP-09). */
export interface SafetyGuardCache {
  doc: Document;
  searchInputs: Element[] | null;
  protectedElements: Element[] | null;
}

export const PROTECTED_TAG_SET = new Set(SELECTORS.safetyGuard.protectedTags);

export const PROTECTED_SELECTOR_COMBINED = SELECTORS.safetyGuard.protectedSelectors.join(", ");

export const CONTAINER_ANCESTOR_COMBINED = SELECTORS.tier1.aiOverviews.containerAncestors.join(", ");

/**
 * Build per-language active label sets and combined direct selector strings once at module load
 * so DOM sweeps allocate nothing extra. Every supported non-English locale includes English
 * fallbacks so mixed-language Google markup still matches (BP-03).
 * @param lang - Resolved UI language.
 * @returns Combined direct selectors and lowercase label sets for that language. Pure; never throws.
 */
function buildLocaleSets(lang: SupportedUiLanguage) {
  const overviewHeadingTexts = new Set(SELECTORS.tier1.aiOverviews.headingTexts.en);
  const aiModeExactTexts = new Set(SELECTORS.tier1.aiModeUi.exactTexts.en);
  const aiAttributionMarkers = new Set(SELECTORS.tier1.auxiliaryAi.aiAttributionMarkers.en);
  const overviewDirectSelectors = [
    ...SELECTORS.tier1.aiOverviews.directSelectors,
    ...SELECTORS.tier1.aiOverviews.localizedDirectSelectors.en
  ];
  const auxDirectSelectors = [
    ...SELECTORS.tier1.auxiliaryAi.directSelectors,
    ...SELECTORS.tier1.auxiliaryAi.localizedDirectSelectors.en
  ];
  if (lang === "es") {
    for (const text of SELECTORS.tier1.aiOverviews.headingTexts.es) {
      overviewHeadingTexts.add(text);
    }
    for (const text of SELECTORS.tier1.aiModeUi.exactTexts.es) {
      aiModeExactTexts.add(text);
    }
    for (const text of SELECTORS.tier1.auxiliaryAi.aiAttributionMarkers.es) {
      aiAttributionMarkers.add(text);
    }
    overviewDirectSelectors.push(...SELECTORS.tier1.aiOverviews.localizedDirectSelectors.es);
    auxDirectSelectors.push(...SELECTORS.tier1.auxiliaryAi.localizedDirectSelectors.es);
  }
  return {
    overviewHeadingTexts,
    aiModeExactTexts,
    aiAttributionMarkers,
    overviewDirectCombined: overviewDirectSelectors.join(", "),
    auxDirectCombined: auxDirectSelectors.join(", ")
  };
}

const LOCALE_SETS: Record<SupportedUiLanguage, ReturnType<typeof buildLocaleSets>> = {
  en: buildLocaleSets("en"),
  es: buildLocaleSets("es")
};

// Combined built-in selector lists so each sweep issues one querySelectorAll per group instead
// of looping per selector string (BP-09).
const OVERVIEW_HEADING_COMBINED = SELECTORS.tier1.aiOverviews.headingSelectors.join(", ");
const OVERVIEW_TIER2_COMBINED = SELECTORS.tier2.aiOverviews.join(", ");
const AI_MODE_DIRECT_COMBINED = SELECTORS.tier1.aiModeUi.directSelectors.join(", ");
const AI_MODE_TEXT_COMBINED = SELECTORS.tier1.aiModeUi.textCandidateSelectors.join(", ");
const AI_MODE_TIER2_COMBINED = SELECTORS.tier2.aiModeUi.join(", ");
const AUX_PAA_COMBINED = SELECTORS.tier1.auxiliaryAi.paaCardSelectors.join(", ");
const AUX_TIER2_COMBINED = SELECTORS.tier2.auxiliaryAi.join(", ");

/**
 * Collapse whitespace and lowercase text for exact label comparisons.
 * @param text - Raw text (may be null).
 * @returns Normalized text, or "". Pure; never throws.
 */
export function normalizeText(text: string | null | undefined): string {
  if (!text) {
    return "";
  }
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Element.matches() that returns false instead of throwing on an unsupported selector.
 * @param el - Element.
 * @param selector - CSS selector.
 * @returns Match result.
 */
export function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/**
 * querySelectorAll() that records ERR_SELECTOR_SYNTAX instead of throwing.
 * @param root - Document or element to search.
 * @param selector - CSS selector.
 * @param errors - Collector for diagnostics.
 * @returns Matches, or [] on a bad selector so other tiers keep working.
 */
export function safeQueryAll(root: ParentNode, selector: string, errors: PolicyError[]): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({
      code: "ERR_SELECTOR_SYNTAX",
      detail: `Selector "${selector}" failed: ${message}`
    });
    return [];
  }
}

const SAFE_DIAGNOSTIC_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

/**
 * Describe an element for diagnostics by tag and safe short structural id only (no text, no classes).
 * Long or punctuation-bearing IDs are omitted so dynamic SERP fragment IDs cannot enter diagnostics.
 * @param el - Element.
 * @returns e.g. "div#rso" or "div". Pure; never throws.
 */
export function describeElementSafe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  return el.id && SAFE_DIAGNOSTIC_ID_RE.test(el.id) ? `${tag}#${el.id}` : tag;
}

/**
 * Read the marker fragment that a DNR redirect appended.
 * @param hash - location.hash.
 * @returns "omnibox", "aimode" or null. Pure; never throws.
 */
export function parseRedirectHash(hash: string): "omnibox" | "aimode" | null {
  if (hash === "#rm_sg_omnibox") {
    return "omnibox";
  }
  if (hash === "#rm_sg_aimode") {
    return "aimode";
  }
  return null;
}

/**
 * Snapshot search inputs and protected landmarks once per sweep so isUnsafeToHide avoids
 * repeating document-wide queries for every candidate (BP-09).
 * @param doc - Page document.
 * @returns Cache object; fields are null on query error so callers fall back to live queries.
 */
export function createSafetyGuardCache(doc: Document): SafetyGuardCache {
  let searchInputs: Element[] | null = null;
  let protectedElements: Element[] | null = null;
  try {
    searchInputs = Array.from(doc.querySelectorAll(SELECTORS.safetyGuard.searchInputSelector));
  } catch {
    searchInputs = null;
  }
  try {
    protectedElements = Array.from(doc.querySelectorAll(PROTECTED_SELECTOR_COMBINED));
  } catch {
    protectedElements = null;
  }
  return { doc, searchInputs, protectedElements };
}

/**
 * Organic Results Safety Guard: refuse to hide core search UI or a block of organic results.
 * Protects landmark tags and IDs, the search box, and any element holding 3+ organic results;
 * AI Overview and AI Mode candidates are refused at 1 organic result (BP-08). Don't weaken this (AGENTS.md
 * hard rule).
 * @param el - Candidate element.
 * @param doc - Owning document (defaults to el.ownerDocument).
 * @param category - What the candidate would be hidden as; "overview" and "aimode" use the stricter threshold.
 * Omitted, the general threshold applies.
 * @param cache - Optional per-sweep snapshot from createSafetyGuardCache().
 * @returns true if the element must not be hidden. Query errors are ignored so the remaining checks still run.
 */
export function isUnsafeToHide(
  el: Element,
  doc?: Document | null,
  category?: HideCategory,
  cache?: SafetyGuardCache
): boolean {
  if (PROTECTED_TAG_SET.has(el.tagName.toUpperCase())) {
    return true;
  }
  const ownerDoc = doc ?? el.ownerDocument;
  // Use cached document-wide lists only when el lives in the same light DOM as cache.doc.
  const canUseCache = Boolean(
    cache &&
      el.isConnected &&
      ownerDoc === cache.doc &&
      (typeof el.getRootNode !== "function" || el.getRootNode() === cache.doc)
  );
  if (canUseCache && cache!.protectedElements !== null) {
    for (const protectedEl of cache!.protectedElements) {
      if (protectedEl === el || el.contains(protectedEl)) {
        return true;
      }
    }
  } else {
    for (const protectedSel of SELECTORS.safetyGuard.protectedSelectors) {
      if (safeMatches(el, protectedSel)) {
        return true;
      }
    }
    try {
      if (el.querySelector(PROTECTED_SELECTOR_COMBINED) !== null) {
        return true;
      }
    } catch {
    }
  }
  const searchInputSel = SELECTORS.safetyGuard.searchInputSelector;
  if (canUseCache && cache!.searchInputs !== null) {
    for (const searchInput of cache!.searchInputs) {
      if (searchInput === el || el.contains(searchInput)) {
        return true;
      }
    }
  } else {
    if (safeMatches(el, searchInputSel)) {
      return true;
    }
    try {
      if (el.querySelector(searchInputSel) !== null) {
        return true;
      }
    } catch {
    }
    if (ownerDoc) {
      const searchInput = ownerDoc.querySelector(searchInputSel);
      if (searchInput && el.contains(searchInput)) {
        return true;
      }
    }
  }
  try {
    const threshold = category === "overview" || category === "aimode" ? SELECTORS.safetyGuard.overviewOrganicResultThreshold : SELECTORS.safetyGuard.organicResultThreshold;
    if (threshold <= 1) {
      if (el.querySelector(SELECTORS.safetyGuard.organicResultSelector) !== null) {
        return true;
      }
    } else {
      const organicResults = el.querySelectorAll(SELECTORS.safetyGuard.organicResultSelector);
      if (organicResults.length >= threshold) {
        return true;
      }
    }
  } catch {
  }
  return false;
}

/**
 * Set or remove a root policy attribute only when its value actually changed, avoiding
 * redundant attribute MutationRecords when rootObserver monitors <html>.
 * @param root - Document root element.
 * @param attr - Attribute name.
 * @param enabled - Whether the attribute should equal "1".
 * @returns Nothing.
 */
function syncRootPolicyAttr(root: Element, attr: string, enabled: boolean): void {
  if (enabled) {
    if (root.getAttribute(attr) !== "1") {
      root.setAttribute(attr, "1");
    }
  } else if (root.hasAttribute(attr)) {
    root.removeAttribute(attr);
  }
}

/**
 * Set or remove the html[data-rmsg-hide-*] attributes that static-guard.css keys on.
 * @param doc - Page document.
 * @param policy - Effective policy; masterEnabled false removes all three.
 * @returns Nothing. No-op when there is no documentElement yet.
 */
export function applyPolicyAttributes(doc: Document, policy: Toggles): void {
  const root = doc.documentElement;
  if (!root) {
    return;
  }
  if (!policy.masterEnabled) {
    syncRootPolicyAttr(root, "data-rmsg-hide-overviews", false);
    syncRootPolicyAttr(root, "data-rmsg-hide-aimode", false);
    syncRootPolicyAttr(root, "data-rmsg-hide-aux", false);
    return;
  }
  syncRootPolicyAttr(root, "data-rmsg-hide-overviews", policy.hideAiOverviews);
  syncRootPolicyAttr(root, "data-rmsg-hide-aimode", policy.hideAiModeUi);
  syncRootPolicyAttr(root, "data-rmsg-hide-aux", policy.hideAuxiliaryAiFeatures);
}

/**
 * Isolated-world backup of original inline display styles for elements hidden by hideElement(),
 * preventing page-world attribute tampering from corrupting restored inline styles.
 */
const savedInlineDisplay = /* @__PURE__ */ new WeakMap<Element, { value: string; priority: string } | null>();

/**
 * Isolated-world ownership table for elements currently hidden by hideElement(), so un-hiding
 * restores every extension-hidden element even if page scripts altered data-rmsg-hidden.
 */
const ownedHiddenCategories = /* @__PURE__ */ new Map<Element, HideCategory>();

/**
 * Drop disconnected DOM nodes from ownership tracking so churning SERPs never retain detached elements.
 * @returns Nothing.
 */
function pruneDisconnectedOwnedElements(): void {
  for (const el of Array.from(ownedHiddenCategories.keys())) {
    if (!el.isConnected) {
      // Keep savedInlineDisplay until restoreElementVisibility: WeakMap will not leak detached
      // nodes, and preserving it prevents re-hiding a reinserted node from recording "none".
      ownedHiddenCategories.delete(el);
    }
  }
}

/**
 * Undo hideElement(): restore the saved inline display and remove marker attributes.
 * @param el - Previously hidden element.
 * @returns Nothing. Skips inline style restoration if style is absent on the element.
 */
export function restoreElementVisibility(el: Element): void {
  ownedHiddenCategories.delete(el);
  el.removeAttribute("data-rmsg-hidden");
  const htmlEl = el as HTMLElement;
  if (htmlEl.style) {
    if (savedInlineDisplay.has(el)) {
      const saved = savedInlineDisplay.get(el);
      savedInlineDisplay.delete(el);
      if (saved) {
        htmlEl.style.setProperty("display", saved.value, saved.priority);
      } else {
        htmlEl.style.removeProperty("display");
      }
    } else {
      const prevDisplay = el.getAttribute("data-rmsg-prev-display");
      const prevPriority = el.getAttribute("data-rmsg-prev-display-priority") ?? "";
      if (prevDisplay) {
        htmlEl.style.setProperty("display", prevDisplay, prevPriority);
      } else {
        htmlEl.style.removeProperty("display");
      }
    }
  } else {
    savedInlineDisplay.delete(el);
  }
  el.removeAttribute("data-rmsg-prev-display");
  el.removeAttribute("data-rmsg-prev-display-priority");
}

const ALL_HIDDEN_CATEGORIES_SELECTOR = '[data-rmsg-hidden="overview"], [data-rmsg-hidden="aimode"], [data-rmsg-hidden="aux"]';

/**
 * Active hide-marker filter derived from policy so inactive or spoofed data-rmsg-hidden
 * attributes never blind active category sweeps or leak detection.
 */
export interface ActiveHiddenFilter {
  categories: Set<string>;
  selector: string;
}

const ALL_ACTIVE_HIDDEN_FILTER: ActiveHiddenFilter = {
  categories: /* @__PURE__ */ new Set(["overview", "aimode", "aux"]),
  selector: ALL_HIDDEN_CATEGORIES_SELECTOR
};

/**
 * Build the active hide-marker filter for a policy.
 * @param policy - Optional policy toggles; omitted defaults to all three categories.
 * @returns Enabled category set and combined selector. Pure; never throws.
 */
export function getActiveHiddenFilter(policy?: Toggles): ActiveHiddenFilter {
  if (!policy) {
    return ALL_ACTIVE_HIDDEN_FILTER;
  }
  if (!policy.masterEnabled) {
    return { categories: /* @__PURE__ */ new Set(), selector: "" };
  }
  const categories = /* @__PURE__ */ new Set<string>();
  const parts: string[] = [];
  if (policy.hideAiOverviews) {
    categories.add("overview");
    parts.push('[data-rmsg-hidden="overview"]');
  }
  if (policy.hideAiModeUi) {
    categories.add("aimode");
    parts.push('[data-rmsg-hidden="aimode"]');
  }
  if (policy.hideAuxiliaryAiFeatures) {
    categories.add("aux");
    parts.push('[data-rmsg-hidden="aux"]');
  }
  return { categories, selector: parts.join(", ") };
}

/**
 * Restore every element this extension hid (used when masterEnabled turns off).
 * Restores all extension-owned elements tracked in ownedHiddenCategories even if their
 * data-rmsg-hidden marker was modified, then any remaining valid-category elements; unowned
 * elements with arbitrary marker values stay untouched.
 * @param doc - Page document.
 * @returns Nothing. No-op when no owned or valid-category elements exist.
 */
export function unhideAllElements(doc: Document): void {
  const restored = /* @__PURE__ */ new Set<Element>();
  for (const el of Array.from(ownedHiddenCategories.keys())) {
    if (!el.ownerDocument || el.ownerDocument === doc) {
      restored.add(el);
      restoreElementVisibility(el);
    }
  }
  const hiddenElements = doc.querySelectorAll(ALL_HIDDEN_CATEGORIES_SELECTOR);
  for (const el of hiddenElements) {
    if (!restored.has(el)) {
      restoreElementVisibility(el);
    }
  }
}

/**
 * Restore elements hidden under one category after that toggle turns off.
 * @param doc - Page document.
 * @param category - "overview" | "aimode" | "aux".
 * @returns Nothing. No-op when no owned or marked elements exist under that category.
 */
export function unhideCategoryElements(doc: Document, category: HideCategory): void {
  const restored = /* @__PURE__ */ new Set<Element>();
  for (const [el, ownedCategory] of Array.from(ownedHiddenCategories.entries())) {
    if (ownedCategory === category && (!el.ownerDocument || el.ownerDocument === doc)) {
      restored.add(el);
      restoreElementVisibility(el);
    }
  }
  const hiddenElements = doc.querySelectorAll(`[data-rmsg-hidden="${category}"]`);
  for (const el of hiddenElements) {
    if (!restored.has(el)) {
      restoreElementVisibility(el);
    }
  }
}

/**
 * Hide an element with an important inline display:none, saving its previous inline display.
 * @param el - Vetted candidate.
 * @param category - Category recorded in data-rmsg-hidden.
 * @returns Nothing. Always sets data-rmsg-hidden; skips inline style if style is absent.
 */
export function hideElement(el: Element, category: HideCategory): void {
  ownedHiddenCategories.set(el, category);
  el.setAttribute("data-rmsg-hidden", category);
  const htmlEl = el as HTMLElement;
  if (htmlEl.style) {
    if (!savedInlineDisplay.has(el)) {
      const prevDisplay = htmlEl.style.getPropertyValue("display");
      const prevPriority = htmlEl.style.getPropertyPriority("display");
      savedInlineDisplay.set(el, prevDisplay ? { value: prevDisplay, priority: prevPriority } : null);
      // Save every original inline value, "none" included (BP-18): if Google had the element
      // hidden inline, un-hiding must put that back rather than reveal it.
      if (prevDisplay) {
        el.setAttribute("data-rmsg-prev-display", prevDisplay);
        if (prevPriority) {
          el.setAttribute("data-rmsg-prev-display-priority", prevPriority);
        }
      }
    }
    htmlEl.style.setProperty("display", "none", "important");
  }
}

/**
 * Check whether an element or an ancestor is already hidden under an active category.
 * @param el - Element.
 * @param activeHidden - Active category filter (defaults to all three valid categories).
 * @returns true if hidden under an enabled category. Pure DOM check; never throws.
 */
export function isAlreadyHidden(el: Element, activeHidden: ActiveHiddenFilter = ALL_ACTIVE_HIDDEN_FILTER): boolean {
  const cat = el.getAttribute("data-rmsg-hidden");
  if (cat !== null && activeHidden.categories.has(cat)) {
    return true;
  }
  if (!activeHidden.selector) {
    return false;
  }
  return Boolean(el.parentElement?.closest(activeHidden.selector));
}

/**
 * Keep only outermost elements from a candidate list in a single pre-order pass (BP-09).
 * Replaces the O(n^2) all-pairs containment check with an O(n log n) document-order sort:
 * in pre-order, any ancestor precedes all of its descendants before the next sibling subtree.
 * @param candidates - Vetted safe candidates.
 * @returns Top-level candidates with nested descendants removed. Pure; never throws.
 */
export function filterTopLevelCandidates(candidates: Element[]): Element[] {
  if (candidates.length <= 1) {
    return [...candidates];
  }
  const sorted = [...candidates].sort((a, b) => {
    if (a === b) {
      return 0;
    }
    const pos = a.compareDocumentPosition(b);
    // Bit 4 (DOCUMENT_POSITION_FOLLOWING) includes descendants, so ancestors sort before descendants.
    if ((pos & 4) !== 0) {
      return -1;
    }
    // Bit 2 (DOCUMENT_POSITION_PRECEDING) includes ancestors.
    if ((pos & 2) !== 0) {
      return 1;
    }
    return 0;
  });
  const topLevel: Element[] = [];
  let lastKept: Element | null = null;
  for (const candidate of sorted) {
    if (lastKept && (lastKept === candidate || lastKept.contains(candidate))) {
      continue;
    }
    topLevel.push(candidate);
    lastKept = candidate;
  }
  return topLevel;
}

/**
 * Re-check elements already hidden under one category and restore any that now violate the
 * Organic Results Safety Guard (e.g., an empty wrapper that received organic results later).
 * Runs before candidate collection so restored wrappers release safe inner AI elements to be
 * collected and hidden individually in the same sweep.
 * @param category - Category name.
 * @param doc - Page document.
 * @param errors - Collector; ERR_SAFETY_GUARD_TRIPPED is added once per un-hidden element.
 * @param reportedUnsafe - Elements already reported this sweep.
 * @param guardCache - Optional per-sweep safety-guard cache.
 * @returns Nothing. Fails safe: query errors inside isUnsafeToHide() are caught so remaining
 * safety checks still run; DOM query/restore errors on doc propagate.
 */
export function restoreUnsafeHiddenElements(
  category: HideCategory,
  doc: Document,
  errors: PolicyError[],
  reportedUnsafe: Set<Element>,
  guardCache?: SafetyGuardCache
): void {
  for (const hidden of doc.querySelectorAll(`[data-rmsg-hidden="${category}"]`)) {
    if (isUnsafeToHide(hidden, doc, category, guardCache)) {
      restoreElementVisibility(hidden);
      if (!reportedUnsafe.has(hidden)) {
        reportedUnsafe.add(hidden);
        errors.push({
          code: "ERR_SAFETY_GUARD_TRIPPED",
          detail: `Un-hid ${describeElementSafe(hidden)} (${category}): it now holds protected content`
        });
      }
    }
  }
}

/**
 * Vet, dedupe and hide one category's candidates, keeping only outermost safe ones.
 * Callers (sweepDom) run restoreUnsafeHiddenElements() first so stale unsafe wrappers are
 * un-hidden before candidates are collected.
 * @param candidates - Raw candidates.
 * @param category - Category name.
 * @param doc - Page document.
 * @param errors - Collector; ERR_SAFETY_GUARD_TRIPPED is added once per refused element.
 * @param reportedUnsafe - Elements already reported this sweep.
 * @param guardCache - Optional per-sweep safety-guard cache.
 * @returns Number of elements newly hidden. Fails closed against over-hiding: unsafe candidates
 * stay visible and are logged once; query errors inside isUnsafeToHide() are caught per check.
 */
export function processCategoryCandidates(
  candidates: Element[],
  category: HideCategory,
  doc: Document,
  errors: PolicyError[],
  reportedUnsafe: Set<Element>,
  guardCache?: SafetyGuardCache,
  activeHidden: ActiveHiddenFilter = ALL_ACTIVE_HIDDEN_FILTER
): number {
  const uniqueCandidates = Array.from(new Set(candidates));
  const safeCandidates: Element[] = [];
  for (const candidate of uniqueCandidates) {
    if (isAlreadyHidden(candidate, activeHidden)) {
      continue;
    }
    if (isUnsafeToHide(candidate, doc, category, guardCache)) {
      if (!reportedUnsafe.has(candidate)) {
        reportedUnsafe.add(candidate);
        errors.push({
          code: "ERR_SAFETY_GUARD_TRIPPED",
          detail: `Refused to hide protected element ${describeElementSafe(candidate)} (${category})`
        });
      }
      continue;
    }
    safeCandidates.push(candidate);
  }
  const topLevelCandidates = filterTopLevelCandidates(safeCandidates);
  let newlyHiddenCount = 0;
  for (const el of topLevelCandidates) {
    if (isAlreadyHidden(el, activeHidden)) {
      continue;
    }
    hideElement(el, category);
    newlyHiddenCount += 1;
  }
  return newlyHiddenCount;
}

/**
 * Walk up from an "AI Overview" heading to its card container.
 * @param headingEl - Matched heading.
 * @param doc - Page document.
 * @param guardCache - Optional per-sweep safety-guard cache.
 * @returns The nearest container-ancestor match within maxAncestorDepth levels, else the parent
 * if safe, else the heading. Stops at the first ancestor the overview guard refuses (BP-08), so
 * the walk never climbs into a wrapper that holds real results.
 */
export function findOverviewHeadingContainer(
  headingEl: Element,
  doc: Document,
  guardCache?: SafetyGuardCache
): Element {
  let cursor = headingEl.parentElement;
  let depth = 0;
  while (cursor && depth < SELECTORS.safetyGuard.maxAncestorDepth) {
    depth += 1;
    if (safeMatches(cursor, CONTAINER_ANCESTOR_COMBINED)) {
      return cursor;
    }
    if (isUnsafeToHide(cursor, doc, "overview", guardCache)) {
      if (cursor === headingEl.parentElement) {
        return cursor;
      }
      break;
    }
    cursor = cursor.parentElement;
  }
  if (headingEl.parentElement && !isUnsafeToHide(headingEl.parentElement, doc, "overview", guardCache)) {
    return headingEl.parentElement;
  }
  return headingEl;
}

/**
 * Run admin-pushed extraHideSelectors one selector at a time so one malformed selector logs
 * ERR_SELECTOR_SYNTAX via safeQueryAll() without breaking valid selectors in the same array (BP-04).
 * @param doc - Page document.
 * @param selectors - Optional managed selector array for one category.
 * @param errors - Collector for syntax errors.
 * @returns Matched elements not already hidden by this extension. Bad selectors are recorded in
 * errors and skipped without aborting remaining selectors.
 */
export function collectExtraSelectorCandidates(
  doc: Document,
  selectors: readonly string[] | undefined,
  errors: PolicyError[],
  activeHidden: ActiveHiddenFilter = ALL_ACTIVE_HIDDEN_FILTER
): Element[] {
  if (!selectors || selectors.length === 0) {
    return [];
  }
  const candidates: Element[] = [];
  for (const selector of selectors) {
    if (typeof selector !== "string") {
      continue;
    }
    const trimmed = trimCssWhitespace(selector);
    if (!trimmed) {
      continue;
    }
    for (const el of safeQueryAll(doc, trimmed, errors)) {
      if (!isAlreadyHidden(el, activeHidden)) {
        candidates.push(el);
      }
    }
  }
  return candidates;
}

/**
 * Collect AI Overview candidates from Tier 1 selectors, heading text, Tier 2 selectors and extras.
 * @param doc - Page document.
 * @param errors - Collector for selector errors.
 * @param guardCache - Optional per-sweep safety-guard cache.
 * @param lang - Resolved UI language ("en" | "es").
 * @param extraSelectors - Optional managed hotfix selectors for overview.
 * @param activeHidden - Active category hide-marker filter.
 * @returns Candidate elements (unvetted). Selector syntax errors are captured in errors so remaining tiers continue.
 */
export function collectAiOverviewCandidates(
  doc: Document,
  errors: PolicyError[],
  guardCache?: SafetyGuardCache,
  lang: SupportedUiLanguage = "en",
  extraSelectors?: readonly string[],
  activeHidden: ActiveHiddenFilter = ALL_ACTIVE_HIDDEN_FILTER
): Element[] {
  const candidates: Element[] = [];
  const localeSet = LOCALE_SETS[lang];
  if (localeSet.overviewDirectCombined) {
    for (const el of safeQueryAll(doc, localeSet.overviewDirectCombined, errors)) {
      if (!isAlreadyHidden(el, activeHidden)) {
        candidates.push(el);
      }
    }
  }
  if (OVERVIEW_HEADING_COMBINED) {
    for (const headingEl of safeQueryAll(doc, OVERVIEW_HEADING_COMBINED, errors)) {
      if (isAlreadyHidden(headingEl, activeHidden)) {
        continue;
      }
      if (localeSet.overviewHeadingTexts.has(normalizeText(headingEl.textContent))) {
        candidates.push(findOverviewHeadingContainer(headingEl, doc, guardCache));
      }
    }
  }
  if (OVERVIEW_TIER2_COMBINED) {
    for (const el of safeQueryAll(doc, OVERVIEW_TIER2_COMBINED, errors)) {
      if (!isAlreadyHidden(el, activeHidden)) {
        candidates.push(el);
      }
    }
  }
  if (extraSelectors && extraSelectors.length > 0) {
    candidates.push(...collectExtraSelectorCandidates(doc, extraSelectors, errors, activeHidden));
  }
  return candidates;
}

/**
 * Widen an AI Mode match to its nav tab slot or interactive ancestor when that is safe.
 * @param el - Matched element.
 * @param doc - Page document.
 * @param guardCache - Optional per-sweep safety-guard cache.
 * @returns Element to hide; falls back to el if widening would fail isUnsafeToHide().
 */
export function promoteAiModeTarget(
  el: Element,
  doc: Document,
  guardCache?: SafetyGuardCache
): Element {
  const navItem = el.closest(SELECTORS.tier1.aiModeUi.navItemAncestor);
  if (navItem && !isUnsafeToHide(navItem, doc, "aimode", guardCache)) {
    return navItem;
  }
  if (el.tagName.toUpperCase() === "SPAN") {
    const interactiveAncestor = el.closest('a, button, [role="tab"], [role="button"]');
    if (interactiveAncestor && !isUnsafeToHide(interactiveAncestor, doc, "aimode", guardCache)) {
      return interactiveAncestor;
    }
  }
  return el;
}

/**
 * Collect AI Mode buttons, tabs and prompts from links, exact label text, Tier 2 selectors and extras.
 * @param doc - Page document.
 * @param errors - Collector for selector errors.
 * @param guardCache - Optional per-sweep safety-guard cache.
 * @param lang - Resolved UI language ("en" | "es").
 * @param extraSelectors - Optional managed hotfix selectors for aimode.
 * @param activeHidden - Active category hide-marker filter.
 * @returns Candidate elements (unvetted). Selector syntax errors are captured in errors so remaining tiers continue.
 */
export function collectAiModeUiCandidates(
  doc: Document,
  errors: PolicyError[],
  guardCache?: SafetyGuardCache,
  lang: SupportedUiLanguage = "en",
  extraSelectors?: readonly string[],
  activeHidden: ActiveHiddenFilter = ALL_ACTIVE_HIDDEN_FILTER
): Element[] {
  const candidates: Element[] = [];
  const localeSet = LOCALE_SETS[lang];
  if (AI_MODE_DIRECT_COMBINED) {
    for (const el of safeQueryAll(doc, AI_MODE_DIRECT_COMBINED, errors)) {
      if (!isAlreadyHidden(el, activeHidden)) {
        candidates.push(promoteAiModeTarget(el, doc, guardCache));
      }
    }
  }
  if (AI_MODE_TEXT_COMBINED) {
    for (const el of safeQueryAll(doc, AI_MODE_TEXT_COMBINED, errors)) {
      if (isAlreadyHidden(el, activeHidden)) {
        continue;
      }
      if (localeSet.aiModeExactTexts.has(normalizeText(el.textContent))) {
        candidates.push(promoteAiModeTarget(el, doc, guardCache));
      }
    }
  }
  // BP-09 Option D: scan anchors outside nav listitems by short trimmed text before normalizing.
  const anchors = typeof doc.getElementsByTagName === "function"
    ? doc.getElementsByTagName("a")
    : safeQueryAll(doc, "a", errors);
  for (const anchor of anchors) {
    if (isAlreadyHidden(anchor, activeHidden)) {
      continue;
    }
    const rawText = anchor.textContent;
    if (!rawText) {
      continue;
    }
    const trimmed = rawText.trim();
    if (trimmed.length === 0 || trimmed.length > SELECTORS.tier1.aiModeUi.maxAnchorTextLength) {
      continue;
    }
    if (localeSet.aiModeExactTexts.has(normalizeText(trimmed))) {
      candidates.push(promoteAiModeTarget(anchor, doc, guardCache));
    }
  }
  if (AI_MODE_TIER2_COMBINED) {
    for (const el of safeQueryAll(doc, AI_MODE_TIER2_COMBINED, errors)) {
      if (!isAlreadyHidden(el, activeHidden)) {
        candidates.push(el);
      }
    }
  }
  if (extraSelectors && extraSelectors.length > 0) {
    candidates.push(...collectExtraSelectorCandidates(doc, extraSelectors, errors, activeHidden));
  }
  return candidates;
}

/**
 * Check whether a People Also Ask card is labelled as AI-generated.
 * @param card - Card element.
 * @param lang - Resolved UI language ("en" | "es").
 * @returns true if an aria-label or leaf text exactly matches an attribution marker. Pure DOM check; never throws.
 */
export function hasAiAttributionBadge(card: Element, lang: SupportedUiLanguage = "en"): boolean {
  const markers = LOCALE_SETS[lang].aiAttributionMarkers;
  const ariaLabel = normalizeText(card.getAttribute("aria-label"));
  if (ariaLabel && markers.has(ariaLabel)) {
    return true;
  }
  const labelNodes = card.querySelectorAll('span, div, p, [role="heading"], h3, h4');
  for (const node of labelNodes) {
    const nodeAria = normalizeText(node.getAttribute("aria-label"));
    if (nodeAria && markers.has(nodeAria)) {
      return true;
    }
    if (node.children.length === 0) {
      const rawText = node.textContent;
      // Short badge text only; avoids whitespace normalization on long PAA answer paragraphs.
      if (!rawText || rawText.trim().length > 60) {
        continue;
      }
      const text = normalizeText(rawText);
      if (markers.has(text)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Collect auxiliary AI candidates: Search Labs, Lens, follow-up prompts, AI PAA cards and extras.
 * @param doc - Page document.
 * @param errors - Collector for selector errors.
 * @param lang - Resolved UI language ("en" | "es").
 * @param extraSelectors - Optional managed hotfix selectors for aux.
 * @returns Candidate elements (unvetted). Selector syntax errors are captured in errors so remaining tiers continue.
 */
export function collectAuxAiCandidates(
  doc: Document,
  errors: PolicyError[],
  lang: SupportedUiLanguage = "en",
  extraSelectors?: readonly string[],
  activeHidden: ActiveHiddenFilter = ALL_ACTIVE_HIDDEN_FILTER
): Element[] {
  const candidates: Element[] = [];
  const localeSet = LOCALE_SETS[lang];
  if (localeSet.auxDirectCombined) {
    for (const el of safeQueryAll(doc, localeSet.auxDirectCombined, errors)) {
      if (!isAlreadyHidden(el, activeHidden)) {
        candidates.push(el);
      }
    }
  }
  if (AUX_PAA_COMBINED) {
    for (const card of safeQueryAll(doc, AUX_PAA_COMBINED, errors)) {
      if (!isAlreadyHidden(card, activeHidden) && hasAiAttributionBadge(card, lang)) {
        candidates.push(card);
      }
    }
  }
  if (AUX_TIER2_COMBINED) {
    for (const el of safeQueryAll(doc, AUX_TIER2_COMBINED, errors)) {
      if (!isAlreadyHidden(el, activeHidden)) {
        candidates.push(el);
      }
    }
  }
  if (extraSelectors && extraSelectors.length > 0) {
    candidates.push(...collectExtraSelectorCandidates(doc, extraSelectors, errors, activeHidden));
  }
  return candidates;
}

/**
 * Check whether an element is still visible to the user (not hidden by this extension or CSS).
 * Uses Element.checkVisibility() (Chrome 105+, below the 134 floor) with a safe fallback for
 * minimal DOM test stubs.
 * @param el - Candidate element.
 * @param activeHidden - Active category hide-marker filter.
 * @returns true if connected and visibly rendered. Fails open to style/offsetParent fallback checks if checkVisibility() throws.
 */
export function isElementVisible(el: Element, activeHidden: ActiveHiddenFilter = ALL_ACTIVE_HIDDEN_FILTER): boolean {
  if (!el.isConnected || isAlreadyHidden(el, activeHidden)) {
    return false;
  }
  const maybeCheck = el as Element & {
    checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean;
  };
  if (typeof maybeCheck.checkVisibility === "function") {
    try {
      return maybeCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } catch {
    }
  }
  const htmlEl = el as HTMLElement & { offsetParent?: Element | null };
  if (htmlEl.style?.getPropertyValue?.("display") === "none") {
    return false;
  }
  if ("offsetParent" in htmlEl && htmlEl.offsetParent === null && htmlEl.tagName !== "BODY") {
    return false;
  }
  return true;
}

/**
 * Leak detector (BP-04): after hiding finishes, scan headings, tabs and buttons for known AI
 * labels that are still visible so silent selector rot becomes visible in IT Diagnostics.
 * Skips already-hidden nodes and checks text before checkVisibility() to avoid layout flushes
 * on clean pages (BP-09). Never puts page text into error details (category name only).
 * @param doc - Page document.
 * @param policy - Effective policy toggles.
 * @param lang - Resolved UI language ("en" | "es").
 * @param errors - Collector for WARN_AI_SURFACE_VISIBLE.
 * @param activeHidden - Active category hide-marker filter.
 * @returns Nothing. Selector errors are captured in errors; fails safe on hidden/stub nodes.
 */
export function detectVisibleAiSurfaceLeaks(
  doc: Document,
  policy: Toggles,
  lang: SupportedUiLanguage,
  errors: PolicyError[],
  activeHidden: ActiveHiddenFilter = getActiveHiddenFilter(policy)
): void {
  if (!policy.masterEnabled || (!policy.hideAiOverviews && !policy.hideAiModeUi)) {
    return;
  }
  const localeSet = LOCALE_SETS[lang];
  let flaggedOverview = false;
  let flaggedAiMode = false;
  for (const el of safeQueryAll(doc, SELECTORS.leakDetector.candidateSelector, errors)) {
    if (isAlreadyHidden(el, activeHidden)) {
      continue;
    }
    const rawText = el.textContent;
    if (!rawText) {
      continue;
    }
    const trimmed = rawText.trim();
    if (!trimmed || trimmed.length > SELECTORS.leakDetector.maxLabelTextLength) {
      continue;
    }
    const normalized = normalizeText(trimmed);
    if (
      policy.hideAiOverviews &&
      !flaggedOverview &&
      localeSet.overviewHeadingTexts.has(normalized) &&
      isElementVisible(el, activeHidden)
    ) {
      flaggedOverview = true;
      errors.push({ code: "WARN_AI_SURFACE_VISIBLE", detail: "overview" });
    }
    if (
      policy.hideAiModeUi &&
      !flaggedAiMode &&
      localeSet.aiModeExactTexts.has(normalized) &&
      isElementVisible(el, activeHidden)
    ) {
      flaggedAiMode = true;
      errors.push({ code: "WARN_AI_SURFACE_VISIBLE", detail: "aimode" });
    }
    if ((!policy.hideAiOverviews || flaggedOverview) && (!policy.hideAiModeUi || flaggedAiMode)) {
      break;
    }
  }
}

/**
 * Run one full hiding sweep for the active policy.
 * @param doc - Page document.
 * @param policy - Effective policy (plus optional managed extraHideSelectors).
 * @param seenPages - Page-key sets used to count each hidden category once per page (BP-14).
 * @param pageKey - Opaque page key; defaults to location.href (kept local, never sent).
 * @returns { deltas, errors } for the caller to report (empty when masterEnabled is false).
 */
export function sweepDom(
  doc: Document,
  policy: SweepPolicy,
  seenPages: SeenCategoryPages,
  pageKey?: string
): { deltas: Record<string, number>; errors: PolicyError[] } {
  const deltas: Record<string, number> = {};
  const errors: PolicyError[] = [];
  if (!policy.masterEnabled) {
    return { deltas, errors };
  }
  pruneDisconnectedOwnedElements();
  const uiLang = resolveUiLanguage(doc.documentElement?.lang);
  if (!uiLang.supported) {
    errors.push({
      code: "WARN_UNSUPPORTED_UI_LANGUAGE",
      detail: uiLang.normalizedTag
    });
  }
  const resolvedPageKey = pageKey ?? (doc.location && doc.location.href ? doc.location.href : "default");
  const reportedUnsafe = /* @__PURE__ */ new Set<Element>();
  const guardCache = createSafetyGuardCache(doc);
  const activeHidden = getActiveHiddenFilter(policy);
  // Restore unsafe hidden wrappers before any collector runs so safe inner AI controls are
  // not skipped by isAlreadyHidden() and can be hidden in the same sweep (PR #6 review).
  if (policy.hideAiOverviews) {
    restoreUnsafeHiddenElements("overview", doc, errors, reportedUnsafe, guardCache);
  }
  if (policy.hideAiModeUi) {
    restoreUnsafeHiddenElements("aimode", doc, errors, reportedUnsafe, guardCache);
  }
  if (policy.hideAuxiliaryAiFeatures) {
    restoreUnsafeHiddenElements("aux", doc, errors, reportedUnsafe, guardCache);
  }
  if (policy.hideAiOverviews) {
    const overviewCandidates = collectAiOverviewCandidates(
      doc,
      errors,
      guardCache,
      uiLang.language,
      policy.extraHideSelectors?.overview,
      activeHidden
    );
    const hiddenOverviews = processCategoryCandidates(
      overviewCandidates,
      "overview",
      doc,
      errors,
      reportedUnsafe,
      guardCache,
      activeHidden
    );
    if (hiddenOverviews > 0 && !seenPages.overview.has(resolvedPageKey)) {
      seenPages.overview.add(resolvedPageKey);
      deltas.overviewsHidden = 1;
    }
  }
  if (policy.hideAiModeUi) {
    const aiModeCandidates = collectAiModeUiCandidates(
      doc,
      errors,
      guardCache,
      uiLang.language,
      policy.extraHideSelectors?.aimode,
      activeHidden
    );
    const hiddenAiMode = processCategoryCandidates(
      aiModeCandidates,
      "aimode",
      doc,
      errors,
      reportedUnsafe,
      guardCache,
      activeHidden
    );
    if (hiddenAiMode > 0 && !seenPages.aimode.has(resolvedPageKey)) {
      seenPages.aimode.add(resolvedPageKey);
      deltas.aiModeUiHidden = 1;
    }
  }
  if (policy.hideAuxiliaryAiFeatures) {
    const auxCandidates = collectAuxAiCandidates(
      doc,
      errors,
      uiLang.language,
      policy.extraHideSelectors?.aux,
      activeHidden
    );
    const hiddenAux = processCategoryCandidates(
      auxCandidates,
      "aux",
      doc,
      errors,
      reportedUnsafe,
      guardCache,
      activeHidden
    );
    if (hiddenAux > 0 && !seenPages.aux.has(resolvedPageKey)) {
      seenPages.aux.add(resolvedPageKey);
      deltas.auxAiHidden = 1;
    }
  }
  detectVisibleAiSurfaceLeaks(doc, policy, uiLang.language, errors, activeHidden);
  return { deltas, errors };
}
