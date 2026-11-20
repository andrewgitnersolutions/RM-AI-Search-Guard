// src/shared/defaults.ts — Default policy constants and storage keys
var STRICT_LOCKDOWN_TOGGLES = { // Fail-closed default protection flags (used when no policy or invalid fields exist)
  masterEnabled: true, // Master kill-switch; true means Search Guard protections are active
  hideAiOverviews: true, // Hide Google AI Overviews on search result pages
  hideAiModeUi: true, // Hide AI Mode buttons, tabs, and triggers in the Google Search UI
  blockAiModeNavigation: true, // Redirect/block navigation to Google AI Mode (udm=50 or /aimode)
  forceWebOnlySearch: true, // Rewrite standard Google searches to udm=14 (Web-only results)
  hideAuxiliaryAiFeatures: true // Hide auxiliary AI triggers (Search Labs, Lens image search, follow-up prompts)
}; // End STRICT_LOCKDOWN_TOGGLES
var DEFAULT_ANALYTICS_POLICY = { // Default telemetry settings; privacy-preserving and disabled by default
  analyticsEnabled: false, // Anonymous aggregate telemetry is opt-in only (disabled by default)
  analyticsEndpointUrl: "", // No default remote endpoint; must be explicitly configured by district IT
  analyticsSharedToken: "", // Optional shared secret header/payload token for district Apps Script endpoint
  analyticsFlushIntervalMinutes: 240 // Default telemetry batch upload interval (4 hours)
}; // End DEFAULT_ANALYTICS_POLICY
var VALID_GRADE_BANDS = [ // Allowed K-12 organizational unit (OU) grade-band labels
  "K-2", // Early elementary grade band
  "3-5", // Upper elementary grade band
  "6-8", // Middle school grade band
  "9-12", // High school grade band
  "Staff", // Faculty and staff OU label
  "Unassigned" // Fallback label when no grade band is configured
]; // End VALID_GRADE_BANDS
var FEATURE_TOGGLE_KEYS = [ // Ordered list of the six boolean policy toggle keys
  "masterEnabled", // Key for master protection switch
  "hideAiOverviews", // Key for AI Overviews hiding
  "hideAiModeUi", // Key for AI Mode UI hiding
  "blockAiModeNavigation", // Key for AI Mode navigation blocking
  "forceWebOnlySearch", // Key for Web-only (udm=14) search enforcement
  "hideAuxiliaryAiFeatures" // Key for auxiliary AI feature hiding
]; // End FEATURE_TOGGLE_KEYS
var APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/; // Strict allowlist regex permitting only deployed Google Apps Script /exec endpoints
var STORAGE_KEYS = { // Keys used in chrome.storage.local
  LOCAL_OVERRIDES: "rmsg_local_overrides", // Stores unmanaged local test-mode settings
  TELEMETRY: "rmsg_telemetry", // Stores aggregate event counters before flushing
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

// src/ui/popup.ts — Toolbar popup UI logic
var SVG_NS = "http://www.w3.org/2000/svg"; // Standard SVG XML namespace for creating crisp vector icons without innerHTML
function createShieldIcon(className) { // Build a 18x18 inline SVG shield-with-checkmark icon safely via DOM APIs
  const svg = document.createElementNS(SVG_NS, "svg"); // Create root <svg> element
  svg.setAttribute("class", className); // Apply CSS class for sizing and color
  svg.setAttribute("aria-hidden", "true"); // Hide decorative icon from screen readers
  svg.setAttribute("width", "18"); // Set intrinsic icon width
  svg.setAttribute("height", "18"); // Set intrinsic icon height
  svg.setAttribute("viewBox", "0 0 24 24"); // Set 24x24 vector coordinate system
  svg.setAttribute("fill", "none"); // Use stroke-only outline style
  svg.setAttribute("stroke", "currentColor"); // Inherit text color from parent CSS
  svg.setAttribute("stroke-width", "2"); // Set consistent 2px stroke thickness
  svg.setAttribute("stroke-linecap", "round"); // Round stroke line endings
  svg.setAttribute("stroke-linejoin", "round"); // Round stroke corners
  const shieldPath = document.createElementNS(SVG_NS, "path"); // Create shield outline path
  shieldPath.setAttribute("d", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"); // Vector geometry for shield silhouette
  const checkPath = document.createElementNS(SVG_NS, "path"); // Create checkmark path inside shield
  checkPath.setAttribute("d", "m9 12 2 2 4-4"); // Vector geometry for checkmark
  svg.append(shieldPath, checkPath); // Attach both paths to the SVG element
  return svg; // Return completed SVG element
} // End createShieldIcon
function countActiveProtections(policy) { // Count how many of the 6 protections are currently enabled
  if (!policy.masterEnabled) { // If master switch is off, all protections are paused
    return 0; // Return zero active protections
  } // End masterEnabled check
  let count = 0; // Initialize active counter
  for (const key of FEATURE_TOGGLE_KEYS) { // Iterate over all 6 feature toggle keys
    if (policy[key]) { // Increment if the feature is enabled
      count += 1; // Add 1 to active count
    } // End toggle check
  } // End loop
  return count; // Return total active protection count
} // End countActiveProtections
async function openOptionsPageSafe() { // Safely open the extension's options/policy-generator page
  if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) { // Verify Chrome extension runtime API is available
    await chrome.runtime.openOptionsPage(); // Open dist/ui/options.html in a browser tab
  } // End API check
} // End openOptionsPageSafe
function renderPopup(root, policy, onOpenOptions) { // Render popup UI according to managed vs unmanaged policy state
  root.replaceChildren(); // Clear any existing popup DOM nodes safely
  if (policy.isManaged) { // When managed by Google Admin Console, show minimal read-only status (no student controls)
    const notice = document.createElement("div"); // Create managed status container
    notice.className = "popup-managed"; // Apply managed notice styling
    const icon = createShieldIcon("popup-managed-icon"); // Create shield icon
    const text = document.createElement("span"); // Create status label element
    text.className = "popup-managed-text"; // Apply label styling
    text.textContent = "Managed by your school"; // Display clear school-managed notice to students
    notice.append(icon, text); // Assemble managed notice
    root.append(notice); // Mount into popup root
    return; // Exit early so no interactive controls are exposed to students
  } // End managed branch
  const wrapper = document.createElement("div"); // Create unmanaged/local-test-mode container
  wrapper.className = "popup-unmanaged"; // Apply unmanaged layout styling
  const header = document.createElement("div"); // Create popup header row
  header.className = "popup-unmanaged-header"; // Apply header styling
  const title = document.createElement("span"); // Create extension title text
  title.textContent = "RaiseMark AI Search Guard"; // Set title text
  header.append(createShieldIcon("popup-managed-icon"), title); // Add shield icon and title to header
  const statusPill = document.createElement("p"); // Create status badge paragraph
  statusPill.className = "rm-pill rm-pill-amber"; // Style as amber warning pill
  statusPill.textContent = "Local Test Mode \u2014 Unmanaged"; // Indicate browser is not under Google Admin managed policy
  const activeCount = countActiveProtections(policy); // Compute active protection count
  const summary = document.createElement("p"); // Create protection count summary line
  summary.className = "popup-summary"; // Apply summary text styling
  summary.textContent = policy.masterEnabled ? `${activeCount} of 6 protections active` : "0 of 6 protections active (Paused)"; // Show active count or paused status
  const openBtn = document.createElement("button"); // Create button to open full options & policy generator page
  openBtn.type = "button"; // Prevent unintended form submission
  openBtn.className = "rm-btn rm-btn-primary popup-action-btn"; // Apply primary button styling
  openBtn.textContent = "Open Setup & Policy Generator"; // Set button label
  openBtn.addEventListener("click", () => { // Handle button click
    if (onOpenOptions) { // Use injected callback if provided (supports unit testing)
      onOpenOptions(); // Invoke callback
    } else { // Default production behavior
      void openOptionsPageSafe(); // Open options page via Chrome runtime API
    } // End callback check
  }); // End click listener
  wrapper.append(header, statusPill, summary, openBtn); // Assemble unmanaged popup layout
  root.append(wrapper); // Mount into popup root
} // End renderPopup
async function resolvePopupPolicy() { // Resolve current effective policy for popup display
  if (typeof chrome !== "undefined" && chrome.storage?.managed?.get) { // First try reading directly from Chrome managed storage
    try { // Guard against browsers/environments where managed storage throws
      const managedRaw = await chrome.storage.managed.get(null); // Fetch all managed policy keys
      if (managedRaw && typeof managedRaw === "object" && Object.keys(managedRaw).length > 0) { // If managed keys exist
        return parsePolicy(managedRaw, null).policy; // Parse and return managed policy immediately
      } // End managed keys check
    } catch { // Ignore managed storage errors and fall through to background worker
    } // End try/catch
  } // End managed storage check
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) { // Second, ask the background service worker for cached effective policy
    try { // Guard against inactive service worker or messaging error
      const response = await chrome.runtime.sendMessage({ // Send policy query message
        type: "GET_EFFECTIVE_POLICY" // Message type handled by service-worker.js
      }); // End sendMessage call
      if (response && typeof response.isManaged === "boolean") { // Validate response shape
        return response; // Return effective policy from service worker
      } // End response check
    } catch { // Ignore messaging errors and fall through to local storage
    } // End try/catch
  } // End runtime messaging check
  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) { // Third, check local overrides in chrome.storage.local
    try { // Guard against storage read errors
      const localResult = await chrome.storage.local.get(STORAGE_KEYS.LOCAL_OVERRIDES); // Read local override key
      const localRaw = localResult[STORAGE_KEYS.LOCAL_OVERRIDES] ?? null; // Extract override object or null
      return parsePolicy(null, localRaw).policy; // Parse and return unmanaged local policy
    } catch { // Ignore storage errors and fall back to defaults
    } // End try/catch
  } // End local storage check
  return parsePolicy(null, null).policy; // Final fallback: return fail-closed strict lockdown defaults
} // End resolvePopupPolicy
async function bootPopup() { // Initialize and render the popup once DOM is ready
  if (typeof document === "undefined" || typeof chrome === "undefined") { // Exit if running in a non-browser test environment
    return; // Abort boot
  } // End environment check
  const root = document.getElementById("popup-root"); // Locate popup mount container
  if (!root) { // Guard against missing mount node
    return; // Abort boot
  } // End root check
  const policy = await resolvePopupPolicy(); // Resolve current policy
  renderPopup(root, policy, () => { // Render popup UI
    void openOptionsPageSafe(); // Wire button click to open options page
  }); // End renderPopup call
} // End bootPopup
if (typeof document !== "undefined") { // Auto-boot only when loaded in a browser document
  if (document.readyState === "loading") { // If DOM is still parsing
    document.addEventListener("DOMContentLoaded", () => { // Wait for DOMContentLoaded before mounting
      void bootPopup(); // Boot popup UI
    }); // End event listener
  } else { // If DOM is already parsed
    void bootPopup(); // Boot popup UI immediately
  } // End readyState check
} // End document check
export { // Export renderPopup for automated UI testing
  renderPopup // Exported popup render function
}; // End export block
