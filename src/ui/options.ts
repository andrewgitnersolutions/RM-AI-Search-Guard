/**
 * Options hub controller: Status & Local Testing, IT Diagnostics, and the Admin Policy
 * Generator tabs.
 * Runs in: extension page (options.html).
 * Must never: export or display page content, queries, URLs or identifiers; diagnostics and
 * CSV exports are aggregate counts and catalog codes only.
 * Shared with: shared/defaults.ts, shared/errors.ts, shared/policy.ts, ui/policy-generator-core.ts.
 */

import { FEATURE_TOGGLE_KEYS, STORAGE_KEYS, VALID_GRADE_BANDS, createInitialTelemetryState } from "../shared/defaults";
import { getTodayDateBucket } from "../shared/errors";
import { parsePolicy } from "../shared/policy";
import { mountPolicyGenerator } from "./policy-generator-core";

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
      invalidFields: [...policy.invalidFields]
    },
    metrics: {
      lifetime: { ...telemetry.lifetimeMetrics }
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
 * Export the lifetime counters as CSV (aggregate counts only).
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
      `raisemark-ai-search-controls-metrics-${snapshot.generatedAtDate}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    setDiagFeedback("Exported local metrics CSV.");
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
