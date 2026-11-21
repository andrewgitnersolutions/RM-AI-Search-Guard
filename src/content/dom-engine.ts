/**
 * DOM matching and hiding engine: collects AI Overview, AI Mode and auxiliary AI candidates
 * and hides them, guarded by the Organic Results Safety Guard (isUnsafeToHide).
 * Runs in: content script on google.com (isolated world).
 * Must never: read or report page text beyond fixed label comparisons, or hide core search UI.
 * Don't weaken isUnsafeToHide (AGENTS.md hard rule).
 * Shared with: shared/selectors.ts, content/content.ts.
 */

import { SELECTORS } from "../shared/selectors";
import type { PolicyError, Toggles } from "../shared/types";

/** Which policy toggle an element was hidden under (stored in data-rmsg-hidden). */
export type HideCategory = "overview" | "aimode" | "aux";

export const PROTECTED_TAG_SET = new Set(SELECTORS.safetyGuard.protectedTags);

export const PROTECTED_SELECTOR_COMBINED = SELECTORS.safetyGuard.protectedSelectors.join(", ");

export const CONTAINER_ANCESTOR_COMBINED = SELECTORS.tier1.aiOverviews.containerAncestors.join(", ");

export const OVERVIEW_HEADING_TEXT_SET = new Set(SELECTORS.tier1.aiOverviews.headingTexts);

export const AI_MODE_EXACT_TEXT_SET = new Set(SELECTORS.tier1.aiModeUi.exactTexts);

export const AI_ATTRIBUTION_MARKER_SET = new Set(SELECTORS.tier1.auxiliaryAi.aiAttributionMarkers);

/**
 * Collapse whitespace and lowercase text for exact label comparisons.
 * @param text - Raw text (may be null).
 * @returns Normalized text, or "".
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

/**
 * Describe an element for diagnostics by tag and id only (no text, no classes).
 * @param el - Element.
 * @returns e.g. "div#rso".
 */
export function describeElementSafe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  return el.id ? `${tag}#${el.id}` : tag;
}

/**
 * Read the marker fragment that a DNR redirect appended.
 * @param hash - location.hash.
 * @returns "omnibox", "aimode" or null.
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
 * Organic Results Safety Guard: refuse to hide core search UI or a block of organic results.
 * Protects landmark tags and IDs, the search box, and any element holding 3+ organic results;
 * AI Overview candidates are refused at 1 organic result (BP-08). Don't weaken this (AGENTS.md
 * hard rule).
 * @param el - Candidate element.
 * @param doc - Owning document (defaults to el.ownerDocument).
 * @param category - What the candidate would be hidden as; "overview" uses the stricter threshold.
 * Omitted, the general threshold applies.
 * @returns true if the element must not be hidden. Query errors are ignored so the remaining checks still run.
 */
export function isUnsafeToHide(el: Element, doc?: Document | null, category?: HideCategory): boolean {
  if (PROTECTED_TAG_SET.has(el.tagName.toUpperCase())) {
    return true;
  }
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
  const searchInputSel = SELECTORS.safetyGuard.searchInputSelector;
  if (safeMatches(el, searchInputSel)) {
    return true;
  }
  try {
    if (el.querySelector(searchInputSel) !== null) {
      return true;
    }
  } catch {
  }
  const ownerDoc = doc ?? el.ownerDocument;
  if (ownerDoc) {
    const searchInput = ownerDoc.querySelector(searchInputSel);
    if (searchInput && el.contains(searchInput)) {
      return true;
    }
  }
  try {
    const organicResults = el.querySelectorAll(SELECTORS.safetyGuard.organicResultSelector);
    const threshold = category === "overview" ? SELECTORS.safetyGuard.overviewOrganicResultThreshold : SELECTORS.safetyGuard.organicResultThreshold;
    if (organicResults.length >= threshold) {
      return true;
    }
  } catch {
  }
  return false;
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
    root.removeAttribute("data-rmsg-hide-overviews");
    root.removeAttribute("data-rmsg-hide-aimode");
    root.removeAttribute("data-rmsg-hide-aux");
    return;
  }
  if (policy.hideAiOverviews) {
    root.setAttribute("data-rmsg-hide-overviews", "1");
  } else {
    root.removeAttribute("data-rmsg-hide-overviews");
  }
  if (policy.hideAiModeUi) {
    root.setAttribute("data-rmsg-hide-aimode", "1");
  } else {
    root.removeAttribute("data-rmsg-hide-aimode");
  }
  if (policy.hideAuxiliaryAiFeatures) {
    root.setAttribute("data-rmsg-hide-aux", "1");
  } else {
    root.removeAttribute("data-rmsg-hide-aux");
  }
}

/**
 * Undo hideElement(): restore the saved inline display and remove marker attributes.
 * @param el - Previously hidden element.
 */
export function restoreElementVisibility(el: Element): void {
  el.removeAttribute("data-rmsg-hidden");
  const htmlEl = el as HTMLElement;
  if (htmlEl.style) {
    const prevDisplay = el.getAttribute("data-rmsg-prev-display");
    const prevPriority = el.getAttribute("data-rmsg-prev-display-priority") ?? "";
    if (prevDisplay) {
      htmlEl.style.setProperty("display", prevDisplay, prevPriority);
    } else {
      htmlEl.style.removeProperty("display");
    }
  }
  el.removeAttribute("data-rmsg-prev-display");
  el.removeAttribute("data-rmsg-prev-display-priority");
}

/**
 * Restore every element this extension hid (used when masterEnabled turns off).
 * @param doc - Page document.
 */
export function unhideAllElements(doc: Document): void {
  const hiddenElements = doc.querySelectorAll("[data-rmsg-hidden]");
  for (const el of hiddenElements) {
    restoreElementVisibility(el);
  }
}

/**
 * Restore elements hidden under one category after that toggle turns off.
 * @param doc - Page document.
 * @param category - "overview" | "aimode" | "aux".
 */
export function unhideCategoryElements(doc: Document, category: HideCategory): void {
  const hiddenElements = doc.querySelectorAll(`[data-rmsg-hidden="${category}"]`);
  for (const el of hiddenElements) {
    restoreElementVisibility(el);
  }
}

/**
 * Hide an element with an important inline display:none, saving its previous inline display.
 * @param el - Vetted candidate.
 * @param category - Category recorded in data-rmsg-hidden.
 */
export function hideElement(el: Element, category: HideCategory): void {
  el.setAttribute("data-rmsg-hidden", category);
  const htmlEl = el as HTMLElement;
  if (htmlEl.style) {
    const prevDisplay = htmlEl.style.getPropertyValue("display");
    const prevPriority = htmlEl.style.getPropertyPriority("display");
    // Save every original inline value, "none" included (BP-18): if Google had the element
    // hidden inline, un-hiding must put that back rather than reveal it.
    if (prevDisplay) {
      el.setAttribute("data-rmsg-prev-display", prevDisplay);
      if (prevPriority) {
        el.setAttribute("data-rmsg-prev-display-priority", prevPriority);
      }
    }
    htmlEl.style.setProperty("display", "none", "important");
  }
}

/**
 * Check whether an element or an ancestor is already hidden by this extension.
 * @param el - Element.
 * @returns true if hidden.
 */
export function isAlreadyHidden(el: Element): boolean {
  if (el.hasAttribute("data-rmsg-hidden")) {
    return true;
  }
  return Boolean(el.parentElement?.closest("[data-rmsg-hidden]"));
}

/**
 * Vet, dedupe and hide one category's candidates, keeping only outermost safe ones.
 * @param candidates - Raw candidates.
 * @param category - Category name.
 * @param doc - Page document.
 * @param errors - Collector; ERR_SAFETY_GUARD_TRIPPED is added once per refused element.
 * @param reportedUnsafe - Elements already reported this sweep.
 * @returns Number of elements newly hidden.
 */
export function processCategoryCandidates(
  candidates: Element[],
  category: HideCategory,
  doc: Document,
  errors: PolicyError[],
  reportedUnsafe: Set<Element>
): number {
  const uniqueCandidates = Array.from(new Set(candidates));
  const safeCandidates: Element[] = [];
  for (const candidate of uniqueCandidates) {
    if (isAlreadyHidden(candidate)) {
      continue;
    }
    if (isUnsafeToHide(candidate, doc, category)) {
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
  const topLevelCandidates = safeCandidates.filter(
    (candidate) => !safeCandidates.some((other) => other !== candidate && other.contains(candidate))
  );
  let newlyHiddenCount = 0;
  for (const el of topLevelCandidates) {
    if (isAlreadyHidden(el)) {
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
 * @returns The nearest container-ancestor match within maxAncestorDepth levels, else the parent
 * if safe, else the heading. Stops at the first ancestor the overview guard refuses (BP-08), so
 * the walk never climbs into a wrapper that holds real results.
 */
export function findOverviewHeadingContainer(headingEl: Element, doc: Document): Element {
  let cursor = headingEl.parentElement;
  let depth = 0;
  while (cursor && depth < SELECTORS.safetyGuard.maxAncestorDepth) {
    depth += 1;
    if (safeMatches(cursor, CONTAINER_ANCESTOR_COMBINED)) {
      return cursor;
    }
    if (isUnsafeToHide(cursor, doc, "overview")) {
      if (cursor === headingEl.parentElement) {
        return cursor;
      }
      break;
    }
    cursor = cursor.parentElement;
  }
  if (headingEl.parentElement && !isUnsafeToHide(headingEl.parentElement, doc, "overview")) {
    return headingEl.parentElement;
  }
  return headingEl;
}

/**
 * Collect AI Overview candidates from Tier 1 selectors, heading text and Tier 2 selectors.
 * @param doc - Page document.
 * @param errors - Collector for selector errors.
 * @returns Candidate elements (unvetted).
 */
export function collectAiOverviewCandidates(doc: Document, errors: PolicyError[]): Element[] {
  const candidates: Element[] = [];
  for (const selector of SELECTORS.tier1.aiOverviews.directSelectors) {
    candidates.push(...safeQueryAll(doc, selector, errors));
  }
  const headingSelector = SELECTORS.tier1.aiOverviews.headingSelectors.join(", ");
  for (const headingEl of safeQueryAll(doc, headingSelector, errors)) {
    if (OVERVIEW_HEADING_TEXT_SET.has(normalizeText(headingEl.textContent))) {
      candidates.push(findOverviewHeadingContainer(headingEl, doc));
    }
  }
  for (const selector of SELECTORS.tier2.aiOverviews) {
    candidates.push(...safeQueryAll(doc, selector, errors));
  }
  return candidates;
}

/**
 * Widen an AI Mode match to its nav tab slot or interactive ancestor when that is safe.
 * @param el - Matched element.
 * @param doc - Page document.
 * @returns Element to hide.
 */
export function promoteAiModeTarget(el: Element, doc: Document): Element {
  const navItem = el.closest(SELECTORS.tier1.aiModeUi.navItemAncestor);
  if (navItem && !isUnsafeToHide(navItem, doc, "aimode")) {
    return navItem;
  }
  if (el.tagName.toUpperCase() === "SPAN") {
    const interactiveAncestor = el.closest('a, button, [role="tab"], [role="button"]');
    if (interactiveAncestor && !isUnsafeToHide(interactiveAncestor, doc, "aimode")) {
      return interactiveAncestor;
    }
  }
  return el;
}

/**
 * Collect AI Mode buttons, tabs and prompts from links, exact label text and Tier 2 selectors.
 * @param doc - Page document.
 * @param errors - Collector for selector errors.
 * @returns Candidate elements (unvetted).
 */
export function collectAiModeUiCandidates(doc: Document, errors: PolicyError[]): Element[] {
  const candidates: Element[] = [];
  // The bare google.com host variants now live in the registry (BP-08).
  const directSelectors = SELECTORS.tier1.aiModeUi.directSelectors;
  for (const selector of directSelectors) {
    for (const el of safeQueryAll(doc, selector, errors)) {
      candidates.push(promoteAiModeTarget(el, doc));
    }
  }
  const textSelector = [
    ...SELECTORS.tier1.aiModeUi.textCandidateSelectors,
    // Extra text-candidate selector not in the registry; kept as shipped.
    '[role="button"]'
  ].join(", ");
  for (const el of safeQueryAll(doc, textSelector, errors)) {
    if (AI_MODE_EXACT_TEXT_SET.has(normalizeText(el.textContent))) {
      candidates.push(promoteAiModeTarget(el, doc));
    }
  }
  for (const selector of SELECTORS.tier2.aiModeUi) {
    candidates.push(...safeQueryAll(doc, selector, errors));
  }
  return candidates;
}

/**
 * Check whether a People Also Ask card is labelled as AI-generated.
 * @param card - Card element.
 * @returns true if an aria-label or leaf text exactly matches an attribution marker.
 */
export function hasAiAttributionBadge(card: Element): boolean {
  const ariaLabel = normalizeText(card.getAttribute("aria-label"));
  if (ariaLabel && AI_ATTRIBUTION_MARKER_SET.has(ariaLabel)) {
    return true;
  }
  const labelNodes = card.querySelectorAll('span, div, p, [role="heading"], h3, h4');
  for (const node of labelNodes) {
    const nodeAria = normalizeText(node.getAttribute("aria-label"));
    if (nodeAria && AI_ATTRIBUTION_MARKER_SET.has(nodeAria)) {
      return true;
    }
    if (node.children.length === 0) {
      const text = normalizeText(node.textContent);
      if (AI_ATTRIBUTION_MARKER_SET.has(text)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Collect auxiliary AI candidates: Search Labs, Lens, follow-up prompts and AI-labelled PAA cards.
 * @param doc - Page document.
 * @param errors - Collector for selector errors.
 * @returns Candidate elements (unvetted).
 */
export function collectAuxAiCandidates(doc: Document, errors: PolicyError[]): Element[] {
  const candidates: Element[] = [];
  for (const selector of SELECTORS.tier1.auxiliaryAi.directSelectors) {
    candidates.push(...safeQueryAll(doc, selector, errors));
  }
  for (const selector of SELECTORS.tier1.auxiliaryAi.paaCardSelectors) {
    for (const card of safeQueryAll(doc, selector, errors)) {
      if (hasAiAttributionBadge(card)) {
        candidates.push(card);
      }
    }
  }
  for (const selector of SELECTORS.tier2.auxiliaryAi) {
    candidates.push(...safeQueryAll(doc, selector, errors));
  }
  return candidates;
}

/**
 * Run one full hiding sweep for the active policy.
 * @param doc - Page document.
 * @param policy - Effective policy.
 * @param seenOverviewUrls - Page keys already counted for overviewsHidden (count once per page).
 * @param pageKey - Opaque page key; defaults to location.href (kept local, never sent).
 * @returns { deltas, errors } for the caller to report.
 */
export function sweepDom(
  doc: Document,
  policy: Toggles,
  seenOverviewUrls: Set<string>,
  pageKey?: string
): { deltas: Record<string, number>; errors: PolicyError[] } {
  const deltas: Record<string, number> = {};
  const errors: PolicyError[] = [];
  if (!policy.masterEnabled) {
    return { deltas, errors };
  }
  const resolvedPageKey = pageKey ?? (doc.location && doc.location.href ? doc.location.href : "default");
  const reportedUnsafe = /* @__PURE__ */ new Set<Element>();
  if (policy.hideAiOverviews) {
    const overviewCandidates = collectAiOverviewCandidates(doc, errors);
    const hiddenOverviews = processCategoryCandidates(
      overviewCandidates,
      "overview",
      doc,
      errors,
      reportedUnsafe
    );
    if (hiddenOverviews > 0 && !seenOverviewUrls.has(resolvedPageKey)) {
      seenOverviewUrls.add(resolvedPageKey);
      deltas.overviewsHidden = 1;
    }
  }
  if (policy.hideAiModeUi) {
    const aiModeCandidates = collectAiModeUiCandidates(doc, errors);
    const hiddenAiMode = processCategoryCandidates(
      aiModeCandidates,
      "aimode",
      doc,
      errors,
      reportedUnsafe
    );
    if (hiddenAiMode > 0) {
      deltas.aiModeUiHidden = hiddenAiMode;
    }
  }
  if (policy.hideAuxiliaryAiFeatures) {
    const auxCandidates = collectAuxAiCandidates(doc, errors);
    const hiddenAux = processCategoryCandidates(
      auxCandidates,
      "aux",
      doc,
      errors,
      reportedUnsafe
    );
    if (hiddenAux > 0) {
      deltas.auxAiHidden = hiddenAux;
    }
  }
  return { deltas, errors };
}
