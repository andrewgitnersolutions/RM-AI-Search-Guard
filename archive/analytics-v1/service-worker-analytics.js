// ARCHIVE — reference only. Do not edit, build, or import. See README.md in this folder.
// The complete analytics module (originally src/background/analytics.ts), verbatim from the built bundle.

// ===== Analytics module: payload builder, PII gate, backoff, alarm, flush — dist/background/service-worker.js lines 523–877 @ commit 989c95a =====
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
