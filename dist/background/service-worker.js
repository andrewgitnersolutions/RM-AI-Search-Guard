// src/shared/defaults.ts
var STRICT_LOCKDOWN_TOGGLES = {
  masterEnabled: true,
  hideAiOverviews: true,
  hideAiModeUi: true,
  blockAiModeNavigation: true,
  forceWebOnlySearch: true,
  hideAuxiliaryAiFeatures: true
};
var DEFAULT_ANALYTICS_POLICY = {
  analyticsEnabled: false,
  analyticsEndpointUrl: "",
  analyticsSharedToken: "",
  analyticsFlushIntervalMinutes: 240
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
var APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/;
var METRIC_KEYS = [
  "overviewsHidden",
  "aiModeUiHidden",
  "aiModeRedirects",
  "omniboxFallbackRedirects",
  "auxAiHidden"
];
var STORAGE_KEYS = {
  LOCAL_OVERRIDES: "rmsg_local_overrides",
  TELEMETRY: "rmsg_telemetry",
  LAST_POLICY: "rmsg_last_policy"
};
var ANALYTICS_ALARM_NAME = "rmsg-analytics-flush";
var MAX_DIAGNOSTIC_LOG_ENTRIES = 50;
var MIN_FLUSH_INTERVAL_MINUTES = 60;
var MAX_FLUSH_INTERVAL_MINUTES = 1440;
function createEmptyMetrics() {
  return {
    overviewsHidden: 0,
    aiModeUiHidden: 0,
    aiModeRedirects: 0,
    omniboxFallbackRedirects: 0,
    auxAiHidden: 0
  };
}
function createInitialTelemetryState() {
  return {
    lifetimeMetrics: createEmptyMetrics(),
    pendingMetricsByDate: {},
    pendingErrorsByCode: {},
    diagnosticLog: [],
    lastFlushAttemptDate: null,
    lastFlushSuccessDate: null,
    lastFlushStatus: "idle",
    lastFlushMessage: "Analytics disabled (local-only mode).",
    consecutiveFlushFailures: 0,
    nextEligibleFlushAtMs: 0
  };
}

// src/shared/errors.ts
var ALL_ERROR_CODES = [
  "ERR_POLICY_INVALID",
  "ERR_DNR_SYNC_FAILED",
  "ERR_SELECTOR_SYNTAX",
  "ERR_SAFETY_GUARD_TRIPPED",
  "ERR_ANALYTICS_ENDPOINT_INVALID",
  "ERR_ANALYTICS_FLUSH_FAILED",
  "ERR_STORAGE_FAILURE",
  "WARN_NO_MANAGED_POLICY",
  "WARN_OMNIBOX_POLICY_MISSING"
];
var ERROR_CATALOG = {
  ERR_POLICY_INVALID: {
    code: "ERR_POLICY_INVALID",
    severity: "error",
    title: "Invalid Managed Policy Configuration",
    remediationTemplate: "One or more fields in your Google Admin Console 'Policy for extensions' JSON are invalid (fields: {detail}). Invalid boolean toggles fell back to locked-down ON. Regenerate valid JSON in the Admin Policy Generator tab and re-save under Devices > Chrome > Apps & extensions."
  },
  ERR_DNR_SYNC_FAILED: {
    code: "ERR_DNR_SYNC_FAILED",
    severity: "error",
    title: "Dynamic Redirect Rule Sync Failed",
    remediationTemplate: "Chrome rejected a dynamic redirect rule update ({detail}). Reload the extension or verify Chrome version is 120+. If persistent, copy diagnostics and report to RaiseMark Support."
  },
  ERR_SELECTOR_SYNTAX: {
    code: "ERR_SELECTOR_SYNTAX",
    severity: "error",
    title: "DOM Selector Validation Error",
    remediationTemplate: "A bundled DOM selector failed browser validation ({detail}). Other detection tiers remain active. Update to the latest RaiseMark AI Search Guard release."
  },
  ERR_SAFETY_GUARD_TRIPPED: {
    code: "ERR_SAFETY_GUARD_TRIPPED",
    severity: "error",
    title: "Organic Results Safety Guard Tripped",
    remediationTemplate: "Safety Guard prevented hiding core Google Search results ({detail}). Google likely changed its page structure. Check for an extension update."
  },
  ERR_ANALYTICS_ENDPOINT_INVALID: {
    code: "ERR_ANALYTICS_ENDPOINT_INVALID",
    severity: "error",
    title: "Invalid Analytics Endpoint URL",
    remediationTemplate: "Analytics is enabled, but analyticsEndpointUrl does not match https://script.google.com/macros/s/<ID>/exec. Paste your deployed Google Apps Script Web App URL in the Admin Policy JSON."
  },
  ERR_ANALYTICS_FLUSH_FAILED: {
    code: "ERR_ANALYTICS_FLUSH_FAILED",
    severity: "error",
    title: "District Analytics Flush Failed",
    remediationTemplate: "Failed to flush anonymous counts to district Google Sheet ({detail}). Verify Apps Script is deployed as Web App -> Execute as: Me -> Who has access: Anyone, and that analyticsSharedToken matches Code.gs. Retrying with backoff."
  },
  ERR_STORAGE_FAILURE: {
    code: "ERR_STORAGE_FAILURE",
    severity: "error",
    title: "Extension Storage Read/Write Error",
    remediationTemplate: "Browser extension storage error ({detail}). Check Chrome profile disk quota or reload the browser."
  },
  WARN_NO_MANAGED_POLICY: {
    code: "WARN_NO_MANAGED_POLICY",
    severity: "warning",
    title: "No Google Admin Console Policy Detected",
    remediationTemplate: "No Google Admin Console policy detected. Strict Maximum Lockdown defaults are active (or local test toggles on unmanaged devices). To configure by grade level, paste JSON from the Admin Policy Generator into Devices > Chrome > Apps & extensions > Policy for extensions."
  },
  WARN_OMNIBOX_POLICY_MISSING: {
    code: "WARN_OMNIBOX_POLICY_MISSING",
    severity: "warning",
    title: "Chrome Native Omnibox AI Mode Policy Not Configured",
    remediationTemplate: "An AI Mode click arrived from Chrome's native Omnibox or New Tab Page and was silently blocked. To remove the native browser button itself, set AIModeSettings = 'Do not allow' (1) under Devices > Chrome > Settings > Users & browsers for this grade OU (Chrome/ChromeOS 138+)."
  }
};
function formatRemediation(code, detail) {
  const entry = ERROR_CATALOG[code];
  const sanitizedDetail = typeof detail === "string" && detail.trim().length > 0 ? detail.trim().replace(/\s+/g, " ").slice(0, 240) : "unspecified";
  return entry.remediationTemplate.replace("{detail}", sanitizedDetail);
}
function getTodayDateBucket(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10);
}
function createDiagnosticEntry(code, detail, dateBucket) {
  const catalogEntry = ERROR_CATALOG[code];
  const date = dateBucket ?? getTodayDateBucket();
  const cleanDetail = detail.trim().replace(/\s+/g, " ").slice(0, 240);
  return {
    code,
    severity: catalogEntry.severity,
    title: catalogEntry.title,
    detail: cleanDetail,
    remediation: formatRemediation(code, cleanDetail),
    count: 1,
    firstSeenDate: date,
    lastSeenDate: date
  };
}

// src/shared/policy.ts
function isValidAppsScriptUrl(url) {
  if (typeof url !== "string") {
    return false;
  }
  return APPS_SCRIPT_URL_REGEX.test(url);
}
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
      ...DEFAULT_ANALYTICS_POLICY,
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
  let analyticsEnabled = DEFAULT_ANALYTICS_POLICY.analyticsEnabled;
  if ("analyticsEnabled" in managedRaw && managedRaw.analyticsEnabled !== void 0) {
    if (typeof managedRaw.analyticsEnabled === "boolean") {
      analyticsEnabled = managedRaw.analyticsEnabled;
    } else {
      invalidFields.push("analyticsEnabled");
      analyticsEnabled = false;
    }
  }
  let analyticsEndpointUrl = DEFAULT_ANALYTICS_POLICY.analyticsEndpointUrl;
  if ("analyticsEndpointUrl" in managedRaw && managedRaw.analyticsEndpointUrl !== void 0) {
    if (typeof managedRaw.analyticsEndpointUrl === "string") {
      analyticsEndpointUrl = managedRaw.analyticsEndpointUrl.trim();
    } else {
      invalidFields.push("analyticsEndpointUrl");
      analyticsEndpointUrl = "";
    }
  }
  let analyticsSharedToken = DEFAULT_ANALYTICS_POLICY.analyticsSharedToken;
  if ("analyticsSharedToken" in managedRaw && managedRaw.analyticsSharedToken !== void 0) {
    if (typeof managedRaw.analyticsSharedToken === "string") {
      analyticsSharedToken = managedRaw.analyticsSharedToken.trim();
    } else {
      invalidFields.push("analyticsSharedToken");
      analyticsSharedToken = "";
    }
  }
  let analyticsFlushIntervalMinutes = DEFAULT_ANALYTICS_POLICY.analyticsFlushIntervalMinutes;
  if ("analyticsFlushIntervalMinutes" in managedRaw && managedRaw.analyticsFlushIntervalMinutes !== void 0) {
    const rawInterval = managedRaw.analyticsFlushIntervalMinutes;
    if (typeof rawInterval === "number" && Number.isInteger(rawInterval) && rawInterval >= MIN_FLUSH_INTERVAL_MINUTES && rawInterval <= MAX_FLUSH_INTERVAL_MINUTES) {
      analyticsFlushIntervalMinutes = rawInterval;
    } else {
      invalidFields.push("analyticsFlushIntervalMinutes");
      analyticsFlushIntervalMinutes = DEFAULT_ANALYTICS_POLICY.analyticsFlushIntervalMinutes;
    }
  }
  if (invalidFields.length > 0) {
    errors.push({
      code: "ERR_POLICY_INVALID",
      detail: invalidFields.join(", ")
    });
  }
  if (analyticsEnabled && !isValidAppsScriptUrl(analyticsEndpointUrl)) {
    errors.push({
      code: "ERR_ANALYTICS_ENDPOINT_INVALID",
      detail: analyticsEndpointUrl ? "Configured analyticsEndpointUrl failed Apps Script allowlist validation" : "analyticsEndpointUrl is missing while analyticsEnabled is true"
    });
  }
  const policy = {
    ...toggles,
    analyticsEnabled,
    analyticsEndpointUrl,
    analyticsSharedToken,
    analyticsFlushIntervalMinutes,
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
async function enqueueStorageOp(fn) {
  const previous = storageQueueTail;
  let release;
  storageQueueTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
function formatErrorMessage(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
function sanitizeMetrics(raw) {
  const metrics = createEmptyMetrics();
  if (!raw || typeof raw !== "object") {
    return metrics;
  }
  const obj = raw;
  for (const key of METRIC_KEYS) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      metrics[key] = Math.floor(val);
    }
  }
  return metrics;
}
function sanitizePendingMetricsByDate(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  for (const [dateKey, value] of Object.entries(raw)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      out[dateKey] = sanitizeMetrics(value);
    }
  }
  return out;
}
function sanitizePendingErrorsByCode(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  const obj = raw;
  for (const code of ALL_ERROR_CODES) {
    const val = obj[code];
    if (typeof val === "number" && Number.isFinite(val) && val > 0) {
      out[code] = Math.floor(val);
    }
  }
  return out;
}
function sanitizeDiagnosticLog(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const validCodes = new Set(ALL_ERROR_CODES);
  const entries = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item;
    if (typeof candidate.code !== "string" || !validCodes.has(candidate.code)) {
      continue;
    }
    const code = candidate.code;
    const detail = typeof candidate.detail === "string" ? candidate.detail : "";
    const firstSeenDate = typeof candidate.firstSeenDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.firstSeenDate) ? candidate.firstSeenDate : getTodayDateBucket();
    const lastSeenDate = typeof candidate.lastSeenDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.lastSeenDate) ? candidate.lastSeenDate : firstSeenDate;
    const count = typeof candidate.count === "number" && Number.isFinite(candidate.count) && candidate.count > 0 ? Math.floor(candidate.count) : 1;
    const base = createDiagnosticEntry(code, detail, firstSeenDate);
    entries.push({
      ...base,
      count,
      firstSeenDate,
      lastSeenDate
    });
    if (entries.length >= MAX_DIAGNOSTIC_LOG_ENTRIES) {
      break;
    }
  }
  return entries;
}
function normalizeTelemetryState(raw) {
  const initial = createInitialTelemetryState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return initial;
  }
  const obj = raw;
  const validStatuses = /* @__PURE__ */ new Set(["idle", "ok", "error", "disabled"]);
  const lastFlushStatus = typeof obj.lastFlushStatus === "string" && validStatuses.has(obj.lastFlushStatus) ? obj.lastFlushStatus : initial.lastFlushStatus;
  return {
    lifetimeMetrics: sanitizeMetrics(obj.lifetimeMetrics),
    pendingMetricsByDate: sanitizePendingMetricsByDate(obj.pendingMetricsByDate),
    pendingErrorsByCode: sanitizePendingErrorsByCode(obj.pendingErrorsByCode),
    diagnosticLog: sanitizeDiagnosticLog(obj.diagnosticLog),
    lastFlushAttemptDate: typeof obj.lastFlushAttemptDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.lastFlushAttemptDate) ? obj.lastFlushAttemptDate : null,
    lastFlushSuccessDate: typeof obj.lastFlushSuccessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.lastFlushSuccessDate) ? obj.lastFlushSuccessDate : null,
    lastFlushStatus,
    lastFlushMessage: typeof obj.lastFlushMessage === "string" ? obj.lastFlushMessage : initial.lastFlushMessage,
    consecutiveFlushFailures: typeof obj.consecutiveFlushFailures === "number" && Number.isFinite(obj.consecutiveFlushFailures) && obj.consecutiveFlushFailures >= 0 ? Math.floor(obj.consecutiveFlushFailures) : 0,
    nextEligibleFlushAtMs: typeof obj.nextEligibleFlushAtMs === "number" && Number.isFinite(obj.nextEligibleFlushAtMs) && obj.nextEligibleFlushAtMs >= 0 ? obj.nextEligibleFlushAtMs : 0
  };
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
async function writeLocalOverrides(overrides) {
  await enqueueStorageOp(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.LOCAL_OVERRIDES]: overrides });
  });
}
async function readTelemetryState() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return createInitialTelemetryState();
  }
  const result = await chrome.storage.local.get(STORAGE_KEYS.TELEMETRY);
  return normalizeTelemetryState(result?.[STORAGE_KEYS.TELEMETRY]);
}
async function writeTelemetryState(state) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    throw new Error("chrome.storage.local is unavailable");
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.TELEMETRY]: state });
}
async function incrementTelemetryMetrics(deltas, now = /* @__PURE__ */ new Date()) {
  return enqueueStorageOp(async () => {
    const state = await readTelemetryState();
    const dateBucket = getTodayDateBucket(now);
    const existingBucket = state.pendingMetricsByDate[dateBucket] ?? createEmptyMetrics();
    let changed = false;
    for (const key of METRIC_KEYS) {
      const rawDelta = deltas[key];
      if (typeof rawDelta === "number" && Number.isFinite(rawDelta) && rawDelta > 0) {
        const delta = Math.floor(rawDelta);
        if (delta > 0) {
          state.lifetimeMetrics[key] = (state.lifetimeMetrics[key] ?? 0) + delta;
          existingBucket[key] = (existingBucket[key] ?? 0) + delta;
          changed = true;
        }
      }
    }
    if (changed) {
      state.pendingMetricsByDate[dateBucket] = existingBucket;
      await writeTelemetryState(state);
    }
    return state;
  });
}
async function recordDiagnosticEntry(code, detail = "", now = /* @__PURE__ */ new Date()) {
  return enqueueStorageOp(async () => {
    const state = await readTelemetryState();
    const dateBucket = getTodayDateBucket(now);
    const cleanDetail = detail.trim().replace(/\s+/g, " ").slice(0, 240);
    state.pendingErrorsByCode[code] = (state.pendingErrorsByCode[code] ?? 0) + 1;
    const existingIndex = state.diagnosticLog.findIndex(
      (entry) => entry.code === code && entry.detail === cleanDetail
    );
    if (existingIndex >= 0) {
      const existing = state.diagnosticLog[existingIndex];
      existing.count += 1;
      existing.lastSeenDate = dateBucket;
      existing.remediation = formatRemediation(code, cleanDetail);
    } else {
      const newEntry = createDiagnosticEntry(code, cleanDetail, dateBucket);
      if (state.diagnosticLog.length >= MAX_DIAGNOSTIC_LOG_ENTRIES) {
        let evictIdx = 0;
        for (let i = 1; i < state.diagnosticLog.length; i++) {
          if (state.diagnosticLog[i].lastSeenDate < state.diagnosticLog[evictIdx].lastSeenDate) {
            evictIdx = i;
          }
        }
        state.diagnosticLog.splice(evictIdx, 1);
      }
      state.diagnosticLog.push(newEntry);
    }
    await writeTelemetryState(state);
    return state;
  });
}
async function resetLocalTelemetry() {
  return enqueueStorageOp(async () => {
    const fresh = createInitialTelemetryState();
    await writeTelemetryState(fresh);
    return fresh;
  });
}

// src/background/analytics.ts
var ALLOWED_PAYLOAD_KEYS = [
  "schemaVersion",
  "extensionVersion",
  "token",
  "gradeBand",
  "dateBucket",
  "metrics",
  "errors"
];
var ALLOWED_PAYLOAD_KEY_SET = new Set(ALLOWED_PAYLOAD_KEYS);
var VALID_GRADE_BAND_SET = new Set(VALID_GRADE_BANDS);
var VALID_METRIC_KEY_SET = new Set(METRIC_KEYS);
var VALID_ERROR_CODE_SET = new Set(ALL_ERROR_CODES);
var SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
var DATE_BUCKET_REGEX = /^\d{4}-\d{2}-\d{2}$/;
var MAX_COUNT_VALUE = 1e5;
var MAX_BACKOFF_MS = 24 * 60 * 60 * 1e3;
var BASE_BACKOFF_MS = 15 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 15e3;
function sanitizeIntegerCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(MAX_COUNT_VALUE, Math.floor(value));
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sumMetrics(metrics) {
  let total = 0;
  for (const key of METRIC_KEYS) {
    total += sanitizeIntegerCount(metrics[key]);
  }
  return total;
}
function buildSanitizedPayload(input) {
  const cleanVersion = typeof input.extensionVersion === "string" && SEMVER_REGEX.test(input.extensionVersion.trim()) ? input.extensionVersion.trim() : "1.0.0";
  const cleanGradeBand = typeof input.gradeBand === "string" && VALID_GRADE_BAND_SET.has(input.gradeBand) ? input.gradeBand : "Unassigned";
  const cleanDateBucket = typeof input.dateBucket === "string" && DATE_BUCKET_REGEX.test(input.dateBucket) ? input.dateBucket : getTodayDateBucket();
  const cleanMetrics = createEmptyMetrics();
  if (isPlainObject(input.metrics)) {
    for (const key of METRIC_KEYS) {
      cleanMetrics[key] = sanitizeIntegerCount(input.metrics[key]);
    }
  }
  const cleanErrors = {};
  if (isPlainObject(input.errors)) {
    for (const code of ALL_ERROR_CODES) {
      const count = sanitizeIntegerCount(input.errors[code]);
      if (count > 0) {
        cleanErrors[code] = count;
      }
    }
  }
  const payload = {
    schemaVersion: 1,
    extensionVersion: cleanVersion,
    gradeBand: cleanGradeBand,
    dateBucket: cleanDateBucket,
    metrics: cleanMetrics,
    errors: cleanErrors
  };
  if (typeof input.token === "string") {
    const trimmedToken = input.token.trim();
    if (trimmedToken.length > 0) {
      payload.token = trimmedToken;
    }
  }
  return payload;
}
function assertNoPiiPayload(payload) {
  if (!isPlainObject(payload)) {
    return false;
  }
  const ownKeys = Object.getOwnPropertyNames(payload);
  for (const key of ownKeys) {
    if (!ALLOWED_PAYLOAD_KEY_SET.has(key)) {
      return false;
    }
  }
  if (payload.schemaVersion !== 1) {
    return false;
  }
  if (typeof payload.extensionVersion !== "string" || !SEMVER_REGEX.test(payload.extensionVersion)) {
    return false;
  }
  if (typeof payload.gradeBand !== "string" || !VALID_GRADE_BAND_SET.has(payload.gradeBand)) {
    return false;
  }
  if (typeof payload.dateBucket !== "string" || !DATE_BUCKET_REGEX.test(payload.dateBucket)) {
    return false;
  }
  if ("token" in payload) {
    if (typeof payload.token !== "string" || payload.token.trim().length === 0 || payload.token.length > 256) {
      return false;
    }
  }
  if (!isPlainObject(payload.metrics)) {
    return false;
  }
  const metricKeys = Object.getOwnPropertyNames(payload.metrics);
  if (metricKeys.length !== METRIC_KEYS.length) {
    return false;
  }
  for (const key of metricKeys) {
    if (!VALID_METRIC_KEY_SET.has(key)) {
      return false;
    }
    const val = payload.metrics[key];
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > MAX_COUNT_VALUE) {
      return false;
    }
  }
  if (!isPlainObject(payload.errors)) {
    return false;
  }
  const errorKeys = Object.getOwnPropertyNames(payload.errors);
  for (const key of errorKeys) {
    if (!VALID_ERROR_CODE_SET.has(key)) {
      return false;
    }
    const val = payload.errors[key];
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > MAX_COUNT_VALUE) {
      return false;
    }
  }
  return true;
}
function calculateBackoffMs(consecutiveFailures) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, consecutiveFailures - 1));
}
async function scheduleAnalyticsAlarm(policy, rng = Math.random) {
  if (!policy.analyticsEnabled || !isValidAppsScriptUrl(policy.analyticsEndpointUrl)) {
    await chrome.alarms.clear(ANALYTICS_ALARM_NAME);
    return;
  }
  const delayInMinutes = policy.analyticsFlushIntervalMinutes + Math.floor(rng() * 31);
  await chrome.alarms.create(ANALYTICS_ALARM_NAME, { delayInMinutes });
}
function getDefaultExtensionVersion() {
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    const version = chrome.runtime.getManifest().version;
    if (typeof version === "string" && SEMVER_REGEX.test(version)) {
      return version;
    }
  }
  return "1.0.0";
}
async function flushAnalyticsIfDue(policy, options) {
  const force = options?.force ?? false;
  const fetchFn = options?.fetchImpl ?? fetch;
  const now = options?.now ?? /* @__PURE__ */ new Date();
  const today = getTodayDateBucket(now);
  const extensionVersion = options?.extensionVersion ?? getDefaultExtensionVersion();
  if (!policy.analyticsEnabled) {
    await enqueueStorageOp(async () => {
      const state = await readTelemetryState();
      state.lastFlushStatus = "disabled";
      state.lastFlushMessage = "Analytics disabled (local-only mode).";
      await writeTelemetryState(state);
    });
    return {
      attempted: false,
      status: "disabled",
      flushedBuckets: 0,
      message: "Analytics disabled (local-only mode)."
    };
  }
  if (!isValidAppsScriptUrl(policy.analyticsEndpointUrl)) {
    const detail = policy.analyticsEndpointUrl ? "analyticsEndpointUrl failed Apps Script allowlist validation" : "analyticsEndpointUrl is missing";
    await enqueueStorageOp(async () => {
      const state = await readTelemetryState();
      state.lastFlushAttemptDate = today;
      state.lastFlushStatus = "error";
      state.lastFlushMessage = "Invalid Apps Script endpoint URL.";
      await writeTelemetryState(state);
    });
    await recordDiagnosticEntry("ERR_ANALYTICS_ENDPOINT_INVALID", detail, now);
    return {
      attempted: false,
      status: "error",
      flushedBuckets: 0,
      message: "Invalid Apps Script endpoint URL.",
      errorCode: "ERR_ANALYTICS_ENDPOINT_INVALID"
    };
  }
  const initialState = await readTelemetryState();
  if (!force && initialState.nextEligibleFlushAtMs > now.getTime()) {
    return {
      attempted: false,
      status: "idle",
      flushedBuckets: 0,
      message: "Flush deferred until exponential backoff window elapses."
    };
  }
  const errorsSnapshot = {};
  let hasPendingErrors = false;
  for (const code of ALL_ERROR_CODES) {
    const count = sanitizeIntegerCount(initialState.pendingErrorsByCode[code]);
    if (count > 0) {
      errorsSnapshot[code] = count;
      hasPendingErrors = true;
    }
  }
  const dateBuckets = Object.keys(initialState.pendingMetricsByDate).sort();
  const nonEmptyMetricBuckets = [];
  for (const dateBucket of dateBuckets) {
    if (!DATE_BUCKET_REGEX.test(dateBucket)) {
      continue;
    }
    const rawBucket = initialState.pendingMetricsByDate[dateBucket];
    const clonedMetrics = createEmptyMetrics();
    for (const key of METRIC_KEYS) {
      clonedMetrics[key] = sanitizeIntegerCount(rawBucket?.[key]);
    }
    if (sumMetrics(clonedMetrics) > 0) {
      nonEmptyMetricBuckets.push({ dateBucket, metrics: clonedMetrics });
    }
  }
  const snapshots = [];
  if (nonEmptyMetricBuckets.length > 0) {
    nonEmptyMetricBuckets.forEach((bucket, index) => {
      const isLast = index === nonEmptyMetricBuckets.length - 1;
      snapshots.push({
        dateBucket: bucket.dateBucket,
        metrics: bucket.metrics,
        errors: isLast ? errorsSnapshot : {}
      });
    });
  } else if (hasPendingErrors) {
    snapshots.push({
      dateBucket: today,
      metrics: createEmptyMetrics(),
      errors: errorsSnapshot
    });
  } else if (force) {
    snapshots.push({
      dateBucket: today,
      metrics: createEmptyMetrics(),
      errors: {}
    });
  } else {
    return {
      attempted: false,
      status: "idle",
      flushedBuckets: 0,
      message: "No pending metrics or errors to flush."
    };
  }
  let flushedBuckets = 0;
  try {
    for (const bucket of snapshots) {
      const payload = buildSanitizedPayload({
        extensionVersion,
        gradeBand: policy.gradeBand,
        dateBucket: bucket.dateBucket,
        metrics: bucket.metrics,
        errors: bucket.errors,
        token: policy.analyticsSharedToken || void 0
      });
      if (!assertNoPiiPayload(payload)) {
        throw new Error("Sanitized analytics payload failed zero-PII validation");
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetchFn(policy.analyticsEndpointUrl, {
          method: "POST",
          // text/plain keeps this a CORS "simple request"; Apps Script web apps cannot answer a preflight.
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          redirect: "follow",
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error("Invalid JSON response from Apps Script endpoint");
      }
      if (!isPlainObject(body) || body.status !== "ok") {
        const remoteCode = isPlainObject(body) && typeof body.code === "string" ? body.code : "NON_OK_RESPONSE";
        throw new Error(`Apps Script rejected batch (${remoteCode})`);
      }
      flushedBuckets += 1;
      await enqueueStorageOp(async () => {
        const current = await readTelemetryState();
        const currentBucket = current.pendingMetricsByDate[bucket.dateBucket];
        if (currentBucket) {
          let remainingSum = 0;
          for (const key of METRIC_KEYS) {
            const nextVal = Math.max(0, (currentBucket[key] ?? 0) - (bucket.metrics[key] ?? 0));
            currentBucket[key] = nextVal;
            remainingSum += nextVal;
          }
          if (remainingSum === 0) {
            delete current.pendingMetricsByDate[bucket.dateBucket];
          }
        }
        for (const [code, sentCount] of Object.entries(bucket.errors)) {
          const curCount = current.pendingErrorsByCode[code] ?? 0;
          const nextCount = Math.max(0, curCount - sentCount);
          if (nextCount === 0) {
            delete current.pendingErrorsByCode[code];
          } else {
            current.pendingErrorsByCode[code] = nextCount;
          }
        }
        current.lastFlushAttemptDate = today;
        current.lastFlushSuccessDate = today;
        current.lastFlushStatus = "ok";
        current.lastFlushMessage = `Flushed ${flushedBuckets} daily bucket(s) successfully.`;
        current.consecutiveFlushFailures = 0;
        current.nextEligibleFlushAtMs = 0;
        await writeTelemetryState(current);
      });
    }
    return {
      attempted: true,
      status: "ok",
      flushedBuckets,
      message: `Flushed ${flushedBuckets} daily bucket(s) successfully.`
    };
  } catch (err) {
    const detail = err instanceof Error ? err.name === "AbortError" ? "Request timed out after 15s" : err.message : String(err);
    await enqueueStorageOp(async () => {
      const current = await readTelemetryState();
      const nextFailures = current.consecutiveFlushFailures + 1;
      const backoffMs = calculateBackoffMs(nextFailures);
      current.consecutiveFlushFailures = nextFailures;
      current.nextEligibleFlushAtMs = now.getTime() + backoffMs;
      current.lastFlushAttemptDate = today;
      current.lastFlushStatus = "error";
      current.lastFlushMessage = detail;
      await writeTelemetryState(current);
    });
    await recordDiagnosticEntry("ERR_ANALYTICS_FLUSH_FAILED", detail, now);
    return {
      attempted: true,
      status: "error",
      flushedBuckets,
      message: detail,
      errorCode: "ERR_ANALYTICS_FLUSH_FAILED"
    };
  }
}

// src/background/dnr-rules.ts
var ALL_MANAGED_RULE_IDS = [101, 102, 110, 111, 120, 130];
var ACTION_REDIRECT = "redirect";
var ACTION_ALLOW = "allow";
var RESOURCE_MAIN_FRAME = "main_frame";
function createAiModeQueryTransform(forceWebOnlySearch) {
  if (forceWebOnlySearch) {
    return {
      addOrReplaceParams: [{ key: "udm", value: "14" }],
      removeParams: ["aep", "arv", "mstk", "csuir"]
    };
  }
  return {
    removeParams: ["udm", "aep", "arv", "mstk", "csuir"]
  };
}
function buildDynamicRules(policy) {
  if (!policy.masterEnabled) {
    return [];
  }
  const rules = [];
  if (policy.blockAiModeNavigation) {
    rules.push({
      id: 101,
      priority: 55,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_omnibox"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?(sourceid=chrome|aep=)[^#]*&udm=50(&|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 102,
      priority: 55,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_omnibox"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50&[^#]*(sourceid=chrome|aep=)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 110,
      priority: 50,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_aimode"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50(&|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 111,
      priority: 50,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          url: "https://www.google.com/#rm_sg_aimode"
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(ai|aimode)(/|\\?|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
  }
  if (policy.forceWebOnlySearch) {
    rules.push({
      id: 120,
      priority: 40,
      action: {
        type: ACTION_ALLOW
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?(udm=|tbm=)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 130,
      priority: 30,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [{ key: "udm", value: "14" }]
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?q=",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
  }
  return rules;
}
async function syncDynamicRules(policy) {
  return enqueueStorageOp(async () => {
    try {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = Array.from(
        /* @__PURE__ */ new Set([...ALL_MANAGED_RULE_IDS, ...existingRules.map((rule) => rule.id)])
      );
      const addRules = buildDynamicRules(policy);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules
      });
      return { activeRuleCount: addRules.length };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { activeRuleCount: 0, error: detail };
    }
  });
}

// src/background/service-worker.ts
function getExtensionVersion() {
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    return chrome.runtime.getManifest().version;
  }
  return "1.0.0";
}
function sanitizeLocalOverridesInput(raw) {
  const clean = {};
  for (const key of FEATURE_TOGGLE_KEYS) {
    if (typeof raw[key] === "boolean") {
      clean[key] = raw[key];
    }
  }
  if (typeof raw.gradeBand === "string" && VALID_GRADE_BANDS.includes(raw.gradeBand)) {
    clean.gradeBand = raw.gradeBand;
  }
  return clean;
}
async function getActiveDynamicRuleCount() {
  if (typeof chrome === "undefined" || !chrome.declarativeNetRequest?.getDynamicRules) {
    return 0;
  }
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return rules.length;
  } catch {
    return 0;
  }
}
async function resolvePolicyFromStorage() {
  const [managedRes, localRes] = await Promise.all([
    readManagedPolicyRaw(),
    readLocalOverrides()
  ]);
  if (managedRes.error) {
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `managed read: ${managedRes.error}`);
  }
  if (localRes.error) {
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `local read: ${localRes.error}`);
  }
  return parsePolicy(managedRes.data, localRes.data);
}
async function syncRuntimeState(options) {
  const { policy, errors } = await resolvePolicyFromStorage();
  if (options.recordPolicyDiagnostics) {
    for (const err of errors) {
      await recordDiagnosticEntry(err.code, err.detail);
    }
  }
  const dnrResult = await syncDynamicRules(policy);
  if (dnrResult.error) {
    await recordDiagnosticEntry("ERR_DNR_SYNC_FAILED", dnrResult.error);
  }
  if (options.alarmMode === "reschedule") {
    await scheduleAnalyticsAlarm(policy);
  } else if (options.alarmMode === "ensure") {
    const existingAlarm = await chrome.alarms.get(ANALYTICS_ALARM_NAME);
    const shouldHaveAlarm = policy.analyticsEnabled && isValidAppsScriptUrl(policy.analyticsEndpointUrl);
    if (shouldHaveAlarm && !existingAlarm) {
      await scheduleAnalyticsAlarm(policy);
    } else if (!shouldHaveAlarm && existingAlarm) {
      await chrome.alarms.clear(ANALYTICS_ALARM_NAME);
    }
  }
  return { policy, activeRuleCount: dnrResult.activeRuleCount };
}
async function handleRuntimeMessage(message) {
  switch (message.type) {
    case "GET_EFFECTIVE_POLICY": {
      const { policy } = await resolvePolicyFromStorage();
      return policy;
    }
    case "INCREMENT_METRICS": {
      await incrementTelemetryMetrics(message.deltas);
      return { ok: true };
    }
    case "RECORD_REDIRECT": {
      if (message.source === "omnibox") {
        await incrementTelemetryMetrics({
          aiModeRedirects: 1,
          omniboxFallbackRedirects: 1
        });
        await recordDiagnosticEntry(
          "WARN_OMNIBOX_POLICY_MISSING",
          "Omnibox/NTP AI Mode redirect intercepted via #rm_sg_omnibox fallback"
        );
      } else {
        await incrementTelemetryMetrics({
          aiModeRedirects: 1
        });
      }
      return { ok: true };
    }
    case "LOG_DIAGNOSTIC": {
      await recordDiagnosticEntry(message.code, message.detail ?? "");
      return { ok: true };
    }
    case "GET_DIAGNOSTIC_SNAPSHOT": {
      const [{ policy }, telemetry, activeRuleCount] = await Promise.all([
        resolvePolicyFromStorage(),
        readTelemetryState(),
        getActiveDynamicRuleCount()
      ]);
      const snapshot = {
        policy,
        telemetry,
        activeRuleCount,
        extensionVersion: getExtensionVersion(),
        generatedAtDate: getTodayDateBucket()
      };
      return snapshot;
    }
    case "SET_LOCAL_OVERRIDES": {
      const { policy: currentPolicy } = await resolvePolicyFromStorage();
      if (currentPolicy.isManaged) {
        return currentPolicy;
      }
      const existingLocalRes = await readLocalOverrides();
      const merged = {
        ...existingLocalRes.data ?? {},
        ...sanitizeLocalOverridesInput(message.toggles)
      };
      await writeLocalOverrides(merged);
      const { policy: updatedPolicy } = await syncRuntimeState({
        recordPolicyDiagnostics: false,
        alarmMode: "none"
      });
      return updatedPolicy;
    }
    case "RESET_LOCAL_METRICS": {
      return await resetLocalTelemetry();
    }
    case "TRIGGER_TEST_FLUSH": {
      const { policy } = await resolvePolicyFromStorage();
      return await flushAnalyticsIfDue(policy, { force: true });
    }
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await syncRuntimeState({
      recordPolicyDiagnostics: true,
      alarmMode: "reschedule"
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onInstalled: ${detail}`);
  }
});
chrome.runtime.onStartup.addListener(async () => {
  try {
    await syncRuntimeState({
      recordPolicyDiagnostics: true,
      alarmMode: "ensure"
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onStartup: ${detail}`);
  }
});
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  try {
    if (areaName === "managed") {
      await syncRuntimeState({
        recordPolicyDiagnostics: true,
        alarmMode: "reschedule"
      });
      return;
    }
    if (areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) {
      await syncRuntimeState({
        recordPolicyDiagnostics: false,
        alarmMode: "ensure"
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `storage.onChanged: ${detail}`);
  }
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ANALYTICS_ALARM_NAME) {
    return;
  }
  try {
    const { policy } = await resolvePolicyFromStorage();
    await flushAnalyticsIfDue(policy);
    await scheduleAnalyticsAlarm(policy);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_ANALYTICS_FLUSH_FAILED", detail);
  }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      const result = await handleRuntimeMessage(message);
      sendResponse(result);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      try {
        await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onMessage: ${detail}`);
      } catch {
      }
      sendResponse({ ok: false, error: detail });
    }
  })();
  return true;
});
