"use strict";
(() => {
  // src/shared/ai-mode-url.ts
  var AI_MODE_SESSION_PARAMS = ["aep", "arv", "mstk", "csuir"];
  function applyAiModeQueryTransform(params, forceWebOnlySearch) {
    for (const key of AI_MODE_SESSION_PARAMS) {
      params.delete(key);
    }
    if (forceWebOnlySearch) {
      params.set("udm", "14");
    } else {
      params.delete("udm");
    }
  }
  function cleanAiModeUrl(href, policy) {
    if (!policy.masterEnabled || !policy.blockAiModeNavigation) {
      return null;
    }
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.hostname !== "www.google.com" && url.hostname !== "google.com") {
      return null;
    }
    url.hash = "";
    const params = url.searchParams;
    const path = url.pathname.toLowerCase();
    if (path === "/search" && params.getAll("udm").includes("50")) {
      const fromOmnibox = params.has("aep") || params.getAll("sourceid").some((v) => v.toLowerCase().startsWith("chrome"));
      applyAiModeQueryTransform(params, policy.forceWebOnlySearch);
      url.hash = fromOmnibox ? "#rm_sg_omnibox" : "#rm_sg_aimode";
      return url.href;
    }
    if (/^\/(ai|aimode)(\/|$)/.test(path)) {
      if (params.getAll("q").some((q) => q !== "")) {
        url.pathname = "/search";
        applyAiModeQueryTransform(params, policy.forceWebOnlySearch);
        url.hash = "#rm_sg_aimode";
        return url.href;
      }
      return "https://www.google.com/#rm_sg_aimode";
    }
    return null;
  }

  // src/shared/defaults.ts
  var STRICT_LOCKDOWN_TOGGLES = {
    masterEnabled: true,
    hideAiOverviews: true,
    hideAiModeUi: true,
    blockAiModeNavigation: true,
    forceWebOnlySearch: true,
    hideAuxiliaryAiFeatures: true
  };
  var VALID_GRADE_BANDS = [
    "K-2",
    "3-5",
    "6-8",
    "9-12",
    "Staff",
    "Unassigned"
  ];
  var FEATURE_TOGGLE_KEYS = [
    "masterEnabled",
    "hideAiOverviews",
    "hideAiModeUi",
    "blockAiModeNavigation",
    "forceWebOnlySearch",
    "hideAuxiliaryAiFeatures"
  ];
  var STORAGE_KEYS = {
    LOCAL_OVERRIDES: "rmsg_local_overrides",
    TELEMETRY: "rmsg_telemetry",
    LAST_POLICY: "rmsg_last_policy",
    METRICS_RESET_EPOCH: "rmsg_metrics_reset_epoch"
  };

  // src/shared/policy.ts
  function isValidGradeBand(value) {
    return typeof value === "string" && VALID_GRADE_BANDS.includes(value);
  }
  function isUnlockableInstall(installType) {
    return installType === "normal" || installType === "development";
  }
  function parsePolicy(managedRaw, localRaw, now = /* @__PURE__ */ new Date(), installType) {
    const evaluatedAt = now.toISOString();
    const errors = [];
    const hasManagedKeys = managedRaw !== null && managedRaw !== void 0 && typeof managedRaw === "object" && !Array.isArray(managedRaw) && Object.keys(managedRaw).length > 0;
    if (!hasManagedKeys) {
      errors.push({
        code: "WARN_NO_MANAGED_POLICY",
        detail: "chrome.storage.managed returned no policy keys"
      });
      const toggles2 = { ...STRICT_LOCKDOWN_TOGGLES };
      if (!isUnlockableInstall(installType)) {
        const policy3 = {
          ...toggles2,
          gradeBand: "Unassigned",
          source: "admin-no-policy",
          isManaged: true,
          invalidFields: [],
          evaluatedAt
        };
        return { policy: policy3, errors };
      }
      let gradeBand2 = "Unassigned";
      let appliedLocalOverride = false;
      if (localRaw !== null && localRaw !== void 0 && typeof localRaw === "object") {
        for (const key of FEATURE_TOGGLE_KEYS) {
          if (typeof localRaw[key] === "boolean") {
            toggles2[key] = localRaw[key];
            appliedLocalOverride = true;
          }
        }
        if (isValidGradeBand(localRaw.gradeBand)) {
          gradeBand2 = localRaw.gradeBand;
          appliedLocalOverride = true;
        }
      }
      const policy2 = {
        ...toggles2,
        gradeBand: gradeBand2,
        source: appliedLocalOverride ? "local-unmanaged" : "defaults",
        isManaged: false,
        invalidFields: [],
        evaluatedAt
      };
      return { policy: policy2, errors };
    }
    const invalidFields = [];
    const toggles = { ...STRICT_LOCKDOWN_TOGGLES };
    for (const key of FEATURE_TOGGLE_KEYS) {
      if (key in managedRaw && managedRaw[key] !== void 0) {
        const rawValue = managedRaw[key];
        if (typeof rawValue === "boolean") {
          toggles[key] = rawValue;
        } else {
          invalidFields.push(key);
          toggles[key] = STRICT_LOCKDOWN_TOGGLES[key];
        }
      }
    }
    let gradeBand = "Unassigned";
    if ("gradeBand" in managedRaw && managedRaw.gradeBand !== void 0) {
      if (isValidGradeBand(managedRaw.gradeBand)) {
        gradeBand = managedRaw.gradeBand;
      } else {
        invalidFields.push("gradeBand");
        gradeBand = "Unassigned";
      }
    }
    if (invalidFields.length > 0) {
      errors.push({
        code: "ERR_POLICY_INVALID",
        detail: invalidFields.join(", ")
      });
    }
    const policy = {
      ...toggles,
      gradeBand,
      source: invalidFields.length > 0 ? "managed-degraded" : "managed",
      isManaged: true,
      invalidFields,
      evaluatedAt
    };
    return { policy, errors };
  }

  // src/shared/storage.ts
  var storageQueueTail = Promise.resolve();
  function formatErrorMessage(err) {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
  async function readManagedPolicyRaw() {
    if (typeof chrome === "undefined" || !chrome.storage?.managed) {
      return { data: {} };
    }
    try {
      const result = await chrome.storage.managed.get(null);
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        return { data: {} };
      }
      return { data: result };
    } catch (err) {
      return { data: {}, error: formatErrorMessage(err) };
    }
  }
  async function readLocalOverrides() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return { data: null };
    }
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.LOCAL_OVERRIDES);
      const raw = result?.[STORAGE_KEYS.LOCAL_OVERRIDES];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { data: null };
      }
      return { data: raw };
    } catch (err) {
      return { data: null, error: formatErrorMessage(err) };
    }
  }
  async function readMetricsResetEpoch() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return 0;
    }
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.METRICS_RESET_EPOCH);
      const raw = result?.[STORAGE_KEYS.METRICS_RESET_EPOCH];
      if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
        return raw;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  // src/shared/selectors.ts
  var SELECTORS = {
    safetyGuard: {
      protectedTags: ["HTML", "BODY", "HEAD", "MAIN"],
      protectedSelectors: [
        "#main",
        "#cnt",
        "#rcnt",
        "#center_col",
        "#search",
        "#rso",
        "#botstuff",
        "#top_nav",
        'form[role="search"]',
        "#searchform"
      ],
      organicResultSelector: "a > h3, h3.LC20lb",
      // Refuse to hide anything holding this many organic results. AI Overview candidates are held
      // to 1 (BP-08): an Overview card never legitimately contains a real result, so a candidate
      // that does is a wrapper and hiding it would remove real results.
      organicResultThreshold: 3,
      overviewOrganicResultThreshold: 1,
      // How far findOverviewHeadingContainer may walk up from an "AI Overview" heading (BP-08).
      maxAncestorDepth: 8,
      searchInputSelector: 'textarea[name="q"], input[name="q"]'
    },
    // FRAGILE(google-dom, last verified NONE, see test L-07): Tier 1 attributes, label text (English only, BP-03) and /aimode, udm=50 hrefs.
    tier1: {
      aiOverviews: {
        directSelectors: [
          '[data-attrid="AIOverview"]',
          '[data-async-type="aiOverview"]',
          '[aria-label="AI Overview"]'
        ],
        headingSelectors: ["h1", "h2", '[role="heading"]', "div.Fzsovc"],
        headingTexts: ["ai overview"],
        // No [data-hveid] (BP-08): Google puts it on most result blocks, so the nearest one can
        // be a wrapper that also holds organic results.
        containerAncestors: [
          "[data-mcpr]",
          "[data-attrid]",
          "[data-async-type]",
          "div#eKIzJc"
        ]
      },
      aiModeUi: {
        // Google destinations only (BP-08): relative links or the two google.com hosts. A link to
        // another site whose URL merely contains "udm=50" or "/aimode" is an organic result.
        // Keep in sync with static-guard.css.
        directSelectors: [
          // A query-only relative link (href="?q=x&udm=50") resolves to /search on a results page.
          'a[href^="?"][href*="udm=50"]',
          'a[href^="/search"][href*="udm=50"]',
          'a[href^="https://www.google.com/search"][href*="udm=50"]',
          'a[href^="https://google.com/search"][href*="udm=50"]',
          'a[href^="/aimode"]',
          'a[href^="https://www.google.com/aimode"]',
          'a[href^="https://google.com/aimode"]',
          'a[href="/ai"]',
          'a[href^="/ai?"]',
          'a[href^="/ai/"]',
          'a[href="https://www.google.com/ai"]',
          'a[href^="https://www.google.com/ai?"]',
          'a[href^="https://www.google.com/ai/"]',
          'a[href="https://google.com/ai"]',
          'a[href^="https://google.com/ai?"]',
          'a[href^="https://google.com/ai/"]'
        ],
        textCandidateSelectors: [
          '[role="tab"]',
          '[role="listitem"] a',
          '[role="listitem"] span',
          "button",
          '[role="button"]'
        ],
        // BP-09 Option D: anchors outside nav listitems are checked separately and skipped when
        // trimmed text exceeds 40 chars, avoiding regex normalization on long organic-result links.
        maxAnchorTextLength: 40,
        exactTexts: ["ai mode", "dive deeper in ai mode", "ask ai mode"],
        navItemAncestor: '[role="listitem"]'
      },
      auxiliaryAi: {
        directSelectors: [
          'a[href*="labs.google.com"]',
          '[aria-label*="Search Labs" i]',
          '[aria-label*="Search by image" i]',
          "[data-base-lens-url]",
          '[aria-label*="Ask a follow up" i]',
          '[placeholder*="Ask a follow up" i]'
        ],
        paaCardSelectors: [
          '[jsname="yEVEwb"]',
          '[data-sgrd="true"]',
          "[data-q]",
          "div.related-question-pair"
        ],
        aiAttributionMarkers: ["ai overview", "generative ai", "ai-generated"]
      }
    },
    // FRAGILE(google-dom, last verified NONE, see test L-07): Tier 2 generated class names and jsname values (BP-04).
    tier2: {
      aiOverviews: ["#eKIzJc", "div.YzCcne[data-mcpr]", 'div[data-mcp="18"]'],
      aiModeUi: ["div.olrp5b", "button.plR5qb", 'button[jsname="B6rgad"]'],
      auxiliaryAi: ['div[jsname="R5mgy"]']
    }
  };

  // src/content/dom-engine.ts
  var PROTECTED_TAG_SET = new Set(SELECTORS.safetyGuard.protectedTags);
  var PROTECTED_SELECTOR_COMBINED = SELECTORS.safetyGuard.protectedSelectors.join(", ");
  var CONTAINER_ANCESTOR_COMBINED = SELECTORS.tier1.aiOverviews.containerAncestors.join(", ");
  var OVERVIEW_HEADING_TEXT_SET = new Set(SELECTORS.tier1.aiOverviews.headingTexts);
  var AI_MODE_EXACT_TEXT_SET = new Set(SELECTORS.tier1.aiModeUi.exactTexts);
  var AI_ATTRIBUTION_MARKER_SET = new Set(SELECTORS.tier1.auxiliaryAi.aiAttributionMarkers);
  var OVERVIEW_DIRECT_COMBINED = SELECTORS.tier1.aiOverviews.directSelectors.join(", ");
  var OVERVIEW_HEADING_COMBINED = SELECTORS.tier1.aiOverviews.headingSelectors.join(", ");
  var OVERVIEW_TIER2_COMBINED = SELECTORS.tier2.aiOverviews.join(", ");
  var AI_MODE_DIRECT_COMBINED = SELECTORS.tier1.aiModeUi.directSelectors.join(", ");
  var AI_MODE_TEXT_COMBINED = SELECTORS.tier1.aiModeUi.textCandidateSelectors.join(", ");
  var AI_MODE_TIER2_COMBINED = SELECTORS.tier2.aiModeUi.join(", ");
  var AUX_DIRECT_COMBINED = SELECTORS.tier1.auxiliaryAi.directSelectors.join(", ");
  var AUX_PAA_COMBINED = SELECTORS.tier1.auxiliaryAi.paaCardSelectors.join(", ");
  var AUX_TIER2_COMBINED = SELECTORS.tier2.auxiliaryAi.join(", ");
  function normalizeText(text) {
    if (!text) {
      return "";
    }
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }
  function safeMatches(el, selector) {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }
  function safeQueryAll(root, selector, errors) {
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
  function describeElementSafe(el) {
    const tag = el.tagName.toLowerCase();
    return el.id ? `${tag}#${el.id}` : tag;
  }
  function parseRedirectHash(hash) {
    if (hash === "#rm_sg_omnibox") {
      return "omnibox";
    }
    if (hash === "#rm_sg_aimode") {
      return "aimode";
    }
    return null;
  }
  function createSafetyGuardCache(doc) {
    let searchInputs = null;
    let protectedElements = null;
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
  function isUnsafeToHide(el, doc, category, cache) {
    if (PROTECTED_TAG_SET.has(el.tagName.toUpperCase())) {
      return true;
    }
    const ownerDoc = doc ?? el.ownerDocument;
    const canUseCache = Boolean(
      cache && el.isConnected && ownerDoc === cache.doc && (typeof el.getRootNode !== "function" || el.getRootNode() === cache.doc)
    );
    if (canUseCache && cache.protectedElements !== null) {
      for (const protectedEl of cache.protectedElements) {
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
    if (canUseCache && cache.searchInputs !== null) {
      for (const searchInput of cache.searchInputs) {
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
      const threshold = category === "overview" ? SELECTORS.safetyGuard.overviewOrganicResultThreshold : SELECTORS.safetyGuard.organicResultThreshold;
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
  function applyPolicyAttributes(doc, policy) {
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
  function restoreElementVisibility(el) {
    el.removeAttribute("data-rmsg-hidden");
    const htmlEl = el;
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
  function unhideAllElements(doc) {
    const hiddenElements = doc.querySelectorAll("[data-rmsg-hidden]");
    for (const el of hiddenElements) {
      restoreElementVisibility(el);
    }
  }
  function unhideCategoryElements(doc, category) {
    const hiddenElements = doc.querySelectorAll(`[data-rmsg-hidden="${category}"]`);
    for (const el of hiddenElements) {
      restoreElementVisibility(el);
    }
  }
  function hideElement(el, category) {
    el.setAttribute("data-rmsg-hidden", category);
    const htmlEl = el;
    if (htmlEl.style) {
      const prevDisplay = htmlEl.style.getPropertyValue("display");
      const prevPriority = htmlEl.style.getPropertyPriority("display");
      if (prevDisplay) {
        el.setAttribute("data-rmsg-prev-display", prevDisplay);
        if (prevPriority) {
          el.setAttribute("data-rmsg-prev-display-priority", prevPriority);
        }
      }
      htmlEl.style.setProperty("display", "none", "important");
    }
  }
  function isAlreadyHidden(el) {
    if (el.hasAttribute("data-rmsg-hidden")) {
      return true;
    }
    return Boolean(el.parentElement?.closest("[data-rmsg-hidden]"));
  }
  function filterTopLevelCandidates(candidates) {
    if (candidates.length <= 1) {
      return [...candidates];
    }
    const sorted = [...candidates].sort((a, b) => {
      if (a === b) {
        return 0;
      }
      const pos = a.compareDocumentPosition(b);
      if ((pos & 4) !== 0) {
        return -1;
      }
      if ((pos & 2) !== 0) {
        return 1;
      }
      return 0;
    });
    const topLevel = [];
    let lastKept = null;
    for (const candidate of sorted) {
      if (lastKept && (lastKept === candidate || lastKept.contains(candidate))) {
        continue;
      }
      topLevel.push(candidate);
      lastKept = candidate;
    }
    return topLevel;
  }
  function restoreUnsafeHiddenElements(category, doc, errors, reportedUnsafe, guardCache) {
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
  function processCategoryCandidates(candidates, category, doc, errors, reportedUnsafe, guardCache) {
    const uniqueCandidates = Array.from(new Set(candidates));
    const safeCandidates = [];
    for (const candidate of uniqueCandidates) {
      if (isAlreadyHidden(candidate)) {
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
      if (isAlreadyHidden(el)) {
        continue;
      }
      hideElement(el, category);
      newlyHiddenCount += 1;
    }
    return newlyHiddenCount;
  }
  function findOverviewHeadingContainer(headingEl, doc, guardCache) {
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
  function collectAiOverviewCandidates(doc, errors, guardCache) {
    const candidates = [];
    if (OVERVIEW_DIRECT_COMBINED) {
      for (const el of safeQueryAll(doc, OVERVIEW_DIRECT_COMBINED, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(el);
        }
      }
    }
    if (OVERVIEW_HEADING_COMBINED) {
      for (const headingEl of safeQueryAll(doc, OVERVIEW_HEADING_COMBINED, errors)) {
        if (isAlreadyHidden(headingEl)) {
          continue;
        }
        if (OVERVIEW_HEADING_TEXT_SET.has(normalizeText(headingEl.textContent))) {
          candidates.push(findOverviewHeadingContainer(headingEl, doc, guardCache));
        }
      }
    }
    if (OVERVIEW_TIER2_COMBINED) {
      for (const el of safeQueryAll(doc, OVERVIEW_TIER2_COMBINED, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(el);
        }
      }
    }
    return candidates;
  }
  function promoteAiModeTarget(el, doc, guardCache) {
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
  function collectAiModeUiCandidates(doc, errors, guardCache) {
    const candidates = [];
    if (AI_MODE_DIRECT_COMBINED) {
      for (const el of safeQueryAll(doc, AI_MODE_DIRECT_COMBINED, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(promoteAiModeTarget(el, doc, guardCache));
        }
      }
    }
    if (AI_MODE_TEXT_COMBINED) {
      for (const el of safeQueryAll(doc, AI_MODE_TEXT_COMBINED, errors)) {
        if (isAlreadyHidden(el)) {
          continue;
        }
        if (AI_MODE_EXACT_TEXT_SET.has(normalizeText(el.textContent))) {
          candidates.push(promoteAiModeTarget(el, doc, guardCache));
        }
      }
    }
    const anchors = typeof doc.getElementsByTagName === "function" ? doc.getElementsByTagName("a") : safeQueryAll(doc, "a", errors);
    for (const anchor of anchors) {
      if (isAlreadyHidden(anchor)) {
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
      if (AI_MODE_EXACT_TEXT_SET.has(normalizeText(trimmed))) {
        candidates.push(promoteAiModeTarget(anchor, doc, guardCache));
      }
    }
    if (AI_MODE_TIER2_COMBINED) {
      for (const el of safeQueryAll(doc, AI_MODE_TIER2_COMBINED, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(el);
        }
      }
    }
    return candidates;
  }
  function hasAiAttributionBadge(card) {
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
        const rawText = node.textContent;
        if (!rawText || rawText.trim().length > 60) {
          continue;
        }
        const text = normalizeText(rawText);
        if (AI_ATTRIBUTION_MARKER_SET.has(text)) {
          return true;
        }
      }
    }
    return false;
  }
  function collectAuxAiCandidates(doc, errors) {
    const candidates = [];
    if (AUX_DIRECT_COMBINED) {
      for (const el of safeQueryAll(doc, AUX_DIRECT_COMBINED, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(el);
        }
      }
    }
    if (AUX_PAA_COMBINED) {
      for (const card of safeQueryAll(doc, AUX_PAA_COMBINED, errors)) {
        if (!isAlreadyHidden(card) && hasAiAttributionBadge(card)) {
          candidates.push(card);
        }
      }
    }
    if (AUX_TIER2_COMBINED) {
      for (const el of safeQueryAll(doc, AUX_TIER2_COMBINED, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(el);
        }
      }
    }
    return candidates;
  }
  function sweepDom(doc, policy, seenPages, pageKey) {
    const deltas = {};
    const errors = [];
    if (!policy.masterEnabled) {
      return { deltas, errors };
    }
    const resolvedPageKey = pageKey ?? (doc.location && doc.location.href ? doc.location.href : "default");
    const reportedUnsafe = /* @__PURE__ */ new Set();
    const guardCache = createSafetyGuardCache(doc);
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
      const overviewCandidates = collectAiOverviewCandidates(doc, errors, guardCache);
      const hiddenOverviews = processCategoryCandidates(
        overviewCandidates,
        "overview",
        doc,
        errors,
        reportedUnsafe,
        guardCache
      );
      if (hiddenOverviews > 0 && !seenPages.overview.has(resolvedPageKey)) {
        seenPages.overview.add(resolvedPageKey);
        deltas.overviewsHidden = 1;
      }
    }
    if (policy.hideAiModeUi) {
      const aiModeCandidates = collectAiModeUiCandidates(doc, errors, guardCache);
      const hiddenAiMode = processCategoryCandidates(
        aiModeCandidates,
        "aimode",
        doc,
        errors,
        reportedUnsafe,
        guardCache
      );
      if (hiddenAiMode > 0 && !seenPages.aimode.has(resolvedPageKey)) {
        seenPages.aimode.add(resolvedPageKey);
        deltas.aiModeUiHidden = 1;
      }
    }
    if (policy.hideAuxiliaryAiFeatures) {
      const auxCandidates = collectAuxAiCandidates(doc, errors);
      const hiddenAux = processCategoryCandidates(
        auxCandidates,
        "aux",
        doc,
        errors,
        reportedUnsafe,
        guardCache
      );
      if (hiddenAux > 0 && !seenPages.aux.has(resolvedPageKey)) {
        seenPages.aux.add(resolvedPageKey);
        deltas.auxAiHidden = 1;
      }
    }
    return { deltas, errors };
  }

  // src/content/content.ts
  function applyFailClosedAttributes() {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    root.setAttribute("data-rmsg-hide-overviews", "1");
    root.setAttribute("data-rmsg-hide-aimode", "1");
    root.setAttribute("data-rmsg-hide-aux", "1");
  }
  applyFailClosedAttributes();
  async function sendRuntimeMessage(message) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }
  function computeOpaquePageKey() {
    const input = `${window.location.pathname}${window.location.search}`;
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `p-${(hash >>> 0).toString(16)}`;
  }
  function handleRedirectHashTelemetry() {
    const redirectSource = parseRedirectHash(window.location.hash);
    if (redirectSource === null) {
      return;
    }
    try {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    } catch {
    }
    void sendRuntimeMessage({ type: "RECORD_REDIRECT", source: redirectSource });
  }
  handleRedirectHashTelemetry();
  var SWEEP_THROTTLE_MS = 150;
  var METRICS_FLUSH_INTERVAL_MS = 1e4;
  var currentPolicy = null;
  var bodyObserver = null;
  var rootObserver = null;
  var pendingRaf = false;
  var pendingRafId = null;
  var sweepTimer = null;
  var lastSweepAt = -Infinity;
  var seenOverviewPages = /* @__PURE__ */ new Set();
  var seenAiModePages = /* @__PURE__ */ new Set();
  var seenAuxPages = /* @__PURE__ */ new Set();
  var seenCategoryPages = {
    overview: seenOverviewPages,
    aimode: seenAiModePages,
    aux: seenAuxPages
  };
  var reportedErrorKeys = /* @__PURE__ */ new Set();
  var pendingMetricDeltas = {};
  var metricsFlushTimer = null;
  var currentResetEpoch = null;
  var liveResetSeen = false;
  async function initMetricsResetEpoch() {
    const epoch = await readMetricsResetEpoch();
    if (!liveResetSeen && currentResetEpoch === null) {
      currentResetEpoch = epoch;
    }
  }
  function clearPendingMetrics() {
    if (metricsFlushTimer !== null) {
      if (typeof window.clearTimeout === "function") {
        window.clearTimeout(metricsFlushTimer);
      }
      metricsFlushTimer = null;
    }
    pendingMetricDeltas = {};
  }
  function cancelScheduledSweep() {
    if (sweepTimer !== null) {
      if (typeof window.clearTimeout === "function") {
        window.clearTimeout(sweepTimer);
      }
      sweepTimer = null;
    }
    if (pendingRafId !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(pendingRafId);
    }
    pendingRafId = null;
    pendingRaf = false;
  }
  function queueSweepFrame() {
    pendingRaf = true;
    const id = window.requestAnimationFrame(() => {
      pendingRaf = false;
      pendingRafId = null;
      runSweepNow();
    });
    pendingRafId = typeof id === "number" ? id : null;
  }
  function queueMetricDeltas(deltas) {
    let added = false;
    for (const [key, rawValue] of Object.entries(deltas)) {
      if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
        const value = Math.floor(rawValue);
        if (value > 0) {
          pendingMetricDeltas[key] = (pendingMetricDeltas[key] ?? 0) + value;
          added = true;
        }
      }
    }
    if (added && metricsFlushTimer === null && typeof window.setTimeout === "function") {
      metricsFlushTimer = window.setTimeout(() => {
        metricsFlushTimer = null;
        flushPendingMetrics();
      }, METRICS_FLUSH_INTERVAL_MS);
    }
  }
  function flushPendingMetrics() {
    if (metricsFlushTimer !== null) {
      if (typeof window.clearTimeout === "function") {
        window.clearTimeout(metricsFlushTimer);
      }
      metricsFlushTimer = null;
    }
    if (Object.keys(pendingMetricDeltas).length === 0) {
      return;
    }
    const deltas = pendingMetricDeltas;
    pendingMetricDeltas = {};
    const msg = { type: "INCREMENT_METRICS", deltas };
    if (currentResetEpoch !== null) {
      msg.resetEpoch = currentResetEpoch;
    }
    void sendRuntimeMessage(msg);
  }
  function disconnectObservers() {
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
    if (rootObserver) {
      rootObserver.disconnect();
      rootObserver = null;
    }
    cancelScheduledSweep();
  }
  var aiModeRedirectStarted = false;
  function checkAiModeUrl() {
    if (aiModeRedirectStarted || !currentPolicy) {
      return false;
    }
    const clean = cleanAiModeUrl(window.location.href, currentPolicy);
    if (clean === null) {
      return false;
    }
    aiModeRedirectStarted = true;
    flushPendingMetrics();
    window.location.replace(clean);
    return true;
  }
  function runSweepNow() {
    if (!currentPolicy || !currentPolicy.masterEnabled) {
      return;
    }
    cancelScheduledSweep();
    lastSweepAt = Date.now();
    if (checkAiModeUrl()) {
      return;
    }
    const pageKey = computeOpaquePageKey();
    const { deltas, errors } = sweepDom(document, currentPolicy, seenCategoryPages, pageKey);
    if (Object.keys(deltas).length > 0) {
      queueMetricDeltas(deltas);
    }
    for (const err of errors) {
      const dedupeKey = `${pageKey}:${err.code}:${err.detail}`;
      if (!reportedErrorKeys.has(dedupeKey)) {
        reportedErrorKeys.add(dedupeKey);
        void sendRuntimeMessage({
          type: "LOG_DIAGNOSTIC",
          code: err.code,
          detail: err.detail
        });
      }
    }
  }
  function scheduleSweep(immediate = false) {
    if (!currentPolicy || !currentPolicy.masterEnabled) {
      return;
    }
    if (immediate) {
      if (sweepTimer !== null) {
        if (typeof window.clearTimeout === "function") {
          window.clearTimeout(sweepTimer);
        }
        sweepTimer = null;
      }
      if (!pendingRaf) {
        queueSweepFrame();
      }
      return;
    }
    if (pendingRaf || sweepTimer !== null) {
      return;
    }
    const elapsed = Date.now() - lastSweepAt;
    if (elapsed >= SWEEP_THROTTLE_MS || typeof window.setTimeout !== "function") {
      queueSweepFrame();
      return;
    }
    sweepTimer = window.setTimeout(() => {
      sweepTimer = null;
      if (!pendingRaf && currentPolicy?.masterEnabled) {
        queueSweepFrame();
      }
    }, SWEEP_THROTTLE_MS - elapsed);
  }
  function attachMutationObserver() {
    if (!currentPolicy || !currentPolicy.masterEnabled) {
      return;
    }
    if (document.body) {
      if (rootObserver) {
        rootObserver.disconnect();
        rootObserver = null;
      }
      if (!bodyObserver) {
        bodyObserver = new MutationObserver(() => {
          scheduleSweep();
        });
        bodyObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
      return;
    }
    if (!rootObserver && document.documentElement) {
      rootObserver = new MutationObserver(() => {
        if (document.body) {
          attachMutationObserver();
          scheduleSweep();
        }
      });
      rootObserver.observe(document.documentElement, { childList: true });
    }
  }
  function applyEffectivePolicy(policy) {
    currentPolicy = policy;
    applyPolicyAttributes(document, policy);
    if (!policy.masterEnabled) {
      flushPendingMetrics();
      disconnectObservers();
      unhideAllElements(document);
      return;
    }
    if (!policy.hideAiOverviews) {
      unhideCategoryElements(document, "overview");
    }
    if (!policy.hideAiModeUi) {
      unhideCategoryElements(document, "aimode");
    }
    if (!policy.hideAuxiliaryAiFeatures) {
      unhideCategoryElements(document, "aux");
    }
    attachMutationObserver();
    scheduleSweep(true);
  }
  async function loadEffectivePolicy() {
    const fromSw = await sendRuntimeMessage({
      type: "GET_EFFECTIVE_POLICY"
    });
    if (fromSw && typeof fromSw.masterEnabled === "boolean") {
      return fromSw;
    }
    const [managedRes, localRes] = await Promise.all([
      readManagedPolicyRaw(),
      readLocalOverrides()
    ]);
    const storageError = managedRes.error ?? localRes.error;
    if (storageError) {
      void sendRuntimeMessage({ type: "LOG_DIAGNOSTIC", code: "ERR_STORAGE_FAILURE", detail: `content fallback: ${storageError}` });
    }
    return parsePolicy(managedRes.data, localRes.data).policy;
  }
  var policyLoadSeq = 0;
  async function loadAndApplyPolicy() {
    const seq = ++policyLoadSeq;
    const policy = await loadEffectivePolicy();
    if (seq !== policyLoadSeq) {
      return null;
    }
    applyEffectivePolicy(policy);
    checkAiModeUrl();
    return policy;
  }
  async function bootstrapContentGuard() {
    const policy = await loadAndApplyPolicy();
    if (policy?.masterEnabled && document.readyState !== "loading") {
      runSweepNow();
    }
  }
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName === "local" && STORAGE_KEYS.METRICS_RESET_EPOCH in changes) {
        const nextEpoch = changes[STORAGE_KEYS.METRICS_RESET_EPOCH]?.newValue;
        if (typeof nextEpoch === "number" && Number.isInteger(nextEpoch) && nextEpoch >= 0) {
          liveResetSeen = true;
          currentResetEpoch = nextEpoch;
          clearPendingMetrics();
        }
      }
      if (areaName === "managed" || areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) {
        await loadAndApplyPolicy();
      }
    });
  }
  window.addEventListener("DOMContentLoaded", () => {
    if (currentPolicy?.masterEnabled) {
      attachMutationObserver();
      runSweepNow();
    }
  });
  window.addEventListener("load", () => {
    if (currentPolicy?.masterEnabled) {
      scheduleSweep();
    }
  });
  window.addEventListener("hashchange", () => {
    handleRedirectHashTelemetry();
  });
  window.addEventListener("popstate", () => {
    checkAiModeUrl();
  });
  window.addEventListener("pageshow", () => {
    checkAiModeUrl();
  });
  window.addEventListener("pagehide", () => {
    flushPendingMetrics();
  });
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushPendingMetrics();
      }
    });
  }
  var navigationApi = window.navigation;
  if (navigationApi && typeof navigationApi.addEventListener === "function") {
    navigationApi.addEventListener("navigatesuccess", () => {
      checkAiModeUrl();
    });
  }
  void initMetricsResetEpoch();
  void bootstrapContentGuard();
})();
