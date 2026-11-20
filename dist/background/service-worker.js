// src/shared/defaults.ts — Default policy constants, metric keys, and storage keys
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
var APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/; // Strict allowlist regex permitting only deployed Google Apps Script /exec URLs
var METRIC_KEYS = [ // Aggregate integer counter keys (zero PII; no URLs or queries)
  "overviewsHidden", // Count of search pages where an AI Overview was hidden
  "aiModeUiHidden", // Count of AI Mode UI buttons/tabs hidden
  "aiModeRedirects", // Count of direct AI Mode URL navigations redirected
  "omniboxFallbackRedirects", // Count of Chrome Omnibox/NTP AI Mode clicks caught by fallback rule
  "auxAiHidden" // Count of auxiliary AI features hidden
]; // End METRIC_KEYS
var STORAGE_KEYS = { // Keys used in chrome.storage.local
  LOCAL_OVERRIDES: "rmsg_local_overrides", // Stores unmanaged local test-mode settings
  TELEMETRY: "rmsg_telemetry", // Stores aggregate metrics and diagnostic logs
  LAST_POLICY: "rmsg_last_policy" // Caches the most recently evaluated policy snapshot
}; // End STORAGE_KEYS
var ANALYTICS_ALARM_NAME = "rmsg-analytics-flush"; // Chrome alarm name for periodic analytics flush
var MAX_DIAGNOSTIC_LOG_ENTRIES = 50; // Cap diagnostic log size to bound local storage usage
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
function createInitialTelemetryState() { // Construct a fresh telemetry state object for new installs or resets
  return { // Return initial telemetry state
    lifetimeMetrics: createEmptyMetrics(), // Cumulative local counters for IT dashboard
    pendingMetricsByDate: {}, // Date-bucketed (YYYY-MM-DD) aggregate counts awaiting analytics flush
    pendingErrorsByCode: {}, // Error-code counts awaiting analytics flush
    diagnosticLog: [], // Capped list of deduplicated diagnostic entries
    lastFlushAttemptDate: null, // Date of most recent analytics flush attempt
    lastFlushSuccessDate: null, // Date of most recent successful analytics flush
    lastFlushStatus: "idle", // Current flush status ("idle" | "ok" | "error" | "disabled")
    lastFlushMessage: "Analytics disabled (local-only mode).", // Human-readable status summary
    consecutiveFlushFailures: 0, // Failure counter used for exponential backoff
    nextEligibleFlushAtMs: 0 // Epoch timestamp (ms) before which automatic flushes are deferred
  }; // End initial telemetry state
} // End createInitialTelemetryState

// src/shared/errors.ts — Actionable IT diagnostic catalog and remediation templates
var ALL_ERROR_CODES = [ // Complete allowlist of valid diagnostic error/warning codes
  "ERR_POLICY_INVALID", // Managed JSON contained invalid field types or out-of-range numbers
  "ERR_DNR_SYNC_FAILED", // Chrome rejected declarativeNetRequest dynamic rule update
  "ERR_SELECTOR_SYNTAX", // A DOM CSS selector threw a syntax error in querySelectorAll
  "ERR_SAFETY_GUARD_TRIPPED", // Safety guard blocked hiding a core Google Search landmark
  "ERR_ANALYTICS_ENDPOINT_INVALID", // Analytics enabled without a valid Apps Script /exec URL
  "ERR_ANALYTICS_FLUSH_FAILED", // Network, HTTP, or Apps Script error during telemetry flush
  "ERR_STORAGE_FAILURE", // Chrome storage read/write exception
  "WARN_NO_MANAGED_POLICY", // No Google Admin Console policy found (unmanaged/test mode)
  "WARN_OMNIBOX_POLICY_MISSING" // Omnibox/NTP AI Mode click occurred (Chrome AIModeSettings policy recommended)
]; // End ALL_ERROR_CODES
var ERROR_CATALOG = { // Metadata and step-by-step IT remediation guidance for each diagnostic code
  ERR_POLICY_INVALID: { // Invalid managed policy field entry
    code: "ERR_POLICY_INVALID", // Diagnostic code
    severity: "error", // Severity level
    title: "Invalid Managed Policy Configuration", // Short title for Options UI table
    remediationTemplate: "One or more fields in your Google Admin Console 'Policy for extensions' JSON are invalid (fields: {detail}). Invalid boolean toggles fell back to locked-down ON. Regenerate valid JSON in the Admin Policy Generator tab and re-save under Devices > Chrome > Apps & extensions." // Remediation text
  }, // End ERR_POLICY_INVALID
  ERR_DNR_SYNC_FAILED: { // Dynamic redirect rule sync failure entry
    code: "ERR_DNR_SYNC_FAILED", // Diagnostic code
    severity: "error", // Severity level
    title: "Dynamic Redirect Rule Sync Failed", // Short title
    remediationTemplate: "Chrome rejected a dynamic redirect rule update ({detail}). Reload the extension or verify Chrome version is 120+. If persistent, copy diagnostics and report to RaiseMark Support." // Remediation text
  }, // End ERR_DNR_SYNC_FAILED
  ERR_SELECTOR_SYNTAX: { // DOM selector validation failure entry
    code: "ERR_SELECTOR_SYNTAX", // Diagnostic code
    severity: "error", // Severity level
    title: "DOM Selector Validation Error", // Short title
    remediationTemplate: "A bundled DOM selector failed browser validation ({detail}). Other detection tiers remain active. Update to the latest RaiseMark AI Search Guard release." // Remediation text
  }, // End ERR_SELECTOR_SYNTAX
  ERR_SAFETY_GUARD_TRIPPED: { // Organic Results Safety Guard activation entry
    code: "ERR_SAFETY_GUARD_TRIPPED", // Diagnostic code
    severity: "error", // Severity level
    title: "Organic Results Safety Guard Tripped", // Short title
    remediationTemplate: "Safety Guard prevented hiding core Google Search results ({detail}). Google likely changed its page structure. Check for an extension update." // Remediation text
  }, // End ERR_SAFETY_GUARD_TRIPPED
  ERR_ANALYTICS_ENDPOINT_INVALID: { // Invalid Apps Script endpoint URL entry
    code: "ERR_ANALYTICS_ENDPOINT_INVALID", // Diagnostic code
    severity: "error", // Severity level
    title: "Invalid Analytics Endpoint URL", // Short title
    remediationTemplate: "Analytics is enabled, but analyticsEndpointUrl does not match https://script.google.com/macros/s/<ID>/exec. Paste your deployed Google Apps Script Web App URL in the Admin Policy JSON." // Remediation text
  }, // End ERR_ANALYTICS_ENDPOINT_INVALID
  ERR_ANALYTICS_FLUSH_FAILED: { // Analytics HTTP flush failure entry
    code: "ERR_ANALYTICS_FLUSH_FAILED", // Diagnostic code
    severity: "error", // Severity level
    title: "District Analytics Flush Failed", // Short title
    remediationTemplate: "Failed to flush anonymous counts to district Google Sheet ({detail}). Verify Apps Script is deployed as Web App -> Execute as: Me -> Who has access: Anyone, and that analyticsSharedToken matches Code.gs. Retrying with backoff." // Remediation text
  }, // End ERR_ANALYTICS_FLUSH_FAILED
  ERR_STORAGE_FAILURE: { // Chrome storage read/write error entry
    code: "ERR_STORAGE_FAILURE", // Diagnostic code
    severity: "error", // Severity level
    title: "Extension Storage Read/Write Error", // Short title
    remediationTemplate: "Browser extension storage error ({detail}). Check Chrome profile disk quota or reload the browser." // Remediation text
  }, // End ERR_STORAGE_FAILURE
  WARN_NO_MANAGED_POLICY: { // Missing managed policy warning entry
    code: "WARN_NO_MANAGED_POLICY", // Diagnostic code
    severity: "warning", // Severity level
    title: "No Google Admin Console Policy Detected", // Short title
    remediationTemplate: "No Google Admin Console policy detected. Strict Maximum Lockdown defaults are active (or local test toggles on unmanaged devices). To configure by grade level, paste JSON from the Admin Policy Generator into Devices > Chrome > Apps & extensions > Policy for extensions." // Remediation text
  }, // End WARN_NO_MANAGED_POLICY
  WARN_OMNIBOX_POLICY_MISSING: { // Chrome native Omnibox AI Mode policy warning entry
    code: "WARN_OMNIBOX_POLICY_MISSING", // Diagnostic code
    severity: "warning", // Severity level
    title: "Chrome Native Omnibox AI Mode Policy Not Configured", // Short title
    remediationTemplate: "An AI Mode click arrived from Chrome's native Omnibox or New Tab Page and was silently blocked. To remove the native browser button itself, set AIModeSettings = 'Do not allow' (1) under Devices > Chrome > Settings > Users & browsers for this grade OU (Chrome/ChromeOS 138+)." // Remediation text
  } // End WARN_OMNIBOX_POLICY_MISSING
}; // End ERROR_CATALOG
function formatRemediation(code, detail) { // Interpolate sanitized detail into a catalog remediation template
  const entry = ERROR_CATALOG[code]; // Look up catalog entry by code
  const sanitizedDetail = typeof detail === "string" && detail.trim().length > 0 ? detail.trim().replace(/\s+/g, " ").slice(0, 240) : "unspecified"; // Normalize whitespace and cap detail at 240 chars
  return entry.remediationTemplate.replace("{detail}", sanitizedDetail); // Insert detail into template
} // End formatRemediation
function getTodayDateBucket(now = /* @__PURE__ */ new Date()) { // Return UTC date string (YYYY-MM-DD) for daily aggregation
  return now.toISOString().slice(0, 10); // Extract YYYY-MM-DD prefix from ISO timestamp
} // End getTodayDateBucket
function createDiagnosticEntry(code, detail, dateBucket) { // Construct a new diagnostic log entry
  const catalogEntry = ERROR_CATALOG[code]; // Look up severity and title from catalog
  const date = dateBucket ?? getTodayDateBucket(); // Default to today's UTC date bucket
  const cleanDetail = detail.trim().replace(/\s+/g, " ").slice(0, 240); // Normalize and bound detail string
  return { // Return structured diagnostic entry
    code, // Diagnostic error/warning code
    severity: catalogEntry.severity, // "error" or "warning"
    title: catalogEntry.title, // Short human-readable title
    detail: cleanDetail, // Sanitized diagnostic detail
    remediation: formatRemediation(code, cleanDetail), // Actionable IT fix instructions
    count: 1, // Initial occurrence count
    firstSeenDate: date, // Date first observed
    lastSeenDate: date // Date most recently observed
  }; // End diagnostic entry object
} // End createDiagnosticEntry

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

// src/shared/storage.ts — Serialized Chrome storage read/write and telemetry sanitizers
var storageQueueTail = Promise.resolve(); // Promise chain tail serializing all read-modify-write operations to prevent race conditions
async function enqueueStorageOp(fn) { // Execute an async storage operation strictly sequentially
  const previous = storageQueueTail; // Capture current queue tail
  let release; // Resolver function to release the next operation in queue
  storageQueueTail = new Promise((resolve) => { // Create new tail promise for subsequent callers
    release = resolve; // Capture resolve handle
  }); // End queue promise
  await previous; // Wait until all earlier storage operations finish
  try { // Ensure queue lock is always released even if fn() throws
    return await fn(); // Run the serialized storage operation
  } finally { // Always release lock
    release(); // Unblock the next queued operation
  } // End try/finally
} // End enqueueStorageOp
function formatErrorMessage(err) { // Convert unknown thrown value into a safe string message
  if (err instanceof Error) { // Use Error.message when available
    return err.message; // Return error message
  } // End Error check
  return String(err); // Coerce non-Error values to string
} // End formatErrorMessage
function sanitizeMetrics(raw) { // Validate and normalize a metrics object to non-negative integers
  const metrics = createEmptyMetrics(); // Start with zeroed metric keys
  if (!raw || typeof raw !== "object") { // Guard against null or non-object storage data
    return metrics; // Return zeroed metrics
  } // End type check
  const obj = raw; // Alias raw object
  for (const key of METRIC_KEYS) { // Validate each allowed metric key
    const val = obj[key]; // Read raw value
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) { // Accept finite non-negative numbers only
      metrics[key] = Math.floor(val); // Truncate to integer
    } // End number check
  } // End loop
  return metrics; // Return sanitized metrics
} // End sanitizeMetrics
function sanitizePendingMetricsByDate(raw) { // Validate date-bucketed pending metrics map
  const out = {}; // Initialize clean map
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { // Reject non-plain objects
    return out; // Return empty map
  } // End type check
  for (const [dateKey, value] of Object.entries(raw)) { // Iterate over stored date buckets
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { // Only keep valid YYYY-MM-DD date keys
      out[dateKey] = sanitizeMetrics(value); // Sanitize the bucket's metric counters
    } // End date format check
  } // End loop
  return out; // Return sanitized map
} // End sanitizePendingMetricsByDate
function sanitizePendingErrorsByCode(raw) { // Validate error-code count map against ALL_ERROR_CODES allowlist
  const out = {}; // Initialize clean map
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { // Reject non-plain objects
    return out; // Return empty map
  } // End type check
  const obj = raw; // Alias raw object
  for (const code of ALL_ERROR_CODES) { // Only iterate known allowlisted error codes
    const val = obj[code]; // Read stored count
    if (typeof val === "number" && Number.isFinite(val) && val > 0) { // Accept positive finite numbers only
      out[code] = Math.floor(val); // Truncate to integer
    } // End count check
  } // End loop
  return out; // Return sanitized map
} // End sanitizePendingErrorsByCode
function sanitizeDiagnosticLog(raw) { // Validate and cap stored diagnostic log entries
  if (!Array.isArray(raw)) { // Require array input
    return []; // Return empty log
  } // End array check
  const validCodes = new Set(ALL_ERROR_CODES); // Fast lookup set of valid error codes
  const entries = []; // Accumulate sanitized entries
  for (const item of raw) { // Inspect each stored entry
    if (!item || typeof item !== "object") { // Skip non-object items
      continue; // Next item
    } // End object check
    const candidate = item; // Alias candidate item
    if (typeof candidate.code !== "string" || !validCodes.has(candidate.code)) { // Reject unknown error codes
      continue; // Next item
    } // End code check
    const code = candidate.code; // Validated diagnostic code
    const detail = typeof candidate.detail === "string" ? candidate.detail : ""; // Extract string detail
    const firstSeenDate = typeof candidate.firstSeenDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.firstSeenDate) ? candidate.firstSeenDate : getTodayDateBucket(); // Validate firstSeenDate
    const lastSeenDate = typeof candidate.lastSeenDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.lastSeenDate) ? candidate.lastSeenDate : firstSeenDate; // Validate lastSeenDate
    const count = typeof candidate.count === "number" && Number.isFinite(candidate.count) && candidate.count > 0 ? Math.floor(candidate.count) : 1; // Validate occurrence count
    const base = createDiagnosticEntry(code, detail, firstSeenDate); // Rebuild title, severity, and remediation from catalog
    entries.push({ // Append sanitized entry
      ...base, // Spread catalog fields
      count, // Restored count
      firstSeenDate, // Restored first-seen date
      lastSeenDate // Restored last-seen date
    }); // End push
    if (entries.length >= MAX_DIAGNOSTIC_LOG_ENTRIES) { // Enforce maximum log size cap
      break; // Stop reading additional entries
    } // End cap check
  } // End loop
  return entries; // Return sanitized diagnostic log
} // End sanitizeDiagnosticLog
function normalizeTelemetryState(raw) { // Normalize raw chrome.storage.local telemetry into a valid TelemetryState
  const initial = createInitialTelemetryState(); // Create baseline default state
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { // Return baseline if storage is empty or corrupted
    return initial; // Return initial state
  } // End type check
  const obj = raw; // Alias raw object
  const validStatuses = /* @__PURE__ */ new Set(["idle", "ok", "error", "disabled"]); // Allowed flush status values
  const lastFlushStatus = typeof obj.lastFlushStatus === "string" && validStatuses.has(obj.lastFlushStatus) ? obj.lastFlushStatus : initial.lastFlushStatus; // Validate flush status
  return { // Return normalized telemetry state
    lifetimeMetrics: sanitizeMetrics(obj.lifetimeMetrics), // Sanitized lifetime counters
    pendingMetricsByDate: sanitizePendingMetricsByDate(obj.pendingMetricsByDate), // Sanitized daily pending buckets
    pendingErrorsByCode: sanitizePendingErrorsByCode(obj.pendingErrorsByCode), // Sanitized pending error counts
    diagnosticLog: sanitizeDiagnosticLog(obj.diagnosticLog), // Sanitized diagnostic log
    lastFlushAttemptDate: typeof obj.lastFlushAttemptDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.lastFlushAttemptDate) ? obj.lastFlushAttemptDate : null, // Validated last attempt date
    lastFlushSuccessDate: typeof obj.lastFlushSuccessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.lastFlushSuccessDate) ? obj.lastFlushSuccessDate : null, // Validated last success date
    lastFlushStatus, // Validated status string
    lastFlushMessage: typeof obj.lastFlushMessage === "string" ? obj.lastFlushMessage : initial.lastFlushMessage, // Validated status message
    consecutiveFlushFailures: typeof obj.consecutiveFlushFailures === "number" && Number.isFinite(obj.consecutiveFlushFailures) && obj.consecutiveFlushFailures >= 0 ? Math.floor(obj.consecutiveFlushFailures) : 0, // Validated failure count
    nextEligibleFlushAtMs: typeof obj.nextEligibleFlushAtMs === "number" && Number.isFinite(obj.nextEligibleFlushAtMs) && obj.nextEligibleFlushAtMs >= 0 ? obj.nextEligibleFlushAtMs : 0 // Validated backoff timestamp
  }; // End normalized object
} // End normalizeTelemetryState
async function readManagedPolicyRaw() { // Read enterprise policy object from chrome.storage.managed
  if (typeof chrome === "undefined" || !chrome.storage?.managed) { // Guard when managed storage API is unavailable
    return { data: {} }; // Return empty object
  } // End API check
  try { // Catch storage read errors
    const result = await chrome.storage.managed.get(null); // Fetch all managed keys pushed by Google Admin Console
    if (!result || typeof result !== "object" || Array.isArray(result)) { // Ensure plain object response
      return { data: {} }; // Return empty object on unexpected shape
    } // End shape check
    return { data: result }; // Return managed policy data
  } catch (err) { // Handle storage exception
    return { data: {}, error: formatErrorMessage(err) }; // Return empty object plus error message
  } // End try/catch
} // End readManagedPolicyRaw
async function readLocalOverrides() { // Read local IT test-mode overrides from chrome.storage.local
  if (typeof chrome === "undefined" || !chrome.storage?.local) { // Guard when local storage API is unavailable
    return { data: null }; // Return null
  } // End API check
  try { // Catch storage read errors
    const result = await chrome.storage.local.get(STORAGE_KEYS.LOCAL_OVERRIDES); // Fetch local override key
    const raw = result?.[STORAGE_KEYS.LOCAL_OVERRIDES]; // Extract override value
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { // Validate plain object shape
      return { data: null }; // Return null if absent or malformed
    } // End shape check
    return { data: raw }; // Return local overrides
  } catch (err) { // Handle storage exception
    return { data: null, error: formatErrorMessage(err) }; // Return null plus error message
  } // End try/catch
} // End readLocalOverrides
async function writeLocalOverrides(overrides) { // Persist local IT test-mode overrides to chrome.storage.local
  await enqueueStorageOp(async () => { // Serialize write through storage queue
    if (typeof chrome === "undefined" || !chrome.storage?.local) { // Ensure local storage API is available
      throw new Error("chrome.storage.local is unavailable"); // Throw explicit error
    } // End API check
    await chrome.storage.local.set({ [STORAGE_KEYS.LOCAL_OVERRIDES]: overrides }); // Save overrides object
  }); // End queued op
} // End writeLocalOverrides
async function readTelemetryState() { // Read and normalize telemetry state from chrome.storage.local
  if (typeof chrome === "undefined" || !chrome.storage?.local) { // Guard when local storage API is unavailable
    return createInitialTelemetryState(); // Return empty initial state
  } // End API check
  const result = await chrome.storage.local.get(STORAGE_KEYS.TELEMETRY); // Fetch stored telemetry object
  return normalizeTelemetryState(result?.[STORAGE_KEYS.TELEMETRY]); // Normalize and return state
} // End readTelemetryState
async function writeTelemetryState(state) { // Persist telemetry state to chrome.storage.local
  if (typeof chrome === "undefined" || !chrome.storage?.local) { // Ensure local storage API is available
    throw new Error("chrome.storage.local is unavailable"); // Throw explicit error
  } // End API check
  await chrome.storage.local.set({ [STORAGE_KEYS.TELEMETRY]: state }); // Save telemetry state
} // End writeTelemetryState
async function incrementTelemetryMetrics(deltas, now = /* @__PURE__ */ new Date()) { // Atomically increment lifetime and daily pending counters
  return enqueueStorageOp(async () => { // Serialize read-modify-write via queue
    const state = await readTelemetryState(); // Read current telemetry state
    const dateBucket = getTodayDateBucket(now); // Resolve today's UTC date bucket (YYYY-MM-DD)
    const existingBucket = state.pendingMetricsByDate[dateBucket] ?? createEmptyMetrics(); // Load or create today's bucket
    let changed = false; // Track whether any positive delta was applied
    for (const key of METRIC_KEYS) { // Iterate allowlisted metric keys
      const rawDelta = deltas[key]; // Read incoming increment
      if (typeof rawDelta === "number" && Number.isFinite(rawDelta) && rawDelta > 0) { // Accept positive finite numbers only
        const delta = Math.floor(rawDelta); // Truncate to integer
        if (delta > 0) { // Apply non-zero increment
          state.lifetimeMetrics[key] = (state.lifetimeMetrics[key] ?? 0) + delta; // Increment lifetime counter
          existingBucket[key] = (existingBucket[key] ?? 0) + delta; // Increment daily pending bucket
          changed = true; // Mark state as modified
        } // End integer check
      } // End number check
    } // End metric loop
    if (changed) { // Persist only if counters actually changed
      state.pendingMetricsByDate[dateBucket] = existingBucket; // Store updated daily bucket
      await writeTelemetryState(state); // Save updated state
    } // End changed check
    return state; // Return updated telemetry state
  }); // End queued op
} // End incrementTelemetryMetrics
async function recordDiagnosticEntry(code, detail = "", now = /* @__PURE__ */ new Date()) { // Record or deduplicate a diagnostic error/warning in storage
  return enqueueStorageOp(async () => { // Serialize read-modify-write via queue
    const state = await readTelemetryState(); // Read current telemetry state
    const dateBucket = getTodayDateBucket(now); // Resolve today's UTC date bucket
    const cleanDetail = detail.trim().replace(/\s+/g, " ").slice(0, 240); // Normalize whitespace and cap detail length
    state.pendingErrorsByCode[code] = (state.pendingErrorsByCode[code] ?? 0) + 1; // Increment pending error count for analytics
    const existingIndex = state.diagnosticLog.findIndex( // Look for an existing log entry with the same code and detail
      (entry) => entry.code === code && entry.detail === cleanDetail // Match code + detail
    ); // End findIndex
    if (existingIndex >= 0) { // Update existing entry in place to avoid log spam
      const existing = state.diagnosticLog[existingIndex]; // Reference existing entry
      existing.count += 1; // Increment occurrence count
      existing.lastSeenDate = dateBucket; // Update last-seen date
      existing.remediation = formatRemediation(code, cleanDetail); // Refresh remediation text
    } else { // Insert new diagnostic entry
      const newEntry = createDiagnosticEntry(code, cleanDetail, dateBucket); // Build new entry
      if (state.diagnosticLog.length >= MAX_DIAGNOSTIC_LOG_ENTRIES) { // Evict oldest-seen entry if log is at capacity
        let evictIdx = 0; // Start with index 0 as eviction candidate
        for (let i = 1; i < state.diagnosticLog.length; i++) { // Scan for entry with oldest lastSeenDate
          if (state.diagnosticLog[i].lastSeenDate < state.diagnosticLog[evictIdx].lastSeenDate) { // Compare YYYY-MM-DD strings lexicographically
            evictIdx = i; // Update eviction index
          } // End comparison
        } // End scan loop
        state.diagnosticLog.splice(evictIdx, 1); // Remove oldest entry
      } // End eviction check
      state.diagnosticLog.push(newEntry); // Append new entry
    } // End existingIndex branch
    await writeTelemetryState(state); // Persist updated telemetry state
    return state; // Return updated state
  }); // End queued op
} // End recordDiagnosticEntry
async function resetLocalTelemetry() { // Clear all local metrics and diagnostic logs
  return enqueueStorageOp(async () => { // Serialize reset via queue
    const fresh = createInitialTelemetryState(); // Create clean zeroed state
    await writeTelemetryState(fresh); // Overwrite stored telemetry
    return fresh; // Return fresh state
  }); // End queued op
} // End resetLocalTelemetry

// src/background/analytics.ts — Opt-in zero-PII district Google Sheets telemetry flush
var ALLOWED_PAYLOAD_KEYS = [ // Strict top-level key allowlist enforced before any network POST
  "schemaVersion", // Payload schema version (1)
  "extensionVersion", // Extension semver string
  "token", // Optional shared secret token
  "gradeBand", // OU grade-band label
  "dateBucket", // UTC date string (YYYY-MM-DD)
  "metrics", // Aggregate integer counts
  "errors" // Aggregate error-code counts
]; // End ALLOWED_PAYLOAD_KEYS
var ALLOWED_PAYLOAD_KEY_SET = new Set(ALLOWED_PAYLOAD_KEYS); // O(1) lookup set for payload key allowlist
var VALID_GRADE_BAND_SET = new Set(VALID_GRADE_BANDS); // O(1) lookup set for valid grade bands
var VALID_METRIC_KEY_SET = new Set(METRIC_KEYS); // O(1) lookup set for valid metric keys
var VALID_ERROR_CODE_SET = new Set(ALL_ERROR_CODES); // O(1) lookup set for valid error codes
var SEMVER_REGEX = /^\d+\.\d+\.\d+$/; // Strict semantic version pattern (X.Y.Z)
var DATE_BUCKET_REGEX = /^\d{4}-\d{2}-\d{2}$/; // Strict YYYY-MM-DD date format
var MAX_COUNT_VALUE = 1e5; // Sanity cap (100,000) per metric counter per batch
var MAX_BACKOFF_MS = 24 * 60 * 60 * 1e3; // Maximum exponential backoff delay (24 hours)
var BASE_BACKOFF_MS = 15 * 60 * 1e3; // Initial exponential backoff delay (15 minutes)
var FETCH_TIMEOUT_MS = 15e3; // Network request timeout (15 seconds)
function sanitizeIntegerCount(value) { // Clamp a count to a non-negative integer within [0, MAX_COUNT_VALUE]
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) { // Reject invalid or negative numbers
    return 0; // Return zero
  } // End validation
  return Math.min(MAX_COUNT_VALUE, Math.floor(value)); // Truncate and clamp
} // End sanitizeIntegerCount
function isPlainObject(value) { // Check whether value is a non-null, non-array object
  return typeof value === "object" && value !== null && !Array.isArray(value); // Return boolean
} // End isPlainObject
function sumMetrics(metrics) { // Sum all 5 metric counters to check if a daily bucket is non-empty
  let total = 0; // Initialize sum
  for (const key of METRIC_KEYS) { // Iterate all metric keys
    total += sanitizeIntegerCount(metrics[key]); // Add sanitized integer count
  } // End loop
  return total; // Return total count
} // End sumMetrics
function buildSanitizedPayload(input) { // Construct a strictly allowlisted, zero-PII analytics payload
  const cleanVersion = typeof input.extensionVersion === "string" && SEMVER_REGEX.test(input.extensionVersion.trim()) ? input.extensionVersion.trim() : "1.0.0"; // Validate semver string
  const cleanGradeBand = typeof input.gradeBand === "string" && VALID_GRADE_BAND_SET.has(input.gradeBand) ? input.gradeBand : "Unassigned"; // Validate grade band
  const cleanDateBucket = typeof input.dateBucket === "string" && DATE_BUCKET_REGEX.test(input.dateBucket) ? input.dateBucket : getTodayDateBucket(); // Validate date bucket
  const cleanMetrics = createEmptyMetrics(); // Initialize zeroed metrics object
  if (isPlainObject(input.metrics)) { // Copy only allowlisted integer metric counters
    for (const key of METRIC_KEYS) { // Iterate METRIC_KEYS
      cleanMetrics[key] = sanitizeIntegerCount(input.metrics[key]); // Sanitize count
    } // End metric loop
  } // End metrics object check
  const cleanErrors = {}; // Initialize empty error counts object
  if (isPlainObject(input.errors)) { // Copy only allowlisted positive error-code counts
    for (const code of ALL_ERROR_CODES) { // Iterate ALL_ERROR_CODES
      const count = sanitizeIntegerCount(input.errors[code]); // Sanitize count
      if (count > 0) { // Omit zero-count error codes
        cleanErrors[code] = count; // Store count
      } // End positive check
    } // End error loop
  } // End errors object check
  const payload = { // Assemble final payload object
    schemaVersion: 1, // Fixed schema version
    extensionVersion: cleanVersion, // Validated extension version
    gradeBand: cleanGradeBand, // Validated OU grade band
    dateBucket: cleanDateBucket, // Validated YYYY-MM-DD date bucket
    metrics: cleanMetrics, // Validated aggregate metrics
    errors: cleanErrors // Validated aggregate error counts
  }; // End payload object
  if (typeof input.token === "string") { // Include optional shared token only if non-empty
    const trimmedToken = input.token.trim(); // Trim whitespace
    if (trimmedToken.length > 0) { // Check non-empty
      payload.token = trimmedToken; // Attach shared token
    } // End length check
  } // End token check
  return payload; // Return sanitized payload
} // End buildSanitizedPayload
function assertNoPiiPayload(payload) { // Runtime defense-in-depth gate: verify payload contains zero PII or unexpected keys
  if (!isPlainObject(payload)) { // Payload must be a plain object
    return false; // Reject
  } // End object check
  const ownKeys = Object.getOwnPropertyNames(payload); // Inspect all own property names
  for (const key of ownKeys) { // Reject any unexpected top-level keys
    if (!ALLOWED_PAYLOAD_KEY_SET.has(key)) { // Key not in allowlist
      return false; // Reject
    } // End key check
  } // End key loop
  if (payload.schemaVersion !== 1) { // Enforce exact schema version
    return false; // Reject
  } // End schemaVersion check
  if (typeof payload.extensionVersion !== "string" || !SEMVER_REGEX.test(payload.extensionVersion)) { // Enforce semver format
    return false; // Reject
  } // End version check
  if (typeof payload.gradeBand !== "string" || !VALID_GRADE_BAND_SET.has(payload.gradeBand)) { // Enforce grade-band enum
    return false; // Reject
  } // End gradeBand check
  if (typeof payload.dateBucket !== "string" || !DATE_BUCKET_REGEX.test(payload.dateBucket)) { // Enforce YYYY-MM-DD format
    return false; // Reject
  } // End dateBucket check
  if ("token" in payload) { // Validate optional token string length
    if (typeof payload.token !== "string" || payload.token.trim().length === 0 || payload.token.length > 256) { // Enforce bounded non-empty token
      return false; // Reject
    } // End token validation
  } // End token presence check
  if (!isPlainObject(payload.metrics)) { // Metrics must be a plain object
    return false; // Reject
  } // End metrics object check
  const metricKeys = Object.getOwnPropertyNames(payload.metrics); // Inspect metric keys
  if (metricKeys.length !== METRIC_KEYS.length) { // Must contain exact set of metric keys
    return false; // Reject
  } // End key count check
  for (const key of metricKeys) { // Validate each metric key and integer value
    if (!VALID_METRIC_KEY_SET.has(key)) { // Must be an allowlisted metric key
      return false; // Reject
    } // End key check
    const val = payload.metrics[key]; // Read metric count
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > MAX_COUNT_VALUE) { // Must be bounded integer
      return false; // Reject
    } // End value check
  } // End metric loop
  if (!isPlainObject(payload.errors)) { // Errors must be a plain object
    return false; // Reject
  } // End errors object check
  const errorKeys = Object.getOwnPropertyNames(payload.errors); // Inspect error keys
  for (const key of errorKeys) { // Validate each error code and integer count
    if (!VALID_ERROR_CODE_SET.has(key)) { // Must be an allowlisted error code
      return false; // Reject
    } // End code check
    const val = payload.errors[key]; // Read error count
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > MAX_COUNT_VALUE) { // Must be bounded integer
      return false; // Reject
    } // End value check
  } // End error loop
  return true; // Payload is strictly verified zero-PII
} // End assertNoPiiPayload
function calculateBackoffMs(consecutiveFailures) { // Compute capped exponential backoff (15m, 30m, 1h, ... up to 24h)
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, consecutiveFailures - 1)); // Exponential delay capped at 24h
} // End calculateBackoffMs
async function scheduleAnalyticsAlarm(policy, rng = Math.random) { // Schedule or clear the periodic analytics flush alarm with jitter
  if (!policy.analyticsEnabled || !isValidAppsScriptUrl(policy.analyticsEndpointUrl)) { // Clear alarm when analytics is disabled or misconfigured
    await chrome.alarms.clear(ANALYTICS_ALARM_NAME); // Cancel alarm
    return; // Exit
  } // End disabled check
  const delayInMinutes = policy.analyticsFlushIntervalMinutes + Math.floor(rng() * 31); // Add 0-30 min random jitter to avoid thundering herd across district devices
  await chrome.alarms.create(ANALYTICS_ALARM_NAME, { delayInMinutes }); // Register Chrome alarm
} // End scheduleAnalyticsAlarm
function getDefaultExtensionVersion() { // Read extension version from Chrome manifest with safe fallback
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) { // Check manifest API
    const version = chrome.runtime.getManifest().version; // Read manifest version
    if (typeof version === "string" && SEMVER_REGEX.test(version)) { // Verify semver format
      return version; // Return manifest version
    } // End semver check
  } // End API check
  return "1.0.0"; // Fallback version
} // End getDefaultExtensionVersion
async function flushAnalyticsIfDue(policy, options) { // Flush queued daily aggregate metrics to district Google Apps Script endpoint
  const force = options?.force ?? false; // Whether IT manually triggered "Test Flush Now"
  const fetchFn = options?.fetchImpl ?? fetch; // Injectable fetch for unit testing
  const now = options?.now ?? /* @__PURE__ */ new Date(); // Injectable clock for testing
  const today = getTodayDateBucket(now); // Today's UTC date string
  const extensionVersion = options?.extensionVersion ?? getDefaultExtensionVersion(); // Extension version string
  if (!policy.analyticsEnabled) { // Abort immediately if analytics is disabled by policy
    await enqueueStorageOp(async () => { // Update status message in telemetry state
      const state = await readTelemetryState(); // Read state
      state.lastFlushStatus = "disabled"; // Mark disabled
      state.lastFlushMessage = "Analytics disabled (local-only mode)."; // Set status text
      await writeTelemetryState(state); // Persist state
    }); // End queued op
    return { // Return disabled result
      attempted: false, // No network request made
      status: "disabled", // Disabled status
      flushedBuckets: 0, // Zero buckets flushed
      message: "Analytics disabled (local-only mode)." // Status message
    }; // End return
  } // End !analyticsEnabled branch
  if (!isValidAppsScriptUrl(policy.analyticsEndpointUrl)) { // Enforce strict Apps Script URL allowlist before any fetch
    const detail = policy.analyticsEndpointUrl ? "analyticsEndpointUrl failed Apps Script allowlist validation" : "analyticsEndpointUrl is missing"; // Build diagnostic detail
    await enqueueStorageOp(async () => { // Record error status in telemetry state
      const state = await readTelemetryState(); // Read state
      state.lastFlushAttemptDate = today; // Record attempt date
      state.lastFlushStatus = "error"; // Mark error
      state.lastFlushMessage = "Invalid Apps Script endpoint URL."; // Set error message
      await writeTelemetryState(state); // Persist state
    }); // End queued op
    await recordDiagnosticEntry("ERR_ANALYTICS_ENDPOINT_INVALID", detail, now); // Log actionable diagnostic entry
    return { // Return error result
      attempted: false, // No network request made
      status: "error", // Error status
      flushedBuckets: 0, // Zero buckets flushed
      message: "Invalid Apps Script endpoint URL.", // Error message
      errorCode: "ERR_ANALYTICS_ENDPOINT_INVALID" // Diagnostic code
    }; // End return
  } // End URL validation check
  const initialState = await readTelemetryState(); // Load current telemetry queue
  if (!force && initialState.nextEligibleFlushAtMs > now.getTime()) { // Respect exponential backoff unless manually forced
    return { // Defer flush
      attempted: false, // No network request made
      status: "idle", // Idle status
      flushedBuckets: 0, // Zero buckets flushed
      message: "Flush deferred until exponential backoff window elapses." // Backoff message
    }; // End return
  } // End backoff check
  const errorsSnapshot = {}; // Snapshot pending error counts to include in flush
  let hasPendingErrors = false; // Track whether any error counts are non-zero
  for (const code of ALL_ERROR_CODES) { // Iterate allowlisted error codes
    const count = sanitizeIntegerCount(initialState.pendingErrorsByCode[code]); // Read sanitized count
    if (count > 0) { // Include non-zero error counts
      errorsSnapshot[code] = count; // Store in snapshot
      hasPendingErrors = true; // Flag pending errors
    } // End positive check
  } // End error snapshot loop
  const dateBuckets = Object.keys(initialState.pendingMetricsByDate).sort(); // Sort pending date buckets chronologically
  const nonEmptyMetricBuckets = []; // Collect date buckets with non-zero metric totals
  for (const dateBucket of dateBuckets) { // Process each date bucket
    if (!DATE_BUCKET_REGEX.test(dateBucket)) { // Skip invalid date keys
      continue; // Next bucket
    } // End date format check
    const rawBucket = initialState.pendingMetricsByDate[dateBucket]; // Read raw bucket
    const clonedMetrics = createEmptyMetrics(); // Clone into clean metrics object
    for (const key of METRIC_KEYS) { // Copy each metric key
      clonedMetrics[key] = sanitizeIntegerCount(rawBucket?.[key]); // Sanitize count
    } // End metric copy loop
    if (sumMetrics(clonedMetrics) > 0) { // Only queue buckets with actual activity
      nonEmptyMetricBuckets.push({ dateBucket, metrics: clonedMetrics }); // Add non-empty bucket
    } // End non-empty check
  } // End dateBuckets loop
  const snapshots = []; // Build ordered list of per-day batch payloads to POST
  if (nonEmptyMetricBuckets.length > 0) { // Normal case: one payload per non-empty date bucket
    nonEmptyMetricBuckets.forEach((bucket, index) => { // Attach error counts to the final bucket only
      const isLast = index === nonEmptyMetricBuckets.length - 1; // Check if last bucket
      snapshots.push({ // Queue bucket payload
        dateBucket: bucket.dateBucket, // Bucket date
        metrics: bucket.metrics, // Bucket metrics
        errors: isLast ? errorsSnapshot : {} // Send error counts once
      }); // End push
    }); // End forEach
  } else if (hasPendingErrors) { // Edge case: errors occurred with zero metric counts
    snapshots.push({ // Queue error-only payload for today
      dateBucket: today, // Today's date
      metrics: createEmptyMetrics(), // Zeroed metrics
      errors: errorsSnapshot // Pending error counts
    }); // End push
  } else if (force) { // Manual "Test Flush Now" with empty queue sends a zero-count connectivity ping
    snapshots.push({ // Queue test ping payload
      dateBucket: today, // Today's date
      metrics: createEmptyMetrics(), // Zeroed metrics
      errors: {} // No errors
    }); // End push
  } else { // Nothing pending and not forced
    return { // Skip network call
      attempted: false, // No network request made
      status: "idle", // Idle status
      flushedBuckets: 0, // Zero buckets flushed
      message: "No pending metrics or errors to flush." // Status message
    }; // End return
  } // End snapshot construction
  let flushedBuckets = 0; // Count successfully acknowledged buckets
  try { // Execute network POSTs with timeout and error handling
    for (const bucket of snapshots) { // POST each daily bucket sequentially
      const payload = buildSanitizedPayload({ // Build zero-PII payload
        extensionVersion, // Extension version
        gradeBand: policy.gradeBand, // Grade band label
        dateBucket: bucket.dateBucket, // UTC date bucket
        metrics: bucket.metrics, // Aggregate counts
        errors: bucket.errors, // Aggregate error counts
        token: policy.analyticsSharedToken || void 0 // Optional shared token
      }); // End buildSanitizedPayload
      if (!assertNoPiiPayload(payload)) { // Enforce zero-PII invariant before fetch
        throw new Error("Sanitized analytics payload failed zero-PII validation"); // Abort if invariant fails
      } // End PII assertion
      const controller = new AbortController(); // Create abort controller for 15s timeout
      const timeoutId = setTimeout(() => { // Schedule timeout abort
        controller.abort(); // Cancel fetch if Apps Script hangs
      }, FETCH_TIMEOUT_MS); // 15-second timeout
      let response; // Hold fetch Response
      try { // Execute POST request
        response = await fetchFn(policy.analyticsEndpointUrl, { // POST JSON as text/plain (Apps Script CORS-friendly)
          method: "POST", // HTTP POST
          headers: { "Content-Type": "text/plain;charset=utf-8" }, // Avoid CORS preflight issues with Apps Script
          redirect: "follow", // Follow Apps Script 302 redirect to script.googleusercontent.com
          body: JSON.stringify(payload), // Serialize zero-PII JSON
          signal: controller.signal // Attach abort signal
        }); // End fetch
      } finally { // Always clear timeout timer
        clearTimeout(timeoutId); // Clear timer
      } // End try/finally
      if (!response.ok) { // Require HTTP 2xx status
        throw new Error(`HTTP ${response.status}`); // Throw HTTP error
      } // End response.ok check
      let body; // Hold parsed JSON response
      try { // Parse Apps Script JSON response
        body = await response.json(); // Parse response body
      } catch { // Handle non-JSON response (e.g., login HTML page if deployed wrong)
        throw new Error("Invalid JSON response from Apps Script endpoint"); // Throw parse error
      } // End JSON parse
      if (!isPlainObject(body) || body.status !== "ok") { // Require { status: "ok" } confirmation from Apps Script
        const remoteCode = isPlainObject(body) && typeof body.code === "string" ? body.code : "NON_OK_RESPONSE"; // Extract remote error code
        throw new Error(`Apps Script rejected batch (${remoteCode})`); // Throw rejection error
      } // End body.status check
      flushedBuckets += 1; // Increment flushed bucket count
      await enqueueStorageOp(async () => { // Atomically subtract flushed counts from local pending queue
        const current = await readTelemetryState(); // Re-read latest state (new events may have arrived during fetch)
        const currentBucket = current.pendingMetricsByDate[bucket.dateBucket]; // Look up bucket
        if (currentBucket) { // Subtract only the counts that were actually sent
          let remainingSum = 0; // Track remaining unsent counts
          for (const key of METRIC_KEYS) { // Subtract per metric key
            const nextVal = Math.max(0, (currentBucket[key] ?? 0) - (bucket.metrics[key] ?? 0)); // Clamp at 0
            currentBucket[key] = nextVal; // Store remaining count
            remainingSum += nextVal; // Accumulate sum
          } // End metric subtraction loop
          if (remainingSum === 0) { // Remove empty date bucket to keep storage tidy
            delete current.pendingMetricsByDate[bucket.dateBucket]; // Delete empty bucket
          } // End empty check
        } // End currentBucket check
        for (const [code, sentCount] of Object.entries(bucket.errors)) { // Subtract sent error counts
          const curCount = current.pendingErrorsByCode[code] ?? 0; // Read current count
          const nextCount = Math.max(0, curCount - sentCount); // Subtract sent count
          if (nextCount === 0) { // Delete zeroed error key
            delete current.pendingErrorsByCode[code]; // Remove key
          } else { // Store remaining count
            current.pendingErrorsByCode[code] = nextCount; // Update count
          } // End zero check
        } // End error subtraction loop
        current.lastFlushAttemptDate = today; // Record attempt date
        current.lastFlushSuccessDate = today; // Record success date
        current.lastFlushStatus = "ok"; // Mark status ok
        current.lastFlushMessage = `Flushed ${flushedBuckets} daily bucket(s) successfully.`; // Update status message
        current.consecutiveFlushFailures = 0; // Reset failure counter
        current.nextEligibleFlushAtMs = 0; // Clear backoff window
        await writeTelemetryState(current); // Persist updated telemetry state
      }); // End queued subtraction
    } // End snapshots loop
    return { // Return success summary
      attempted: true, // Network request attempted
      status: "ok", // Success status
      flushedBuckets, // Number of buckets flushed
      message: `Flushed ${flushedBuckets} daily bucket(s) successfully.` // Summary message
    }; // End return
  } catch (err) { // Handle network, timeout, or Apps Script rejection errors
    const detail = err instanceof Error ? err.name === "AbortError" ? "Request timed out after 15s" : err.message : String(err); // Format error detail
    await enqueueStorageOp(async () => { // Record failure and schedule exponential backoff
      const current = await readTelemetryState(); // Read current state
      const nextFailures = current.consecutiveFlushFailures + 1; // Increment failure counter
      const backoffMs = calculateBackoffMs(nextFailures); // Compute exponential backoff delay
      current.consecutiveFlushFailures = nextFailures; // Save failure count
      current.nextEligibleFlushAtMs = now.getTime() + backoffMs; // Set next eligible flush timestamp
      current.lastFlushAttemptDate = today; // Record attempt date
      current.lastFlushStatus = "error"; // Mark error status
      current.lastFlushMessage = detail; // Store error detail
      await writeTelemetryState(current); // Persist updated state
    }); // End queued failure update
    await recordDiagnosticEntry("ERR_ANALYTICS_FLUSH_FAILED", detail, now); // Log diagnostic entry for IT dashboard
    return { // Return failure summary
      attempted: true, // Network request attempted
      status: "error", // Error status
      flushedBuckets, // Partial count if some buckets succeeded before failure
      message: detail, // Error message
      errorCode: "ERR_ANALYTICS_FLUSH_FAILED" // Diagnostic code
    }; // End return
  } // End try/catch
} // End flushAnalyticsIfDue

// src/background/dnr-rules.ts — Chrome declarativeNetRequest (DNR) dynamic redirect rules
var ALL_MANAGED_RULE_IDS = [101, 102, 110, 111, 120, 130]; // Fixed IDs of all DNR rules managed by Search Guard
var ACTION_REDIRECT = "redirect"; // DNR action type for URL redirection
var ACTION_ALLOW = "allow"; // DNR action type to exempt explicit Search tabs (Images/Videos/News/etc.)
var RESOURCE_MAIN_FRAME = "main_frame"; // Apply rules only to top-level page navigations (not subresources)
function createAiModeQueryTransform(forceWebOnlySearch) { // Build query parameter transform when redirecting out of AI Mode
  if (forceWebOnlySearch) { // If Web-only mode is also enforced, switch udm=50 to udm=14
    return { // Return queryTransform
      addOrReplaceParams: [{ key: "udm", value: "14" }], // Force classic Web-only results
      removeParams: ["aep", "arv", "mstk", "csuir"] // Strip Chrome AI Mode tracking/entry parameters
    }; // End queryTransform
  } // End forceWebOnlySearch check
  return { // Otherwise strip udm=50 and AI Mode parameters to return to standard Google Search
    removeParams: ["udm", "aep", "arv", "mstk", "csuir"] // Remove AI Mode query parameters while keeping student's q= query
  }; // End queryTransform
} // End createAiModeQueryTransform
function buildDynamicRules(policy) { // Compile active Chrome declarativeNetRequest rules from effective policy
  if (!policy.masterEnabled) { // Remove all network rules when master switch is off
    return []; // Return empty rule list
  } // End masterEnabled check
  const rules = []; // Accumulate DNR rules to install
  if (policy.blockAiModeNavigation) { // Add AI Mode URL blocking/redirection rules when enabled
    rules.push({ // Rule 101: Catch Chrome Omnibox / NTP AI Mode clicks (sourceid=chrome or aep= before udm=50)
      id: 101, // Unique rule ID
      priority: 55, // Highest priority so Omnibox fallback is tagged separately from standard AI Mode links
      action: { // Redirect action
        type: ACTION_REDIRECT, // Redirect request
        redirect: { // URL transform
          transform: { // Modify query and append telemetry hash
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch), // Transform AI Mode params
            fragment: "#rm_sg_omnibox" // Tag for content.js to log WARN_OMNIBOX_POLICY_MISSING (stripped immediately)
          } // End transform
        } // End redirect
      }, // End action
      condition: { // Match Google Search URLs containing sourceid=chrome or aep= followed by udm=50
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?(sourceid=chrome|aep=)[^#]*&udm=50(&|$)", // Regex filter
        resourceTypes: [RESOURCE_MAIN_FRAME] // Top-level navigation only
      } // End condition
    }); // End Rule 101
    rules.push({ // Rule 102: Catch Chrome Omnibox / NTP AI Mode clicks when udm=50 appears before sourceid=chrome/aep=
      id: 102, // Unique rule ID
      priority: 55, // Same high priority as Rule 101
      action: { // Redirect action
        type: ACTION_REDIRECT, // Redirect request
        redirect: { // URL transform
          transform: { // Modify query and append telemetry hash
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch), // Transform AI Mode params
            fragment: "#rm_sg_omnibox" // Tag for Omnibox fallback diagnostic
          } // End transform
        } // End redirect
      }, // End action
      condition: { // Match Google Search URLs with udm=50 before sourceid=chrome or aep=
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50&[^#]*(sourceid=chrome|aep=)", // Regex filter
        resourceTypes: [RESOURCE_MAIN_FRAME] // Top-level navigation only
      } // End condition
    }); // End Rule 102
    rules.push({ // Rule 110: Redirect any remaining Google Search AI Mode URL (?udm=50)
      id: 110, // Unique rule ID
      priority: 50, // Lower priority than Omnibox rules 101/102
      action: { // Redirect action
        type: ACTION_REDIRECT, // Redirect request
        redirect: { // URL transform
          transform: { // Modify query and append AI Mode telemetry hash
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch), // Transform AI Mode params
            fragment: "#rm_sg_aimode" // Tag for content.js to increment aiModeRedirects
          } // End transform
        } // End redirect
      }, // End action
      condition: { // Match any Google Search URL with udm=50
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50(&|$)", // Regex filter
        resourceTypes: [RESOURCE_MAIN_FRAME] // Top-level navigation only
      } // End condition
    }); // End Rule 110
    rules.push({ // Rule 111: Redirect direct /ai or /aimode landing page URLs back to Google Search homepage
      id: 111, // Unique rule ID
      priority: 50, // Standard AI Mode block priority
      action: { // Redirect action
        type: ACTION_REDIRECT, // Redirect request
        redirect: { // Static redirect target
          url: "https://www.google.com/#rm_sg_aimode" // Redirect to Google homepage with telemetry hash
        } // End redirect
      }, // End action
      condition: { // Match google.com/ai or google.com/aimode
        regexFilter: "^https://(www\\.)?google\\.com/(ai|aimode)(/|\\?|$)", // Regex filter
        resourceTypes: [RESOURCE_MAIN_FRAME] // Top-level navigation only
      } // End condition
    }); // End Rule 111
  } // End blockAiModeNavigation branch
  if (policy.forceWebOnlySearch) { // Add Web-only (udm=14) enforcement rules when enabled
    rules.push({ // Rule 120: Allow explicit Search tabs (Images, Videos, News, Shopping, etc.) that already set udm= or tbm=
      id: 120, // Unique rule ID
      priority: 40, // Higher priority than Rule 130 so non-Web tabs are preserved
      action: { // Allow action stops lower-priority Rule 130 from rewriting these tabs
        type: ACTION_ALLOW // Permit request unmodified
      }, // End action
      condition: { // Match Google Search URLs that already specify udm= or legacy tbm=
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?(udm=|tbm=)", // Regex filter
        resourceTypes: [RESOURCE_MAIN_FRAME] // Top-level navigation only
      } // End condition
    }); // End Rule 120
    rules.push({ // Rule 130: Rewrite standard Google searches (?q=...) to classic Web-only results (udm=14)
      id: 130, // Unique rule ID
      priority: 30, // Lowest priority; runs only if Rule 120 did not match
      action: { // Redirect action
        type: ACTION_REDIRECT, // Redirect request
        redirect: { // URL transform
          transform: { // Add udm=14 parameter while preserving q= and other params
            queryTransform: { // Query transform config
              addOrReplaceParams: [{ key: "udm", value: "14" }] // Set udm=14
            } // End queryTransform
          } // End transform
        } // End redirect
      }, // End action
      condition: { // Match standard Google Search URLs containing a q= query parameter
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?q=", // Regex filter
        resourceTypes: [RESOURCE_MAIN_FRAME] // Top-level navigation only
      } // End condition
    }); // End Rule 130
  } // End forceWebOnlySearch branch
  return rules; // Return compiled DNR rule set
} // End buildDynamicRules
async function syncDynamicRules(policy) { // Atomically replace Chrome dynamic rules to match the current policy
  return enqueueStorageOp(async () => { // Serialize DNR updates to prevent race conditions
    try { // Catch Chrome DNR API errors
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules(); // Fetch currently registered dynamic rules
      const removeRuleIds = Array.from( // Remove all known managed IDs plus any stale rule IDs
        /* @__PURE__ */ new Set([...ALL_MANAGED_RULE_IDS, ...existingRules.map((rule) => rule.id)]) // Deduplicate IDs
      ); // End Array.from
      const addRules = buildDynamicRules(policy); // Build new rule set for current policy
      await chrome.declarativeNetRequest.updateDynamicRules({ // Atomically update Chrome DNR rules
        removeRuleIds, // IDs to remove
        addRules // Rules to install
      }); // End updateDynamicRules
      return { activeRuleCount: addRules.length }; // Return count of active rules
    } catch (err) { // Handle DNR validation or quota errors
      const detail = err instanceof Error ? err.message : String(err); // Extract error message
      return { activeRuleCount: 0, error: detail }; // Return error detail for diagnostics
    } // End try/catch
  }); // End queued op
} // End syncDynamicRules

// src/background/service-worker.ts — MV3 background service worker entry point and message router
function getExtensionVersion() { // Read extension version from manifest.json
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) { // Check manifest API
    return chrome.runtime.getManifest().version; // Return version string
  } // End API check
  return "1.0.0"; // Fallback version
} // End getExtensionVersion
function sanitizeLocalOverridesInput(raw) { // Whitelist and type-check local test-mode toggle updates from Options UI
  const clean = {}; // Initialize clean object
  for (const key of FEATURE_TOGGLE_KEYS) { // Copy only valid boolean feature toggles
    if (typeof raw[key] === "boolean") { // Strict boolean check
      clean[key] = raw[key]; // Store toggle
    } // End boolean check
  } // End loop
  if (typeof raw.gradeBand === "string" && VALID_GRADE_BANDS.includes(raw.gradeBand)) { // Validate gradeBand against enum
    clean.gradeBand = raw.gradeBand; // Store valid gradeBand
  } // End gradeBand check
  return clean; // Return sanitized overrides
} // End sanitizeLocalOverridesInput
async function getActiveDynamicRuleCount() { // Query Chrome for the count of currently active DNR rules
  if (typeof chrome === "undefined" || !chrome.declarativeNetRequest?.getDynamicRules) { // Guard when DNR API is unavailable
    return 0; // Return zero
  } // End API check
  try { // Catch DNR query errors
    const rules = await chrome.declarativeNetRequest.getDynamicRules(); // Fetch active rules
    return rules.length; // Return rule count
  } catch { // Ignore errors
    return 0; // Return zero fallback
  } // End try/catch
} // End getActiveDynamicRuleCount
async function resolvePolicyFromStorage() { // Load managed and local storage, log any read errors, and parse policy
  const [managedRes, localRes] = await Promise.all([ // Read both storage areas in parallel
    readManagedPolicyRaw(), // Read Google Admin Console managed policy
    readLocalOverrides() // Read local test overrides
  ]); // End Promise.all
  if (managedRes.error) { // Log managed storage read failure if any
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `managed read: ${managedRes.error}`); // Record error
  } // End managed error check
  if (localRes.error) { // Log local storage read failure if any
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `local read: ${localRes.error}`); // Record error
  } // End local error check
  return parsePolicy(managedRes.data, localRes.data); // Parse and return resolved policy + validation errors
} // End resolvePolicyFromStorage
async function syncRuntimeState(options) { // Synchronize policy, DNR rules, diagnostics, and analytics alarm
  const { policy, errors } = await resolvePolicyFromStorage(); // Resolve current effective policy
  if (options.recordPolicyDiagnostics) { // Record policy warnings/errors when requested (install/startup/policy change)
    for (const err of errors) { // Iterate policy diagnostics
      await recordDiagnosticEntry(err.code, err.detail); // Log entry
    } // End loop
  } // End recordPolicyDiagnostics check
  const dnrResult = await syncDynamicRules(policy); // Sync Chrome declarativeNetRequest rules
  if (dnrResult.error) { // Log DNR sync failure if Chrome rejected any rule
    await recordDiagnosticEntry("ERR_DNR_SYNC_FAILED", dnrResult.error); // Record error
  } // End dnrResult error check
  if (options.alarmMode === "reschedule") { // Reschedule alarm unconditionally (install or managed policy change)
    await scheduleAnalyticsAlarm(policy); // Schedule or clear alarm
  } else if (options.alarmMode === "ensure") { // Ensure alarm exists on browser startup without resetting timer unnecessarily
    const existingAlarm = await chrome.alarms.get(ANALYTICS_ALARM_NAME); // Check for existing alarm
    const shouldHaveAlarm = policy.analyticsEnabled && isValidAppsScriptUrl(policy.analyticsEndpointUrl); // Determine if alarm is needed
    if (shouldHaveAlarm && !existingAlarm) { // Create alarm if missing
      await scheduleAnalyticsAlarm(policy); // Schedule alarm
    } else if (!shouldHaveAlarm && existingAlarm) { // Clear alarm if analytics was disabled
      await chrome.alarms.clear(ANALYTICS_ALARM_NAME); // Cancel alarm
    } // End alarm state check
  } // End alarmMode branch
  return { policy, activeRuleCount: dnrResult.activeRuleCount }; // Return resolved policy and active rule count
} // End syncRuntimeState
async function handleRuntimeMessage(message) { // Route messages from content.js, popup.js, and options.js
  switch (message.type) { // Dispatch by message type
    case "GET_EFFECTIVE_POLICY": { // Request for current resolved policy
      const { policy } = await resolvePolicyFromStorage(); // Resolve policy
      return policy; // Return policy object
    } // End GET_EFFECTIVE_POLICY
    case "INCREMENT_METRICS": { // Request from content.js to increment aggregate DOM hiding counters
      await incrementTelemetryMetrics(message.deltas); // Atomically increment counters
      return { ok: true }; // Acknowledge
    } // End INCREMENT_METRICS
    case "RECORD_REDIRECT": { // Request from content.js when a redirect marker hash was observed
      if (message.source === "omnibox") { // Redirect came from Chrome's native Omnibox/NTP AI Mode entry
        await incrementTelemetryMetrics({ // Increment both general and Omnibox fallback counters
          aiModeRedirects: 1, // Increment AI Mode redirect count
          omniboxFallbackRedirects: 1 // Increment Omnibox fallback count
        }); // End incrementTelemetryMetrics
        await recordDiagnosticEntry( // Advise IT admin to also set Chrome's AIModeSettings policy
          "WARN_OMNIBOX_POLICY_MISSING", // Warning code
          "Omnibox/NTP AI Mode redirect intercepted via #rm_sg_omnibox fallback" // Detail
        ); // End recordDiagnosticEntry
      } else { // Standard in-page/URL AI Mode redirect
        await incrementTelemetryMetrics({ // Increment AI Mode redirect counter
          aiModeRedirects: 1 // Add 1
        }); // End incrementTelemetryMetrics
      } // End source check
      return { ok: true }; // Acknowledge
    } // End RECORD_REDIRECT
    case "LOG_DIAGNOSTIC": { // Request from content.js to record a selector or safety-guard diagnostic
      await recordDiagnosticEntry(message.code, message.detail ?? ""); // Record diagnostic entry
      return { ok: true }; // Acknowledge
    } // End LOG_DIAGNOSTIC
    case "GET_DIAGNOSTIC_SNAPSHOT": { // Request from options.js for full dashboard state
      const [{ policy }, telemetry, activeRuleCount] = await Promise.all([ // Gather policy, telemetry, and DNR count in parallel
        resolvePolicyFromStorage(), // Current policy
        readTelemetryState(), // Current telemetry state
        getActiveDynamicRuleCount() // Active DNR rule count
      ]); // End Promise.all
      const snapshot = { // Assemble zero-PII diagnostic snapshot
        policy, // Resolved policy
        telemetry, // Aggregate telemetry & diagnostic log
        activeRuleCount, // Count of active DNR rules
        extensionVersion: getExtensionVersion(), // Manifest version
        generatedAtDate: getTodayDateBucket() // UTC date string
      }; // End snapshot
      return snapshot; // Return snapshot to options.js
    } // End GET_DIAGNOSTIC_SNAPSHOT
    case "SET_LOCAL_OVERRIDES": { // Request from options.js to update local test-mode switches
      const { policy: currentPolicy } = await resolvePolicyFromStorage(); // Check whether managed policy is active
      if (currentPolicy.isManaged) { // Hard-block local overrides when Google Admin Console policy is active
        return currentPolicy; // Return locked managed policy unchanged
      } // End isManaged guard
      const existingLocalRes = await readLocalOverrides(); // Read existing local overrides
      const merged = { // Merge sanitized updates into existing overrides
        ...existingLocalRes.data ?? {}, // Existing local keys
        ...sanitizeLocalOverridesInput(message.toggles) // Sanitized new keys
      }; // End merged object
      await writeLocalOverrides(merged); // Persist local overrides
      const { policy: updatedPolicy } = await syncRuntimeState({ // Re-sync DNR rules immediately without logging warnings
        recordPolicyDiagnostics: false, // Skip diagnostic log noise
        alarmMode: "none" // Leave alarms untouched
      }); // End syncRuntimeState
      return updatedPolicy; // Return updated policy to options.js
    } // End SET_LOCAL_OVERRIDES
    case "RESET_LOCAL_METRICS": { // Request from options.js to reset local counters and diagnostic log
      return await resetLocalTelemetry(); // Clear telemetry and return fresh state
    } // End RESET_LOCAL_METRICS
    case "TRIGGER_TEST_FLUSH": { // Request from options.js ("Test Flush Now" button) to flush analytics immediately
      const { policy } = await resolvePolicyFromStorage(); // Resolve current policy
      return await flushAnalyticsIfDue(policy, { force: true }); // Force immediate flush bypassing backoff
    } // End TRIGGER_TEST_FLUSH
  } // End switch
} // End handleRuntimeMessage
chrome.runtime.onInstalled.addListener(async () => { // Sync policy, DNR rules, and analytics alarm on install/update
  try { // Catch initialization errors
    await syncRuntimeState({ // Sync runtime state
      recordPolicyDiagnostics: true, // Record initial policy status
      alarmMode: "reschedule" // Schedule analytics alarm if enabled
    }); // End syncRuntimeState
  } catch (err) { // Log unexpected startup error
    const detail = err instanceof Error ? err.message : String(err); // Extract message
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onInstalled: ${detail}`); // Record error
  } // End try/catch
}); // End onInstalled listener
chrome.runtime.onStartup.addListener(async () => { // Re-sync policy and ensure alarm on Chrome browser startup
  try { // Catch startup errors
    await syncRuntimeState({ // Sync runtime state
      recordPolicyDiagnostics: true, // Record policy status
      alarmMode: "ensure" // Ensure analytics alarm exists if enabled
    }); // End syncRuntimeState
  } catch (err) { // Log unexpected startup error
    const detail = err instanceof Error ? err.message : String(err); // Extract message
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onStartup: ${detail}`); // Record error
  } // End try/catch
}); // End onStartup listener
chrome.storage.onChanged.addListener(async (changes, areaName) => { // React live when Google Admin Console pushes new policy or local overrides change
  try { // Catch sync errors
    if (areaName === "managed") { // Managed policy updated by Google Admin Console
      await syncRuntimeState({ // Re-sync rules and reschedule alarm
        recordPolicyDiagnostics: true, // Log any validation errors in new policy
        alarmMode: "reschedule" // Reschedule analytics alarm
      }); // End syncRuntimeState
      return; // Done
    } // End managed branch
    if (areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) { // Unmanaged local test overrides updated
      await syncRuntimeState({ // Re-sync DNR rules
        recordPolicyDiagnostics: false, // Skip policy diagnostic noise
        alarmMode: "ensure" // Ensure alarm consistency
      }); // End syncRuntimeState
    } // End local branch
  } catch (err) { // Log unexpected change-handler error
    const detail = err instanceof Error ? err.message : String(err); // Extract message
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `storage.onChanged: ${detail}`); // Record error
  } // End try/catch
}); // End storage.onChanged listener
chrome.alarms.onAlarm.addListener(async (alarm) => { // Handle periodic analytics flush alarm
  if (alarm.name !== ANALYTICS_ALARM_NAME) { // Ignore unrelated alarms
    return; // Exit
  } // End alarm name check
  try { // Catch flush errors
    const { policy } = await resolvePolicyFromStorage(); // Resolve current policy
    await flushAnalyticsIfDue(policy); // Flush pending daily buckets to Apps Script if enabled and due
    await scheduleAnalyticsAlarm(policy); // Schedule next periodic alarm with jitter
  } catch (err) { // Log unexpected alarm handler error
    const detail = err instanceof Error ? err.message : String(err); // Extract message
    await recordDiagnosticEntry("ERR_ANALYTICS_FLUSH_FAILED", detail); // Record error
  } // End try/catch
}); // End alarms.onAlarm listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => { // Listen for extension runtime messages
  (async () => { // Execute async message handler
    try { // Catch unhandled handler errors
      const result = await handleRuntimeMessage(message); // Dispatch message
      sendResponse(result); // Send response back to caller
    } catch (err) { // Handle unexpected error
      const detail = err instanceof Error ? err.message : String(err); // Extract message
      try { // Best-effort diagnostic logging
        await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onMessage: ${detail}`); // Record error
      } catch { // Ignore secondary storage failure
      } // End nested try/catch
      sendResponse({ ok: false, error: detail }); // Return error response
    } // End try/catch
  })(); // Invoke async IIFE
  return true; // Keep Chrome message channel open for asynchronous sendResponse
}); // End runtime.onMessage listener
