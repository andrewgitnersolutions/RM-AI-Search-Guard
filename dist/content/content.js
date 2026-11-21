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
    METRICS_RESET_EPOCH: "rmsg_metrics_reset_epoch",
    UNSUPPORTED_LANG_DATES: "rmsg_unsupported_lang_dates"
  };
  var EXTRA_SELECTOR_CATEGORIES = ["overview", "aimode", "aux"];
  var MAX_EXTRA_SELECTORS_PER_CATEGORY = 20;
  var MAX_EXTRA_SELECTOR_LENGTH = 300;
  function createEmptyExtraHideSelectors() {
    return {
      overview: [],
      aimode: [],
      aux: []
    };
  }

  // src/shared/errors.ts
  function getTodayDateBucket(now = /* @__PURE__ */ new Date()) {
    return now.toISOString().slice(0, 10);
  }

  // src/shared/policy.ts
  function isValidGradeBand(value) {
    return typeof value === "string" && VALID_GRADE_BANDS.includes(value);
  }
  function isUnlockableInstall(installType) {
    return installType === "normal" || installType === "development";
  }
  function trimCssWhitespace(value) {
    return value.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, "");
  }
  function parseExtraHideSelectors(raw) {
    const value = createEmptyExtraHideSelectors();
    if (raw === null || raw === void 0 || typeof raw !== "object" || Array.isArray(raw)) {
      return { value, valid: false };
    }
    const obj = raw;
    let valid = true;
    const allowedKeys = new Set(EXTRA_SELECTOR_CATEGORIES);
    for (const key of Object.keys(obj)) {
      if (!allowedKeys.has(key)) {
        valid = false;
      }
    }
    for (const category of EXTRA_SELECTOR_CATEGORIES) {
      if (!(category in obj) || obj[category] === void 0) {
        continue;
      }
      const rawList = obj[category];
      if (!Array.isArray(rawList) || rawList.length > MAX_EXTRA_SELECTORS_PER_CATEGORY) {
        valid = false;
        continue;
      }
      for (const item of rawList) {
        if (typeof item !== "string" || item.length > MAX_EXTRA_SELECTOR_LENGTH) {
          valid = false;
          continue;
        }
        const trimmed = trimCssWhitespace(item);
        if (trimmed.length === 0) {
          valid = false;
          continue;
        }
        value[category].push(trimmed);
      }
    }
    return { value, valid };
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
          extraHideSelectors: createEmptyExtraHideSelectors(),
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
        // Custom hotfix selectors are managed-only (BP-04): ignore any localRaw.extraHideSelectors.
        extraHideSelectors: createEmptyExtraHideSelectors(),
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
    let extraHideSelectors = createEmptyExtraHideSelectors();
    if ("extraHideSelectors" in managedRaw && managedRaw.extraHideSelectors !== void 0) {
      const parsedExtras = parseExtraHideSelectors(managedRaw.extraHideSelectors);
      extraHideSelectors = parsedExtras.value;
      if (!parsedExtras.valid) {
        invalidFields.push("extraHideSelectors");
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
      extraHideSelectors,
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
    const result = await chrome.storage.local.get(STORAGE_KEYS.METRICS_RESET_EPOCH);
    const raw = result?.[STORAGE_KEYS.METRICS_RESET_EPOCH];
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
      return raw;
    }
    return 0;
  }

  // src/shared/selectors.ts
  function resolveUiLanguage(rawLang) {
    if (typeof rawLang !== "string") {
      return { language: "en", normalizedTag: "", supported: true };
    }
    const cleaned = rawLang.trim().toLowerCase();
    if (!cleaned) {
      return { language: "en", normalizedTag: "", supported: true };
    }
    const primarySubtag = cleaned.split(/[-_\s]/)[0].replace(/[^a-z0-9-]/g, "").slice(0, 16);
    if (primarySubtag === "en") {
      return { language: "en", normalizedTag: "en", supported: true };
    }
    if (primarySubtag === "es") {
      return { language: "es", normalizedTag: "es", supported: true };
    }
    return {
      language: "en",
      normalizedTag: primarySubtag || "unknown",
      supported: false
    };
  }
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
    // FRAGILE(google-dom, last verified 2026-11-21): Tier 1 semantic attrs, localized en/es labels
    // collected from live Google (?hl=en, ?hl=es -> es-US, ?hl=es-419), and Google-only AI Mode hrefs.
    // Legacy attrs [data-attrid="AIOverview"], [data-async-type="aiOverview"], [aria-label="AI Overview"],
    // div.Fzsovc, and [data-base-lens-url] had 0 live matches on 2026-11-21 and stay as fallbacks.
    tier1: {
      aiOverviews: {
        directSelectors: [
          '[data-attrid="AIOverview"]',
          '[data-async-type="aiOverview"]'
        ],
        localizedDirectSelectors: {
          // FRAGILE(google-dom, last verified 2026-11-21): legacy exact aria-label fallback (0 matches on hl=en 2026-11-21; live uses div[role="heading"] > strong.WJFise).
          en: ['[aria-label="AI Overview"]'],
          // FRAGILE(google-dom, last verified 2026-11-21): Spanish heading text from live Google (?hl=es / ?hl=es-419).
          es: ['[aria-label="Visión general creada por IA"]']
        },
        headingSelectors: ["h1", "h2", '[role="heading"]', "div.Fzsovc"],
        headingTexts: {
          // FRAGILE(google-dom, last verified 2026-11-21): observed on live Google (?hl=en) in div[role="heading"][aria-level="2"] > strong.WJFise.
          en: ["ai overview"],
          // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=es and ?hl=es-419).
          es: ["visión general creada por ia"]
        },
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
        exactTexts: {
          // FRAGILE(google-dom, last verified 2026-11-21): "AI Mode" observed on live Google (?hl=en) nav tab and search-bar button.
          en: ["ai mode", "dive deeper in ai mode", "ask ai mode"],
          // FRAGILE(google-dom, last verified 2026-11-21): "Modo IA" observed verbatim on live Google (?hl=es and ?hl=es-419) nav tab and search-bar button.
          es: ["modo ia"]
        },
        navItemAncestor: '[role="listitem"]'
      },
      auxiliaryAi: {
        directSelectors: [
          'a[href*="labs.google.com"]',
          "[data-base-lens-url]",
          // FRAGILE(google-dom, last verified 2026-11-21): embedded follow-up input plate inside #eKIzJc on live Google (EN/ES/ES-419).
          '[data-xid="aim-mars-input-plate"]'
        ],
        localizedDirectSelectors: {
          en: [
            // FRAGILE(google-dom, last verified 2026-11-21): Search Labs did not render in test account; retained from prior DOM capture.
            '[aria-label*="Search Labs" i]',
            // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=en) Lens button.
            '[aria-label*="Search by image" i]',
            // FRAGILE(google-dom, last verified 2026-11-21): legacy follow-up wording (0 matches on hl=en 2026-11-21; replaced by "Ask anything").
            '[aria-label*="Ask a follow up" i]',
            '[placeholder*="Ask a follow up" i]',
            // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=en) follow-up textarea; :not([name="q"]) protects search input.
            '[aria-label*="Ask anything" i]:not([name="q"])',
            '[placeholder*="Ask anything" i]:not([name="q"])'
          ],
          es: [
            // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=es and ?hl=es-419) Lens button.
            '[aria-label*="Búsqueda por imagen" i]',
            // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=es and ?hl=es-419) follow-up textarea; :not([name="q"]) protects search input.
            '[aria-label*="Haz una pregunta" i]:not([name="q"])',
            '[placeholder*="Haz una pregunta" i]:not([name="q"])'
          ]
        },
        paaCardSelectors: [
          '[jsname="yEVEwb"]',
          '[data-sgrd="true"]',
          "[data-q]",
          "div.related-question-pair"
        ],
        aiAttributionMarkers: {
          en: ["ai overview", "generative ai", "ai-generated"],
          // FRAGILE(google-dom, last verified 2026-11-21): only observed Spanish AI badge/heading verbatim on live Google; "Generative AI" / "AI-generated" did not render on es PAA headers.
          es: ["visión general creada por ia"]
        }
      }
    },
    tier2: {
      aiOverviews: [
        // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match, canonical AIO root).
        "#eKIzJc",
        // FRAGILE(google-dom, last verified 2026-11-21): 0 matches on live Google 2026-11-21; kept as legacy fallback (never drop [data-mcpr] because bare div.YzCcne matches PAA skeletons).
        "div.YzCcne[data-mcpr]",
        // FRAGILE(google-dom, last verified 2026-11-21): 0 matches on live Google 2026-11-21; kept as legacy fallback.
        'div[data-mcp="18"]'
      ],
      aiModeUi: [
        // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match wrapping AI Mode nav tab).
        "div.olrp5b",
        // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match on homepage and SERP search bar).
        "button.plR5qb",
        // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match on homepage and SERP search bar).
        'button[jsname="B6rgad"]'
      ],
      auxiliaryAi: [
        // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match for Google Lens button).
        'div[jsname="R5mgy"]'
      ]
    },
    leakDetector: {
      // Limit leak scanning to headings, tabs and buttons so organic article titles aren't flagged (BP-04).
      candidateSelector: 'h1, h2, [role="heading"], [role="tab"], button',
      maxLabelTextLength: 60
    }
  };

  // src/content/dom-engine.ts
  var PROTECTED_TAG_SET = new Set(SELECTORS.safetyGuard.protectedTags);
  var PROTECTED_SELECTOR_COMBINED = SELECTORS.safetyGuard.protectedSelectors.join(", ");
  var CONTAINER_ANCESTOR_COMBINED = SELECTORS.tier1.aiOverviews.containerAncestors.join(", ");
  function buildLocaleSets(lang) {
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
  var LOCALE_SETS = {
    en: buildLocaleSets("en"),
    es: buildLocaleSets("es")
  };
  var OVERVIEW_HEADING_TEXT_SET = LOCALE_SETS.en.overviewHeadingTexts;
  var AI_MODE_EXACT_TEXT_SET = LOCALE_SETS.en.aiModeExactTexts;
  var AI_ATTRIBUTION_MARKER_SET = LOCALE_SETS.en.aiAttributionMarkers;
  var OVERVIEW_HEADING_COMBINED = SELECTORS.tier1.aiOverviews.headingSelectors.join(", ");
  var OVERVIEW_TIER2_COMBINED = SELECTORS.tier2.aiOverviews.join(", ");
  var AI_MODE_DIRECT_COMBINED = SELECTORS.tier1.aiModeUi.directSelectors.join(", ");
  var AI_MODE_TEXT_COMBINED = SELECTORS.tier1.aiModeUi.textCandidateSelectors.join(", ");
  var AI_MODE_TIER2_COMBINED = SELECTORS.tier2.aiModeUi.join(", ");
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
  function collectExtraSelectorCandidates(doc, selectors, errors) {
    if (!selectors || selectors.length === 0) {
      return [];
    }
    const candidates = [];
    for (const selector of selectors) {
      if (typeof selector !== "string") {
        continue;
      }
      const trimmed = trimCssWhitespace(selector);
      if (!trimmed) {
        continue;
      }
      for (const el of safeQueryAll(doc, trimmed, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(el);
        }
      }
    }
    return candidates;
  }
  function collectAiOverviewCandidates(doc, errors, guardCache, lang = "en", extraSelectors) {
    const candidates = [];
    const localeSet = LOCALE_SETS[lang];
    if (localeSet.overviewDirectCombined) {
      for (const el of safeQueryAll(doc, localeSet.overviewDirectCombined, errors)) {
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
        if (localeSet.overviewHeadingTexts.has(normalizeText(headingEl.textContent))) {
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
    if (extraSelectors && extraSelectors.length > 0) {
      candidates.push(...collectExtraSelectorCandidates(doc, extraSelectors, errors));
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
  function collectAiModeUiCandidates(doc, errors, guardCache, lang = "en", extraSelectors) {
    const candidates = [];
    const localeSet = LOCALE_SETS[lang];
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
        if (localeSet.aiModeExactTexts.has(normalizeText(el.textContent))) {
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
      if (localeSet.aiModeExactTexts.has(normalizeText(trimmed))) {
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
    if (extraSelectors && extraSelectors.length > 0) {
      candidates.push(...collectExtraSelectorCandidates(doc, extraSelectors, errors));
    }
    return candidates;
  }
  function hasAiAttributionBadge(card, lang = "en") {
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
  function collectAuxAiCandidates(doc, errors, lang = "en", extraSelectors) {
    const candidates = [];
    const localeSet = LOCALE_SETS[lang];
    if (localeSet.auxDirectCombined) {
      for (const el of safeQueryAll(doc, localeSet.auxDirectCombined, errors)) {
        if (!isAlreadyHidden(el)) {
          candidates.push(el);
        }
      }
    }
    if (AUX_PAA_COMBINED) {
      for (const card of safeQueryAll(doc, AUX_PAA_COMBINED, errors)) {
        if (!isAlreadyHidden(card) && hasAiAttributionBadge(card, lang)) {
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
    if (extraSelectors && extraSelectors.length > 0) {
      candidates.push(...collectExtraSelectorCandidates(doc, extraSelectors, errors));
    }
    return candidates;
  }
  function isElementVisible(el) {
    if (!el.isConnected || isAlreadyHidden(el)) {
      return false;
    }
    const maybeCheck = el;
    if (typeof maybeCheck.checkVisibility === "function") {
      try {
        return maybeCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch {
      }
    }
    const htmlEl = el;
    if (htmlEl.style?.getPropertyValue?.("display") === "none") {
      return false;
    }
    if ("offsetParent" in htmlEl && htmlEl.offsetParent === null && htmlEl.tagName !== "BODY") {
      return false;
    }
    return true;
  }
  function detectVisibleAiSurfaceLeaks(doc, policy, lang, errors) {
    if (!policy.masterEnabled || !policy.hideAiOverviews && !policy.hideAiModeUi) {
      return;
    }
    const localeSet = LOCALE_SETS[lang];
    let flaggedOverview = false;
    let flaggedAiMode = false;
    for (const el of safeQueryAll(doc, SELECTORS.leakDetector.candidateSelector, errors)) {
      if (isAlreadyHidden(el)) {
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
      if (policy.hideAiOverviews && !flaggedOverview && localeSet.overviewHeadingTexts.has(normalized) && isElementVisible(el)) {
        flaggedOverview = true;
        errors.push({ code: "WARN_AI_SURFACE_VISIBLE", detail: "overview" });
      }
      if (policy.hideAiModeUi && !flaggedAiMode && localeSet.aiModeExactTexts.has(normalized) && isElementVisible(el)) {
        flaggedAiMode = true;
        errors.push({ code: "WARN_AI_SURFACE_VISIBLE", detail: "aimode" });
      }
      if ((!policy.hideAiOverviews || flaggedOverview) && (!policy.hideAiModeUi || flaggedAiMode)) {
        break;
      }
    }
  }
  function sweepDom(doc, policy, seenPages, pageKey) {
    const deltas = {};
    const errors = [];
    if (!policy.masterEnabled) {
      return { deltas, errors };
    }
    const uiLang = resolveUiLanguage(doc.documentElement?.lang);
    if (!uiLang.supported) {
      errors.push({
        code: "WARN_UNSUPPORTED_UI_LANGUAGE",
        detail: uiLang.normalizedTag
      });
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
      const overviewCandidates = collectAiOverviewCandidates(
        doc,
        errors,
        guardCache,
        uiLang.language,
        policy.extraHideSelectors?.overview
      );
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
      const aiModeCandidates = collectAiModeUiCandidates(
        doc,
        errors,
        guardCache,
        uiLang.language,
        policy.extraHideSelectors?.aimode
      );
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
      const auxCandidates = collectAuxAiCandidates(
        doc,
        errors,
        uiLang.language,
        policy.extraHideSelectors?.aux
      );
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
    detectVisibleAiSurfaceLeaks(doc, policy, uiLang.language, errors);
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
  var reportedUnsupportedLangKeys = /* @__PURE__ */ new Set();
  var pendingMetricDeltas = {};
  var metricsFlushTimer = null;
  var currentResetEpoch = null;
  var epochReadPromise = null;
  var epochVersion = 0;
  async function ensureMetricsResetEpoch() {
    if (currentResetEpoch !== null) {
      return currentResetEpoch;
    }
    if (epochReadPromise === null) {
      const versionAtStart = epochVersion;
      epochReadPromise = (async () => {
        try {
          const epoch = await readMetricsResetEpoch();
          if (epochVersion === versionAtStart && currentResetEpoch === null) {
            currentResetEpoch = epoch;
          }
          return currentResetEpoch;
        } catch {
          return null;
        } finally {
          epochReadPromise = null;
        }
      })();
    }
    return await epochReadPromise;
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
  function scheduleMetricsFlushTimer() {
    if (metricsFlushTimer === null && typeof window.setTimeout === "function") {
      metricsFlushTimer = window.setTimeout(() => {
        metricsFlushTimer = null;
        flushPendingMetrics();
      }, METRICS_FLUSH_INTERVAL_MS);
    }
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
    if (added) {
      scheduleMetricsFlushTimer();
    }
  }
  async function flushAfterEpochRetry(versionBeforeRetry) {
    const confirmedEpoch = await ensureMetricsResetEpoch();
    if (epochVersion !== versionBeforeRetry) {
      return;
    }
    if (confirmedEpoch === null) {
      if (Object.keys(pendingMetricDeltas).length > 0) {
        scheduleMetricsFlushTimer();
      }
      return;
    }
    flushPendingMetrics(false);
  }
  function flushPendingMetrics(allowAsyncRetry = true) {
    if (metricsFlushTimer !== null) {
      if (typeof window.clearTimeout === "function") {
        window.clearTimeout(metricsFlushTimer);
      }
      metricsFlushTimer = null;
    }
    if (Object.keys(pendingMetricDeltas).length === 0) {
      return;
    }
    if (currentResetEpoch === null) {
      if (!allowAsyncRetry) {
        clearPendingMetrics();
        return;
      }
      void flushAfterEpochRetry(epochVersion);
      return;
    }
    const deltas = pendingMetricDeltas;
    pendingMetricDeltas = {};
    void sendRuntimeMessage({ type: "INCREMENT_METRICS", deltas, resetEpoch: currentResetEpoch });
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
    flushPendingMetrics(false);
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
      if (err.code === "WARN_UNSUPPORTED_UI_LANGUAGE") {
        const langKey = `${getTodayDateBucket()}:${err.detail}`;
        if (!reportedUnsupportedLangKeys.has(langKey)) {
          reportedUnsupportedLangKeys.add(langKey);
          void sendRuntimeMessage({
            type: "LOG_DIAGNOSTIC",
            code: err.code,
            detail: err.detail
          });
        }
        continue;
      }
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
  function sameSelectorList(prev, next) {
    const a = prev ?? [];
    const b = next ?? [];
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }
  function extraSelectorsChanged(prev, next, category) {
    if (prev === null) {
      return false;
    }
    return !sameSelectorList(prev.extraHideSelectors?.[category], next.extraHideSelectors?.[category]);
  }
  function applyEffectivePolicy(policy) {
    const previousPolicy = currentPolicy;
    currentPolicy = policy;
    applyPolicyAttributes(document, policy);
    if (!policy.masterEnabled) {
      flushPendingMetrics();
      disconnectObservers();
      unhideAllElements(document);
      return;
    }
    const overviewExtraChanged = extraSelectorsChanged(previousPolicy, policy, "overview");
    const aimodeExtraChanged = extraSelectorsChanged(previousPolicy, policy, "aimode");
    const auxExtraChanged = extraSelectorsChanged(previousPolicy, policy, "aux");
    if (!policy.hideAiOverviews || overviewExtraChanged) {
      unhideCategoryElements(document, "overview");
    }
    if (!policy.hideAiModeUi || aimodeExtraChanged) {
      unhideCategoryElements(document, "aimode");
    }
    if (!policy.hideAuxiliaryAiFeatures || auxExtraChanged) {
      unhideCategoryElements(document, "aux");
    }
    attachMutationObserver();
    if ((overviewExtraChanged || aimodeExtraChanged || auxExtraChanged) && document.body) {
      runSweepNow();
    } else {
      scheduleSweep(true);
    }
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
          epochVersion += 1;
          currentResetEpoch = nextEpoch;
          clearPendingMetrics();
          reportedUnsupportedLangKeys.clear();
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
    flushPendingMetrics(false);
  });
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushPendingMetrics(true);
      }
    });
  }
  var navigationApi = window.navigation;
  if (navigationApi && typeof navigationApi.addEventListener === "function") {
    navigationApi.addEventListener("navigatesuccess", () => {
      checkAiModeUrl();
    });
  }
  void ensureMetricsResetEpoch();
  void bootstrapContentGuard();
})();
