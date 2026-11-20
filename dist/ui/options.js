// src/shared/defaults.ts — Default policy constants, K-12 presets, and storage keys
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
  analyticsEndpointUrl: "", // No default remote endpoint; must be explicitly configured by district IT
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
var GRADE_BAND_PRESETS = { // Recommended K-12 OU policy presets for the 4-Band Admin Policy Generator
  "K-2": { // Grades K-2 preset: strictest lockdown
    label: "Grades K\u20132", // Display label
    subtitle: "Maximum Protection", // Preset summary
    toggles: { // All 6 protections enabled
      masterEnabled: true, // Protection active
      hideAiOverviews: true, // Hide AI Overviews
      hideAiModeUi: true, // Hide AI Mode UI
      blockAiModeNavigation: true, // Block AI Mode URLs
      forceWebOnlySearch: true, // Force Web-only (udm=14) search
      hideAuxiliaryAiFeatures: true // Hide auxiliary AI features
    } // End K-2 toggles
  }, // End K-2 preset
  "3-5": { // Grades 3-5 preset: strict elementary research
    label: "Grades 3\u20135", // Display label
    subtitle: "Elementary Research", // Preset summary
    toggles: { // All 6 protections enabled
      masterEnabled: true, // Protection active
      hideAiOverviews: true, // Hide AI Overviews
      hideAiModeUi: true, // Hide AI Mode UI
      blockAiModeNavigation: true, // Block AI Mode URLs
      forceWebOnlySearch: true, // Force Web-only (udm=14) search
      hideAuxiliaryAiFeatures: true // Hide auxiliary AI features
    } // End 3-5 toggles
  }, // End 3-5 preset
  "6-8": { // Grades 6-8 preset: hide AI Overviews & AI Mode while keeping Calculator/Knowledge Panels
    label: "Grades 6\u20138", // Display label
    subtitle: "Middle School Standard Search", // Preset summary
    toggles: { // 5 protections enabled; udm=14 off to preserve Knowledge Panels/Calculator
      masterEnabled: true, // Protection active
      hideAiOverviews: true, // Hide AI Overviews
      hideAiModeUi: true, // Hide AI Mode UI
      blockAiModeNavigation: true, // Block AI Mode URLs
      forceWebOnlySearch: false, // Keep Knowledge Panels, Calculator, and Dictionary
      hideAuxiliaryAiFeatures: true // Hide auxiliary AI features
    } // End 6-8 toggles
  }, // End 6-8 preset
  "9-12": { // Grades 9-12 preset: block AI Mode chat while allowing AI Overviews for guided literacy
    label: "Grades 9\u201312", // Display label
    subtitle: "High School Guided AI Literacy", // Preset summary
    toggles: { // Block AI Mode UI and URLs; allow standard search & Overviews
      masterEnabled: true, // Protection active
      hideAiOverviews: false, // Allow AI Overviews for high school media literacy
      hideAiModeUi: true, // Hide AI Mode buttons and tabs
      blockAiModeNavigation: true, // Block direct AI Mode URLs
      forceWebOnlySearch: false, // Keep standard search features
      hideAuxiliaryAiFeatures: false // Allow auxiliary features
    } // End 9-12 toggles
  }, // End 9-12 preset
  Staff: { // Staff/Faculty OU preset: master switch off (extension stays installed but inactive)
    label: "Staff / Faculty", // Display label
    subtitle: "Unrestricted (Master Switch Off)", // Preset summary
    toggles: { // All protections off for faculty
      masterEnabled: false, // Master switch off
      hideAiOverviews: false, // Overviews allowed
      hideAiModeUi: false, // AI Mode UI allowed
      blockAiModeNavigation: false, // AI Mode URLs allowed
      forceWebOnlySearch: false, // Standard search allowed
      hideAuxiliaryAiFeatures: false // Auxiliary features allowed
    } // End Staff toggles
  } // End Staff preset
}; // End GRADE_BAND_PRESETS
var APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/; // Strict allowlist regex permitting only deployed Google Apps Script /exec URLs
var STORAGE_KEYS = { // Keys used in chrome.storage.local
  LOCAL_OVERRIDES: "rmsg_local_overrides", // Stores unmanaged local test-mode settings
  TELEMETRY: "rmsg_telemetry", // Stores aggregate metrics and diagnostic logs
  LAST_POLICY: "rmsg_last_policy" // Caches the most recently evaluated policy snapshot
}; // End STORAGE_KEYS
var MIN_FLUSH_INTERVAL_MINUTES = 60; // Minimum allowed telemetry flush interval (1 hour)
var MAX_FLUSH_INTERVAL_MINUTES = 1440; // Maximum allowed telemetry flush interval (24 hours)
function createEmptyMetrics() { // Construct a zeroed aggregate metrics object
  return { // Return fresh counter object
    overviewsHidden: 0, // Zero AI Overviews hidden
    aiModeUiHidden: 0, // Zero AI Mode UI elements hidden
    aiModeRedirects: 0, // Zero AI Mode redirects
    omniboxFallbackRedirects: 0, // Zero Omnibox fallback redirects
    auxAiHidden: 0 // Zero auxiliary AI elements hidden
  }; // End empty metrics object
} // End createEmptyMetrics
function createInitialTelemetryState() { // Construct a fresh telemetry state object for fallback UI rendering
  return { // Return initial telemetry state
    lifetimeMetrics: createEmptyMetrics(), // Zeroed lifetime counters
    pendingMetricsByDate: {}, // Empty pending daily buckets
    pendingErrorsByCode: {}, // Empty pending error counts
    diagnosticLog: [], // Empty diagnostic log
    lastFlushAttemptDate: null, // No flush attempted
    lastFlushSuccessDate: null, // No flush succeeded
    lastFlushStatus: "idle", // Idle flush status
    lastFlushMessage: "Analytics disabled (local-only mode).", // Default status message
    consecutiveFlushFailures: 0, // Zero consecutive failures
    nextEligibleFlushAtMs: 0 // No backoff delay
  }; // End initial telemetry state
} // End createInitialTelemetryState

// src/shared/errors.ts — Date bucket helper
function getTodayDateBucket(now = /* @__PURE__ */ new Date()) { // Return UTC date string (YYYY-MM-DD)
  return now.toISOString().slice(0, 10); // Extract YYYY-MM-DD prefix from ISO timestamp
} // End getTodayDateBucket

// src/shared/policy.ts — Enterprise policy validation, resolution, and Admin Console JSON formatting
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
function formatAdminConsolePolicyJson(config) { // Format policy config into Google Admin Console { "Value": ... } schema structure
  const result = { // Build base policy JSON object
    gradeBand: { Value: config.gradeBand }, // Grade band label
    masterEnabled: { Value: Boolean(config.masterEnabled) }, // Master switch
    hideAiOverviews: { Value: Boolean(config.hideAiOverviews) }, // Hide AI Overviews toggle
    hideAiModeUi: { Value: Boolean(config.hideAiModeUi) }, // Hide AI Mode UI toggle
    blockAiModeNavigation: { Value: Boolean(config.blockAiModeNavigation) }, // Block AI Mode URLs toggle
    forceWebOnlySearch: { Value: Boolean(config.forceWebOnlySearch) }, // Force udm=14 toggle
    hideAuxiliaryAiFeatures: { Value: Boolean(config.hideAuxiliaryAiFeatures) }, // Hide auxiliary AI toggle
    analyticsEnabled: { Value: Boolean(config.analyticsEnabled) } // Analytics opt-in flag
  }; // End base result
  if (config.analyticsEnabled) { // Include analytics fields only when analytics is enabled
    const trimmedUrl = (config.analyticsEndpointUrl ?? "").trim(); // Trim endpoint URL
    result.analyticsEndpointUrl = { Value: trimmedUrl }; // Set endpoint URL
    const trimmedToken = (config.analyticsSharedToken ?? "").trim(); // Trim optional token
    if (trimmedToken.length > 0) { // Omit token field if blank
      result.analyticsSharedToken = { Value: trimmedToken }; // Set shared token
    } // End token check
    const interval = config.analyticsFlushIntervalMinutes; // Read flush interval
    const validInterval = typeof interval === "number" && Number.isInteger(interval) && interval >= MIN_FLUSH_INTERVAL_MINUTES && interval <= MAX_FLUSH_INTERVAL_MINUTES ? interval : DEFAULT_ANALYTICS_POLICY.analyticsFlushIntervalMinutes; // Validate or default interval
    result.analyticsFlushIntervalMinutes = { Value: validInterval }; // Set flush interval
  } // End analyticsEnabled check
  return result; // Return Google Admin Console JSON object
} // End formatAdminConsolePolicyJson
function validatePolicyDraft(config) { // Validate a generator draft before copying/downloading Admin Console JSON
  const errors = []; // Collect human-readable validation warnings
  if (!isValidGradeBand(config.gradeBand)) { // Validate gradeBand
    errors.push(`Invalid grade band "${String(config.gradeBand)}".`); // Record gradeBand error
  } // End gradeBand check
  if (config.analyticsEnabled) { // Validate analytics settings when enabled
    const trimmedUrl = (config.analyticsEndpointUrl ?? "").trim(); // Trim URL
    if (!trimmedUrl) { // Require non-empty URL
      errors.push("District Google Apps Script Web App URL is required when analytics is enabled."); // Record missing URL error
    } else if (!isValidAppsScriptUrl(trimmedUrl)) { // Require valid Apps Script /exec URL format
      errors.push( // Record invalid URL error
        "Analytics Endpoint URL must match https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" // Expected format
      ); // End push
    } // End URL check
    if (config.analyticsFlushIntervalMinutes !== void 0) { // Validate flush interval range if provided
      const interval = config.analyticsFlushIntervalMinutes; // Read interval
      if (typeof interval !== "number" || !Number.isInteger(interval) || interval < MIN_FLUSH_INTERVAL_MINUTES || interval > MAX_FLUSH_INTERVAL_MINUTES) { // Enforce [60, 1440] integer
        errors.push( // Record interval error
          `Analytics flush interval must be a whole number between ${MIN_FLUSH_INTERVAL_MINUTES} and ${MAX_FLUSH_INTERVAL_MINUTES} minutes.` // Expected range
        ); // End push
      } // End range check
    } // End interval presence check
  } // End analyticsEnabled check
  return { valid: errors.length === 0, errors }; // Return validation result
} // End validatePolicyDraft

// src/ui/policy-generator-core.ts — 4-Band Google Admin Console JSON Generator UI
var PRIMARY_BANDS = ["K-2", "3-5", "6-8", "9-12"]; // Four core student K-12 grade bands
var ALL_BANDS = ["K-2", "3-5", "6-8", "9-12", "Staff"]; // All bands including optional Staff OU card
var TOGGLE_LABELS = { // Human-readable labels for the 6 policy switches in each band card
  masterEnabled: "Master Protection Switch", // Label for masterEnabled
  hideAiOverviews: "Hide AI Overviews", // Label for hideAiOverviews
  hideAiModeUi: "Hide AI Mode Buttons & Tabs", // Label for hideAiModeUi
  blockAiModeNavigation: "Block & Redirect AI Mode URLs", // Label for blockAiModeNavigation
  forceWebOnlySearch: "Force Web-Only Search (udm=14)", // Label for forceWebOnlySearch
  hideAuxiliaryAiFeatures: "Hide Auxiliary AI (Labs / Lens / Follow-Ups)" // Label for hideAuxiliaryAiFeatures
}; // End TOGGLE_LABELS
var mountInstanceCounter = 0; // Counter ensuring unique DOM IDs if generator is mounted multiple times
function createDefaultBandStates() { // Clone recommended K-12 presets into mutable per-band state
  return { // Return fresh band state map
    "K-2": { ...GRADE_BAND_PRESETS["K-2"].toggles }, // Clone K-2 preset
    "3-5": { ...GRADE_BAND_PRESETS["3-5"].toggles }, // Clone 3-5 preset
    "6-8": { ...GRADE_BAND_PRESETS["6-8"].toggles }, // Clone 6-8 preset
    "9-12": { ...GRADE_BAND_PRESETS["9-12"].toggles }, // Clone 9-12 preset
    Staff: { ...GRADE_BAND_PRESETS.Staff.toggles } // Clone Staff preset
  }; // End band state map
} // End createDefaultBandStates
function buildBandAdminJsonString(gradeBand, toggles, analytics) { // Serialize one grade band's settings into formatted Admin Console JSON
  const payload = formatAdminConsolePolicyJson({ // Format with Google Admin Console { Value } wrappers
    gradeBand, // OU grade band
    ...toggles, // 6 feature toggles
    analyticsEnabled: analytics.analyticsEnabled, // Shared analytics opt-in
    analyticsEndpointUrl: analytics.analyticsEndpointUrl, // Shared Apps Script URL
    analyticsSharedToken: analytics.analyticsSharedToken, // Shared anti-spam token
    analyticsFlushIntervalMinutes: analytics.analyticsFlushIntervalMinutes // Shared flush interval
  }); // End formatAdminConsolePolicyJson
  return JSON.stringify(payload, null, 2); // Pretty-print with 2-space indentation
} // End buildBandAdminJsonString
async function copyTextToClipboard(text) { // Copy text using Clipboard API with execCommand fallback
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) { // Prefer modern async Clipboard API
    try { // Guard against permission errors
      await navigator.clipboard.writeText(text); // Write text to clipboard
      return true; // Success
    } catch { // Fall through to legacy textarea fallback
    } // End try/catch
  } // End navigator.clipboard check
  if (typeof document === "undefined" || !document.body) { // Guard in non-DOM test environments
    return false; // Cannot copy
  } // End document check
  const textarea = document.createElement("textarea"); // Create temporary offscreen textarea
  textarea.value = text; // Populate text
  textarea.setAttribute("readonly", "true"); // Prevent mobile keyboard popup
  textarea.className = "visually-hidden"; // Hide visually from layout
  document.body.append(textarea); // Attach to DOM so selection works
  textarea.select(); // Select text
  let copied = false; // Track copy outcome
  try { // Attempt legacy copy command
    copied = typeof document.execCommand === "function" && document.execCommand("copy"); // Execute copy
  } catch { // Ignore execCommand errors
    copied = false; // Mark failed
  } finally { // Always clean up temporary DOM node
    textarea.remove(); // Remove textarea
  } // End try/catch/finally
  return copied; // Return copy status
} // End copyTextToClipboard
function triggerFileDownload(filename, content, mimeType = "application/json") { // Trigger client-side file download via Blob URL
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") { // Guard in non-browser environments
    return; // Exit safely
  } // End environment check
  const blob = new Blob([content], { type: mimeType }); // Create in-memory file Blob
  const objectUrl = URL.createObjectURL(blob); // Allocate temporary blob: URL
  const link = document.createElement("a"); // Create hidden download anchor
  link.href = objectUrl; // Point anchor to Blob
  link.download = filename; // Set suggested download filename
  link.className = "visually-hidden"; // Hide visually
  document.body.append(link); // Attach to DOM
  link.click(); // Trigger browser download
  link.remove(); // Remove temporary anchor
  window.setTimeout(() => { // Revoke Blob URL after download starts to free memory
    URL.revokeObjectURL(objectUrl); // Release object URL
  }, 1e3); // Wait 1 second
} // End triggerFileDownload
function syncFieldErrorLink(input, errorId, shown) { // Dynamically link/unlink aria-describedby error ID on form inputs
  const existing = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id.length > 0 && id !== errorId); // Keep non-error describedby IDs
  if (shown) { // Append error ID when error is visible
    existing.push(errorId); // Add errorId
  } // End shown check
  if (existing.length > 0) { // Update or clear aria-describedby attribute
    input.setAttribute("aria-describedby", existing.join(" ")); // Set combined IDs
  } else { // Remove empty attribute
    input.removeAttribute("aria-describedby"); // Clean up attribute
  } // End existing check
} // End syncFieldErrorLink
function mountPolicyGenerator(container, options) { // Render and wire the interactive 4-Band Admin Policy Generator
  mountInstanceCounter += 1; // Increment instance counter for unique IDs
  const idPrefix = `rm-pg-${mountInstanceCounter}`; // Prefix for all form control IDs
  let bandStates = createDefaultBandStates(); // Initialize per-band toggle states
  const analytics = { ...DEFAULT_ANALYTICS_POLICY }; // Initialize shared analytics draft settings
  let showStaffBand = false; // Staff OU card is collapsed by default
  container.replaceChildren(); // Clear mount container safely
  const root = document.createElement("div"); // Create generator root wrapper
  root.className = "pg-root"; // Apply generator layout class
  const errorAnnouncer = document.createElement("div"); // Screen-reader live region for validation errors
  errorAnnouncer.setAttribute("aria-live", "polite"); // Announce validation errors politely
  errorAnnouncer.className = "visually-hidden"; // Visually hidden
  root.append(errorAnnouncer); // Attach live region
  const introCard = document.createElement("section"); // Create top instructions card
  introCard.className = "rm-card"; // Apply card styling
  const introTitle = document.createElement("h2"); // Card heading
  introTitle.className = "rm-section-title"; // Apply title styling
  introTitle.textContent = "4-Band Google Admin Console Policy Generator"; // Heading text
  const introDesc = document.createElement("p"); // Deployment path instructions
  introDesc.className = "rm-section-subtitle"; // Apply subtitle styling
  introDesc.textContent = "Configure grade-band controls below, then paste each OU JSON into Google Admin Console under Devices \u2192 Chrome \u2192 Apps & extensions \u2192 Users & browsers \u2192 Policy for extensions."; // Admin Console navigation path
  const udmCallout = document.createElement("div"); // Trade-off callout for udm=14
  udmCallout.className = "rm-callout rm-callout-amber mt-sm"; // Apply amber callout styling
  const udmText = document.createElement("span"); // Callout copy
  udmText.textContent = "Note: Google's Web-only mode (udm=14) hides AI Overviews while keeping Images, Videos, Shopping, and News tabs working, but also hides Knowledge Panels, Calculator, Unit Converter, and Dictionary cards. Recommended ON for Grades K\u20135 and OFF for Grades 6\u201312."; // Grade-band guidance
  udmCallout.append(udmText); // Assemble callout
  introCard.append(introTitle, introDesc, udmCallout); // Assemble intro card
  root.append(introCard); // Mount intro card
  const toolbar = document.createElement("div"); // Create generator action toolbar
  toolbar.className = "pg-toolbar"; // Apply toolbar styling
  const leftButtons = document.createElement("div"); // Left button group
  leftButtons.className = "btn-row"; // Apply button row spacing
  const resetBtn = document.createElement("button"); // Reset presets button
  resetBtn.type = "button"; // Non-submit button
  resetBtn.className = "rm-btn"; // Apply standard button style
  resetBtn.textContent = "Reset to Recommended Presets"; // Button label
  const staffToggleBtn = document.createElement("button"); // Show/Hide Staff OU preset button
  staffToggleBtn.type = "button"; // Non-submit button
  staffToggleBtn.className = "rm-btn"; // Apply standard button style
  staffToggleBtn.setAttribute("aria-pressed", "false"); // Accessible toggle button state
  staffToggleBtn.textContent = "Show Staff OU Preset"; // Initial label
  leftButtons.append(resetBtn, staffToggleBtn); // Add left buttons
  const rightButtons = document.createElement("div"); // Right button group
  rightButtons.className = "btn-row"; // Apply button row spacing
  const downloadAllBtn = document.createElement("button"); // Download all 4 student JSON files button
  downloadAllBtn.type = "button"; // Non-submit button
  downloadAllBtn.className = "rm-btn rm-btn-navy"; // Apply navy button style
  downloadAllBtn.textContent = "Download All 4 JSON Files"; // Button label
  const copyAppsScriptBtn = document.createElement("button"); // Copy Code.gs template button
  copyAppsScriptBtn.type = "button"; // Non-submit button
  copyAppsScriptBtn.className = "rm-btn"; // Apply standard button style
  copyAppsScriptBtn.textContent = "Copy Apps Script Template (Code.gs)"; // Button label
  rightButtons.append(downloadAllBtn, copyAppsScriptBtn); // Add right buttons
  toolbar.append(leftButtons, rightButtons); // Assemble toolbar
  root.append(toolbar); // Mount toolbar
  const statusLine = document.createElement("p"); // Live status feedback line
  statusLine.className = "status-line"; // Apply status styling
  statusLine.setAttribute("role", "status"); // Accessible status role
  statusLine.setAttribute("aria-live", "polite"); // Polite live region
  root.append(statusLine); // Mount status line
  const setStatus = (message, isError = false) => { // Helper to update generator status feedback
    statusLine.textContent = message; // Set message text
    statusLine.classList.toggle("status-line-error", isError); // Apply error color if needed
    options?.onStatus?.(message); // Forward to global screen-reader announcer
  }; // End setStatus
  const analyticsFieldset = document.createElement("fieldset"); // Fieldset for optional district Google Sheets analytics config
  analyticsFieldset.className = "pg-analytics-fieldset"; // Apply fieldset styling
  const analyticsLegend = document.createElement("legend"); // Fieldset legend
  analyticsLegend.className = "pg-analytics-legend"; // Apply legend styling
  analyticsLegend.textContent = "Optional Shared District Google Sheets Analytics ($0, Zero PII)"; // Legend text
  analyticsFieldset.append(analyticsLegend); // Attach legend
  const enableRow = document.createElement("div"); // Checkbox row for enabling analytics
  const enableCheckbox = document.createElement("input"); // Checkbox input
  enableCheckbox.type = "checkbox"; // Checkbox type
  enableCheckbox.id = `${idPrefix}-analytics-enabled`; // Unique ID
  enableCheckbox.name = "analyticsEnabled"; // Field name
  enableCheckbox.className = "rm-checkbox"; // Apply checkbox styling
  enableCheckbox.checked = analytics.analyticsEnabled; // Sync initial state (false)
  const enableLabel = document.createElement("label"); // Checkbox label
  enableLabel.htmlFor = enableCheckbox.id; // Associate label with checkbox
  enableLabel.className = "rm-checkbox-label"; // Apply label styling
  enableLabel.append(enableCheckbox, document.createTextNode("Enable District Google Sheets Analytics across all generated policies")); // Label text
  enableRow.append(enableLabel); // Assemble row
  analyticsFieldset.append(enableRow); // Mount enable row
  const analyticsGrid = document.createElement("div"); // 3-column input grid for URL, token, and interval
  analyticsGrid.className = "pg-analytics-grid"; // Apply grid styling
  const urlRow = document.createElement("div"); // Field row for Apps Script URL
  urlRow.className = "field-row"; // Apply field row styling
  const urlId = `${idPrefix}-analytics-url`; // Input ID
  const urlHintId = `${idPrefix}-analytics-url-hint`; // Hint ID
  const urlErrorId = `${idPrefix}-analytics-url-error`; // Error ID
  const urlLabel = document.createElement("label"); // Field label
  urlLabel.htmlFor = urlId; // Associate with input
  urlLabel.className = "field-label"; // Apply label styling
  urlLabel.textContent = "Google Apps Script Web App URL"; // Label text
  const urlHint = document.createElement("p"); // Format hint
  urlHint.id = urlHintId; // Set hint ID
  urlHint.className = "field-hint"; // Apply hint styling
  urlHint.textContent = "Format: https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"; // Expected URL pattern
  const urlInput = document.createElement("input"); // URL input element
  urlInput.type = "url"; // URL input type
  urlInput.id = urlId; // Set ID
  urlInput.name = "analyticsEndpointUrl"; // Field name
  urlInput.className = "rm-input"; // Apply input styling
  urlInput.placeholder = "https://script.google.com/macros/s/AKfycb.../exec"; // Example placeholder
  urlInput.setAttribute("autocorrect", "off"); // Disable autocorrect
  urlInput.setAttribute("autocapitalize", "none"); // Disable autocapitalize
  urlInput.setAttribute("spellcheck", "false"); // Disable spellcheck
  urlInput.setAttribute("inputmode", "url"); // URL keyboard hint
  urlInput.setAttribute("aria-invalid", "false"); // Initial valid ARIA state
  urlInput.setAttribute("aria-describedby", urlHintId); // Link hint
  urlInput.dataset.error = urlErrorId; // Reference error element ID
  const urlError = document.createElement("p"); // Validation error message element
  urlError.id = urlErrorId; // Set error ID
  urlError.className = "field-error"; // Apply error styling
  urlError.hidden = true; // Hidden until invalid
  urlRow.append(urlLabel, urlHint, urlInput, urlError); // Assemble URL field
  const tokenRow = document.createElement("div"); // Field row for optional shared token
  tokenRow.className = "field-row"; // Apply field row styling
  const tokenId = `${idPrefix}-analytics-token`; // Input ID
  const tokenHintId = `${idPrefix}-analytics-token-hint`; // Hint ID
  const tokenLabel = document.createElement("label"); // Field label
  tokenLabel.htmlFor = tokenId; // Associate with input
  tokenLabel.className = "field-label"; // Apply label styling
  tokenLabel.textContent = "Optional Shared Token"; // Label text
  const tokenHint = document.createElement("p"); // Token hint
  tokenHint.id = tokenHintId; // Set hint ID
  tokenHint.className = "field-hint"; // Apply hint styling
  tokenHint.textContent = "Must match SHARED_TOKEN in your district Code.gs (optional anti-spam check)."; // Hint text
  const tokenInput = document.createElement("input"); // Token text input
  tokenInput.type = "text"; // Text input
  tokenInput.id = tokenId; // Set ID
  tokenInput.name = "analyticsSharedToken"; // Field name
  tokenInput.className = "rm-input"; // Apply input styling
  tokenInput.placeholder = "district-sg-2026"; // Example placeholder
  tokenInput.setAttribute("autocorrect", "off"); // Disable autocorrect
  tokenInput.setAttribute("autocapitalize", "none"); // Disable autocapitalize
  tokenInput.setAttribute("spellcheck", "false"); // Disable spellcheck
  tokenInput.setAttribute("aria-invalid", "false"); // Valid ARIA state
  tokenInput.setAttribute("aria-describedby", tokenHintId); // Link hint
  tokenRow.append(tokenLabel, tokenHint, tokenInput); // Assemble token field
  const intervalRow = document.createElement("div"); // Field row for flush interval
  intervalRow.className = "field-row"; // Apply field row styling
  const intervalId = `${idPrefix}-analytics-interval`; // Input ID
  const intervalHintId = `${idPrefix}-analytics-interval-hint`; // Hint ID
  const intervalErrorId = `${idPrefix}-analytics-interval-error`; // Error ID
  const intervalLabel = document.createElement("label"); // Field label
  intervalLabel.htmlFor = intervalId; // Associate with input
  intervalLabel.className = "field-label"; // Apply label styling
  intervalLabel.textContent = "Flush Interval (Minutes)"; // Label text
  const intervalHint = document.createElement("p"); // Range hint
  intervalHint.id = intervalHintId; // Set hint ID
  intervalHint.className = "field-hint"; // Apply hint styling
  intervalHint.textContent = `Whole number between ${MIN_FLUSH_INTERVAL_MINUTES} and ${MAX_FLUSH_INTERVAL_MINUTES} (default 240).`; // Allowed range text
  const intervalInput = document.createElement("input"); // Numeric input
  intervalInput.type = "number"; // Number input type
  intervalInput.id = intervalId; // Set ID
  intervalInput.name = "analyticsFlushIntervalMinutes"; // Field name
  intervalInput.className = "rm-input"; // Apply input styling
  intervalInput.min = String(MIN_FLUSH_INTERVAL_MINUTES); // Minimum 60
  intervalInput.max = String(MAX_FLUSH_INTERVAL_MINUTES); // Maximum 1440
  intervalInput.step = "1"; // Whole integers only
  intervalInput.value = String(analytics.analyticsFlushIntervalMinutes); // Initial value 240
  intervalInput.setAttribute("aria-invalid", "false"); // Valid ARIA state
  intervalInput.setAttribute("aria-describedby", intervalHintId); // Link hint
  intervalInput.dataset.error = intervalErrorId; // Reference error ID
  const intervalError = document.createElement("p"); // Interval error message element
  intervalError.id = intervalErrorId; // Set error ID
  intervalError.className = "field-error"; // Apply error styling
  intervalError.hidden = true; // Hidden until invalid
  intervalRow.append(intervalLabel, intervalHint, intervalInput, intervalError); // Assemble interval field
  analyticsGrid.append(urlRow, tokenRow, intervalRow); // Add all 3 fields to grid
  analyticsFieldset.append(analyticsGrid); // Add grid to fieldset
  root.append(analyticsFieldset); // Mount analytics fieldset
  const matrix = document.createElement("div"); // Responsive card grid for all grade-band policy cards
  matrix.className = "pg-matrix"; // Apply matrix grid class
  const cardRefs = {}; // Store DOM references per band for fast re-rendering
  for (const band of ALL_BANDS) { // Build a configuration + JSON preview card for each grade band
    const preset = GRADE_BAND_PRESETS[band]; // Look up preset metadata
    const article = document.createElement("article"); // Create band card element
    article.className = "band-card"; // Apply card styling
    article.dataset.gradeBand = band; // Tag with grade band
    if (band === "Staff") { // Hide Staff card initially until toggled
      article.hidden = !showStaffBand; // Hide Staff card
    } // End Staff check
    const header = document.createElement("div"); // Card header
    header.className = "band-card-header"; // Apply header styling
    const title = document.createElement("h3"); // Band title
    title.className = "band-card-title"; // Apply title styling
    title.textContent = band === "Staff" ? preset.label : `${preset.label} (${band})`; // Format title
    const subtitle = document.createElement("p"); // Band subtitle
    subtitle.className = "band-card-subtitle"; // Apply subtitle styling
    subtitle.textContent = preset.subtitle; // Set subtitle
    header.append(title, subtitle); // Assemble header
    const reminder = document.createElement("div"); // Reminder banner to also set Chrome's native AIModeSettings policy
    reminder.className = "band-reminder"; // Apply reminder styling
    reminder.dataset.aimodeReminder = band; // Tag reminder with band
    reminder.append( // Build reminder text with inline <code> tag
      document.createTextNode("Also set "), // Prefix text
      (() => { // Create <code> element safely without innerHTML
        const code = document.createElement("code"); // Code element
        code.textContent = "AIModeSettings = Do not allow (1)"; // Chrome Admin policy name
        return code; // Return code node
      })(), // Invoke inline builder
      document.createTextNode(" in this OU") // Suffix text
    ); // End append
    const togglesContainer = document.createElement("div"); // Container for the 6 switch rows
    togglesContainer.className = "band-toggles"; // Apply toggles list styling
    const toggleInputs = {}; // Map toggle key -> checkbox element
    const toggleItems = {}; // Map toggle key -> row container element
    for (const key of FEATURE_TOGGLE_KEYS) { // Build each of the 6 switches
      const item = document.createElement("div"); // Switch row container
      item.className = "band-toggle-item"; // Apply row styling
      const inputId = `${idPrefix}-${band}-${key}`; // Unique switch ID
      const label = document.createElement("label"); // Switch label
      label.htmlFor = inputId; // Associate with switch
      label.className = "band-toggle-label"; // Apply label styling
      label.textContent = TOGGLE_LABELS[key]; // Set human-readable label
      const input = document.createElement("input"); // Switch input
      input.type = "checkbox"; // Checkbox backing input
      input.setAttribute("role", "switch"); // ARIA switch role
      input.className = "rm-switch"; // Apply custom switch styling
      input.id = inputId; // Set ID
      input.dataset.gradeBand = band; // Tag grade band
      input.dataset.toggleKey = key; // Tag toggle key
      input.checked = bandStates[band][key]; // Set initial state
      input.addEventListener("change", () => { // Update band state and JSON preview on toggle change
        bandStates[band][key] = input.checked; // Save new boolean
        renderBandCard(band); // Re-render card preview
      }); // End change listener
      toggleInputs[key] = input; // Store input ref
      toggleItems[key] = item; // Store row ref
      item.append(label, input); // Assemble switch row
      togglesContainer.append(item); // Add row to container
    } // End toggle loop
    const pre = document.createElement("pre"); // Code block wrapper for JSON preview
    pre.className = "json-preview"; // Apply JSON preview styling
    const codeEl = document.createElement("code"); // Code element holding generated JSON
    codeEl.dataset.jsonOutput = band; // Tag with grade band
    pre.append(codeEl); // Attach code element
    const actions = document.createElement("div"); // Card footer action buttons
    actions.className = "band-actions"; // Apply actions row styling
    const copyBtn = document.createElement("button"); // Copy JSON button
    copyBtn.type = "button"; // Non-submit button
    copyBtn.className = "rm-btn rm-btn-primary rm-btn-sm"; // Apply primary small button style
    copyBtn.dataset.copyBand = band; // Tag with band
    const copySr = document.createElement("span"); // Screen-reader band context
    copySr.className = "visually-hidden"; // Visually hidden
    copySr.textContent = ` for ${band}`; // Screen-reader suffix
    copyBtn.append(document.createTextNode("Copy Google Admin Console JSON"), copySr); // Assemble button text
    copyBtn.addEventListener("click", async () => { // Validate and copy this band's Admin Console JSON
      const draftCheck = validatePolicyDraft({ // Run draft validation
        gradeBand: band, // Band being copied
        analyticsEnabled: analytics.analyticsEnabled, // Analytics flag
        analyticsEndpointUrl: analytics.analyticsEndpointUrl, // Endpoint URL
        analyticsFlushIntervalMinutes: analytics.analyticsFlushIntervalMinutes // Flush interval
      }); // End validatePolicyDraft
      validateAnalyticsInputs(true); // Surface any field-level validation errors
      const jsonText = buildBandAdminJsonString(band, bandStates[band], analytics); // Build formatted JSON
      const copied = await copyTextToClipboard(jsonText); // Copy to clipboard
      if (!copied) { // Handle clipboard failure
        setStatus(`Could not copy ${band} JSON automatically. Select and copy from the preview box.`, true); // Show error
        return; // Exit
      } // End copied check
      if (!draftCheck.valid) { // Warn if analytics config has validation issues
        setStatus(`Copied ${band} JSON (warning: ${draftCheck.errors[0]}).`, true); // Show warning
      } else { // Normal success
        setStatus(`Copied Google Admin Console JSON for ${band}.`); // Show confirmation
      } // End draftCheck branch
    }); // End copyBtn click
    const dlBtn = document.createElement("button"); // Download .json button
    dlBtn.type = "button"; // Non-submit button
    dlBtn.className = "rm-btn rm-btn-sm"; // Apply small button style
    dlBtn.dataset.downloadBand = band; // Tag with band
    const dlSr = document.createElement("span"); // Screen-reader band context
    dlSr.className = "visually-hidden"; // Visually hidden
    dlSr.textContent = ` for ${band}`; // Screen-reader suffix
    dlBtn.append(document.createTextNode("Download .json"), dlSr); // Assemble button text
    dlBtn.addEventListener("click", () => { // Download this band's JSON file
      const jsonText = buildBandAdminJsonString(band, bandStates[band], analytics); // Build formatted JSON
      triggerFileDownload(`raisemark-search-guard-${band}.json`, jsonText); // Trigger download
      setStatus(`Downloaded raisemark-search-guard-${band}.json.`); // Show confirmation
    }); // End dlBtn click
    actions.append(copyBtn, dlBtn); // Assemble card actions
    article.append(header, reminder, togglesContainer, pre, actions); // Assemble card
    matrix.append(article); // Add card to matrix
    cardRefs[band] = { // Save DOM refs for re-rendering
      article, // Card element
      reminder, // AIModeSettings reminder banner
      codeEl, // JSON <code> preview
      toggleInputs, // Switch inputs map
      toggleItems // Switch row wrappers map
    }; // End cardRefs entry
  } // End ALL_BANDS loop
  root.append(matrix); // Mount card matrix
  container.append(root); // Mount generator root into container
  function renderBandCard(band) { // Refresh one grade-band card's switches, AIModeSettings reminder, and JSON preview
    const refs = cardRefs[band]; // Look up card DOM references
    const toggles = bandStates[band]; // Look up current toggle state
    for (const key of FEATURE_TOGGLE_KEYS) { // Sync checkbox state and paused styling
      refs.toggleInputs[key].checked = toggles[key]; // Update checkbox state
      if (key !== "masterEnabled") { // Dim child toggles when masterEnabled is false
        refs.toggleItems[key].classList.toggle("band-toggle-item-paused", !toggles.masterEnabled); // Toggle paused visual class
      } // End masterEnabled check
    } // End toggle loop
    const showAiModeReminder = toggles.masterEnabled && (toggles.blockAiModeNavigation || toggles.hideAiModeUi); // Show Chrome AIModeSettings reminder when AI Mode is blocked
    refs.reminder.hidden = !showAiModeReminder; // Toggle reminder visibility
    refs.codeEl.textContent = buildBandAdminJsonString(band, toggles, analytics); // Update formatted JSON preview
  } // End renderBandCard
  function renderAllBands() { // Re-render all grade-band cards
    for (const band of ALL_BANDS) { // Iterate all 5 bands
      renderBandCard(band); // Render card
    } // End loop
  } // End renderAllBands
  function validateAnalyticsInputs(announce = false) { // Validate Apps Script URL and flush interval inputs with ARIA feedback
    const trimmedUrl = urlInput.value.trim(); // Read trimmed endpoint URL
    let urlMessage = ""; // Initialize error message
    if (trimmedUrl.length > 0 && !APPS_SCRIPT_URL_REGEX.test(trimmedUrl)) { // Reject URLs outside Apps Script /exec allowlist
      urlMessage = "Invalid Apps Script URL. Must match https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec."; // Format error
    } else if (analytics.analyticsEnabled && trimmedUrl.length === 0) { // Require URL when analytics is enabled
      urlMessage = "Apps Script Web App URL is required when District Analytics is enabled (https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec)."; // Required error
    } // End URL checks
    const urlInvalid = urlMessage.length > 0; // Determine invalid state
    urlInput.setCustomValidity(urlMessage); // Set native constraint validation message
    urlInput.setAttribute("aria-invalid", urlInvalid ? "true" : "false"); // Update ARIA invalid state
    urlError.textContent = urlMessage; // Display error text
    urlError.hidden = !urlInvalid; // Toggle error visibility
    syncFieldErrorLink(urlInput, urlErrorId, urlInvalid); // Link/unlink aria-describedby error ID
    const parsedInterval = Number(intervalInput.value); // Parse numeric flush interval
    const intervalInvalid = analytics.analyticsEnabled && (!Number.isInteger(parsedInterval) || parsedInterval < MIN_FLUSH_INTERVAL_MINUTES || parsedInterval > MAX_FLUSH_INTERVAL_MINUTES); // Check integer range [60, 1440]
    const intervalMessage = intervalInvalid ? `Flush interval must be a whole number between ${MIN_FLUSH_INTERVAL_MINUTES} and ${MAX_FLUSH_INTERVAL_MINUTES} minutes.` : ""; // Build interval error message
    intervalInput.setCustomValidity(intervalMessage); // Set native validation message
    intervalInput.setAttribute("aria-invalid", intervalInvalid ? "true" : "false"); // Update ARIA invalid state
    intervalError.textContent = intervalMessage; // Display error text
    intervalError.hidden = !intervalInvalid; // Toggle error visibility
    syncFieldErrorLink(intervalInput, intervalErrorId, intervalInvalid); // Link/unlink aria-describedby error ID
    if (announce && (urlInvalid || intervalInvalid)) { // Announce first validation error to screen readers on blur/submit
      errorAnnouncer.textContent = ""; // Clear to re-trigger live region
      errorAnnouncer.textContent = urlMessage || intervalMessage; // Announce error
    } else if (!urlInvalid && !intervalInvalid) { // Clear live region when all fields are valid
      errorAnnouncer.textContent = ""; // Clear announcement
    } // End announce check
    return !urlInvalid && !intervalInvalid; // Return overall validity
  } // End validateAnalyticsInputs
  enableCheckbox.addEventListener("change", () => { // Toggle district analytics across all generated JSON cards
    analytics.analyticsEnabled = enableCheckbox.checked; // Update draft state
    validateAnalyticsInputs(true); // Validate URL/interval requirements
    renderAllBands(); // Re-render all JSON previews
  }); // End enableCheckbox listener
  urlInput.addEventListener("input", () => { // Live-update endpoint URL in JSON previews
    analytics.analyticsEndpointUrl = urlInput.value.trim(); // Update draft URL
    validateAnalyticsInputs(false); // Validate quietly while typing
    renderAllBands(); // Re-render JSON previews
  }); // End urlInput input listener
  urlInput.addEventListener("blur", () => { // Validate and announce URL errors when leaving field
    analytics.analyticsEndpointUrl = urlInput.value.trim(); // Update draft URL
    validateAnalyticsInputs(true); // Announce errors if invalid
    renderAllBands(); // Re-render JSON previews
  }); // End urlInput blur listener
  tokenInput.addEventListener("input", () => { // Live-update optional shared token in JSON previews
    analytics.analyticsSharedToken = tokenInput.value.trim(); // Update draft token
    renderAllBands(); // Re-render JSON previews
  }); // End tokenInput listener
  intervalInput.addEventListener("input", () => { // Live-update flush interval in JSON previews when valid
    const parsed = Number(intervalInput.value); // Parse numeric input
    if (Number.isInteger(parsed) && parsed >= MIN_FLUSH_INTERVAL_MINUTES && parsed <= MAX_FLUSH_INTERVAL_MINUTES) { // Only apply valid integer values
      analytics.analyticsFlushIntervalMinutes = parsed; // Update draft interval
    } // End range check
    validateAnalyticsInputs(false); // Validate quietly while typing
    renderAllBands(); // Re-render JSON previews
  }); // End intervalInput input listener
  intervalInput.addEventListener("blur", () => { // Validate and announce interval errors on blur
    validateAnalyticsInputs(true); // Announce errors if invalid
    renderAllBands(); // Re-render JSON previews
  }); // End intervalInput blur listener
  resetBtn.addEventListener("click", () => { // Restore all 5 grade-band cards to recommended K-12 presets
    bandStates = createDefaultBandStates(); // Reset state
    renderAllBands(); // Re-render cards
    setStatus("Reset all grade-band cards to recommended K\u201312 presets."); // Show confirmation
  }); // End resetBtn listener
  staffToggleBtn.addEventListener("click", () => { // Show or hide the optional Staff/Faculty OU card
    showStaffBand = !showStaffBand; // Toggle visibility flag
    cardRefs.Staff.article.hidden = !showStaffBand; // Update card hidden attribute
    staffToggleBtn.setAttribute("aria-pressed", String(showStaffBand)); // Update ARIA pressed state
    staffToggleBtn.textContent = showStaffBand ? "Hide Staff OU Preset" : "Show Staff OU Preset"; // Update button label
  }); // End staffToggleBtn listener
  downloadAllBtn.addEventListener("click", () => { // Download all 4 student grade-band JSON files at once
    validateAnalyticsInputs(true); // Surface any analytics validation issues
    for (const band of PRIMARY_BANDS) { // Download K-2, 3-5, 6-8, and 9-12 JSON files
      const jsonText = buildBandAdminJsonString(band, bandStates[band], analytics); // Build JSON string
      triggerFileDownload(`raisemark-search-guard-${band}.json`, jsonText); // Trigger download
    } // End loop
    const validAnalytics = !analytics.analyticsEnabled || isValidAppsScriptUrl(analytics.analyticsEndpointUrl); // Check analytics URL validity
    if (!validAnalytics) { // Warn if analytics was enabled with an invalid URL
      setStatus( // Show warning status
        "Downloaded all 4 grade-band JSON files (warning: Apps Script URL is invalid or blank).", // Warning text
        true // Mark as error/warning
      ); // End setStatus
    } else { // Normal confirmation
      setStatus("Downloaded all 4 grade-band JSON files (K-2, 3-5, 6-8, 9-12)."); // Show confirmation
    } // End validAnalytics check
  }); // End downloadAllBtn listener
  copyAppsScriptBtn.addEventListener("click", async () => { // Copy embedded district Google Apps Script (Code.gs) template
    const template = options?.appsScriptTemplate; // Read bundled Code.gs template
    if (!template) { // Fallback message if template is not provided
      setStatus( // Show info status
        "Apps Script template (templates/apps-script/Code.gs) is not bundled in this view. Copy it directly from the repository.", // Message
        true // Error flag
      ); // End setStatus
      return; // Exit
    } // End template check
    const copied = await copyTextToClipboard(template); // Copy Code.gs to clipboard
    if (copied) { // Confirm copy
      setStatus("Copied district Google Apps Script template (Code.gs) to clipboard."); // Success message
    } else { // Report clipboard failure
      setStatus("Could not access clipboard to copy Code.gs.", true); // Error message
    } // End copied check
  }); // End copyAppsScriptBtn listener
  renderAllBands(); // Render initial JSON previews for all cards
} // End mountPolicyGenerator

// src/ui/options.ts — IT Options Hub controller (Status, Diagnostics, and Policy Generator)
var EMBEDDED_APPS_SCRIPT_TEMPLATE = true ? "/**\n * RaiseMark AI Search Guard \u2014 District-Owned Zero-PII Analytics Sink\n *\n * Deployment Instructions:\n * 1. Create a Google Sheet inside your school district's Google Workspace.\n * 2. Open Extensions -> Apps Script and paste this entire file into Code.gs.\n * 3. (Optional) Set SHARED_TOKEN below to match `analyticsSharedToken` in your\n *    Google Admin Console extension policy JSON.\n * 4. Click Deploy -> New deployment -> Web app:\n *      - Execute as: Me\n *      - Who has access: Anyone\n * 5. Copy the resulting https://script.google.com/macros/s/<ID>/exec URL into\n *    the RaiseMark AI Search Guard Admin Policy Generator.\n *\n * Privacy Guarantee:\n * - Strictly allowlists aggregate counts only (zero PII, zero search queries,\n *   zero student emails, zero device IDs, zero IP logging).\n * - Rejects any payload containing unexpected or non-allowlisted fields.\n */\n\nvar SHARED_TOKEN = '';\nvar DAILY_SHEET_NAME = 'Daily_Rollup';\nvar ERROR_SHEET_NAME = 'Error_Summary';\nvar MAX_COUNT_PER_BATCH = 100000;\n\nvar ALLOWED_TOP_LEVEL_KEYS = [\n  'schemaVersion',\n  'extensionVersion',\n  'token',\n  'gradeBand',\n  'dateBucket',\n  'metrics',\n  'errors',\n];\n\nvar ALLOWED_GRADE_BANDS = ['K-2', '3-5', '6-8', '9-12', 'Staff', 'Unassigned'];\n\nvar ALLOWED_METRIC_KEYS = [\n  'overviewsHidden',\n  'aiModeUiHidden',\n  'aiModeRedirects',\n  'omniboxFallbackRedirects',\n  'auxAiHidden',\n];\n\nvar ALLOWED_ERROR_CODES = [\n  'ERR_POLICY_INVALID',\n  'ERR_DNR_SYNC_FAILED',\n  'ERR_SELECTOR_SYNTAX',\n  'ERR_SAFETY_GUARD_TRIPPED',\n  'ERR_ANALYTICS_ENDPOINT_INVALID',\n  'ERR_ANALYTICS_FLUSH_FAILED',\n  'ERR_STORAGE_FAILURE',\n  'WARN_NO_MANAGED_POLICY',\n  'WARN_OMNIBOX_POLICY_MISSING',\n];\n\nvar DAILY_HEADERS = [\n  'Date',\n  'GradeBand',\n  'ExtensionVersion',\n  'OverviewsHidden',\n  'AiModeUiHidden',\n  'AiModeRedirects',\n  'OmniboxFallbackRedirects',\n  'AuxAiHidden',\n  'ReportingBatches',\n];\n\nvar ERROR_HEADERS = ['Date', 'GradeBand', 'ErrorCode', 'Count'];\n\nfunction doGet() {\n  return jsonResponse_({\n    status: 'ok',\n    service: 'RaiseMark AI Search Guard Analytics Sink',\n    message: 'Endpoint is active. Submit anonymous daily aggregates via HTTP POST.',\n  });\n}\n\nfunction doPost(e) {\n  if (!e || !e.postData || typeof e.postData.contents !== 'string') {\n    return jsonResponse_({ status: 'error', code: 'EMPTY_BODY' });\n  }\n\n  var payload;\n  try {\n    payload = JSON.parse(e.postData.contents);\n  } catch (_err) {\n    return jsonResponse_({ status: 'error', code: 'INVALID_JSON' });\n  }\n\n  if (!isPlainObject_(payload)) {\n    return jsonResponse_({ status: 'error', code: 'INVALID_PAYLOAD' });\n  }\n\n  if (typeof SHARED_TOKEN === 'string' && SHARED_TOKEN.length > 0) {\n    if (typeof payload.token !== 'string' || payload.token !== SHARED_TOKEN) {\n      return jsonResponse_({ status: 'error', code: 'UNAUTHORIZED' });\n    }\n  }\n\n  var validation = validatePayload_(payload);\n  if (!validation.ok) {\n    return jsonResponse_({\n      status: 'error',\n      code: validation.code,\n      message: validation.message,\n    });\n  }\n\n  var lock = LockService.getScriptLock();\n  var lockAcquired = false;\n  try {\n    lock.waitLock(15000);\n    lockAcquired = true;\n\n    var ss = SpreadsheetApp.getActiveSpreadsheet();\n    upsertDailyRollup_(ss, validation.data);\n    upsertErrorSummary_(ss, validation.data);\n\n    return jsonResponse_({ status: 'ok' });\n  } catch (err) {\n    return jsonResponse_({\n      status: 'error',\n      code: lockAcquired ? 'WRITE_FAILED' : 'LOCK_TIMEOUT',\n      message: err && err.message ? String(err.message) : 'Unexpected server error',\n    });\n  } finally {\n    if (lockAcquired) {\n      lock.releaseLock();\n    }\n  }\n}\n\nfunction isPlainObject_(value) {\n  return value !== null && typeof value === 'object' && !Array.isArray(value);\n}\n\nfunction isValidCount_(value) {\n  return (\n    typeof value === 'number' &&\n    isFinite(value) &&\n    Math.floor(value) === value &&\n    value >= 0 &&\n    value <= MAX_COUNT_PER_BATCH\n  );\n}\n\nfunction validatePayload_(payload) {\n  var topKeys = Object.keys(payload);\n  for (var i = 0; i < topKeys.length; i++) {\n    if (ALLOWED_TOP_LEVEL_KEYS.indexOf(topKeys[i]) === -1) {\n      return {\n        ok: false,\n        code: 'INVALID_PAYLOAD',\n        message: 'Unexpected field rejected by zero-PII allowlist',\n      };\n    }\n  }\n\n  if (payload.schemaVersion !== 1) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Unsupported schemaVersion' };\n  }\n\n  if (\n    typeof payload.extensionVersion !== 'string' ||\n    !/^\\d+\\.\\d+\\.\\d+$/.test(payload.extensionVersion)\n  ) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid extensionVersion' };\n  }\n\n  if (payload.token !== undefined && typeof payload.token !== 'string') {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid token type' };\n  }\n\n  if (\n    typeof payload.gradeBand !== 'string' ||\n    ALLOWED_GRADE_BANDS.indexOf(payload.gradeBand) === -1\n  ) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid gradeBand' };\n  }\n\n  if (typeof payload.dateBucket !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.dateBucket)) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid dateBucket' };\n  }\n\n  if (!isPlainObject_(payload.metrics)) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Missing or invalid metrics object' };\n  }\n\n  var metricKeys = Object.keys(payload.metrics);\n  for (var m = 0; m < metricKeys.length; m++) {\n    if (ALLOWED_METRIC_KEYS.indexOf(metricKeys[m]) === -1) {\n      return {\n        ok: false,\n        code: 'INVALID_PAYLOAD',\n        message: 'Unexpected metric key rejected by allowlist',\n      };\n    }\n  }\n\n  var cleanMetrics = {};\n  for (var k = 0; k < ALLOWED_METRIC_KEYS.length; k++) {\n    var mKey = ALLOWED_METRIC_KEYS[k];\n    var mVal = payload.metrics[mKey];\n    if (mVal === undefined) {\n      cleanMetrics[mKey] = 0;\n    } else if (!isValidCount_(mVal)) {\n      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid metric value' };\n    } else {\n      cleanMetrics[mKey] = mVal;\n    }\n  }\n\n  var cleanErrors = {};\n  if (payload.errors !== undefined) {\n    if (!isPlainObject_(payload.errors)) {\n      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid errors object' };\n    }\n    var errKeys = Object.keys(payload.errors);\n    for (var eIdx = 0; eIdx < errKeys.length; eIdx++) {\n      var errCode = errKeys[eIdx];\n      if (ALLOWED_ERROR_CODES.indexOf(errCode) === -1) {\n        return {\n          ok: false,\n          code: 'INVALID_PAYLOAD',\n          message: 'Unexpected error code rejected by allowlist',\n        };\n      }\n      var errVal = payload.errors[errCode];\n      if (!isValidCount_(errVal)) {\n        return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid error count' };\n      }\n      if (errVal > 0) {\n        cleanErrors[errCode] = errVal;\n      }\n    }\n  }\n\n  return {\n    ok: true,\n    data: {\n      schemaVersion: 1,\n      extensionVersion: payload.extensionVersion,\n      gradeBand: payload.gradeBand,\n      dateBucket: payload.dateBucket,\n      metrics: cleanMetrics,\n      errors: cleanErrors,\n    },\n  };\n}\n\nfunction getOrCreateSheet_(ss, name, headers) {\n  var sheet = ss.getSheetByName(name);\n  if (!sheet) {\n    sheet = ss.insertSheet(name);\n  }\n  if (sheet.getLastRow() === 0) {\n    sheet.appendRow(headers);\n  }\n  return sheet;\n}\n\nfunction normalizeDateCell_(value) {\n  if (value instanceof Date && !isNaN(value.getTime())) {\n    return value.toISOString().slice(0, 10);\n  }\n  return String(value);\n}\n\nfunction upsertDailyRollup_(ss, data) {\n  var sheet = getOrCreateSheet_(ss, DAILY_SHEET_NAME, DAILY_HEADERS);\n  var lastRow = sheet.getLastRow();\n  var m = data.metrics;\n\n  if (lastRow > 1) {\n    var rows = sheet.getRange(2, 1, lastRow - 1, DAILY_HEADERS.length).getValues();\n    for (var i = 0; i < rows.length; i++) {\n      var row = rows[i];\n      if (\n        normalizeDateCell_(row[0]) === data.dateBucket &&\n        String(row[1]) === data.gradeBand &&\n        String(row[2]) === data.extensionVersion\n      ) {\n        var updated = [\n          data.dateBucket,\n          data.gradeBand,\n          data.extensionVersion,\n          (Number(row[3]) || 0) + m.overviewsHidden,\n          (Number(row[4]) || 0) + m.aiModeUiHidden,\n          (Number(row[5]) || 0) + m.aiModeRedirects,\n          (Number(row[6]) || 0) + m.omniboxFallbackRedirects,\n          (Number(row[7]) || 0) + m.auxAiHidden,\n          (Number(row[8]) || 0) + 1,\n        ];\n        sheet.getRange(i + 2, 1, 1, DAILY_HEADERS.length).setValues([updated]);\n        return;\n      }\n    }\n  }\n\n  sheet.appendRow([\n    data.dateBucket,\n    data.gradeBand,\n    data.extensionVersion,\n    m.overviewsHidden,\n    m.aiModeUiHidden,\n    m.aiModeRedirects,\n    m.omniboxFallbackRedirects,\n    m.auxAiHidden,\n    1,\n  ]);\n}\n\nfunction upsertErrorSummary_(ss, data) {\n  var sheet = getOrCreateSheet_(ss, ERROR_SHEET_NAME, ERROR_HEADERS);\n  var errorCodes = Object.keys(data.errors);\n  if (errorCodes.length === 0) {\n    return;\n  }\n\n  for (var idx = 0; idx < errorCodes.length; idx++) {\n    var code = errorCodes[idx];\n    var count = data.errors[code];\n    if (!count || count <= 0) {\n      continue;\n    }\n\n    var lastRow = sheet.getLastRow();\n    var matched = false;\n    if (lastRow > 1) {\n      var rows = sheet.getRange(2, 1, lastRow - 1, ERROR_HEADERS.length).getValues();\n      for (var r = 0; r < rows.length; r++) {\n        var row = rows[r];\n        if (\n          normalizeDateCell_(row[0]) === data.dateBucket &&\n          String(row[1]) === data.gradeBand &&\n          String(row[2]) === code\n        ) {\n          var updated = [data.dateBucket, data.gradeBand, code, (Number(row[3]) || 0) + count];\n          sheet.getRange(r + 2, 1, 1, ERROR_HEADERS.length).setValues([updated]);\n          matched = true;\n          break;\n        }\n      }\n    }\n\n    if (!matched) {\n      sheet.appendRow([data.dateBucket, data.gradeBand, code, count]);\n    }\n  }\n}\n\nfunction jsonResponse_(obj) {\n  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(\n    ContentService.MimeType.JSON\n  );\n}\n" : void 0; // Bundled zero-PII Google Apps Script (Code.gs) template for district Google Sheets analytics
var RESET_CONFIRM_WINDOW_MS = 1e4; // Two-step counter reset confirmation timeout (10 seconds)
function sortDiagnosticEntries(entries) { // Sort diagnostics: errors before warnings, newest date first, highest count, then code
  return [...entries].sort((a, b) => { // Return sorted shallow copy
    if (a.severity !== b.severity) { // Errors always sort above warnings
      return a.severity === "error" ? -1 : 1; // Error first
    } // End severity check
    if (a.lastSeenDate !== b.lastSeenDate) { // Most recently seen entries first
      return b.lastSeenDate.localeCompare(a.lastSeenDate); // Descending date order
    } // End date check
    if (a.count !== b.count) { // Higher occurrence count first
      return b.count - a.count; // Descending count
    } // End count check
    return a.code.localeCompare(b.code); // Alphabetical tie-breaker by error code
  }); // End sort
} // End sortDiagnosticEntries
function buildZeroPiiDiagnosticBundle(snapshot) { // Build a sanitized JSON diagnostic report for IT support (strictly zero PII)
  const { policy, telemetry } = snapshot; // Destructure snapshot
  return { // Return structured diagnostic bundle
    schemaVersion: 1, // Bundle schema version
    extensionVersion: snapshot.extensionVersion, // Extension manifest version
    generatedAtDate: snapshot.generatedAtDate, // UTC date string
    activeRuleCount: snapshot.activeRuleCount, // Active Chrome DNR rule count
    policy: { // Effective policy flags (shared token value is redacted to a boolean)
      gradeBand: policy.gradeBand, // Grade band label
      source: policy.source, // Policy source ("managed" | "managed-degraded" | "local-unmanaged" | "defaults")
      isManaged: policy.isManaged, // Whether Chrome managed policy is active
      masterEnabled: policy.masterEnabled, // Master switch state
      hideAiOverviews: policy.hideAiOverviews, // AI Overviews toggle
      hideAiModeUi: policy.hideAiModeUi, // AI Mode UI toggle
      blockAiModeNavigation: policy.blockAiModeNavigation, // AI Mode URL block toggle
      forceWebOnlySearch: policy.forceWebOnlySearch, // Web-only udm=14 toggle
      hideAuxiliaryAiFeatures: policy.hideAuxiliaryAiFeatures, // Auxiliary AI toggle
      analyticsEnabled: policy.analyticsEnabled, // Analytics opt-in state
      analyticsEndpointConfigured: isValidAppsScriptUrl(policy.analyticsEndpointUrl), // Boolean only (URL omitted)
      analyticsSharedTokenConfigured: policy.analyticsSharedToken.length > 0, // Boolean only (secret token redacted)
      analyticsFlushIntervalMinutes: policy.analyticsFlushIntervalMinutes, // Configured flush interval
      invalidFields: [...policy.invalidFields] // List of invalid policy fields if any
    }, // End policy section
    metrics: { // Aggregate counter summary
      lifetime: { ...telemetry.lifetimeMetrics }, // Lifetime integer counts
      pendingDateBuckets: Object.keys(telemetry.pendingMetricsByDate).sort() // Dates awaiting analytics flush
    }, // End metrics section
    analyticsSync: { // Analytics flush status metadata
      lastFlushAttemptDate: telemetry.lastFlushAttemptDate, // Last attempt date
      lastFlushSuccessDate: telemetry.lastFlushSuccessDate, // Last success date
      lastFlushStatus: telemetry.lastFlushStatus, // Status string
      lastFlushMessage: telemetry.lastFlushMessage, // Status message
      consecutiveFlushFailures: telemetry.consecutiveFlushFailures // Failure streak count
    }, // End analyticsSync section
    diagnosticLog: sortDiagnosticEntries(telemetry.diagnosticLog) // Sorted diagnostic entries
  }; // End diagnostic bundle
} // End buildZeroPiiDiagnosticBundle
function escapeCsvCell(value) { // RFC 4180 CSV cell escaping
  const str = String(value); // Convert cell value to string
  if (/[",\r\n]/.test(str)) { // Quote cells containing commas, quotes, or newlines
    return `"${str.replace(/"/g, '""')}"`; // Escape internal quotes by doubling
  } // End special character check
  return str; // Return plain cell string
} // End escapeCsvCell
function buildMetricsCsv(snapshot) { // Export lifetime and pending daily aggregate metrics as CSV (zero PII)
  const header = [ // CSV column headers
    "RowType", // LIFETIME_TOTAL or PENDING_DAILY
    "DateBucket", // UTC date string
    "GradeBand", // Active grade band
    "ExtensionVersion", // Extension version
    "OverviewsHidden", // AI Overviews hidden count
    "AiModeUiHidden", // AI Mode UI hidden count
    "AiModeRedirects", // AI Mode redirects count
    "OmniboxFallbackRedirects", // Omnibox fallback redirects count
    "AuxAiHidden" // Auxiliary AI hidden count
  ]; // End header
  const rows = [ // Start with lifetime total summary row
    [ // Lifetime total row
      "LIFETIME_TOTAL", // Row type
      snapshot.generatedAtDate, // Report date
      snapshot.policy.gradeBand, // Grade band
      snapshot.extensionVersion, // Extension version
      snapshot.telemetry.lifetimeMetrics.overviewsHidden, // Overviews count
      snapshot.telemetry.lifetimeMetrics.aiModeUiHidden, // AI Mode UI count
      snapshot.telemetry.lifetimeMetrics.aiModeRedirects, // Redirects count
      snapshot.telemetry.lifetimeMetrics.omniboxFallbackRedirects, // Omnibox fallback count
      snapshot.telemetry.lifetimeMetrics.auxAiHidden // Auxiliary AI count
    ] // End lifetime row
  ]; // End rows array
  const sortedDates = Object.keys(snapshot.telemetry.pendingMetricsByDate).sort(); // Sort pending daily buckets chronologically
  for (const dateBucket of sortedDates) { // Append one row per pending daily bucket
    const bucket = snapshot.telemetry.pendingMetricsByDate[dateBucket]; // Look up daily bucket
    if (!bucket) continue; // Skip missing bucket
    rows.push([ // Append daily row
      "PENDING_DAILY", // Row type
      dateBucket, // Bucket date
      snapshot.policy.gradeBand, // Grade band
      snapshot.extensionVersion, // Extension version
      bucket.overviewsHidden, // Daily overviews count
      bucket.aiModeUiHidden, // Daily AI Mode UI count
      bucket.aiModeRedirects, // Daily redirects count
      bucket.omniboxFallbackRedirects, // Daily Omnibox count
      bucket.auxAiHidden // Daily auxiliary AI count
    ]); // End row push
  } // End date loop
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n"; // Format CSV with trailing newline
} // End buildMetricsCsv
async function copyText(text) { // Copy text to clipboard with execCommand fallback
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) { // Prefer modern Clipboard API
    try { // Catch permission errors
      await navigator.clipboard.writeText(text); // Write to clipboard
      return true; // Success
    } catch { // Fall through to legacy fallback
    } // End try/catch
  } // End clipboard check
  const textarea = document.createElement("textarea"); // Create temporary offscreen textarea
  textarea.value = text; // Set text
  textarea.setAttribute("readonly", "true"); // Prevent keyboard popup
  textarea.className = "visually-hidden"; // Hide visually
  document.body.append(textarea); // Attach to DOM
  textarea.select(); // Select contents
  let ok = false; // Track copy success
  try { // Attempt execCommand copy
    ok = typeof document.execCommand === "function" && document.execCommand("copy"); // Run copy command
  } catch { // Ignore errors
    ok = false; // Mark failed
  } finally { // Always remove temporary textarea
    textarea.remove(); // Clean up DOM
  } // End try/catch/finally
  return ok; // Return result
} // End copyText
function downloadFile(filename, content, mimeType) { // Trigger a client-side file download via Blob URL
  const blob = new Blob([content], { type: mimeType }); // Create in-memory Blob
  const url = URL.createObjectURL(blob); // Allocate blob: URL
  const link = document.createElement("a"); // Create temporary anchor
  link.href = url; // Set href
  link.download = filename; // Set filename
  link.className = "visually-hidden"; // Hide visually
  document.body.append(link); // Attach to DOM
  link.click(); // Trigger download
  link.remove(); // Remove anchor
  window.setTimeout(() => { // Release Blob URL after 1 second
    URL.revokeObjectURL(url); // Revoke URL
  }, 1e3); // 1000ms delay
} // End downloadFile
async function fetchDiagnosticSnapshot() { // Fetch full diagnostic snapshot from service worker or storage fallback
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) { // Prefer service worker snapshot (includes live DNR count)
    try { // Catch messaging errors
      const response = await chrome.runtime.sendMessage({ // Query service worker
        type: "GET_DIAGNOSTIC_SNAPSHOT" // Message type
      }); // End sendMessage
      if (response && response.policy && response.telemetry) { // Validate response shape
        return response; // Return snapshot
      } // End response check
    } catch { // Fall through to direct storage read
    } // End try/catch
  } // End runtime check
  let managedRaw = null; // Fallback managed policy
  let localRaw = null; // Fallback local overrides
  let telemetry = createInitialTelemetryState(); // Fallback telemetry state
  if (typeof chrome !== "undefined" && chrome.storage?.managed?.get) { // Read managed storage directly
    try { // Catch storage errors
      managedRaw = await chrome.storage.managed.get(null); // Fetch managed keys
    } catch { // Ignore error
      managedRaw = null; // Reset to null
    } // End try/catch
  } // End managed check
  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) { // Read local storage directly
    try { // Catch storage errors
      const localData = await chrome.storage.local.get([ // Fetch local overrides and telemetry
        STORAGE_KEYS.LOCAL_OVERRIDES, // Local overrides key
        STORAGE_KEYS.TELEMETRY // Telemetry key
      ]); // End local.get
      localRaw = localData[STORAGE_KEYS.LOCAL_OVERRIDES] ?? null; // Extract overrides
      if (localData[STORAGE_KEYS.TELEMETRY]) { // Extract telemetry if present
        telemetry = localData[STORAGE_KEYS.TELEMETRY]; // Use stored telemetry
      } // End telemetry check
    } catch { // Ignore storage errors
    } // End try/catch
  } // End local storage check
  const parsed = parsePolicy(managedRaw, localRaw); // Parse fallback policy
  const version = typeof chrome !== "undefined" && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : "1.0.0"; // Read extension version
  return { // Return fallback snapshot
    policy: parsed.policy, // Resolved policy
    telemetry, // Telemetry state
    activeRuleCount: 0, // Unknown without service worker
    extensionVersion: version, // Extension version
    generatedAtDate: getTodayDateBucket() // Today's UTC date
  }; // End return
} // End fetchDiagnosticSnapshot
function setupAccessibleTabs() { // Implement WAI-ARIA Tabs pattern with keyboard navigation and hidden="until-found"
  const tablist = document.querySelector('[role="tablist"]'); // Locate tablist container
  if (!tablist) return; // Exit if missing
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]')); // Collect all tab buttons
  const panels = tabs.map((tab) => document.querySelector(`[role="tabpanel"][aria-labelledby="${tab.id}"]`)).filter((panel) => panel !== null); // Match each tab to its panel
  if (tabs.length === 0 || tabs.length !== panels.length) { // Guard against mismatched DOM
    return; // Exit
  } // End mismatch check
  function activateTab(index, moveFocus) { // Switch active tab and update ARIA/tabindex/hidden attributes
    const safeIndex = (index % tabs.length + tabs.length) % tabs.length; // Wrap index modulo tab count
    for (let i = 0; i < tabs.length; i += 1) { // Update all tabs and panels
      const isSelected = i === safeIndex; // Whether this tab is active
      const tab = tabs[i]; // Tab button
      const panel = panels[i]; // Tab panel
      tab.setAttribute("aria-selected", String(isSelected)); // Update ARIA selected state
      tab.tabIndex = isSelected ? 0 : -1; // Roving tabindex for keyboard accessibility
      if (isSelected) { // Show active panel
        panel.removeAttribute("hidden"); // Unhide panel
      } else { // Hide inactive panel while allowing browser Ctrl+F find-in-page
        panel.setAttribute("hidden", "until-found"); // Use hidden="until-found"
      } // End isSelected check
    } // End loop
    const activeTab = tabs[safeIndex]; // Reference newly activated tab
    if (moveFocus) { // Move keyboard focus when navigated via arrow/Home/End keys
      activeTab.focus(); // Focus tab
    } // End moveFocus check
    if (typeof activeTab.scrollIntoView === "function") { // Ensure tab button is visible in horizontal scrollbars
      activeTab.scrollIntoView({ block: "nearest", inline: "nearest" }); // Scroll into view
    } // End scrollIntoView check
  } // End activateTab
  for (let i = 0; i < tabs.length; i += 1) { // Attach click, keydown, and beforematch listeners to each tab/panel
    const tab = tabs[i]; // Tab button
    const panel = panels[i]; // Tab panel
    tab.addEventListener("click", () => { // Activate tab on click
      activateTab(i, false); // Switch without stealing focus
    }); // End click listener
    tab.addEventListener("keydown", (event) => { // Support ArrowRight, ArrowLeft, Home, and End keys
      if (event.key === "ArrowRight") { // Next tab
        event.preventDefault(); // Prevent page scroll
        activateTab(i + 1, true); // Move focus right
      } else if (event.key === "ArrowLeft") { // Previous tab
        event.preventDefault(); // Prevent page scroll
        activateTab(i - 1, true); // Move focus left
      } else if (event.key === "Home") { // First tab
        event.preventDefault(); // Prevent page scroll
        activateTab(0, true); // Move focus to first tab
      } else if (event.key === "End") { // Last tab
        event.preventDefault(); // Prevent page scroll
        activateTab(tabs.length - 1, true); // Move focus to last tab
      } // End key check
    }); // End keydown listener
    panel.addEventListener("beforematch", () => { // Auto-switch tab if browser Ctrl+F matches text inside a hidden panel
      activateTab(i, false); // Reveal matched panel
    }); // End beforematch listener
  } // End loop
} // End setupAccessibleTabs
async function bootOptionsPage() { // Initialize Options Hub DOM bindings, generator, diagnostics, and live listeners
  if (typeof document === "undefined") { // Guard in non-browser environments
    return; // Exit
  } // End document check
  const tabStatus = document.getElementById("tab-status"); // Verify Options HTML DOM is present
  if (!tabStatus) { // Exit if not on options.html
    return; // Exit
  } // End DOM check
  setupAccessibleTabs(); // Initialize accessible tab switching
  const globalAnnouncer = document.getElementById("global-announcer"); // Reference ARIA live announcer
  const announce = (message) => { // Helper to announce status updates to screen readers
    if (!globalAnnouncer) return; // Guard
    globalAnnouncer.textContent = ""; // Clear first to force re-announcement
    globalAnnouncer.textContent = message; // Set announcement text
  }; // End announce
  const generatorRoot = document.getElementById("options-policy-generator-root"); // Locate Tab 3 generator mount point
  if (generatorRoot) { // Mount 4-Band Admin Policy Generator
    mountPolicyGenerator(generatorRoot, { // Initialize generator UI
      appsScriptTemplate: EMBEDDED_APPS_SCRIPT_TEMPLATE, // Pass bundled Code.gs template
      onStatus: (msg) => announce(msg) // Forward status announcements
    }); // End mountPolicyGenerator
  } // End generatorRoot check
  const versionBadge = document.getElementById("ext-version-badge"); // Extension version pill in header
  const policyBanner = document.getElementById("policy-source-banner"); // Policy source banner container
  const policyTitle = document.getElementById("policy-source-title"); // Policy source headline
  const policyDetail = document.getElementById("policy-source-detail"); // Policy source description
  const policyModeBadge = document.getElementById("policy-mode-badge"); // Locked vs Interactive pill
  const gradeBandPill = document.getElementById("active-grade-band-pill"); // Active grade-band pill
  const ruleCountPill = document.getElementById("active-rule-count-pill"); // Active DNR rule count pill
  const gradeBandSelect = document.getElementById("grade-band-select"); // Grade-band dropdown
  const togglesSubtitle = document.getElementById("toggles-subtitle"); // Protection controls subtitle
  const statusSaveFeedback = document.getElementById("status-save-feedback"); // Local save status line
  const lockBadges = Array.from(document.querySelectorAll("[data-lock-badge]")); // All "Locked" badges on switches
  const toggleInputs = {}; // Map toggle key -> switch <input> element
  for (const key of FEATURE_TOGGLE_KEYS) { // Resolve each switch input element by ID
    toggleInputs[key] = document.getElementById(`toggle-${key}`); // Store element ref
  } // End toggle lookup loop
  const metricEls = { // Map metric card DOM value elements
    overviewsHidden: document.getElementById("metric-overviewsHidden"), // AI Overviews hidden counter
    aiModeUiHidden: document.getElementById("metric-aiModeUiHidden"), // AI Mode UI hidden counter
    aiModeRedirects: document.getElementById("metric-aiModeRedirects"), // AI Mode redirects counter
    omniboxFallbackRedirects: document.getElementById("metric-omniboxFallbackRedirects"), // Omnibox fallback counter
    auxAiHidden: document.getElementById("metric-auxAiHidden"), // Auxiliary AI hidden counter
    errorsWarnings: document.getElementById("metric-errorsWarnings"), // Errors/warnings counter
    errorsCard: document.getElementById("metric-card-errors") // Errors card container (highlighted on error)
  }; // End metricEls
  const analyticsBadge = document.getElementById("analytics-config-badge"); // Analytics config status pill
  const analyticsLastAttempt = document.getElementById("analytics-last-attempt"); // Last flush attempt date
  const analyticsLastSuccess = document.getElementById("analytics-last-success"); // Last flush success date
  const analyticsPendingCount = document.getElementById("analytics-pending-count"); // Pending batch count
  const analyticsLastMessage = document.getElementById("analytics-last-message"); // Last flush message
  const testFlushBtn = document.getElementById("btn-test-flush"); // "Test Flush Now" button
  const refreshDiagBtn = document.getElementById("btn-refresh-diag"); // "Refresh Diagnostics" button
  const copyDiagBtn = document.getElementById("btn-copy-diag-json"); // "Copy Diagnostic JSON" button
  const exportCsvBtn = document.getElementById("btn-export-csv"); // "Export Local Metrics CSV" button
  const resetMetricsBtn = document.getElementById("btn-reset-metrics"); // "Reset Local Counters" button
  const cancelResetBtn = document.getElementById("btn-cancel-reset"); // "Cancel Reset" button
  const diagActionStatus = document.getElementById("diag-action-status"); // Diagnostics action feedback line
  const diagTableBody = document.getElementById("diag-table-body"); // Diagnostics table <tbody>
  let currentSnapshot = null; // Most recently rendered diagnostic snapshot
  let resetArmed = false; // Two-step reset confirmation state
  let resetArmTimer = null; // Timer auto-disarming reset confirmation after 10s
  function setStatusFeedback(message, isError = false) { // Update Tab 1 local save status line
    if (!statusSaveFeedback) return; // Guard
    statusSaveFeedback.textContent = message; // Set message text
    statusSaveFeedback.classList.toggle("status-line-error", isError); // Apply error styling if needed
    announce(message); // Announce to screen readers
  } // End setStatusFeedback
  function setDiagFeedback(message, isError = false) { // Update Tab 2 diagnostic action status line
    if (!diagActionStatus) return; // Guard
    diagActionStatus.textContent = message; // Set message text
    diagActionStatus.classList.toggle("status-line-error", isError); // Apply error styling if needed
    announce(message); // Announce to screen readers
  } // End setDiagFeedback
  function disarmResetConfirm() { // Reset the two-step "Reset Local Counters" button back to its idle state
    resetArmed = false; // Clear armed flag
    if (resetArmTimer !== null) { // Clear auto-disarm timer if active
      window.clearTimeout(resetArmTimer); // Cancel timeout
      resetArmTimer = null; // Clear handle
    } // End timer check
    if (resetMetricsBtn) { // Restore default button text and danger styling
      resetMetricsBtn.textContent = "Reset Local Counters"; // Restore label
      resetMetricsBtn.classList.remove("rm-btn-danger-confirm"); // Remove armed class
      resetMetricsBtn.classList.add("rm-btn-danger"); // Restore idle danger class
    } // End button check
    if (cancelResetBtn) { // Hide cancel button
      cancelResetBtn.hidden = true; // Hide
    } // End cancel button check
  } // End disarmResetConfirm
  function renderDiagnosticTable(entries) { // Render sorted diagnostic errors and warnings into Tab 2 table
    if (!diagTableBody) return; // Guard
    diagTableBody.replaceChildren(); // Clear existing rows safely
    const sorted = sortDiagnosticEntries(entries); // Sort by severity, date, count, code
    if (sorted.length === 0) { // Show empty-state row when no issues exist
      const tr = document.createElement("tr"); // Table row
      const td = document.createElement("td"); // Spanning cell
      td.colSpan = 5; // Span all 5 columns
      td.className = "diag-empty-cell"; // Apply empty-state styling
      td.textContent = "No errors or warnings recorded. All protections are operating normally."; // Reassuring message
      tr.append(td); // Append cell
      diagTableBody.append(tr); // Append row
      return; // Exit
    } // End empty check
    for (const entry of sorted) { // Render one table row per diagnostic entry
      const tr = document.createElement("tr"); // Table row
      const codeTh = document.createElement("th"); // Row header cell for severity + code
      codeTh.scope = "row"; // Accessible row header scope
      codeTh.className = "diag-code-cell"; // Apply cell styling
      const sevPill = document.createElement("span"); // Severity badge pill
      sevPill.className = entry.severity === "error" ? "rm-pill rm-pill-red" : "rm-pill rm-pill-amber"; // Red for error, amber for warning
      sevPill.textContent = entry.severity === "error" ? "ERROR" : "WARNING"; // Badge label
      const codeEl = document.createElement("code"); // Monospace error code
      codeEl.className = "diag-code-text"; // Apply code styling
      codeEl.textContent = entry.code; // Set error code text
      codeTh.append(sevPill, codeEl); // Assemble header cell
      const countTd = document.createElement("td"); // Occurrence count cell
      countTd.textContent = String(entry.count); // Set count
      const dateTd = document.createElement("td"); // Last-seen date cell
      dateTd.textContent = entry.lastSeenDate; // Set YYYY-MM-DD date
      const detailTd = document.createElement("td"); // Diagnostic detail cell
      detailTd.textContent = entry.detail || entry.title; // Set detail or fallback title
      const fixTd = document.createElement("td"); // Remediation guidance cell
      fixTd.className = "diag-remediation"; // Apply remediation styling
      const fixPrefix = document.createElement("strong"); // Bold prefix
      fixPrefix.textContent = "How to Fix: "; // Prefix label
      fixTd.append(fixPrefix, document.createTextNode(entry.remediation)); // Assemble remediation text
      tr.append(codeTh, countTd, dateTd, detailTd, fixTd); // Assemble row
      diagTableBody.append(tr); // Append row to table body
    } // End entries loop
  } // End renderDiagnosticTable
  function renderSnapshot(snapshot) { // Populate Tab 1 and Tab 2 UI from a diagnostic snapshot
    currentSnapshot = snapshot; // Cache latest snapshot for export actions
    const { policy, telemetry } = snapshot; // Destructure policy and telemetry
    if (versionBadge) { // Update header version badge
      versionBadge.textContent = `v${snapshot.extensionVersion}`; // Set version string
    } // End versionBadge check
    if (policyBanner && policyTitle && policyDetail && policyModeBadge) { // Update policy source banner and mode pill
      policyBanner.classList.remove( // Clear previous banner state classes
        "policy-banner-managed", // Managed class
        "policy-banner-degraded", // Degraded class
        "policy-banner-unmanaged" // Unmanaged class
      ); // End classList.remove
      policyModeBadge.classList.remove("rm-pill-navy", "rm-pill-red", "rm-pill-amber"); // Clear previous pill color classes
      if (policy.isManaged && policy.source === "managed-degraded") { // Managed policy with invalid fields that fell back fail-closed
        policyBanner.classList.add("policy-banner-degraded"); // Apply degraded warning banner
        policyTitle.textContent = "Managed by Google Admin Console (Degraded \u2014 Fail-Closed)"; // Set headline
        policyDetail.textContent = `Invalid managed policy fields (${policy.invalidFields.join(", ")}) fell back to Strict Maximum Lockdown ON. See IT Diagnostics for exact fixes.`; // Explain degraded fields
        policyModeBadge.classList.add("rm-pill-red"); // Red badge
        policyModeBadge.textContent = "Locked (Degraded)"; // Badge text
      } else if (policy.isManaged) { // Valid Google Admin Console managed policy
        policyBanner.classList.add("policy-banner-managed"); // Apply managed banner
        policyTitle.textContent = "Managed by Google Admin Console"; // Set headline
        policyDetail.textContent = "Policy is centrally enforced via chrome.storage.managed. Local browser overrides are disabled."; // Explain lock
        policyModeBadge.classList.add("rm-pill-navy"); // Navy badge
        policyModeBadge.textContent = "Locked"; // Badge text
      } else { // Unmanaged / local IT testing mode
        policyBanner.classList.add("policy-banner-unmanaged"); // Apply unmanaged banner
        policyTitle.textContent = "Unmanaged Local Testing Mode"; // Set headline
        policyDetail.textContent = policy.source === "local-unmanaged" ? "Running with local IT testing overrides saved in chrome.storage.local. Push managed JSON via Google Admin Console for student Chromebooks." : "No Google Admin Console policy detected \u2014 Strict Maximum Lockdown defaults are active. Toggle switches below to test locally."; // Explain unmanaged state
        policyModeBadge.classList.add("rm-pill-amber"); // Amber badge
        policyModeBadge.textContent = "Interactive"; // Badge text
      } // End policy source branch
    } // End banner elements check
    if (gradeBandPill) { // Update active grade-band badge
      gradeBandPill.textContent = `Grade Band: ${policy.gradeBand}`; // Set grade band text
    } // End gradeBandPill check
    if (ruleCountPill) { // Update active DNR rule count badge
      const label = snapshot.activeRuleCount === 1 ? "rule" : "rules"; // Singular/plural label
      ruleCountPill.textContent = `${snapshot.activeRuleCount} active network ${label}`; // Set rule count text
    } // End ruleCountPill check
    if (gradeBandSelect) { // Sync grade-band dropdown and lock when managed
      gradeBandSelect.value = policy.gradeBand; // Select current grade band
      gradeBandSelect.disabled = policy.isManaged; // Disable dropdown when managed
    } // End gradeBandSelect check
    if (togglesSubtitle) { // Update controls subtitle for managed vs unmanaged state
      togglesSubtitle.textContent = policy.isManaged ? "All controls are read-only and enforced by your Google Admin Console OU policy." : "On unmanaged devices, switches save locally for IT testing and immediately sync network rules and active Google tabs."; // Set subtitle
    } // End togglesSubtitle check
    for (const badge of lockBadges) { // Show or hide "Locked" badges next to switches
      badge.hidden = !policy.isManaged; // Visible only when managed
    } // End lockBadges loop
    for (const key of FEATURE_TOGGLE_KEYS) { // Sync all 6 protection switch states and lock status
      const input = toggleInputs[key]; // Look up switch input
      if (!input) continue; // Skip if missing
      input.checked = policy[key]; // Set checked state
      input.disabled = policy.isManaged; // Lock switch when managed
    } // End toggleInputs loop
    if (metricEls.overviewsHidden) { // Update AI Overviews hidden counter
      metricEls.overviewsHidden.textContent = String(telemetry.lifetimeMetrics.overviewsHidden); // Set count
    } // End overviewsHidden check
    if (metricEls.aiModeUiHidden) { // Update AI Mode UI hidden counter
      metricEls.aiModeUiHidden.textContent = String(telemetry.lifetimeMetrics.aiModeUiHidden); // Set count
    } // End aiModeUiHidden check
    if (metricEls.aiModeRedirects) { // Update AI Mode URLs redirected counter
      metricEls.aiModeRedirects.textContent = String(telemetry.lifetimeMetrics.aiModeRedirects); // Set count
    } // End aiModeRedirects check
    if (metricEls.omniboxFallbackRedirects) { // Update Omnibox fallback redirects counter
      metricEls.omniboxFallbackRedirects.textContent = String( // Set count
        telemetry.lifetimeMetrics.omniboxFallbackRedirects // Read lifetime Omnibox count
      ); // End String()
    } // End omniboxFallbackRedirects check
    if (metricEls.auxAiHidden) { // Update auxiliary AI hidden counter
      metricEls.auxAiHidden.textContent = String(telemetry.lifetimeMetrics.auxAiHidden); // Set count
    } // End auxAiHidden check
    const diagCount = telemetry.diagnosticLog.length; // Total diagnostic log entries
    const hasError = telemetry.diagnosticLog.some((entry) => entry.severity === "error"); // Check if any entry is severity "error"
    if (metricEls.errorsWarnings) { // Update errors/warnings counter
      metricEls.errorsWarnings.textContent = String(diagCount); // Set count
    } // End errorsWarnings check
    if (metricEls.errorsCard) { // Highlight errors card when at least one error exists
      metricEls.errorsCard.classList.toggle("metric-card-alert", hasError); // Toggle alert styling
    } // End errorsCard check
    const endpointValid = isValidAppsScriptUrl(policy.analyticsEndpointUrl); // Validate configured Apps Script endpoint
    if (analyticsBadge) { // Update analytics sync status pill
      analyticsBadge.classList.remove("rm-pill-slate", "rm-pill-teal", "rm-pill-red"); // Clear previous colors
      if (!policy.analyticsEnabled) { // Disabled (default)
        analyticsBadge.classList.add("rm-pill-slate"); // Slate badge
        analyticsBadge.textContent = "Disabled (Local-Only)"; // Status text
      } else if (endpointValid) { // Enabled with valid Apps Script URL
        analyticsBadge.classList.add("rm-pill-teal"); // Teal badge
        analyticsBadge.textContent = `Configured (every ${policy.analyticsFlushIntervalMinutes}m)`; // Status text
      } else { // Enabled but URL is invalid or missing
        analyticsBadge.classList.add("rm-pill-red"); // Red badge
        analyticsBadge.textContent = "Configured \u2014 Invalid Endpoint URL"; // Status text
      } // End analytics status branch
    } // End analyticsBadge check
    if (analyticsLastAttempt) { // Update last flush attempt date
      analyticsLastAttempt.textContent = telemetry.lastFlushAttemptDate ?? "Never"; // Set date or Never
    } // End lastAttempt check
    if (analyticsLastSuccess) { // Update last flush success date
      analyticsLastSuccess.textContent = telemetry.lastFlushSuccessDate ?? "Never"; // Set date or Never
    } // End lastSuccess check
    if (analyticsPendingCount) { // Update pending daily batch count
      analyticsPendingCount.textContent = String( // Set count
        Object.keys(telemetry.pendingMetricsByDate).length // Count pending date buckets
      ); // End String()
    } // End pendingCount check
    if (analyticsLastMessage) { // Update last flush status message
      analyticsLastMessage.textContent = telemetry.lastFlushMessage || ""; // Set message
    } // End lastMessage check
    if (testFlushBtn) { // Show "Test Flush Now" button only when analytics is enabled
      testFlushBtn.hidden = !policy.analyticsEnabled; // Hide when disabled
      testFlushBtn.disabled = !policy.analyticsEnabled; // Disable when disabled
    } // End testFlushBtn check
    renderDiagnosticTable(telemetry.diagnosticLog); // Re-render Tab 2 diagnostic table
  } // End renderSnapshot
  async function refreshSnapshot() { // Reload diagnostic snapshot and re-render UI
    const snapshot = await fetchDiagnosticSnapshot(); // Fetch snapshot
    renderSnapshot(snapshot); // Render snapshot
  } // End refreshSnapshot
  async function persistLocalOverride(partial) { // Save an unmanaged local test-mode toggle or gradeBand change
    if (currentSnapshot?.policy.isManaged) { // Guard against modifying managed policy
      setStatusFeedback("Policy is locked by Google Admin Console and cannot be changed locally.", true); // Show error
      return; // Exit
    } // End managed guard
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) { // Send override update to service worker
      try { // Catch messaging errors
        const updated = await chrome.runtime.sendMessage({ // Send SET_LOCAL_OVERRIDES message
          type: "SET_LOCAL_OVERRIDES", // Message type
          toggles: partial // Partial toggle/gradeBand update
        }); // End sendMessage
        if (updated) { // Refresh UI on success
          await refreshSnapshot(); // Reload snapshot
          setStatusFeedback("Local testing setting saved and applied."); // Show confirmation
          return; // Done
        } // End updated check
      } catch { // Handle messaging failure
        setStatusFeedback("Failed to reach background service worker to save setting.", true); // Show error
        return; // Exit
      } // End try/catch
    } // End runtime check
    await refreshSnapshot(); // Fallback refresh
  } // End persistLocalOverride
  if (gradeBandSelect) { // Handle local grade-band dropdown change
    gradeBandSelect.addEventListener("change", () => { // Listen for selection change
      const value = gradeBandSelect.value; // Read selected grade band
      if (VALID_GRADE_BANDS.includes(value)) { // Validate against enum
        void persistLocalOverride({ gradeBand: value }); // Save local override
      } // End validation
    }); // End change listener
  } // End gradeBandSelect check
  for (const key of FEATURE_TOGGLE_KEYS) { // Wire change listeners for all 6 Tab 1 switches
    const input = toggleInputs[key]; // Get switch element
    if (!input) continue; // Skip if missing
    input.addEventListener("change", () => { // Persist switch change locally
      void persistLocalOverride({ [key]: input.checked }); // Save local override
    }); // End change listener
  } // End switch loop
  refreshDiagBtn?.addEventListener("click", async () => { // Handle "Refresh Diagnostics" button click
    await refreshSnapshot(); // Reload snapshot
    setDiagFeedback("Diagnostics refreshed."); // Show confirmation
  }); // End refreshDiagBtn listener
  copyDiagBtn?.addEventListener("click", async () => { // Handle "Copy Diagnostic JSON" button click
    const snapshot = currentSnapshot ?? await fetchDiagnosticSnapshot(); // Use cached or fresh snapshot
    const bundle = buildZeroPiiDiagnosticBundle(snapshot); // Build zero-PII diagnostic JSON
    const copied = await copyText(JSON.stringify(bundle, null, 2)); // Copy formatted JSON to clipboard
    if (copied) { // Report copy result
      setDiagFeedback("Copied zero-PII Diagnostic JSON to clipboard."); // Success message
    } else { // Report clipboard failure
      setDiagFeedback("Could not copy Diagnostic JSON to clipboard.", true); // Error message
    } // End copied check
  }); // End copyDiagBtn listener
  exportCsvBtn?.addEventListener("click", async () => { // Handle "Export Local Metrics CSV" button click
    const snapshot = currentSnapshot ?? await fetchDiagnosticSnapshot(); // Use cached or fresh snapshot
    const csv = buildMetricsCsv(snapshot); // Build aggregate CSV
    downloadFile( // Trigger CSV file download
      `raisemark-search-guard-metrics-${snapshot.generatedAtDate}.csv`, // Filename with UTC date
      csv, // CSV contents
      "text/csv;charset=utf-8" // MIME type
    ); // End downloadFile
    setDiagFeedback("Exported local metrics CSV."); // Show confirmation
  }); // End exportCsvBtn listener
  testFlushBtn?.addEventListener("click", async () => { // Handle "Test Flush Now" button click
    if (!testFlushBtn) return; // Guard
    testFlushBtn.disabled = true; // Prevent double-clicks while flushing
    setDiagFeedback("Running test flush to district Apps Script endpoint\u2026"); // Show in-progress status
    try { // Trigger immediate flush in background service worker
      const result = await chrome.runtime.sendMessage({ // Send TRIGGER_TEST_FLUSH
        type: "TRIGGER_TEST_FLUSH" // Message type
      }); // End sendMessage
      await refreshSnapshot(); // Refresh dashboard with flush result
      if (result) { // Display flush outcome
        setDiagFeedback(result.message, result.status === "error"); // Show result message
      } else { // Fallback message
        setDiagFeedback("Test flush completed."); // Show completion
      } // End result check
    } catch { // Handle messaging error
      setDiagFeedback("Failed to trigger test flush.", true); // Show error
    } finally { // Re-enable button if analytics is still enabled
      if (currentSnapshot?.policy.analyticsEnabled) { // Check policy
        testFlushBtn.disabled = false; // Re-enable button
      } // End analyticsEnabled check
    } // End try/catch/finally
  }); // End testFlushBtn listener
  resetMetricsBtn?.addEventListener("click", async () => { // Handle two-step "Reset Local Counters" button click
    if (!resetArmed) { // First click arms confirmation for 10 seconds
      resetArmed = true; // Arm reset
      if (resetMetricsBtn) { // Update button label and warning style
        resetMetricsBtn.textContent = "Click Again to Confirm Reset"; // Confirmation prompt
        resetMetricsBtn.classList.remove("rm-btn-danger"); // Remove idle class
        resetMetricsBtn.classList.add("rm-btn-danger-confirm"); // Add armed class
      } // End button check
      if (cancelResetBtn) { // Show cancel button
        cancelResetBtn.hidden = false; // Reveal cancel button
      } // End cancel check
      setDiagFeedback('Click "Click Again to Confirm Reset" within 10 seconds to clear local counters.'); // Prompt user
      resetArmTimer = window.setTimeout(() => { // Auto-disarm if user does not confirm within 10s
        disarmResetConfirm(); // Disarm
      }, RESET_CONFIRM_WINDOW_MS); // 10-second window
      return; // Wait for second click
    } // End first-click branch
    disarmResetConfirm(); // Disarm immediately on confirmation click
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) { // Send reset command to service worker
      try { // Catch messaging errors
        await chrome.runtime.sendMessage({ type: "RESET_LOCAL_METRICS" }); // Clear local telemetry
        await refreshSnapshot(); // Refresh UI counters to 0
        setDiagFeedback("Local counters and diagnostic log cleared."); // Confirm reset
      } catch { // Handle error
        setDiagFeedback("Failed to reset local counters.", true); // Show error
      } // End try/catch
    } // End runtime check
  }); // End resetMetricsBtn listener
  cancelResetBtn?.addEventListener("click", () => { // Cancel armed counter reset
    disarmResetConfirm(); // Disarm reset state
    setDiagFeedback("Reset cancelled."); // Confirm cancellation
  }); // End cancelResetBtn listener
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) { // Auto-refresh dashboard when managed or local storage changes
    chrome.storage.onChanged.addListener((_changes, areaName) => { // Listen for storage updates
      if (areaName === "managed" || areaName === "local") { // Refresh on managed or local changes
        void refreshSnapshot(); // Reload snapshot
      } // End areaName check
    }); // End storage listener
  } // End chrome.storage check
  await refreshSnapshot(); // Perform initial data load and render
} // End bootOptionsPage
if (typeof document !== "undefined") { // Auto-boot only when loaded in a browser document
  if (document.readyState === "loading") { // Wait for DOMContentLoaded if document is still parsing
    document.addEventListener("DOMContentLoaded", () => { // Listen for DOMContentLoaded
      void bootOptionsPage(); // Boot options hub
    }); // End listener
  } else { // Document already parsed
    void bootOptionsPage(); // Boot options hub immediately
  } // End readyState check
} // End document check
export { // Export pure helper functions for unit testing
  buildMetricsCsv, // Export CSV builder
  buildZeroPiiDiagnosticBundle, // Export diagnostic JSON builder
  sortDiagnosticEntries // Export diagnostic entry sorter
}; // End export block
