"use strict"; // Enforce strict JavaScript mode to catch common coding errors
(() => { // Wrap content script in an IIFE to avoid polluting Google Search's global window scope
  // src/shared/defaults.ts — Shared default policy constants and storage keys
  var STRICT_LOCKDOWN_TOGGLES = { // Fail-closed default protection flags used when no policy or invalid fields exist
    masterEnabled: true, // Master kill-switch; true keeps all Search Guard protections active
    hideAiOverviews: true, // Hide Google AI Overviews on search result pages
    hideAiModeUi: true, // Hide AI Mode buttons, tabs, and triggers in Google Search
    blockAiModeNavigation: true, // Redirect direct AI Mode URLs back to standard Search
    forceWebOnlySearch: true, // Rewrite standard searches to udm=14 (Web-only results)
    hideAuxiliaryAiFeatures: true // Hide auxiliary AI triggers (Search Labs, Lens, follow-up bars)
  }; // End STRICT_LOCKDOWN_TOGGLES
  var DEFAULT_ANALYTICS_POLICY = { // Default telemetry settings; privacy-preserving and disabled by default
    analyticsEnabled: false, // Anonymous aggregate telemetry is opt-in only (off by default)
    analyticsEndpointUrl: "", // No default remote endpoint; must be configured by district IT
    analyticsSharedToken: "", // Optional shared secret token for district Apps Script endpoint
    analyticsFlushIntervalMinutes: 240 // Default telemetry upload interval (4 hours)
  }; // End DEFAULT_ANALYTICS_POLICY
  var VALID_GRADE_BANDS = [ // Allowed K-12 organizational unit (OU) grade-band labels
    "K-2", // Early elementary grade band
    "3-5", // Upper elementary grade band
    "6-8", // Middle school grade band
    "9-12", // High school grade band
    "Staff", // Faculty and staff OU label
    "Unassigned" // Fallback label when no grade band is assigned
  ]; // End VALID_GRADE_BANDS
  var FEATURE_TOGGLE_KEYS = [ // Ordered list of the six boolean policy toggle keys
    "masterEnabled", // Key for master protection switch
    "hideAiOverviews", // Key for AI Overviews hiding
    "hideAiModeUi", // Key for AI Mode UI hiding
    "blockAiModeNavigation", // Key for AI Mode URL redirection
    "forceWebOnlySearch", // Key for Web-only (udm=14) search enforcement
    "hideAuxiliaryAiFeatures" // Key for auxiliary AI feature hiding
  ]; // End FEATURE_TOGGLE_KEYS
  var APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/; // Strict allowlist regex permitting only deployed Google Apps Script /exec URLs
  var STORAGE_KEYS = { // Keys used in chrome.storage.local
    LOCAL_OVERRIDES: "rmsg_local_overrides", // Stores unmanaged local test-mode settings
    TELEMETRY: "rmsg_telemetry", // Stores aggregate daily event counters
    LAST_POLICY: "rmsg_last_policy" // Caches the most recently evaluated policy snapshot
  }; // End STORAGE_KEYS
  var MIN_FLUSH_INTERVAL_MINUTES = 60; // Minimum allowed telemetry flush interval (1 hour)
  var MAX_FLUSH_INTERVAL_MINUTES = 1440; // Maximum allowed telemetry flush interval (24 hours)

  // src/shared/policy.ts — Enterprise policy validation and resolution
  function isValidAppsScriptUrl(url) { // Validate that an analytics endpoint matches the strict Apps Script URL pattern
    if (typeof url !== "string") { // Reject non-string values immediately
      return false; // Return invalid
    } // End type check
    return APPS_SCRIPT_URL_REGEX.test(url); // Test URL against the strict Apps Script HTTPS regex
  } // End isValidAppsScriptUrl
  function isValidGradeBand(value) { // Check whether a value is one of the allowed grade-band strings
    return typeof value === "string" && VALID_GRADE_BANDS.includes(value); // Ensure string type and membership in VALID_GRADE_BANDS
  } // End isValidGradeBand
  function parsePolicy(managedRaw, localRaw, now = /* @__PURE__ */ new Date()) { // Resolve effective policy from Google Admin managed storage or local test overrides
    const evaluatedAt = now.toISOString(); // Record ISO-8601 timestamp of policy evaluation
    const errors = []; // Collect non-fatal warnings or validation errors for IT diagnostics
    const hasManagedKeys = managedRaw !== null && managedRaw !== void 0 && typeof managedRaw === "object" && !Array.isArray(managedRaw) && Object.keys(managedRaw).length > 0; // Determine if Google Admin Console pushed any managed policy keys
    if (!hasManagedKeys) { // Branch when no managed policy is present (unmanaged / local test mode)
      errors.push({ // Record informational warning that managed policy was absent
        code: "WARN_NO_MANAGED_POLICY", // Machine-readable warning code
        detail: "chrome.storage.managed returned no policy keys" // Human-readable diagnostic message
      }); // End warning entry
      const toggles2 = { ...STRICT_LOCKDOWN_TOGGLES }; // Start with fail-closed strict lockdown defaults
      let gradeBand2 = "Unassigned"; // Default grade band when unmanaged
      let appliedLocalOverride = false; // Track whether any local test-mode override was applied
      if (localRaw !== null && localRaw !== void 0 && typeof localRaw === "object") { // Check if local override object exists
        for (const key of FEATURE_TOGGLE_KEYS) { // Iterate through each of the 6 feature toggle keys
          if (typeof localRaw[key] === "boolean") { // Only accept strict boolean values from local storage
            toggles2[key] = localRaw[key]; // Apply local toggle override
            appliedLocalOverride = true; // Mark that local overrides are active
          } // End boolean check
        } // End feature toggle loop
        if (isValidGradeBand(localRaw.gradeBand)) { // Validate local gradeBand override if present
          gradeBand2 = localRaw.gradeBand; // Apply local grade-band label
          appliedLocalOverride = true; // Mark that local overrides are active
        } // End gradeBand check
      } // End localRaw check
      const policy2 = { // Assemble resolved unmanaged policy object
        ...toggles2, // Spread resolved feature toggles
        ...DEFAULT_ANALYTICS_POLICY, // Unmanaged mode always keeps telemetry disabled
        gradeBand: gradeBand2, // Resolved grade band
        source: appliedLocalOverride ? "local-unmanaged" : "defaults", // Indicate whether defaults or local overrides were used
        isManaged: false, // Flag that this browser is NOT managed by Google Admin Console policy
        invalidFields: [], // No invalid managed fields in unmanaged mode
        evaluatedAt // Timestamp of evaluation
      }; // End policy2 object
      return { policy: policy2, errors }; // Return resolved unmanaged policy and warning
    } // End !hasManagedKeys branch
    const invalidFields = []; // Track any managed policy keys that failed type/range validation
    const toggles = { ...STRICT_LOCKDOWN_TOGGLES }; // Initialize toggles with fail-closed strict defaults
    for (const key of FEATURE_TOGGLE_KEYS) { // Validate each feature toggle from managed storage
      if (key in managedRaw && managedRaw[key] !== void 0) { // Check if the admin configured this key
        const rawValue = managedRaw[key]; // Read raw managed value
        if (typeof rawValue === "boolean") { // Confirm value is a valid boolean
          toggles[key] = rawValue; // Apply admin-configured boolean
        } else { // Handle malformed non-boolean value
          invalidFields.push(key); // Record field name as invalid
          toggles[key] = STRICT_LOCKDOWN_TOGGLES[key]; // Fall back to strict lockdown default (fail-closed)
        } // End boolean validation
      } // End key presence check
    } // End managed feature toggle loop
    let gradeBand = "Unassigned"; // Default grade band if omitted or invalid
    if ("gradeBand" in managedRaw && managedRaw.gradeBand !== void 0) { // Check if admin set gradeBand
      if (isValidGradeBand(managedRaw.gradeBand)) { // Validate against allowed grade-band enum
        gradeBand = managedRaw.gradeBand; // Apply valid grade band
      } else { // Handle invalid gradeBand value
        invalidFields.push("gradeBand"); // Record invalid field
        gradeBand = "Unassigned"; // Fall back to Unassigned
      } // End gradeBand validation
    } // End gradeBand presence check
    let analyticsEnabled = DEFAULT_ANALYTICS_POLICY.analyticsEnabled; // Default analyticsEnabled to false
    if ("analyticsEnabled" in managedRaw && managedRaw.analyticsEnabled !== void 0) { // Check if admin set analyticsEnabled
      if (typeof managedRaw.analyticsEnabled === "boolean") { // Validate boolean type
        analyticsEnabled = managedRaw.analyticsEnabled; // Apply admin setting
      } else { // Handle invalid type
        invalidFields.push("analyticsEnabled"); // Record invalid field
        analyticsEnabled = false; // Fail-closed: disable analytics on invalid input
      } // End analyticsEnabled validation
    } // End analyticsEnabled presence check
    let analyticsEndpointUrl = DEFAULT_ANALYTICS_POLICY.analyticsEndpointUrl; // Default endpoint to empty string
    if ("analyticsEndpointUrl" in managedRaw && managedRaw.analyticsEndpointUrl !== void 0) { // Check if admin set analyticsEndpointUrl
      if (typeof managedRaw.analyticsEndpointUrl === "string") { // Validate string type
        analyticsEndpointUrl = managedRaw.analyticsEndpointUrl.trim(); // Trim whitespace from endpoint URL
      } else { // Handle invalid non-string type
        invalidFields.push("analyticsEndpointUrl"); // Record invalid field
        analyticsEndpointUrl = ""; // Reset endpoint to empty string
      } // End analyticsEndpointUrl type check
    } // End analyticsEndpointUrl presence check
    let analyticsSharedToken = DEFAULT_ANALYTICS_POLICY.analyticsSharedToken; // Default shared token to empty string
    if ("analyticsSharedToken" in managedRaw && managedRaw.analyticsSharedToken !== void 0) { // Check if admin set analyticsSharedToken
      if (typeof managedRaw.analyticsSharedToken === "string") { // Validate string type
        analyticsSharedToken = managedRaw.analyticsSharedToken.trim(); // Trim whitespace from token
      } else { // Handle invalid non-string type
        invalidFields.push("analyticsSharedToken"); // Record invalid field
        analyticsSharedToken = ""; // Reset token to empty string
      } // End analyticsSharedToken type check
    } // End analyticsSharedToken presence check
    let analyticsFlushIntervalMinutes = DEFAULT_ANALYTICS_POLICY.analyticsFlushIntervalMinutes; // Default flush interval (240 min)
    if ("analyticsFlushIntervalMinutes" in managedRaw && managedRaw.analyticsFlushIntervalMinutes !== void 0) { // Check if admin set flush interval
      const rawInterval = managedRaw.analyticsFlushIntervalMinutes; // Read raw numeric interval
      if (typeof rawInterval === "number" && Number.isInteger(rawInterval) && rawInterval >= MIN_FLUSH_INTERVAL_MINUTES && rawInterval <= MAX_FLUSH_INTERVAL_MINUTES) { // Enforce integer within [60, 1440] minutes
        analyticsFlushIntervalMinutes = rawInterval; // Apply valid flush interval
      } else { // Handle out-of-range or non-integer value
        invalidFields.push("analyticsFlushIntervalMinutes"); // Record invalid field
        analyticsFlushIntervalMinutes = DEFAULT_ANALYTICS_POLICY.analyticsFlushIntervalMinutes; // Fall back to default 240 minutes
      } // End interval validation
    } // End flush interval presence check
    if (invalidFields.length > 0) { // If any managed fields failed validation
      errors.push({ // Record policy validation error for admin visibility
        code: "ERR_POLICY_INVALID", // Error code indicating partial fallback
        detail: invalidFields.join(", ") // Comma-separated list of invalid field names
      }); // End error entry
    } // End invalidFields check
    if (analyticsEnabled && !isValidAppsScriptUrl(analyticsEndpointUrl)) { // Verify endpoint matches Apps Script allowlist when analytics is enabled
      errors.push({ // Record endpoint validation error
        code: "ERR_ANALYTICS_ENDPOINT_INVALID", // Error code for invalid or missing endpoint
        detail: analyticsEndpointUrl ? "Configured analyticsEndpointUrl failed Apps Script allowlist validation" : "analyticsEndpointUrl is missing while analyticsEnabled is true" // Specific reason
      }); // End error entry
    } // End analytics endpoint check
    const policy = { // Assemble final managed policy object
      ...toggles, // Spread validated feature toggles
      analyticsEnabled, // Validated analytics opt-in flag
      analyticsEndpointUrl, // Validated endpoint URL
      analyticsSharedToken, // Validated shared token
      analyticsFlushIntervalMinutes, // Validated flush interval
      gradeBand, // Validated grade band
      source: invalidFields.length > 0 ? "managed-degraded" : "managed", // Indicate full managed vs degraded fallback
      isManaged: true, // Flag that policy came from chrome.storage.managed (locks UI overrides)
      invalidFields, // List of any fields that fell back to defaults
      evaluatedAt // Timestamp of evaluation
    }; // End policy object
    return { policy, errors }; // Return resolved managed policy and any diagnostic errors
  } // End parsePolicy

  // src/shared/storage.ts — Safe Chrome storage read helpers
  var storageQueueTail = Promise.resolve(); // Unused in content script (bundled from shared module); keeps storage writes serialized in background
  function formatErrorMessage(err) { // Convert unknown thrown value into a safe string message
    if (err instanceof Error) { // Use Error.message when available
      return err.message; // Return error message string
    } // End Error check
    return String(err); // Coerce non-Error values to string
  } // End formatErrorMessage
  async function readManagedPolicyRaw() { // Read enterprise policy object from chrome.storage.managed
    if (typeof chrome === "undefined" || !chrome.storage?.managed) { // Guard when managed storage API is unavailable
      return { data: {} }; // Return empty policy object
    } // End API check
    try { // Catch browser storage read errors
      const result = await chrome.storage.managed.get(null); // Fetch all managed policy keys pushed by Google Admin Console
      if (!result || typeof result !== "object" || Array.isArray(result)) { // Ensure result is a plain object
        return { data: {} }; // Return empty object on unexpected shape
      } // End shape check
      return { data: result }; // Return managed policy keys
    } catch (err) { // Handle storage exception
      return { data: {}, error: formatErrorMessage(err) }; // Return empty object plus error detail
    } // End try/catch
  } // End readManagedPolicyRaw
  async function readLocalOverrides() { // Read local IT test-mode overrides from chrome.storage.local
    if (typeof chrome === "undefined" || !chrome.storage?.local) { // Guard when local storage API is unavailable
      return { data: null }; // Return null overrides
    } // End API check
    try { // Catch browser storage read errors
      const result = await chrome.storage.local.get(STORAGE_KEYS.LOCAL_OVERRIDES); // Fetch local override key
      const raw = result?.[STORAGE_KEYS.LOCAL_OVERRIDES]; // Extract override object
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { // Validate plain object shape
        return { data: null }; // Return null if absent or malformed
      } // End shape check
      return { data: raw }; // Return local override object
    } catch (err) { // Handle storage exception
      return { data: null, error: formatErrorMessage(err) }; // Return null plus error detail
    } // End try/catch
  } // End readLocalOverrides

  // src/shared/selectors.ts — Multi-tier CSS selectors and safety guard definitions
  var SELECTORS = { // Centralized selector registry for Google Search AI elements
    safetyGuard: { // Landmarks and heuristics that must NEVER be hidden by the DOM engine
      protectedTags: ["HTML", "BODY", "HEAD", "MAIN"], // Structural root tags that can never be hidden
      protectedSelectors: [ // Core Google Search page landmark IDs and form selectors
        "#main", // Primary Google Search outer wrapper
        "#cnt", // Search results content wrapper
        "#rcnt", // Results columns container
        "#center_col", // Main organic results column
        "#search", // Search results root container
        "#rso", // Organic search result list container
        "#botstuff", // Bottom pagination and related searches container
        "#top_nav", // Search category navigation bar (Images, Videos, News, etc.)
        'form[role="search"]', // Accessible search form landmark
        "#searchform" // Top Google search bar form
      ], // End protectedSelectors
      organicResultSelector: "a > h3, h3.LC20lb", // Selector matching standard organic Google Search result titles
      organicResultThreshold: 3, // Refuse to hide any container holding 3 or more organic results
      searchInputSelector: 'textarea[name="q"], input[name="q"]' // Primary Google search query input box
    }, // End safetyGuard
    tier1: { // Resilient semantic, ARIA, and attribute-based selectors (preferred over obfuscated classes)
      aiOverviews: { // Selectors for Google AI Overview summary boxes
        directSelectors: [ // Explicit attributes Google uses for AI Overview containers
          '[data-attrid="AIOverview"]', // Attribute ID for AI Overview
          '[data-async-type="aiOverview"]', // Async container type for AI Overview
          '[aria-label="AI Overview"]' // Accessibility label for AI Overview region
        ], // End directSelectors
        headingSelectors: ["h1", "h2", '[role="heading"]', "div.Fzsovc"], // Heading elements that may label an AI Overview block
        headingTexts: ["ai overview"], // Normalized heading text identifying an AI Overview
        containerAncestors: [ // Ancestor wrapper attributes used to hide the entire AI Overview card cleanly
          "[data-mcpr]", // Google AI Overview wrapper attribute
          "[data-attrid]", // Attribute-tagged card container
          "[data-async-type]", // Async card container
          "[data-hveid]", // Google impression-tracking card wrapper
          "div#eKIzJc" // Known AI Overview container ID
        ] // End containerAncestors
      }, // End aiOverviews
      aiModeUi: { // Selectors for Google AI Mode buttons, tabs, and prompts
        directSelectors: [ // Direct link patterns targeting AI Mode
          'a[href*="udm=50"]', // Links with Google's AI Mode parameter (udm=50)
          'a[href*="/aimode"]', // Links to /aimode route
          'a[href^="https://www.google.com/ai"]' // Links to www.google.com/ai
        ], // End directSelectors
        textCandidateSelectors: [ // Interactive elements checked for exact AI Mode text labels
          '[role="tab"]', // Search mode tab items
          '[role="listitem"] a', // Navigation listitem links
          '[role="listitem"] span', // Navigation listitem labels
          "button", // Standard HTML buttons
          "a" // Standard anchor links
        ], // End textCandidateSelectors
        exactTexts: ["ai mode", "dive deeper in ai mode", "ask ai mode"], // Normalized text strings identifying AI Mode triggers
        navItemAncestor: '[role="listitem"]' // Closest listitem wrapper to remove the entire tab slot cleanly
      }, // End aiModeUi
      auxiliaryAi: { // Selectors for Search Labs, Google Lens, follow-up bars, and AI-generated PAA cards
        directSelectors: [ // Direct attributes/URLs for auxiliary AI features
          'a[href*="labs.google.com"]', // Links to Google Search Labs
          '[aria-label*="Search Labs" i]', // Case-insensitive Search Labs trigger
          '[aria-label*="Search by image" i]', // Case-insensitive Google Lens image search trigger
          "[data-base-lens-url]", // Element carrying a Google Lens base URL
          '[aria-label*="Ask a follow up" i]', // Conversational AI follow-up button/input
          '[placeholder*="Ask a follow up" i]' // Conversational AI follow-up input placeholder
        ], // End directSelectors
        paaCardSelectors: [ // "People Also Ask" / expandable question card containers
          '[jsname="yEVEwb"]', // Google PAA item jsname
          '[data-sgrd="true"]', // Search generated card marker
          "[data-q]", // Question card attribute
          "div.related-question-pair" // Classic PAA question pair container
        ], // End paaCardSelectors
        aiAttributionMarkers: ["ai overview", "generative ai", "ai-generated"] // Labels indicating an AI-generated PAA card
      } // End auxiliaryAi
    }, // End tier1
    tier2: { // Fallback class/ID/jsname selectors for known Google DOM variants
      aiOverviews: ["#eKIzJc", "div.YzCcne[data-mcpr]", 'div[data-mcp="18"]'], // Fallback AI Overview containers
      aiModeUi: ["div.olrp5b", "button.plR5qb", 'button[jsname="B6rgad"]'], // Fallback AI Mode triggers
      auxiliaryAi: ['div[jsname="R5mgy"]'] // Fallback auxiliary AI container
    } // End tier2
  }; // End SELECTORS

  // src/content/dom-engine.ts — Safe, zero-PII DOM sweeping and element hiding engine
  var PROTECTED_TAG_SET = new Set(SELECTORS.safetyGuard.protectedTags); // Fast O(1) lookup set for protected tag names
  var PROTECTED_SELECTOR_COMBINED = SELECTORS.safetyGuard.protectedSelectors.join(", "); // Combined CSS selector for protected landmarks
  var CONTAINER_ANCESTOR_COMBINED = SELECTORS.tier1.aiOverviews.containerAncestors.join(", "); // Combined CSS selector for AI Overview card ancestors
  var OVERVIEW_HEADING_TEXT_SET = new Set(SELECTORS.tier1.aiOverviews.headingTexts); // Fast lookup set for AI Overview heading text
  var AI_MODE_EXACT_TEXT_SET = new Set(SELECTORS.tier1.aiModeUi.exactTexts); // Fast lookup set for AI Mode trigger text
  var AI_ATTRIBUTION_MARKER_SET = new Set(SELECTORS.tier1.auxiliaryAi.aiAttributionMarkers); // Fast lookup set for AI attribution badges
  function normalizeText(text) { // Collapse whitespace and lowercase text for reliable comparisons
    if (!text) { // Return empty string for null/undefined/empty input
      return ""; // Safe empty string
    } // End empty check
    return text.replace(/\s+/g, " ").trim().toLowerCase(); // Normalize whitespace and case
  } // End normalizeText
  function safeMatches(el, selector) { // Run Element.matches() without throwing on unsupported pseudo-selectors
    try { // Guard against DOMException on invalid selector syntax
      return el.matches(selector); // Test if element matches CSS selector
    } catch { // Return false if selector fails
      return false; // Safe fallback
    } // End try/catch
  } // End safeMatches
  function safeQueryAll(root, selector, errors) { // Query DOM elements safely and log selector errors without crashing
    try { // Guard against invalid selector syntax
      return Array.from(root.querySelectorAll(selector)); // Return matching elements as an array
    } catch (err) { // Record diagnostic error if a selector ever becomes invalid
      const message = err instanceof Error ? err.message : String(err); // Extract safe error message
      errors.push({ // Push selector syntax error for IT diagnostics
        code: "ERR_SELECTOR_SYNTAX", // Error code
        detail: `Selector "${selector}" failed: ${message}` // Diagnostic detail (no PII)
      }); // End error entry
      return []; // Return empty array so other selectors continue running
    } // End try/catch
  } // End safeQueryAll
  function describeElementSafe(el) { // Return a PII-free tag/id description of an element for diagnostics
    const tag = el.tagName.toLowerCase(); // Read lowercase HTML tag name
    return el.id ? `${tag}#${el.id}` : tag; // Include element ID if present, never text content or URLs
  } // End describeElementSafe
  function parseRedirectHash(hash) { // Detect telemetry marker hashes appended by declarativeNetRequest redirects
    if (hash === "#rm_sg_omnibox") { // Marker for omnibox/URL-bar udm=14 fallback redirect
      return "omnibox"; // Return omnibox redirect source
    } // End omnibox check
    if (hash === "#rm_sg_aimode") { // Marker for AI Mode URL block/redirect
      return "aimode"; // Return aimode redirect source
    } // End aimode check
    return null; // Not a Search Guard redirect marker
  } // End parseRedirectHash
  function isUnsafeToHide(el, doc) { // Organic Results Safety Guard: prevent hiding core Search UI or organic results
    if (PROTECTED_TAG_SET.has(el.tagName.toUpperCase())) { // Never hide <html>, <body>, <head>, or <main>
      return true; // Unsafe to hide
    } // End tag check
    for (const protectedSel of SELECTORS.safetyGuard.protectedSelectors) { // Check if element itself is a protected search landmark
      if (safeMatches(el, protectedSel)) { // Element matches a protected landmark
        return true; // Unsafe to hide
      } // End match check
    } // End landmark loop
    try { // Check if element wraps a protected search landmark
      if (el.querySelector(PROTECTED_SELECTOR_COMBINED) !== null) { // Element contains a core landmark
        return true; // Unsafe to hide
      } // End descendant landmark check
    } catch { // Ignore selector query errors
    } // End try/catch
    const searchInputSel = SELECTORS.safetyGuard.searchInputSelector; // Get search input selector
    if (safeMatches(el, searchInputSel)) { // Never hide the search input box itself
      return true; // Unsafe to hide
    } // End input self-check
    try { // Never hide a container that holds the search input box
      if (el.querySelector(searchInputSel) !== null) { // Element contains search input
        return true; // Unsafe to hide
      } // End input descendant check
    } catch { // Ignore selector query errors
    } // End try/catch
    const ownerDoc = doc ?? el.ownerDocument; // Resolve document reference
    if (ownerDoc) { // Check if element is an ancestor of the active search input
      const searchInput = ownerDoc.querySelector(searchInputSel); // Locate primary search input in document
      if (searchInput && el.contains(searchInput)) { // Element contains the search input
        return true; // Unsafe to hide
      } // End contains check
    } // End ownerDoc check
    try { // Check if element contains multiple organic search results
      const organicResults = el.querySelectorAll(SELECTORS.safetyGuard.organicResultSelector); // Count organic result headings inside element
      if (organicResults.length >= SELECTORS.safetyGuard.organicResultThreshold) { // Threshold (3+) protects organic results column
        return true; // Unsafe to hide
      } // End threshold check
    } catch { // Ignore selector query errors
    } // End try/catch
    return false; // Element passed all safety guard checks and is safe to hide
  } // End isUnsafeToHide
  function applyPolicyAttributes(doc, policy) { // Sync policy flags onto <html> attributes for zero-flash CSS rules
    const root = doc.documentElement; // Reference the <html> root element
    if (!root) { // Guard if documentElement is not yet available
      return; // Exit safely
    } // End root check
    if (!policy.masterEnabled) { // When master switch is off, remove all CSS guard attributes
      root.removeAttribute("data-rmsg-hide-overviews"); // Disable AI Overview CSS rules
      root.removeAttribute("data-rmsg-hide-aimode"); // Disable AI Mode UI CSS rules
      root.removeAttribute("data-rmsg-hide-aux"); // Disable auxiliary AI CSS rules
      return; // Exit early
    } // End masterEnabled check
    if (policy.hideAiOverviews) { // Sync AI Overviews attribute
      root.setAttribute("data-rmsg-hide-overviews", "1"); // Activate static-guard.css AI Overview rules
    } else { // Otherwise ensure attribute is absent
      root.removeAttribute("data-rmsg-hide-overviews"); // Deactivate AI Overview CSS rules
    } // End hideAiOverviews branch
    if (policy.hideAiModeUi) { // Sync AI Mode UI attribute
      root.setAttribute("data-rmsg-hide-aimode", "1"); // Activate static-guard.css AI Mode UI rules
    } else { // Otherwise ensure attribute is absent
      root.removeAttribute("data-rmsg-hide-aimode"); // Deactivate AI Mode UI CSS rules
    } // End hideAiModeUi branch
    if (policy.hideAuxiliaryAiFeatures) { // Sync auxiliary AI features attribute
      root.setAttribute("data-rmsg-hide-aux", "1"); // Activate static-guard.css auxiliary AI rules
    } else { // Otherwise ensure attribute is absent
      root.removeAttribute("data-rmsg-hide-aux"); // Deactivate auxiliary AI CSS rules
    } // End hideAuxiliaryAiFeatures branch
  } // End applyPolicyAttributes
  function restoreElementVisibility(el) { // Cleanly unhide an element when policy is toggled off
    el.removeAttribute("data-rmsg-hidden"); // Remove Search Guard hidden marker attribute
    const htmlEl = el; // Reference element for inline style restoration
    if (htmlEl.style) { // Check if element supports inline style manipulation
      const prevDisplay = el.getAttribute("data-rmsg-prev-display"); // Retrieve original inline display value if saved
      const prevPriority = el.getAttribute("data-rmsg-prev-display-priority") ?? ""; // Retrieve original !important priority if saved
      if (prevDisplay) { // Restore original inline display property
        htmlEl.style.setProperty("display", prevDisplay, prevPriority); // Re-apply original display style
      } else { // Otherwise remove our inline display:none override
        htmlEl.style.removeProperty("display"); // Clear inline display property
      } // End prevDisplay check
    } // End style check
    el.removeAttribute("data-rmsg-prev-display"); // Clean up saved display attribute
    el.removeAttribute("data-rmsg-prev-display-priority"); // Clean up saved priority attribute
  } // End restoreElementVisibility
  function unhideAllElements(doc) { // Restore all elements hidden by Search Guard (used when masterEnabled=false)
    const hiddenElements = doc.querySelectorAll("[data-rmsg-hidden]"); // Find all hidden elements
    for (const el of hiddenElements) { // Restore each element's original visibility
      restoreElementVisibility(el); // Unhide element
    } // End loop
  } // End unhideAllElements
  function unhideCategoryElements(doc, category) { // Restore hidden elements for a single disabled category
    const hiddenElements = doc.querySelectorAll(`[data-rmsg-hidden="${category}"]`); // Find elements hidden under this category
    for (const el of hiddenElements) { // Restore each matching element
      restoreElementVisibility(el); // Unhide element
    } // End loop
  } // End unhideCategoryElements
  function hideElement(el, category) { // Hide a vetted AI element while preserving its prior inline display state
    el.setAttribute("data-rmsg-hidden", category); // Tag element with its hidden category for CSS and unhide support
    const htmlEl = el; // Reference element for inline style manipulation
    if (htmlEl.style) { // Check if element has a style object
      const prevDisplay = htmlEl.style.getPropertyValue("display"); // Read any existing inline display value
      const prevPriority = htmlEl.style.getPropertyPriority("display"); // Read any existing inline display priority
      if (prevDisplay && prevDisplay !== "none") { // Save non-none inline display so it can be restored if unhidden
        el.setAttribute("data-rmsg-prev-display", prevDisplay); // Store prior display value
        if (prevPriority) { // Store prior !important priority if present
          el.setAttribute("data-rmsg-prev-display-priority", prevPriority); // Store prior priority
        } // End priority check
      } // End prevDisplay check
      htmlEl.style.setProperty("display", "none", "important"); // Force element hidden immediately
    } // End style check
  } // End hideElement
  function isAlreadyHidden(el) { // Check if element or any ancestor is already hidden by Search Guard
    if (el.hasAttribute("data-rmsg-hidden")) { // Element itself is already marked hidden
      return true; // Skip duplicate work
    } // End self check
    return Boolean(el.parentElement?.closest("[data-rmsg-hidden]")); // Check if an ancestor is already hidden
  } // End isAlreadyHidden
  function processCategoryCandidates(candidates, category, doc, errors, reportedUnsafe) { // Vet, deduplicate, and hide candidate elements
    const uniqueCandidates = Array.from(new Set(candidates)); // Deduplicate candidate element references
    const safeCandidates = []; // Collect candidates that pass the Organic Results Safety Guard
    for (const candidate of uniqueCandidates) { // Evaluate each unique candidate
      if (isAlreadyHidden(candidate)) { // Skip elements already hidden
        continue; // Move to next candidate
      } // End already-hidden check
      if (isUnsafeToHide(candidate, doc)) { // Run Organic Results Safety Guard check
        if (!reportedUnsafe.has(candidate)) { // Deduplicate diagnostic reports per element per sweep
          reportedUnsafe.add(candidate); // Mark element as reported
          errors.push({ // Log safety guard trip for IT visibility
            code: "ERR_SAFETY_GUARD_TRIPPED", // Diagnostic code
            detail: `Refused to hide protected element ${describeElementSafe(candidate)} (${category})` // Safe tag/ID detail
          }); // End error entry
        } // End reportedUnsafe check
        continue; // Never hide protected element
      } // End safety guard check
      safeCandidates.push(candidate); // Add vetted candidate
    } // End candidate loop
    const topLevelCandidates = safeCandidates.filter( // Filter out nested descendants when an ancestor is already in safeCandidates
      (candidate) => !safeCandidates.some((other) => other !== candidate && other.contains(candidate)) // Keep only outermost containers
    ); // End filter
    let newlyHiddenCount = 0; // Count newly hidden top-level elements for aggregate telemetry
    for (const el of topLevelCandidates) { // Hide each top-level vetted element
      if (isAlreadyHidden(el)) { // Double-check element was not hidden by a sibling pass
        continue; // Skip
      } // End already-hidden check
      hideElement(el, category); // Hide element cleanly
      newlyHiddenCount += 1; // Increment counter
    } // End hiding loop
    return newlyHiddenCount; // Return count of newly hidden elements
  } // End processCategoryCandidates
  function findOverviewHeadingContainer(headingEl, doc) { // Walk up from an "AI Overview" heading to find its card container
    let cursor = headingEl.parentElement; // Start at immediate parent element
    while (cursor) { // Walk up the DOM tree
      if (safeMatches(cursor, CONTAINER_ANCESTOR_COMBINED)) { // Stop at known Google AI Overview card wrapper
        return cursor; // Return card container
      } // End ancestor match check
      if (isUnsafeToHide(cursor, doc)) { // Stop before reaching any protected Search landmark
        if (cursor === headingEl.parentElement) { // If immediate parent is already protected, return it for safety guard rejection
          return cursor; // Return cursor
        } // End immediate parent check
        break; // Stop walking up
      } // End safety check
      cursor = cursor.parentElement; // Move one level up
    } // End while loop
    if (headingEl.parentElement && !isUnsafeToHide(headingEl.parentElement, doc)) { // Fall back to safe immediate parent
      return headingEl.parentElement; // Return immediate parent
    } // End parent fallback
    return headingEl; // Fall back to heading element itself
  } // End findOverviewHeadingContainer
  function collectAiOverviewCandidates(doc, errors) { // Gather all potential AI Overview DOM elements across Tier 1 and Tier 2 selectors
    const candidates = []; // Accumulate candidate elements
    for (const selector of SELECTORS.tier1.aiOverviews.directSelectors) { // Query Tier 1 direct AI Overview selectors
      candidates.push(...safeQueryAll(doc, selector, errors)); // Append matches
    } // End Tier 1 direct loop
    const headingSelector = SELECTORS.tier1.aiOverviews.headingSelectors.join(", "); // Combine heading selectors
    for (const headingEl of safeQueryAll(doc, headingSelector, errors)) { // Scan headings for "AI Overview" label
      if (OVERVIEW_HEADING_TEXT_SET.has(normalizeText(headingEl.textContent))) { // Match exact normalized heading text
        candidates.push(findOverviewHeadingContainer(headingEl, doc)); // Resolve enclosing card container
      } // End heading text match
    } // End heading loop
    for (const selector of SELECTORS.tier2.aiOverviews) { // Query Tier 2 fallback selectors
      candidates.push(...safeQueryAll(doc, selector, errors)); // Append matches
    } // End Tier 2 loop
    return candidates; // Return all AI Overview candidates
  } // End collectAiOverviewCandidates
  function promoteAiModeTarget(el, doc) { // Promote an AI Mode link/span to its enclosing nav tab slot when safe
    const navItem = el.closest(SELECTORS.tier1.aiModeUi.navItemAncestor); // Check if inside a Google Search nav listitem
    if (navItem && !isUnsafeToHide(navItem, doc)) { // Hide the full nav slot so no empty gap remains
      return navItem; // Return listitem ancestor
    } // End navItem check
    if (el.tagName.toUpperCase() === "SPAN") { // If matched a text <span>, promote to its interactive button/link wrapper
      const interactiveAncestor = el.closest('a, button, [role="tab"], [role="button"]'); // Find enclosing clickable element
      if (interactiveAncestor && !isUnsafeToHide(interactiveAncestor, doc)) { // Ensure wrapper is safe to hide
        return interactiveAncestor; // Return interactive wrapper
      } // End interactiveAncestor check
    } // End SPAN check
    return el; // Return original element if no safe promotion applies
  } // End promoteAiModeTarget
  function collectAiModeUiCandidates(doc, errors) { // Gather all AI Mode button, tab, and prompt candidates
    const candidates = []; // Accumulate candidate elements
    const directSelectors = [ // Combine Tier 1 AI Mode link selectors with bare google.com/ai prefix
      ...SELECTORS.tier1.aiModeUi.directSelectors, // Spread configured direct selectors
      'a[href^="https://google.com/ai"]' // Also match non-www google.com/ai links
    ]; // End directSelectors
    for (const selector of directSelectors) { // Query direct AI Mode link selectors
      for (const el of safeQueryAll(doc, selector, errors)) { // Iterate matched elements
        candidates.push(promoteAiModeTarget(el, doc)); // Promote to tab/button wrapper and add
      } // End inner loop
    } // End directSelectors loop
    const textSelector = [ // Build combined selector for text-based AI Mode triggers
      ...SELECTORS.tier1.aiModeUi.textCandidateSelectors, // Spread configured text candidate selectors
      '[role="button"]' // Include ARIA role="button" elements
    ].join(", "); // Join into a single CSS selector list
    for (const el of safeQueryAll(doc, textSelector, errors)) { // Scan interactive elements for AI Mode labels
      if (AI_MODE_EXACT_TEXT_SET.has(normalizeText(el.textContent))) { // Match exact normalized label text
        candidates.push(promoteAiModeTarget(el, doc)); // Promote and add candidate
      } // End text match check
    } // End textSelector loop
    for (const selector of SELECTORS.tier2.aiModeUi) { // Query Tier 2 fallback selectors
      candidates.push(...safeQueryAll(doc, selector, errors)); // Append fallback matches
    } // End Tier 2 loop
    return candidates; // Return all AI Mode UI candidates
  } // End collectAiModeUiCandidates
  function hasAiAttributionBadge(card) { // Check whether a People Also Ask card carries an AI attribution badge
    const ariaLabel = normalizeText(card.getAttribute("aria-label")); // Check card's own aria-label
    if (ariaLabel && AI_ATTRIBUTION_MARKER_SET.has(ariaLabel)) { // Match against known AI attribution strings
      return true; // Card is AI-attributed
    } // End card aria-label check
    const labelNodes = card.querySelectorAll('span, div, p, [role="heading"], h3, h4'); // Inspect descendant text/label nodes
    for (const node of labelNodes) { // Iterate descendant nodes
      const nodeAria = normalizeText(node.getAttribute("aria-label")); // Check descendant aria-label
      if (nodeAria && AI_ATTRIBUTION_MARKER_SET.has(nodeAria)) { // Match AI attribution marker
        return true; // Card is AI-attributed
      } // End node aria-label check
      if (node.children.length === 0) { // Only inspect leaf text nodes to avoid matching huge subtrees
        const text = normalizeText(node.textContent); // Normalize leaf text
        if (AI_ATTRIBUTION_MARKER_SET.has(text)) { // Match exact AI attribution label
          return true; // Card is AI-attributed
        } // End leaf text match
      } // End leaf node check
    } // End descendant loop
    return false; // No AI attribution badge found
  } // End hasAiAttributionBadge
  function collectAuxAiCandidates(doc, errors) { // Gather auxiliary AI UI elements (Search Labs, Lens, follow-ups, AI PAA cards)
    const candidates = []; // Accumulate candidate elements
    for (const selector of SELECTORS.tier1.auxiliaryAi.directSelectors) { // Query Tier 1 auxiliary AI selectors
      candidates.push(...safeQueryAll(doc, selector, errors)); // Append matches
    } // End directSelectors loop
    for (const selector of SELECTORS.tier1.auxiliaryAi.paaCardSelectors) { // Query People Also Ask cards
      for (const card of safeQueryAll(doc, selector, errors)) { // Inspect each PAA card
        if (hasAiAttributionBadge(card)) { // Only hide PAA cards that are explicitly AI-generated
          candidates.push(card); // Add AI-generated PAA card
        } // End attribution check
      } // End card loop
    } // End paaCardSelectors loop
    for (const selector of SELECTORS.tier2.auxiliaryAi) { // Query Tier 2 fallback auxiliary AI selectors
      candidates.push(...safeQueryAll(doc, selector, errors)); // Append matches
    } // End Tier 2 loop
    return candidates; // Return all auxiliary AI candidates
  } // End collectAuxAiCandidates
  function sweepDom(doc, policy, seenOverviewUrls, pageKey) { // Execute one full DOM protection sweep under the active policy
    const deltas = {}; // Aggregate metric increments produced by this sweep
    const errors = []; // Diagnostic errors produced by this sweep
    if (!policy.masterEnabled) { // Do nothing if master switch is disabled
      return { deltas, errors }; // Return empty results
    } // End masterEnabled check
    const resolvedPageKey = pageKey ?? (doc.location && doc.location.href ? doc.location.href : "default"); // Resolve opaque page key for per-page overview deduplication
    const reportedUnsafe = /* @__PURE__ */ new Set(); // Track elements that tripped the safety guard in this sweep
    if (policy.hideAiOverviews) { // Run AI Overviews hiding if enabled by policy
      const overviewCandidates = collectAiOverviewCandidates(doc, errors); // Collect AI Overview candidates
      const hiddenOverviews = processCategoryCandidates( // Vet and hide safe AI Overview candidates
        overviewCandidates, // Candidate elements
        "overview", // Category tag
        doc, // Document reference
        errors, // Diagnostic error array
        reportedUnsafe // Deduplication set
      ); // End processCategoryCandidates
      if (hiddenOverviews > 0 && !seenOverviewUrls.has(resolvedPageKey)) { // Count at most one AI Overview hidden per page load
        seenOverviewUrls.add(resolvedPageKey); // Mark this opaque page key as counted
        deltas.overviewsHidden = 1; // Increment overviewsHidden metric by 1
      } // End deduplicated metric check
    } // End hideAiOverviews branch
    if (policy.hideAiModeUi) { // Run AI Mode UI hiding if enabled by policy
      const aiModeCandidates = collectAiModeUiCandidates(doc, errors); // Collect AI Mode UI candidates
      const hiddenAiMode = processCategoryCandidates( // Vet and hide safe AI Mode UI candidates
        aiModeCandidates, // Candidate elements
        "aimode", // Category tag
        doc, // Document reference
        errors, // Diagnostic error array
        reportedUnsafe // Deduplication set
      ); // End processCategoryCandidates
      if (hiddenAiMode > 0) { // Record count if any new AI Mode UI elements were hidden
        deltas.aiModeUiHidden = hiddenAiMode; // Set aiModeUiHidden delta
      } // End hiddenAiMode check
    } // End hideAiModeUi branch
    if (policy.hideAuxiliaryAiFeatures) { // Run auxiliary AI hiding if enabled by policy
      const auxCandidates = collectAuxAiCandidates(doc, errors); // Collect auxiliary AI candidates
      const hiddenAux = processCategoryCandidates( // Vet and hide safe auxiliary AI candidates
        auxCandidates, // Candidate elements
        "aux", // Category tag
        doc, // Document reference
        errors, // Diagnostic error array
        reportedUnsafe // Deduplication set
      ); // End processCategoryCandidates
      if (hiddenAux > 0) { // Record count if any new auxiliary AI elements were hidden
        deltas.auxAiHidden = hiddenAux; // Set auxAiHidden delta
      } // End hiddenAux check
    } // End hideAuxiliaryAiFeatures branch
    return { deltas, errors }; // Return aggregate metric deltas and diagnostic errors
  } // End sweepDom

  // src/content/content.ts — Content script lifecycle, MutationObserver, and background messaging
  async function sendRuntimeMessage(message) { // Safely send a message to the extension background service worker
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) { // Guard when extension runtime API is unavailable
      return null; // Return null
    } // End runtime check
    try { // Catch transient service worker wake/disconnect errors
      return await chrome.runtime.sendMessage(message); // Await response from service-worker.js
    } catch { // Ignore disconnected port errors
      return null; // Return null safely
    } // End try/catch
  } // End sendRuntimeMessage
  function computeOpaquePageKey() { // Compute a non-reversible FNV-1a hash of path+query for per-page deduplication (zero PII)
    const input = `${window.location.pathname}${window.location.search}`; // Read path and query string locally in memory only
    let hash = 2166136261; // Initialize 32-bit FNV-1a offset basis
    for (let i = 0; i < input.length; i += 1) { // Hash each character code
      hash ^= input.charCodeAt(i); // XOR with character code
      hash = Math.imul(hash, 16777619); // Multiply by 32-bit FNV prime
    } // End hash loop
    return `p-${(hash >>> 0).toString(16)}`; // Return opaque hexadecimal page key (never leaves browser)
  } // End computeOpaquePageKey
  function handleRedirectHashTelemetry() { // Detect and strip redirect telemetry hashes (#rm_sg_omnibox / #rm_sg_aimode)
    const redirectSource = parseRedirectHash(window.location.hash); // Parse current URL hash
    if (redirectSource === null) { // Exit if URL does not carry a Search Guard redirect marker
      return; // Nothing to record
    } // End null check
    try { // Cleanly remove the marker hash from the address bar without reloading
      window.history.replaceState( // Replace current history entry
        null, // Preserve state object
        "", // Unused title parameter
        `${window.location.pathname}${window.location.search}` // Keep original path and query without hash
      ); // End replaceState
    } catch { // Ignore history API restrictions if any
    } // End try/catch
    void sendRuntimeMessage({ type: "RECORD_REDIRECT", source: redirectSource }); // Notify service worker to increment aggregate redirect counter
  } // End handleRedirectHashTelemetry
  handleRedirectHashTelemetry(); // Check immediately at document_start if this load came from a Search Guard redirect
  var currentPolicy = null; // Holds the active resolved policy for this tab
  var bodyObserver = null; // MutationObserver watching document.body for dynamically injected AI elements
  var rootObserver = null; // Temporary MutationObserver waiting for document.body to exist at document_start
  var pendingRaf = false; // Debounce flag coalescing DOM mutations into one requestAnimationFrame sweep
  var seenOverviewPages = /* @__PURE__ */ new Set(); // Tracks opaque page keys where an AI Overview was already counted
  var reportedErrorKeys = /* @__PURE__ */ new Set(); // Deduplicates diagnostic error messages per page
  function disconnectObservers() { // Stop all DOM observers when masterEnabled is turned off
    if (bodyObserver) { // Disconnect body MutationObserver if active
      bodyObserver.disconnect(); // Stop observing mutations
      bodyObserver = null; // Clear reference
    } // End bodyObserver check
    if (rootObserver) { // Disconnect root MutationObserver if active
      rootObserver.disconnect(); // Stop observing mutations
      rootObserver = null; // Clear reference
    } // End rootObserver check
    pendingRaf = false; // Reset pending animation frame flag
  } // End disconnectObservers
  function runSweepNow() { // Perform an immediate DOM sweep and report any aggregate metric deltas/diagnostics
    if (!currentPolicy || !currentPolicy.masterEnabled) { // Skip if policy is not loaded or master switch is off
      return; // Exit
    } // End guard
    const pageKey = computeOpaquePageKey(); // Compute opaque non-PII key for current page
    const { deltas, errors } = sweepDom(document, currentPolicy, seenOverviewPages, pageKey); // Run DOM sweep
    if (Object.keys(deltas).length > 0) { // Send aggregate counts if any new elements were hidden
      void sendRuntimeMessage({ type: "INCREMENT_METRICS", deltas }); // Report aggregate counts to background worker
    } // End deltas check
    for (const err of errors) { // Forward any new diagnostic errors to background worker
      const dedupeKey = `${pageKey}:${err.code}:${err.detail}`; // Build deduplication key
      if (!reportedErrorKeys.has(dedupeKey)) { // Only send each unique error once per page
        reportedErrorKeys.add(dedupeKey); // Mark as reported
        void sendRuntimeMessage({ // Send diagnostic log message
          type: "LOG_DIAGNOSTIC", // Message type
          code: err.code, // Diagnostic code
          detail: err.detail // Sanitized detail
        }); // End sendRuntimeMessage
      } // End dedupe check
    } // End error loop
  } // End runSweepNow
  function scheduleSweep() { // Schedule a debounced DOM sweep on the next animation frame
    if (pendingRaf || !currentPolicy || !currentPolicy.masterEnabled) { // Skip if already scheduled or disabled
      return; // Exit
    } // End guard
    pendingRaf = true; // Mark frame as pending
    window.requestAnimationFrame(() => { // Run before next browser repaint
      pendingRaf = false; // Clear pending flag
      runSweepNow(); // Execute DOM sweep
    }); // End requestAnimationFrame
  } // End scheduleSweep
  function attachMutationObserver() { // Attach MutationObserver to catch Google Search SPA / lazy-loaded AI elements
    if (!currentPolicy || !currentPolicy.masterEnabled) { // Do not observe when master switch is disabled
      return; // Exit
    } // End guard
    if (document.body) { // Once <body> exists, observe its entire subtree
      if (rootObserver) { // Clean up temporary <html> observer
        rootObserver.disconnect(); // Stop root observer
        rootObserver = null; // Clear reference
      } // End rootObserver cleanup
      if (!bodyObserver) { // Create body observer if not already attached
        bodyObserver = new MutationObserver(() => { // Trigger debounced sweep on DOM insertions
          scheduleSweep(); // Schedule sweep
        }); // End MutationObserver
        bodyObserver.observe(document.body, { // Watch for added/removed child nodes anywhere in <body>
          childList: true, // Observe direct and nested child list changes
          subtree: true // Observe full subtree
        }); // End observe call
      } // End bodyObserver creation
      return; // Done attaching body observer
    } // End document.body check
    if (!rootObserver && document.documentElement) { // At document_start before <body> exists, watch <html> for <body> creation
      rootObserver = new MutationObserver(() => { // Check each root child mutation
        if (document.body) { // As soon as <body> appears
          attachMutationObserver(); // Upgrade to bodyObserver
          scheduleSweep(); // Run initial sweep
        } // End body check
      }); // End root MutationObserver
      rootObserver.observe(document.documentElement, { childList: true }); // Watch direct children of <html>
    } // End rootObserver check
  } // End attachMutationObserver
  function applyEffectivePolicy(policy) { // Apply policy to static CSS attributes, hidden elements, and observers
    currentPolicy = policy; // Store active policy
    applyPolicyAttributes(document, policy); // Toggle html[data-rmsg-*] attributes for static-guard.css
    if (!policy.masterEnabled) { // If master switch is disabled, restore unmodified Google Search
      disconnectObservers(); // Stop MutationObservers
      unhideAllElements(document); // Unhide all previously hidden elements
      return; // Exit early
    } // End masterEnabled check
    if (!policy.hideAiOverviews) { // If AI Overviews hiding was turned off, restore hidden overview elements
      unhideCategoryElements(document, "overview"); // Unhide overview category
    } // End hideAiOverviews check
    if (!policy.hideAiModeUi) { // If AI Mode UI hiding was turned off, restore hidden AI Mode elements
      unhideCategoryElements(document, "aimode"); // Unhide aimode category
    } // End hideAiModeUi check
    if (!policy.hideAuxiliaryAiFeatures) { // If auxiliary AI hiding was turned off, restore hidden auxiliary elements
      unhideCategoryElements(document, "aux"); // Unhide aux category
    } // End hideAuxiliaryAiFeatures check
    attachMutationObserver(); // Ensure MutationObserver is active
    scheduleSweep(); // Schedule DOM sweep under updated policy
  } // End applyEffectivePolicy
  async function loadEffectivePolicy() { // Fetch effective policy from service worker or directly from storage fallback
    const fromSw = await sendRuntimeMessage({ // Prefer cached policy from background service worker
      type: "GET_EFFECTIVE_POLICY" // Policy query message
    }); // End sendRuntimeMessage
    if (fromSw && typeof fromSw.masterEnabled === "boolean") { // Validate response shape
      return fromSw; // Return service worker policy
    } // End fromSw check
    const [managedRes, localRes] = await Promise.all([ // Fallback: read storage directly if service worker is waking
      readManagedPolicyRaw(), // Read Google Admin managed policy
      readLocalOverrides() // Read local test overrides
    ]); // End Promise.all
    return parsePolicy(managedRes.data, localRes.data).policy; // Parse and return policy
  } // End loadEffectivePolicy
  async function bootstrapContentGuard() { // Initialize Search Guard on the current Google Search page
    const policy = await loadEffectivePolicy(); // Load effective policy
    applyEffectivePolicy(policy); // Apply CSS attributes, observers, and sweep
    if (policy.masterEnabled && document.readyState !== "loading") { // If DOM is already parsed, sweep synchronously too
      runSweepNow(); // Run immediate sweep
    } // End readyState check
  } // End bootstrapContentGuard
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) { // React live when Admin policy or local overrides change
    chrome.storage.onChanged.addListener(async (changes, areaName) => { // Listen for storage updates
      if (areaName === "managed" || areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) { // Filter relevant policy changes
        const policy = await loadEffectivePolicy(); // Reload effective policy
        applyEffectivePolicy(policy); // Re-apply immediately to open tabs
      } // End relevance check
    }); // End storage listener
  } // End chrome.storage check
  window.addEventListener("DOMContentLoaded", () => { // Run sweep once initial HTML document is parsed
    if (currentPolicy?.masterEnabled) { // Only when master switch is enabled
      attachMutationObserver(); // Ensure bodyObserver is attached
      runSweepNow(); // Sweep initial DOM
    } // End masterEnabled check
  }); // End DOMContentLoaded listener
  window.addEventListener("load", () => { // Schedule a follow-up sweep after subresources finish loading
    if (currentPolicy?.masterEnabled) { // Only when master switch is enabled
      scheduleSweep(); // Schedule sweep
    } // End masterEnabled check
  }); // End load listener
  window.addEventListener("hashchange", () => { // Detect client-side hash updates from redirects
    handleRedirectHashTelemetry(); // Parse and clean any Search Guard telemetry hash
  }); // End hashchange listener
  void bootstrapContentGuard(); // Kick off content guard immediately at document_start
})(); // End IIFE
