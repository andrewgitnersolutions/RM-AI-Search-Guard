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
  LAST_POLICY: "rmsg_last_policy",
  METRICS_RESET_EPOCH: "rmsg_metrics_reset_epoch"
};
var MAX_DIAGNOSTIC_LOG_ENTRIES = 50;
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
    diagnosticLog: []
  };
}

// src/shared/errors.ts
var ALL_ERROR_CODES = [
  "ERR_POLICY_INVALID",
  "ERR_DNR_SYNC_FAILED",
  "ERR_SELECTOR_SYNTAX",
  "ERR_SAFETY_GUARD_TRIPPED",
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
    remediationTemplate: "A bundled DOM selector failed browser validation ({detail}). Other detection tiers remain active. Update to the latest RaiseMark: AI Search Controls for K-12 release."
  },
  ERR_SAFETY_GUARD_TRIPPED: {
    code: "ERR_SAFETY_GUARD_TRIPPED",
    severity: "error",
    title: "Organic Results Safety Guard Tripped",
    remediationTemplate: "Safety Guard prevented hiding core Google Search results ({detail}). Google likely changed its page structure. Check for an extension update."
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
function isValidGradeBand(value) {
  return typeof value === "string" && VALID_GRADE_BANDS.includes(value);
}
function isUnlockableInstall(installType) {
  return installType === "normal" || installType === "development";
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
  return {
    lifetimeMetrics: sanitizeMetrics(obj.lifetimeMetrics),
    diagnosticLog: sanitizeDiagnosticLog(obj.diagnosticLog)
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
async function mergeLocalOverrides(patch) {
  return enqueueStorageOp(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
    const existing = await readLocalOverrides();
    const merged = { ...existing.data ?? {}, ...patch };
    await chrome.storage.local.set({ [STORAGE_KEYS.LOCAL_OVERRIDES]: merged });
    return merged;
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
async function readMetricsResetEpoch() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return 0;
  }
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.METRICS_RESET_EPOCH);
    const raw = result?.[STORAGE_KEYS.METRICS_RESET_EPOCH];
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
      return raw;
    }
    return 0;
  } catch {
    return 0;
  }
}
async function incrementTelemetryMetrics(deltas, batchResetEpoch) {
  return enqueueStorageOp(async () => {
    if (batchResetEpoch !== void 0) {
      const currentEpoch = await readMetricsResetEpoch();
      if (batchResetEpoch < currentEpoch) {
        return await readTelemetryState();
      }
    }
    const state = await readTelemetryState();
    let changed = false;
    for (const key of METRIC_KEYS) {
      const rawDelta = deltas[key];
      if (typeof rawDelta === "number" && Number.isFinite(rawDelta) && rawDelta > 0) {
        const delta = Math.floor(rawDelta);
        if (delta > 0) {
          state.lifetimeMetrics[key] = (state.lifetimeMetrics[key] ?? 0) + delta;
          changed = true;
        }
      }
    }
    if (changed) {
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
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
    const fresh = createInitialTelemetryState();
    const nextEpoch = await readMetricsResetEpoch() + 1;
    await chrome.storage.local.set({
      [STORAGE_KEYS.TELEMETRY]: fresh,
      [STORAGE_KEYS.METRICS_RESET_EPOCH]: nextEpoch
    });
    return fresh;
  });
}

// src/background/dnr-rules.ts
var ALL_MANAGED_RULE_IDS = [101, 102, 110, 111, 112, 120, 130];
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
          transform: {
            path: "/search",
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_aimode"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(ai|aimode)(/[^?#]*)?\\?([^#]*&)?q=[^&#]",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 112,
      priority: 45,
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

// src/background/messages.ts
var PRIVILEGED_MESSAGE_TYPES = /* @__PURE__ */ new Set(["SET_LOCAL_OVERRIDES", "RESET_LOCAL_METRICS", "GET_DIAGNOSTIC_SNAPSHOT"]);
var BAD_MESSAGE = { ok: false, error: "bad_message" };
var FORBIDDEN = { ok: false, error: "forbidden" };
var ERROR_CODE_SET = new Set(ALL_ERROR_CODES);
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFromExtensionPage(sender) {
  const id = typeof chrome !== "undefined" ? chrome.runtime?.id : void 0;
  if (!id || !sender || sender.id !== id) {
    return false;
  }
  return typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${id}/`);
}
function validateMessage(message) {
  if (!isPlainObject(message) || typeof message.type !== "string") {
    return false;
  }
  switch (message.type) {
    case "GET_EFFECTIVE_POLICY":
    case "GET_DIAGNOSTIC_SNAPSHOT":
    case "RESET_LOCAL_METRICS":
      return true;
    case "INCREMENT_METRICS":
      return isPlainObject(message.deltas) && (message.resetEpoch === void 0 || typeof message.resetEpoch === "number" && Number.isInteger(message.resetEpoch) && message.resetEpoch >= 0);
    case "RECORD_REDIRECT":
      return message.source === "omnibox" || message.source === "aimode";
    case "LOG_DIAGNOSTIC":
      return typeof message.code === "string" && ERROR_CODE_SET.has(message.code) && (message.detail === void 0 || typeof message.detail === "string");
    case "SET_LOCAL_OVERRIDES":
      return isPlainObject(message.toggles);
    default:
      return false;
  }
}
function toContentPolicy(policy) {
  return {
    masterEnabled: policy.masterEnabled,
    hideAiOverviews: policy.hideAiOverviews,
    hideAiModeUi: policy.hideAiModeUi,
    blockAiModeNavigation: policy.blockAiModeNavigation,
    forceWebOnlySearch: policy.forceWebOnlySearch,
    hideAuxiliaryAiFeatures: policy.hideAuxiliaryAiFeatures,
    gradeBand: policy.gradeBand,
    isManaged: policy.isManaged
  };
}

// src/background/service-worker.ts
async function resolveInstallType() {
  if (typeof chrome === "undefined" || typeof chrome.management?.getSelf !== "function") {
    return "unknown";
  }
  try {
    const self = await chrome.management.getSelf();
    if (typeof self?.installType === "string") {
      return self.installType;
    }
  } catch {
  }
  return "unknown";
}
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
  const [managedRes, localRes, installType] = await Promise.all([
    readManagedPolicyRaw(),
    readLocalOverrides(),
    resolveInstallType()
  ]);
  if (managedRes.error) {
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `managed read: ${managedRes.error}`);
  }
  if (localRes.error) {
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `local read: ${localRes.error}`);
  }
  return { ...parsePolicy(managedRes.data, localRes.data, /* @__PURE__ */ new Date(), installType), installType };
}
var syncChainTail = Promise.resolve();
function syncRuntimeState(options) {
  const run = syncChainTail.then(() => syncRuntimeStateNow(options));
  syncChainTail = run.catch(() => {
  });
  return run;
}
async function syncRuntimeStateNow(options) {
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
  return { policy, activeRuleCount: dnrResult.activeRuleCount };
}
async function handleRuntimeMessage(message, sender) {
  if (!validateMessage(message)) {
    return BAD_MESSAGE;
  }
  const fromExtensionPage = isFromExtensionPage(sender);
  if (PRIVILEGED_MESSAGE_TYPES.has(message.type) && !fromExtensionPage) {
    return FORBIDDEN;
  }
  switch (message.type) {
    case "GET_EFFECTIVE_POLICY": {
      const { policy } = await resolvePolicyFromStorage();
      return fromExtensionPage ? policy : toContentPolicy(policy);
    }
    case "INCREMENT_METRICS": {
      await incrementTelemetryMetrics(message.deltas, message.resetEpoch);
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
      const { policy: currentPolicy, installType } = await resolvePolicyFromStorage();
      if (currentPolicy.isManaged || !isUnlockableInstall(installType)) {
        return currentPolicy;
      }
      await mergeLocalOverrides(sanitizeLocalOverridesInput(message.toggles));
      const { policy: updatedPolicy } = await syncRuntimeState({
        recordPolicyDiagnostics: false
      });
      return updatedPolicy;
    }
    case "RESET_LOCAL_METRICS": {
      const { policy, installType } = await resolvePolicyFromStorage();
      if (policy.isManaged || !isUnlockableInstall(installType)) {
        return { ok: false, reason: "locked" };
      }
      return await resetLocalTelemetry();
    }
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await syncRuntimeState({
      recordPolicyDiagnostics: true
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onInstalled: ${detail}`);
  }
});
chrome.runtime.onStartup.addListener(async () => {
  try {
    await syncRuntimeState({
      recordPolicyDiagnostics: true
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
        recordPolicyDiagnostics: true
      });
      return;
    }
    if (areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) {
      await syncRuntimeState({
        recordPolicyDiagnostics: false
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `storage.onChanged: ${detail}`);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const result = await handleRuntimeMessage(message, sender);
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
