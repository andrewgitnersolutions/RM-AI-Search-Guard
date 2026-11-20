// ARCHIVE — reference only. Do not edit, build, or import. See README.md in this folder.
// Smaller analytics pieces woven into the rest of the service worker. Each must be re-added (or adapted) on rebuild.

// ===== DEFAULT_ANALYTICS_POLICY constant — dist/background/service-worker.js lines 10–15 @ commit 989c95a =====
var DEFAULT_ANALYTICS_POLICY = { // Default telemetry settings; privacy-preserving and disabled by default
  analyticsEnabled: false, // Anonymous aggregate telemetry is opt-in only (off by default)
  analyticsEndpointUrl: "", // No default remote endpoint; must be explicitly configured by district IT
  analyticsSharedToken: "", // Optional shared secret token for district Apps Script endpoint
  analyticsFlushIntervalMinutes: 240 // Default telemetry upload interval (4 hours)
}; // End DEFAULT_ANALYTICS_POLICY
// ===== APPS_SCRIPT_URL_REGEX endpoint allowlist — dist/background/service-worker.js lines 32–32 @ commit 989c95a =====
var APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/; // Strict allowlist regex permitting only deployed Google Apps Script /exec URLs
// ===== Alarm name and flush interval bounds — dist/background/service-worker.js lines 45–48 @ commit 989c95a =====
var ANALYTICS_ALARM_NAME = "rmsg-analytics-flush"; // Chrome alarm name for periodic analytics flush
var MAX_DIAGNOSTIC_LOG_ENTRIES = 50; // Cap diagnostic log size to bound local storage usage
var MIN_FLUSH_INTERVAL_MINUTES = 60; // Minimum allowed telemetry flush interval (1 hour)
var MAX_FLUSH_INTERVAL_MINUTES = 1440; // Maximum allowed telemetry flush interval (24 hours)
// ===== Telemetry state: pending buckets and flush-status fields — dist/background/service-worker.js lines 58–71 @ commit 989c95a =====
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
// ===== ALL_ERROR_CODES (analytics codes: ERR_ANALYTICS_ENDPOINT_INVALID, ERR_ANALYTICS_FLUSH_FAILED) — dist/background/service-worker.js lines 74–84 @ commit 989c95a =====
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
// ===== ERROR_CATALOG entries for the two analytics codes — dist/background/service-worker.js lines 110–121 @ commit 989c95a =====
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
// ===== isValidAppsScriptUrl — dist/background/service-worker.js lines 166–171 @ commit 989c95a =====
function isValidAppsScriptUrl(url) { // Validate that an analytics endpoint matches the strict Apps Script URL pattern
  if (typeof url !== "string") { // Reject non-string values immediately
    return false; // Return invalid
  } // End type check
  return APPS_SCRIPT_URL_REGEX.test(url); // Test URL against the strict Apps Script HTTPS regex
} // End isValidAppsScriptUrl
// ===== parsePolicy: analytics field validation and policy assembly — dist/background/service-worker.js lines 232–293 @ commit 989c95a =====
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
// ===== Sanitizers for pending buckets / pending error counts — dist/background/service-worker.js lines 331–356 @ commit 989c95a =====
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
// ===== normalizeTelemetryState (flush fields) — dist/background/service-worker.js lines 389–409 @ commit 989c95a =====
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
// ===== incrementTelemetryMetrics / recordDiagnosticEntry (write pending buckets and pending error counts) — dist/background/service-worker.js lines 460–514 @ commit 989c95a =====
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
// ===== syncRuntimeState: alarm scheduling modes — dist/background/service-worker.js lines 1063–1086 @ commit 989c95a =====
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
// ===== TRIGGER_TEST_FLUSH message — dist/background/service-worker.js lines 1153–1156 @ commit 989c95a =====
    case "TRIGGER_TEST_FLUSH": { // Request from options.js ("Test Flush Now" button) to flush analytics immediately
      const { policy } = await resolvePolicyFromStorage(); // Resolve current policy
      return await flushAnalyticsIfDue(policy, { force: true }); // Force immediate flush bypassing backoff
    } // End TRIGGER_TEST_FLUSH
// ===== Lifecycle listeners (alarmMode) and alarms.onAlarm — dist/background/service-worker.js lines 1159–1213 @ commit 989c95a =====
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
