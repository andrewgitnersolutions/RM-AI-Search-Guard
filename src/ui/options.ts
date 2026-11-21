/**
 * Options hub controller: Status & Local Testing, IT Diagnostics & Analytics, and the
 * Admin Policy Generator tabs.
 * Runs in: extension page (options.html).
 * Must never: export or display page content, queries, URLs or identifiers; diagnostics and
 * CSV exports are aggregate counts and catalog codes only.
 * Shared with: shared/defaults.ts, shared/errors.ts, shared/policy.ts, ui/policy-generator-core.ts.
 */

import { FEATURE_TOGGLE_KEYS, STORAGE_KEYS, VALID_GRADE_BANDS, createInitialTelemetryState } from "../shared/defaults";
import { getTodayDateBucket } from "../shared/errors";
import { isValidAppsScriptUrl, parsePolicy } from "../shared/policy";
import { mountPolicyGenerator } from "./policy-generator-core";

// Apps Script sink template, inlined as one string. The `true ? … : void 0` shape is what the
// original build-time define produced; it is kept so the rebuild matches the baseline exactly.
const EMBEDDED_APPS_SCRIPT_TEMPLATE = true ? "/**\n * RaiseMark AI Search Guard \u2014 District-Owned Zero-PII Analytics Sink\n *\n * Deployment Instructions:\n * 1. Create a Google Sheet inside your school district's Google Workspace.\n * 2. Open Extensions -> Apps Script and paste this entire file into Code.gs.\n * 3. (Optional) Set SHARED_TOKEN below to match `analyticsSharedToken` in your\n *    Google Admin Console extension policy JSON.\n * 4. Click Deploy -> New deployment -> Web app:\n *      - Execute as: Me\n *      - Who has access: Anyone\n * 5. Copy the resulting https://script.google.com/macros/s/<ID>/exec URL into\n *    the RaiseMark AI Search Guard Admin Policy Generator.\n *\n * Privacy Guarantee:\n * - Strictly allowlists aggregate counts only (zero PII, zero search queries,\n *   zero student emails, zero device IDs, zero IP logging).\n * - Rejects any payload containing unexpected or non-allowlisted fields.\n */\n\nvar SHARED_TOKEN = '';\nvar DAILY_SHEET_NAME = 'Daily_Rollup';\nvar ERROR_SHEET_NAME = 'Error_Summary';\nvar MAX_COUNT_PER_BATCH = 100000;\n\nvar ALLOWED_TOP_LEVEL_KEYS = [\n  'schemaVersion',\n  'extensionVersion',\n  'token',\n  'gradeBand',\n  'dateBucket',\n  'metrics',\n  'errors',\n];\n\nvar ALLOWED_GRADE_BANDS = ['K-2', '3-5', '6-8', '9-12', 'Staff', 'Unassigned'];\n\nvar ALLOWED_METRIC_KEYS = [\n  'overviewsHidden',\n  'aiModeUiHidden',\n  'aiModeRedirects',\n  'omniboxFallbackRedirects',\n  'auxAiHidden',\n];\n\nvar ALLOWED_ERROR_CODES = [\n  'ERR_POLICY_INVALID',\n  'ERR_DNR_SYNC_FAILED',\n  'ERR_SELECTOR_SYNTAX',\n  'ERR_SAFETY_GUARD_TRIPPED',\n  'ERR_ANALYTICS_ENDPOINT_INVALID',\n  'ERR_ANALYTICS_FLUSH_FAILED',\n  'ERR_STORAGE_FAILURE',\n  'WARN_NO_MANAGED_POLICY',\n  'WARN_OMNIBOX_POLICY_MISSING',\n];\n\nvar DAILY_HEADERS = [\n  'Date',\n  'GradeBand',\n  'ExtensionVersion',\n  'OverviewsHidden',\n  'AiModeUiHidden',\n  'AiModeRedirects',\n  'OmniboxFallbackRedirects',\n  'AuxAiHidden',\n  'ReportingBatches',\n];\n\nvar ERROR_HEADERS = ['Date', 'GradeBand', 'ErrorCode', 'Count'];\n\nfunction doGet() {\n  return jsonResponse_({\n    status: 'ok',\n    service: 'RaiseMark AI Search Guard Analytics Sink',\n    message: 'Endpoint is active. Submit anonymous daily aggregates via HTTP POST.',\n  });\n}\n\nfunction doPost(e) {\n  if (!e || !e.postData || typeof e.postData.contents !== 'string') {\n    return jsonResponse_({ status: 'error', code: 'EMPTY_BODY' });\n  }\n\n  var payload;\n  try {\n    payload = JSON.parse(e.postData.contents);\n  } catch (_err) {\n    return jsonResponse_({ status: 'error', code: 'INVALID_JSON' });\n  }\n\n  if (!isPlainObject_(payload)) {\n    return jsonResponse_({ status: 'error', code: 'INVALID_PAYLOAD' });\n  }\n\n  if (typeof SHARED_TOKEN === 'string' && SHARED_TOKEN.length > 0) {\n    if (typeof payload.token !== 'string' || payload.token !== SHARED_TOKEN) {\n      return jsonResponse_({ status: 'error', code: 'UNAUTHORIZED' });\n    }\n  }\n\n  var validation = validatePayload_(payload);\n  if (!validation.ok) {\n    return jsonResponse_({\n      status: 'error',\n      code: validation.code,\n      message: validation.message,\n    });\n  }\n\n  var lock = LockService.getScriptLock();\n  var lockAcquired = false;\n  try {\n    lock.waitLock(15000);\n    lockAcquired = true;\n\n    var ss = SpreadsheetApp.getActiveSpreadsheet();\n    upsertDailyRollup_(ss, validation.data);\n    upsertErrorSummary_(ss, validation.data);\n\n    return jsonResponse_({ status: 'ok' });\n  } catch (err) {\n    return jsonResponse_({\n      status: 'error',\n      code: lockAcquired ? 'WRITE_FAILED' : 'LOCK_TIMEOUT',\n      message: err && err.message ? String(err.message) : 'Unexpected server error',\n    });\n  } finally {\n    if (lockAcquired) {\n      lock.releaseLock();\n    }\n  }\n}\n\nfunction isPlainObject_(value) {\n  return value !== null && typeof value === 'object' && !Array.isArray(value);\n}\n\nfunction isValidCount_(value) {\n  return (\n    typeof value === 'number' &&\n    isFinite(value) &&\n    Math.floor(value) === value &&\n    value >= 0 &&\n    value <= MAX_COUNT_PER_BATCH\n  );\n}\n\nfunction validatePayload_(payload) {\n  var topKeys = Object.keys(payload);\n  for (var i = 0; i < topKeys.length; i++) {\n    if (ALLOWED_TOP_LEVEL_KEYS.indexOf(topKeys[i]) === -1) {\n      return {\n        ok: false,\n        code: 'INVALID_PAYLOAD',\n        message: 'Unexpected field rejected by zero-PII allowlist',\n      };\n    }\n  }\n\n  if (payload.schemaVersion !== 1) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Unsupported schemaVersion' };\n  }\n\n  if (\n    typeof payload.extensionVersion !== 'string' ||\n    !/^\\d+\\.\\d+\\.\\d+$/.test(payload.extensionVersion)\n  ) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid extensionVersion' };\n  }\n\n  if (payload.token !== undefined && typeof payload.token !== 'string') {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid token type' };\n  }\n\n  if (\n    typeof payload.gradeBand !== 'string' ||\n    ALLOWED_GRADE_BANDS.indexOf(payload.gradeBand) === -1\n  ) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid gradeBand' };\n  }\n\n  if (typeof payload.dateBucket !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.dateBucket)) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid dateBucket' };\n  }\n\n  if (!isPlainObject_(payload.metrics)) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Missing or invalid metrics object' };\n  }\n\n  var metricKeys = Object.keys(payload.metrics);\n  for (var m = 0; m < metricKeys.length; m++) {\n    if (ALLOWED_METRIC_KEYS.indexOf(metricKeys[m]) === -1) {\n      return {\n        ok: false,\n        code: 'INVALID_PAYLOAD',\n        message: 'Unexpected metric key rejected by allowlist',\n      };\n    }\n  }\n\n  var cleanMetrics = {};\n  for (var k = 0; k < ALLOWED_METRIC_KEYS.length; k++) {\n    var mKey = ALLOWED_METRIC_KEYS[k];\n    var mVal = payload.metrics[mKey];\n    if (mVal === undefined) {\n      cleanMetrics[mKey] = 0;\n    } else if (!isValidCount_(mVal)) {\n      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid metric value' };\n    } else {\n      cleanMetrics[mKey] = mVal;\n    }\n  }\n\n  var cleanErrors = {};\n  if (payload.errors !== undefined) {\n    if (!isPlainObject_(payload.errors)) {\n      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid errors object' };\n    }\n    var errKeys = Object.keys(payload.errors);\n    for (var eIdx = 0; eIdx < errKeys.length; eIdx++) {\n      var errCode = errKeys[eIdx];\n      if (ALLOWED_ERROR_CODES.indexOf(errCode) === -1) {\n        return {\n          ok: false,\n          code: 'INVALID_PAYLOAD',\n          message: 'Unexpected error code rejected by allowlist',\n        };\n      }\n      var errVal = payload.errors[errCode];\n      if (!isValidCount_(errVal)) {\n        return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid error count' };\n      }\n      if (errVal > 0) {\n        cleanErrors[errCode] = errVal;\n      }\n    }\n  }\n\n  return {\n    ok: true,\n    data: {\n      schemaVersion: 1,\n      extensionVersion: payload.extensionVersion,\n      gradeBand: payload.gradeBand,\n      dateBucket: payload.dateBucket,\n      metrics: cleanMetrics,\n      errors: cleanErrors,\n    },\n  };\n}\n\nfunction getOrCreateSheet_(ss, name, headers) {\n  var sheet = ss.getSheetByName(name);\n  if (!sheet) {\n    sheet = ss.insertSheet(name);\n  }\n  if (sheet.getLastRow() === 0) {\n    sheet.appendRow(headers);\n  }\n  return sheet;\n}\n\nfunction normalizeDateCell_(value) {\n  if (value instanceof Date && !isNaN(value.getTime())) {\n    return value.toISOString().slice(0, 10);\n  }\n  return String(value);\n}\n\nfunction upsertDailyRollup_(ss, data) {\n  var sheet = getOrCreateSheet_(ss, DAILY_SHEET_NAME, DAILY_HEADERS);\n  var lastRow = sheet.getLastRow();\n  var m = data.metrics;\n\n  if (lastRow > 1) {\n    var rows = sheet.getRange(2, 1, lastRow - 1, DAILY_HEADERS.length).getValues();\n    for (var i = 0; i < rows.length; i++) {\n      var row = rows[i];\n      if (\n        normalizeDateCell_(row[0]) === data.dateBucket &&\n        String(row[1]) === data.gradeBand &&\n        String(row[2]) === data.extensionVersion\n      ) {\n        var updated = [\n          data.dateBucket,\n          data.gradeBand,\n          data.extensionVersion,\n          (Number(row[3]) || 0) + m.overviewsHidden,\n          (Number(row[4]) || 0) + m.aiModeUiHidden,\n          (Number(row[5]) || 0) + m.aiModeRedirects,\n          (Number(row[6]) || 0) + m.omniboxFallbackRedirects,\n          (Number(row[7]) || 0) + m.auxAiHidden,\n          (Number(row[8]) || 0) + 1,\n        ];\n        sheet.getRange(i + 2, 1, 1, DAILY_HEADERS.length).setValues([updated]);\n        return;\n      }\n    }\n  }\n\n  sheet.appendRow([\n    data.dateBucket,\n    data.gradeBand,\n    data.extensionVersion,\n    m.overviewsHidden,\n    m.aiModeUiHidden,\n    m.aiModeRedirects,\n    m.omniboxFallbackRedirects,\n    m.auxAiHidden,\n    1,\n  ]);\n}\n\nfunction upsertErrorSummary_(ss, data) {\n  var sheet = getOrCreateSheet_(ss, ERROR_SHEET_NAME, ERROR_HEADERS);\n  var errorCodes = Object.keys(data.errors);\n  if (errorCodes.length === 0) {\n    return;\n  }\n\n  for (var idx = 0; idx < errorCodes.length; idx++) {\n    var code = errorCodes[idx];\n    var count = data.errors[code];\n    if (!count || count <= 0) {\n      continue;\n    }\n\n    var lastRow = sheet.getLastRow();\n    var matched = false;\n    if (lastRow > 1) {\n      var rows = sheet.getRange(2, 1, lastRow - 1, ERROR_HEADERS.length).getValues();\n      for (var r = 0; r < rows.length; r++) {\n        var row = rows[r];\n        if (\n          normalizeDateCell_(row[0]) === data.dateBucket &&\n          String(row[1]) === data.gradeBand &&\n          String(row[2]) === code\n        ) {\n          var updated = [data.dateBucket, data.gradeBand, code, (Number(row[3]) || 0) + count];\n          sheet.getRange(r + 2, 1, 1, ERROR_HEADERS.length).setValues([updated]);\n          matched = true;\n          break;\n        }\n      }\n    }\n\n    if (!matched) {\n      sheet.appendRow([data.dateBucket, data.gradeBand, code, count]);\n    }\n  }\n}\n\nfunction jsonResponse_(obj) {\n  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(\n    ContentService.MimeType.JSON\n  );\n}\n" : void 0;

// Reset needs a second click within this window.
const RESET_CONFIRM_WINDOW_MS = 1e4;

/**
 * Sort diagnostics: errors first, then newest, then highest count, then code.
 * @param entries - Diagnostic entries.
 * @returns New sorted array.
 */
function sortDiagnosticEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "error" ? -1 : 1;
    }
    if (a.lastSeenDate !== b.lastSeenDate) {
      return b.lastSeenDate.localeCompare(a.lastSeenDate);
    }
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.code.localeCompare(b.code);
  });
}

/**
 * Build the IT diagnostic JSON report (policy toggles, counts, catalog entries; no PII).
 * @param snapshot - Diagnostic snapshot.
 * @returns Report object.
 */
function buildZeroPiiDiagnosticBundle(snapshot) {
  const { policy, telemetry } = snapshot;
  return {
    schemaVersion: 1,
    extensionVersion: snapshot.extensionVersion,
    generatedAtDate: snapshot.generatedAtDate,
    activeRuleCount: snapshot.activeRuleCount,
    policy: {
      gradeBand: policy.gradeBand,
      source: policy.source,
      isManaged: policy.isManaged,
      masterEnabled: policy.masterEnabled,
      hideAiOverviews: policy.hideAiOverviews,
      hideAiModeUi: policy.hideAiModeUi,
      blockAiModeNavigation: policy.blockAiModeNavigation,
      forceWebOnlySearch: policy.forceWebOnlySearch,
      hideAuxiliaryAiFeatures: policy.hideAuxiliaryAiFeatures,
      analyticsEnabled: policy.analyticsEnabled,
      analyticsEndpointConfigured: isValidAppsScriptUrl(policy.analyticsEndpointUrl),
      analyticsSharedTokenConfigured: policy.analyticsSharedToken.length > 0,
      analyticsFlushIntervalMinutes: policy.analyticsFlushIntervalMinutes,
      invalidFields: [...policy.invalidFields]
    },
    metrics: {
      lifetime: { ...telemetry.lifetimeMetrics },
      pendingDateBuckets: Object.keys(telemetry.pendingMetricsByDate).sort()
    },
    analyticsSync: {
      lastFlushAttemptDate: telemetry.lastFlushAttemptDate,
      lastFlushSuccessDate: telemetry.lastFlushSuccessDate,
      lastFlushStatus: telemetry.lastFlushStatus,
      lastFlushMessage: telemetry.lastFlushMessage,
      consecutiveFlushFailures: telemetry.consecutiveFlushFailures
    },
    diagnosticLog: sortDiagnosticEntries(telemetry.diagnosticLog)
  };
}

/**
 * Escape one CSV cell per RFC 4180.
 * @param value - Cell value.
 * @returns Escaped cell text.
 */
function escapeCsvCell(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export lifetime and pending daily counters as CSV (aggregate counts only).
 * @param snapshot - Diagnostic snapshot.
 * @returns CSV text.
 */
function buildMetricsCsv(snapshot) {
  const header = [
    "RowType",
    "DateBucket",
    "GradeBand",
    "ExtensionVersion",
    "OverviewsHidden",
    "AiModeUiHidden",
    "AiModeRedirects",
    "OmniboxFallbackRedirects",
    "AuxAiHidden"
  ];
  const rows = [
    [
      "LIFETIME_TOTAL",
      snapshot.generatedAtDate,
      snapshot.policy.gradeBand,
      snapshot.extensionVersion,
      snapshot.telemetry.lifetimeMetrics.overviewsHidden,
      snapshot.telemetry.lifetimeMetrics.aiModeUiHidden,
      snapshot.telemetry.lifetimeMetrics.aiModeRedirects,
      snapshot.telemetry.lifetimeMetrics.omniboxFallbackRedirects,
      snapshot.telemetry.lifetimeMetrics.auxAiHidden
    ]
  ];
  const sortedDates = Object.keys(snapshot.telemetry.pendingMetricsByDate).sort();
  for (const dateBucket of sortedDates) {
    const bucket = snapshot.telemetry.pendingMetricsByDate[dateBucket];
    if (!bucket) continue;
    rows.push([
      "PENDING_DAILY",
      dateBucket,
      snapshot.policy.gradeBand,
      snapshot.extensionVersion,
      bucket.overviewsHidden,
      bucket.aiModeUiHidden,
      bucket.aiModeRedirects,
      bucket.omniboxFallbackRedirects,
      bucket.auxAiHidden
    ]);
  }
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
}

/**
 * Copy text with the Clipboard API, falling back to execCommand.
 * @param text - Text to copy.
 * @returns true if copied.
 */
async function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.className = "visually-hidden";
  document.body.append(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    textarea.remove();
  }
  return ok;
}

/**
 * Download text as a file through a temporary Blob URL.
 * @param filename - Suggested file name.
 * @param content - File contents.
 * @param mimeType - MIME type.
 */
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.className = "visually-hidden";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1e3);
}

/**
 * Get the diagnostic snapshot from the service worker, or build one from storage if it doesn't answer.
 * @returns Snapshot; activeRuleCount is 0 in the fallback.
 */
async function fetchDiagnosticSnapshot() {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_DIAGNOSTIC_SNAPSHOT"
      });
      if (response && response.policy && response.telemetry) {
        return response;
      }
    } catch {
    }
  }
  let managedRaw = null;
  let localRaw = null;
  let telemetry = createInitialTelemetryState();
  if (typeof chrome !== "undefined" && chrome.storage?.managed?.get) {
    try {
      managedRaw = await chrome.storage.managed.get(null);
    } catch {
      managedRaw = null;
    }
  }
  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    try {
      const localData = await chrome.storage.local.get([
        STORAGE_KEYS.LOCAL_OVERRIDES,
        STORAGE_KEYS.TELEMETRY
      ]);
      localRaw = localData[STORAGE_KEYS.LOCAL_OVERRIDES] ?? null;
      if (localData[STORAGE_KEYS.TELEMETRY]) {
        telemetry = localData[STORAGE_KEYS.TELEMETRY] as typeof telemetry;
      }
    } catch {
    }
  }
  const parsed = parsePolicy(managedRaw, localRaw);
  const version = typeof chrome !== "undefined" && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : "1.0.0";
  return {
    policy: parsed.policy,
    telemetry,
    activeRuleCount: 0,
    extensionVersion: version,
    generatedAtDate: getTodayDateBucket()
  };
}

/**
 * Wire the WAI-ARIA tabs pattern: arrow/Home/End keys, and hidden="until-found" panels so Ctrl+F still finds text.
 */
function setupAccessibleTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
  const panels = tabs.map((tab) => document.querySelector(`[role="tabpanel"][aria-labelledby="${tab.id}"]`)).filter((panel) => panel !== null);
  if (tabs.length === 0 || tabs.length !== panels.length) {
    return;
  }
  function activateTab(index, moveFocus) {
    const safeIndex = (index % tabs.length + tabs.length) % tabs.length;
    for (let i = 0; i < tabs.length; i += 1) {
      const isSelected = i === safeIndex;
      const tab = tabs[i];
      const panel = panels[i];
      tab.setAttribute("aria-selected", String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      if (isSelected) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "until-found");
      }
    }
    const activeTab = tabs[safeIndex];
    if (moveFocus) {
      activeTab.focus();
    }
    if (typeof activeTab.scrollIntoView === "function") {
      activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  for (let i = 0; i < tabs.length; i += 1) {
    const tab = tabs[i];
    const panel = panels[i];
    tab.addEventListener("click", () => {
      activateTab(i, false);
    });
    tab.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        activateTab(i + 1, true);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        activateTab(i - 1, true);
      } else if (event.key === "Home") {
        event.preventDefault();
        activateTab(0, true);
      } else if (event.key === "End") {
        event.preventDefault();
        activateTab(tabs.length - 1, true);
      }
    });
    panel.addEventListener("beforematch", () => {
      activateTab(i, false);
    });
  }
}

/**
 * Wire the Options hub: status view, local test toggles, diagnostics, exports, generator
 * and live storage listeners. Controls are disabled when policy is managed.
 */
async function bootOptionsPage() {
  if (typeof document === "undefined") {
    return;
  }
  const tabStatus = document.getElementById("tab-status");
  if (!tabStatus) {
    return;
  }
  setupAccessibleTabs();
  const globalAnnouncer = document.getElementById("global-announcer");
  const announce = (message) => {
    if (!globalAnnouncer) return;
    globalAnnouncer.textContent = "";
    globalAnnouncer.textContent = message;
  };
  const generatorRoot = document.getElementById("options-policy-generator-root");
  if (generatorRoot) {
    mountPolicyGenerator(generatorRoot, {
      appsScriptTemplate: EMBEDDED_APPS_SCRIPT_TEMPLATE,
      onStatus: (msg) => announce(msg)
    });
  }
  const versionBadge = document.getElementById("ext-version-badge");
  const policyBanner = document.getElementById("policy-source-banner");
  const policyTitle = document.getElementById("policy-source-title");
  const policyDetail = document.getElementById("policy-source-detail");
  const policyModeBadge = document.getElementById("policy-mode-badge");
  const gradeBandPill = document.getElementById("active-grade-band-pill");
  const ruleCountPill = document.getElementById("active-rule-count-pill");
  const gradeBandSelect = document.getElementById("grade-band-select") as HTMLSelectElement;
  const togglesSubtitle = document.getElementById("toggles-subtitle");
  const statusSaveFeedback = document.getElementById("status-save-feedback");
  const lockBadges = Array.from(document.querySelectorAll<HTMLElement>("[data-lock-badge]"));
  const toggleInputs = {};
  for (const key of FEATURE_TOGGLE_KEYS) {
    toggleInputs[key] = document.getElementById(`toggle-${key}`);
  }
  const metricEls = {
    overviewsHidden: document.getElementById("metric-overviewsHidden"),
    aiModeUiHidden: document.getElementById("metric-aiModeUiHidden"),
    aiModeRedirects: document.getElementById("metric-aiModeRedirects"),
    omniboxFallbackRedirects: document.getElementById("metric-omniboxFallbackRedirects"),
    auxAiHidden: document.getElementById("metric-auxAiHidden"),
    errorsWarnings: document.getElementById("metric-errorsWarnings"),
    errorsCard: document.getElementById("metric-card-errors")
  };
  const analyticsBadge = document.getElementById("analytics-config-badge");
  const analyticsLastAttempt = document.getElementById("analytics-last-attempt");
  const analyticsLastSuccess = document.getElementById("analytics-last-success");
  const analyticsPendingCount = document.getElementById("analytics-pending-count");
  const analyticsLastMessage = document.getElementById("analytics-last-message");
  const testFlushBtn = document.getElementById("btn-test-flush") as HTMLButtonElement;
  const refreshDiagBtn = document.getElementById("btn-refresh-diag");
  const copyDiagBtn = document.getElementById("btn-copy-diag-json");
  const exportCsvBtn = document.getElementById("btn-export-csv");
  const resetMetricsBtn = document.getElementById("btn-reset-metrics");
  const cancelResetBtn = document.getElementById("btn-cancel-reset");
  const diagActionStatus = document.getElementById("diag-action-status");
  const diagTableBody = document.getElementById("diag-table-body");
  let currentSnapshot = null;
  let resetArmed = false;
  let resetArmTimer = null;
  function setStatusFeedback(message, isError = false) {
    if (!statusSaveFeedback) return;
    statusSaveFeedback.textContent = message;
    statusSaveFeedback.classList.toggle("status-line-error", isError);
    announce(message);
  }
  function setDiagFeedback(message, isError = false) {
    if (!diagActionStatus) return;
    diagActionStatus.textContent = message;
    diagActionStatus.classList.toggle("status-line-error", isError);
    announce(message);
  }
  function disarmResetConfirm() {
    resetArmed = false;
    if (resetArmTimer !== null) {
      window.clearTimeout(resetArmTimer);
      resetArmTimer = null;
    }
    if (resetMetricsBtn) {
      resetMetricsBtn.textContent = "Reset Local Counters";
      resetMetricsBtn.classList.remove("rm-btn-danger-confirm");
      resetMetricsBtn.classList.add("rm-btn-danger");
    }
    if (cancelResetBtn) {
      cancelResetBtn.hidden = true;
    }
  }
  function renderDiagnosticTable(entries) {
    if (!diagTableBody) return;
    diagTableBody.replaceChildren();
    const sorted = sortDiagnosticEntries(entries);
    if (sorted.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "diag-empty-cell";
      td.textContent = "No errors or warnings recorded. All protections are operating normally.";
      tr.append(td);
      diagTableBody.append(tr);
      return;
    }
    for (const entry of sorted) {
      const tr = document.createElement("tr");
      const codeTh = document.createElement("th");
      codeTh.scope = "row";
      codeTh.className = "diag-code-cell";
      const sevPill = document.createElement("span");
      sevPill.className = entry.severity === "error" ? "rm-pill rm-pill-red" : "rm-pill rm-pill-amber";
      sevPill.textContent = entry.severity === "error" ? "ERROR" : "WARNING";
      const codeEl = document.createElement("code");
      codeEl.className = "diag-code-text";
      codeEl.textContent = entry.code;
      codeTh.append(sevPill, codeEl);
      const countTd = document.createElement("td");
      countTd.textContent = String(entry.count);
      const dateTd = document.createElement("td");
      dateTd.textContent = entry.lastSeenDate;
      const detailTd = document.createElement("td");
      detailTd.textContent = entry.detail || entry.title;
      const fixTd = document.createElement("td");
      fixTd.className = "diag-remediation";
      const fixPrefix = document.createElement("strong");
      fixPrefix.textContent = "How to Fix: ";
      fixTd.append(fixPrefix, document.createTextNode(entry.remediation));
      tr.append(codeTh, countTd, dateTd, detailTd, fixTd);
      diagTableBody.append(tr);
    }
  }
  function renderSnapshot(snapshot) {
    currentSnapshot = snapshot;
    const { policy, telemetry } = snapshot;
    if (versionBadge) {
      versionBadge.textContent = `v${snapshot.extensionVersion}`;
    }
    if (policyBanner && policyTitle && policyDetail && policyModeBadge) {
      policyBanner.classList.remove(
        "policy-banner-managed",
        "policy-banner-degraded",
        "policy-banner-unmanaged"
      );
      policyModeBadge.classList.remove("rm-pill-navy", "rm-pill-red", "rm-pill-amber");
      if (policy.isManaged && policy.source === "managed-degraded") {
        policyBanner.classList.add("policy-banner-degraded");
        policyTitle.textContent = "Managed by Google Admin Console (Degraded \u2014 Fail-Closed)";
        policyDetail.textContent = `Invalid managed policy fields (${policy.invalidFields.join(", ")}) fell back to Strict Maximum Lockdown ON. See IT Diagnostics for exact fixes.`;
        policyModeBadge.classList.add("rm-pill-red");
        policyModeBadge.textContent = "Locked (Degraded)";
      } else if (policy.isManaged) {
        policyBanner.classList.add("policy-banner-managed");
        policyTitle.textContent = "Managed by Google Admin Console";
        policyDetail.textContent = "Policy is centrally enforced via chrome.storage.managed. Local browser overrides are disabled.";
        policyModeBadge.classList.add("rm-pill-navy");
        policyModeBadge.textContent = "Locked";
      } else {
        policyBanner.classList.add("policy-banner-unmanaged");
        policyTitle.textContent = "Unmanaged Local Testing Mode";
        policyDetail.textContent = policy.source === "local-unmanaged" ? "Running with local IT testing overrides saved in chrome.storage.local. Push managed JSON via Google Admin Console for student Chromebooks." : "No Google Admin Console policy detected \u2014 Strict Maximum Lockdown defaults are active. Toggle switches below to test locally.";
        policyModeBadge.classList.add("rm-pill-amber");
        policyModeBadge.textContent = "Interactive";
      }
    }
    if (gradeBandPill) {
      gradeBandPill.textContent = `Grade Band: ${policy.gradeBand}`;
    }
    if (ruleCountPill) {
      const label = snapshot.activeRuleCount === 1 ? "rule" : "rules";
      ruleCountPill.textContent = `${snapshot.activeRuleCount} active network ${label}`;
    }
    if (gradeBandSelect) {
      gradeBandSelect.value = policy.gradeBand;
      gradeBandSelect.disabled = policy.isManaged;
    }
    if (togglesSubtitle) {
      togglesSubtitle.textContent = policy.isManaged ? "All controls are read-only and enforced by your Google Admin Console OU policy." : "On unmanaged devices, switches save locally for IT testing and immediately sync network rules and active Google tabs.";
    }
    for (const badge of lockBadges) {
      badge.hidden = !policy.isManaged;
    }
    for (const key of FEATURE_TOGGLE_KEYS) {
      const input = toggleInputs[key];
      if (!input) continue;
      input.checked = policy[key];
      input.disabled = policy.isManaged;
    }
    if (metricEls.overviewsHidden) {
      metricEls.overviewsHidden.textContent = String(telemetry.lifetimeMetrics.overviewsHidden);
    }
    if (metricEls.aiModeUiHidden) {
      metricEls.aiModeUiHidden.textContent = String(telemetry.lifetimeMetrics.aiModeUiHidden);
    }
    if (metricEls.aiModeRedirects) {
      metricEls.aiModeRedirects.textContent = String(telemetry.lifetimeMetrics.aiModeRedirects);
    }
    if (metricEls.omniboxFallbackRedirects) {
      metricEls.omniboxFallbackRedirects.textContent = String(
        telemetry.lifetimeMetrics.omniboxFallbackRedirects
      );
    }
    if (metricEls.auxAiHidden) {
      metricEls.auxAiHidden.textContent = String(telemetry.lifetimeMetrics.auxAiHidden);
    }
    const diagCount = telemetry.diagnosticLog.length;
    const hasError = telemetry.diagnosticLog.some((entry) => entry.severity === "error");
    if (metricEls.errorsWarnings) {
      metricEls.errorsWarnings.textContent = String(diagCount);
    }
    if (metricEls.errorsCard) {
      metricEls.errorsCard.classList.toggle("metric-card-alert", hasError);
    }
    const endpointValid = isValidAppsScriptUrl(policy.analyticsEndpointUrl);
    if (analyticsBadge) {
      analyticsBadge.classList.remove("rm-pill-slate", "rm-pill-teal", "rm-pill-red");
      if (!policy.analyticsEnabled) {
        analyticsBadge.classList.add("rm-pill-slate");
        analyticsBadge.textContent = "Disabled (Local-Only)";
      } else if (endpointValid) {
        analyticsBadge.classList.add("rm-pill-teal");
        analyticsBadge.textContent = `Configured (every ${policy.analyticsFlushIntervalMinutes}m)`;
      } else {
        analyticsBadge.classList.add("rm-pill-red");
        analyticsBadge.textContent = "Configured \u2014 Invalid Endpoint URL";
      }
    }
    if (analyticsLastAttempt) {
      analyticsLastAttempt.textContent = telemetry.lastFlushAttemptDate ?? "Never";
    }
    if (analyticsLastSuccess) {
      analyticsLastSuccess.textContent = telemetry.lastFlushSuccessDate ?? "Never";
    }
    if (analyticsPendingCount) {
      analyticsPendingCount.textContent = String(
        Object.keys(telemetry.pendingMetricsByDate).length
      );
    }
    if (analyticsLastMessage) {
      analyticsLastMessage.textContent = telemetry.lastFlushMessage || "";
    }
    if (testFlushBtn) {
      testFlushBtn.hidden = !policy.analyticsEnabled;
      testFlushBtn.disabled = !policy.analyticsEnabled;
    }
    renderDiagnosticTable(telemetry.diagnosticLog);
  }
  async function refreshSnapshot() {
    const snapshot = await fetchDiagnosticSnapshot();
    renderSnapshot(snapshot);
  }
  async function persistLocalOverride(partial) {
    if (currentSnapshot?.policy.isManaged) {
      setStatusFeedback("Policy is locked by Google Admin Console and cannot be changed locally.", true);
      return;
    }
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      try {
        const updated = await chrome.runtime.sendMessage({
          type: "SET_LOCAL_OVERRIDES",
          toggles: partial
        });
        if (updated) {
          await refreshSnapshot();
          setStatusFeedback("Local testing setting saved and applied.");
          return;
        }
      } catch {
        setStatusFeedback("Failed to reach background service worker to save setting.", true);
        return;
      }
    }
    await refreshSnapshot();
  }
  if (gradeBandSelect) {
    gradeBandSelect.addEventListener("change", () => {
      const value = gradeBandSelect.value;
      if (VALID_GRADE_BANDS.includes(value)) {
        void persistLocalOverride({ gradeBand: value });
      }
    });
  }
  for (const key of FEATURE_TOGGLE_KEYS) {
    const input = toggleInputs[key];
    if (!input) continue;
    input.addEventListener("change", () => {
      void persistLocalOverride({ [key]: input.checked });
    });
  }
  refreshDiagBtn?.addEventListener("click", async () => {
    await refreshSnapshot();
    setDiagFeedback("Diagnostics refreshed.");
  });
  copyDiagBtn?.addEventListener("click", async () => {
    const snapshot = currentSnapshot ?? await fetchDiagnosticSnapshot();
    const bundle = buildZeroPiiDiagnosticBundle(snapshot);
    const copied = await copyText(JSON.stringify(bundle, null, 2));
    if (copied) {
      setDiagFeedback("Copied zero-PII Diagnostic JSON to clipboard.");
    } else {
      setDiagFeedback("Could not copy Diagnostic JSON to clipboard.", true);
    }
  });
  exportCsvBtn?.addEventListener("click", async () => {
    const snapshot = currentSnapshot ?? await fetchDiagnosticSnapshot();
    const csv = buildMetricsCsv(snapshot);
    downloadFile(
      `raisemark-search-guard-metrics-${snapshot.generatedAtDate}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    setDiagFeedback("Exported local metrics CSV.");
  });
  testFlushBtn?.addEventListener("click", async () => {
    if (!testFlushBtn) return;
    testFlushBtn.disabled = true;
    setDiagFeedback("Running test flush to district Apps Script endpoint\u2026");
    try {
      const result = await chrome.runtime.sendMessage({
        type: "TRIGGER_TEST_FLUSH"
      });
      await refreshSnapshot();
      if (result) {
        setDiagFeedback(result.message, result.status === "error");
      } else {
        setDiagFeedback("Test flush completed.");
      }
    } catch {
      setDiagFeedback("Failed to trigger test flush.", true);
    } finally {
      if (currentSnapshot?.policy.analyticsEnabled) {
        testFlushBtn.disabled = false;
      }
    }
  });
  resetMetricsBtn?.addEventListener("click", async () => {
    if (!resetArmed) {
      resetArmed = true;
      if (resetMetricsBtn) {
        resetMetricsBtn.textContent = "Click Again to Confirm Reset";
        resetMetricsBtn.classList.remove("rm-btn-danger");
        resetMetricsBtn.classList.add("rm-btn-danger-confirm");
      }
      if (cancelResetBtn) {
        cancelResetBtn.hidden = false;
      }
      setDiagFeedback('Click "Click Again to Confirm Reset" within 10 seconds to clear local counters.');
      resetArmTimer = window.setTimeout(() => {
        disarmResetConfirm();
      }, RESET_CONFIRM_WINDOW_MS);
      return;
    }
    disarmResetConfirm();
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      try {
        await chrome.runtime.sendMessage({ type: "RESET_LOCAL_METRICS" });
        await refreshSnapshot();
        setDiagFeedback("Local counters and diagnostic log cleared.");
      } catch {
        setDiagFeedback("Failed to reset local counters.", true);
      }
    }
  });
  cancelResetBtn?.addEventListener("click", () => {
    disarmResetConfirm();
    setDiagFeedback("Reset cancelled.");
  });
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((_changes, areaName) => {
      if (areaName === "managed" || areaName === "local") {
        void refreshSnapshot();
      }
    });
  }
  await refreshSnapshot();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void bootOptionsPage();
    });
  } else {
    void bootOptionsPage();
  }
}

export {
  buildMetricsCsv,
  buildZeroPiiDiagnosticBundle,
  sortDiagnosticEntries
};
