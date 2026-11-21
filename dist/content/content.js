"use strict";
(() => {
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
    LAST_POLICY: "rmsg_last_policy"
  };

  // src/shared/policy.ts
  function isValidGradeBand(value) {
    return typeof value === "string" && VALID_GRADE_BANDS.includes(value);
  }
  function parsePolicy(managedRaw, localRaw, now = /* @__PURE__ */ new Date()) {
    const evaluatedAt = now.toISOString();
    const errors = [];
    const hasManagedKeys = managedRaw !== null && managedRaw !== void 0 && typeof managedRaw === "object" && !Array.isArray(managedRaw) && Object.keys(managedRaw).length > 0;
    if (!hasManagedKeys) {
      errors.push({
        code: "WARN_NO_MANAGED_POLICY",
        detail: "chrome.storage.managed returned no policy keys"
      });
      const toggles2 = { ...STRICT_LOCKDOWN_TOGGLES };
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
      // BP-08 proposes 1 for the overview category; unchanged in Phase 0.
      organicResultThreshold: 3,
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
        containerAncestors: [
          "[data-mcpr]",
          "[data-attrid]",
          "[data-async-type]",
          "[data-hveid]",
          "div#eKIzJc"
        ]
      },
      aiModeUi: {
        directSelectors: [
          'a[href*="udm=50"]',
          'a[href*="/aimode"]',
          'a[href^="https://www.google.com/ai"]'
        ],
        textCandidateSelectors: [
          '[role="tab"]',
          '[role="listitem"] a',
          '[role="listitem"] span',
          "button",
          "a"
        ],
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
  function isUnsafeToHide(el, doc) {
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
      if (organicResults.length >= SELECTORS.safetyGuard.organicResultThreshold) {
        return true;
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
      if (prevDisplay && prevDisplay !== "none") {
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
  function processCategoryCandidates(candidates, category, doc, errors, reportedUnsafe) {
    const uniqueCandidates = Array.from(new Set(candidates));
    const safeCandidates = [];
    for (const candidate of uniqueCandidates) {
      if (isAlreadyHidden(candidate)) {
        continue;
      }
      if (isUnsafeToHide(candidate, doc)) {
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
  function findOverviewHeadingContainer(headingEl, doc) {
    let cursor = headingEl.parentElement;
    while (cursor) {
      if (safeMatches(cursor, CONTAINER_ANCESTOR_COMBINED)) {
        return cursor;
      }
      if (isUnsafeToHide(cursor, doc)) {
        if (cursor === headingEl.parentElement) {
          return cursor;
        }
        break;
      }
      cursor = cursor.parentElement;
    }
    if (headingEl.parentElement && !isUnsafeToHide(headingEl.parentElement, doc)) {
      return headingEl.parentElement;
    }
    return headingEl;
  }
  function collectAiOverviewCandidates(doc, errors) {
    const candidates = [];
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
  function promoteAiModeTarget(el, doc) {
    const navItem = el.closest(SELECTORS.tier1.aiModeUi.navItemAncestor);
    if (navItem && !isUnsafeToHide(navItem, doc)) {
      return navItem;
    }
    if (el.tagName.toUpperCase() === "SPAN") {
      const interactiveAncestor = el.closest('a, button, [role="tab"], [role="button"]');
      if (interactiveAncestor && !isUnsafeToHide(interactiveAncestor, doc)) {
        return interactiveAncestor;
      }
    }
    return el;
  }
  function collectAiModeUiCandidates(doc, errors) {
    const candidates = [];
    const directSelectors = [
      ...SELECTORS.tier1.aiModeUi.directSelectors,
      // FRAGILE(google-dom, last verified NONE, see test L-07): bare google.com host variant of the /ai link selector.
      'a[href^="https://google.com/ai"]'
    ];
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
        const text = normalizeText(node.textContent);
        if (AI_ATTRIBUTION_MARKER_SET.has(text)) {
          return true;
        }
      }
    }
    return false;
  }
  function collectAuxAiCandidates(doc, errors) {
    const candidates = [];
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
  function sweepDom(doc, policy, seenOverviewUrls, pageKey) {
    const deltas = {};
    const errors = [];
    if (!policy.masterEnabled) {
      return { deltas, errors };
    }
    const resolvedPageKey = pageKey ?? (doc.location && doc.location.href ? doc.location.href : "default");
    const reportedUnsafe = /* @__PURE__ */ new Set();
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

  // src/content/content.ts
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
  var currentPolicy = null;
  var bodyObserver = null;
  var rootObserver = null;
  var pendingRaf = false;
  var seenOverviewPages = /* @__PURE__ */ new Set();
  var reportedErrorKeys = /* @__PURE__ */ new Set();
  function disconnectObservers() {
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
    if (rootObserver) {
      rootObserver.disconnect();
      rootObserver = null;
    }
    pendingRaf = false;
  }
  function runSweepNow() {
    if (!currentPolicy || !currentPolicy.masterEnabled) {
      return;
    }
    const pageKey = computeOpaquePageKey();
    const { deltas, errors } = sweepDom(document, currentPolicy, seenOverviewPages, pageKey);
    if (Object.keys(deltas).length > 0) {
      void sendRuntimeMessage({ type: "INCREMENT_METRICS", deltas });
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
  function scheduleSweep() {
    if (pendingRaf || !currentPolicy || !currentPolicy.masterEnabled) {
      return;
    }
    pendingRaf = true;
    window.requestAnimationFrame(() => {
      pendingRaf = false;
      runSweepNow();
    });
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
    scheduleSweep();
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
    return parsePolicy(managedRes.data, localRes.data).policy;
  }
  async function bootstrapContentGuard() {
    const policy = await loadEffectivePolicy();
    applyEffectivePolicy(policy);
    if (policy.masterEnabled && document.readyState !== "loading") {
      runSweepNow();
    }
  }
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName === "managed" || areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) {
        const policy = await loadEffectivePolicy();
        applyEffectivePolicy(policy);
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
  void bootstrapContentGuard();
})();
