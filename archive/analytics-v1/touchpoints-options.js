// ARCHIVE — reference only. Do not edit, build, or import. See README.md in this folder.
// Analytics pieces of the Options page and the 4-band policy generator.

// ===== Admin JSON formatter + draft validator (analytics fields) — dist/ui/options.js lines 261–309 @ commit 989c95a =====
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
// ===== Generator state: shared analytics draft — dist/ui/options.js lines 398–403 @ commit 989c95a =====
function mountPolicyGenerator(container, options) { // Render and wire the interactive 4-Band Admin Policy Generator
  mountInstanceCounter += 1; // Increment instance counter for unique IDs
  const idPrefix = `rm-pg-${mountInstanceCounter}`; // Prefix for all form control IDs
  let bandStates = createDefaultBandStates(); // Initialize per-band toggle states
  const analytics = { ...DEFAULT_ANALYTICS_POLICY }; // Initialize shared analytics draft settings
  let showStaffBand = false; // Staff OU card is collapsed by default
// ===== Generator: analytics fieldset (enable, Apps Script URL, token, interval) — dist/ui/options.js lines 463–571 @ commit 989c95a =====
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
// ===== Generator: analytics validation and listeners — dist/ui/options.js lines 712–772 @ commit 989c95a =====
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
// ===== Generator: download-all warning and Copy Code.gs button — dist/ui/options.js lines 784–815 @ commit 989c95a =====
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
// ===== Diagnostic bundle: analytics fields (token redacted) — dist/ui/options.js lines 836–872 @ commit 989c95a =====
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
// ===== Options: analytics status element refs — dist/ui/options.js lines 1108–1113 @ commit 989c95a =====
  const analyticsBadge = document.getElementById("analytics-config-badge"); // Analytics config status pill
  const analyticsLastAttempt = document.getElementById("analytics-last-attempt"); // Last flush attempt date
  const analyticsLastSuccess = document.getElementById("analytics-last-success"); // Last flush success date
  const analyticsPendingCount = document.getElementById("analytics-pending-count"); // Pending batch count
  const analyticsLastMessage = document.getElementById("analytics-last-message"); // Last flush message
  const testFlushBtn = document.getElementById("btn-test-flush"); // "Test Flush Now" button
// ===== Options: analytics status rendering — dist/ui/options.js lines 1273–1304 @ commit 989c95a =====
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
// ===== Options: Test Flush Now handler — dist/ui/options.js lines 1373–1394 @ commit 989c95a =====
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
