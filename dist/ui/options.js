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
var GRADE_BAND_PRESETS = {
  "K-2": {
    label: "Grades K–2",
    subtitle: "Maximum Protection",
    toggles: {
      masterEnabled: true,
      hideAiOverviews: true,
      hideAiModeUi: true,
      blockAiModeNavigation: true,
      forceWebOnlySearch: true,
      hideAuxiliaryAiFeatures: true
    }
  },
  "3-5": {
    label: "Grades 3–5",
    subtitle: "Elementary Research",
    toggles: {
      masterEnabled: true,
      hideAiOverviews: true,
      hideAiModeUi: true,
      blockAiModeNavigation: true,
      forceWebOnlySearch: true,
      hideAuxiliaryAiFeatures: true
    }
  },
  "6-8": {
    label: "Grades 6–8",
    subtitle: "Middle School Standard Search",
    toggles: {
      masterEnabled: true,
      hideAiOverviews: true,
      hideAiModeUi: true,
      blockAiModeNavigation: true,
      forceWebOnlySearch: false,
      hideAuxiliaryAiFeatures: true
    }
  },
  "9-12": {
    label: "Grades 9–12",
    subtitle: "High School Guided AI Literacy",
    toggles: {
      masterEnabled: true,
      hideAiOverviews: false,
      hideAiModeUi: true,
      blockAiModeNavigation: true,
      forceWebOnlySearch: false,
      hideAuxiliaryAiFeatures: false
    }
  },
  Staff: {
    label: "Staff / Faculty",
    subtitle: "Unrestricted (Master Switch Off)",
    toggles: {
      masterEnabled: false,
      hideAiOverviews: false,
      hideAiModeUi: false,
      blockAiModeNavigation: false,
      forceWebOnlySearch: false,
      hideAuxiliaryAiFeatures: false
    }
  }
};
var STORAGE_KEYS = {
  LOCAL_OVERRIDES: "rmsg_local_overrides",
  TELEMETRY: "rmsg_telemetry",
  LAST_POLICY: "rmsg_last_policy"
};
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
function getTodayDateBucket(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10);
}

// src/shared/policy.ts
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
function formatAdminConsolePolicyJson(config) {
  return {
    gradeBand: { Value: config.gradeBand },
    masterEnabled: { Value: Boolean(config.masterEnabled) },
    hideAiOverviews: { Value: Boolean(config.hideAiOverviews) },
    hideAiModeUi: { Value: Boolean(config.hideAiModeUi) },
    blockAiModeNavigation: { Value: Boolean(config.blockAiModeNavigation) },
    forceWebOnlySearch: { Value: Boolean(config.forceWebOnlySearch) },
    hideAuxiliaryAiFeatures: { Value: Boolean(config.hideAuxiliaryAiFeatures) }
  };
}
function validatePolicyDraft(config) {
  const errors = [];
  if (!isValidGradeBand(config.gradeBand)) {
    errors.push(`Invalid grade band "${String(config.gradeBand)}".`);
  }
  return { valid: errors.length === 0, errors };
}

// src/ui/policy-generator-core.ts
var PRIMARY_BANDS = ["K-2", "3-5", "6-8", "9-12"];
var ALL_BANDS = ["K-2", "3-5", "6-8", "9-12", "Staff"];
var TOGGLE_LABELS = {
  masterEnabled: "Master Protection Switch",
  hideAiOverviews: "Hide AI Overviews",
  hideAiModeUi: "Hide AI Mode Buttons & Tabs",
  blockAiModeNavigation: "Block & Redirect AI Mode URLs",
  forceWebOnlySearch: "Force Web-Only Search (udm=14)",
  hideAuxiliaryAiFeatures: "Hide Auxiliary AI (Labs / Lens / Follow-Ups)"
};
var mountInstanceCounter = 0;
function createDefaultBandStates() {
  return {
    "K-2": { ...GRADE_BAND_PRESETS["K-2"].toggles },
    "3-5": { ...GRADE_BAND_PRESETS["3-5"].toggles },
    "6-8": { ...GRADE_BAND_PRESETS["6-8"].toggles },
    "9-12": { ...GRADE_BAND_PRESETS["9-12"].toggles },
    Staff: { ...GRADE_BAND_PRESETS.Staff.toggles }
  };
}
function buildBandAdminJsonString(gradeBand, toggles) {
  const payload = formatAdminConsolePolicyJson({
    gradeBand,
    ...toggles
  });
  return JSON.stringify(payload, null, 2);
}
async function copyTextToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
    }
  }
  if (typeof document === "undefined" || !document.body) {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.className = "visually-hidden";
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
}
function triggerFileDownload(filename, content, mimeType = "application/json") {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.className = "visually-hidden";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1e3);
}
function mountPolicyGenerator(container, options) {
  mountInstanceCounter += 1;
  const idPrefix = `rm-pg-${mountInstanceCounter}`;
  let bandStates = createDefaultBandStates();
  let showStaffBand = false;
  container.replaceChildren();
  const root = document.createElement("div");
  root.className = "pg-root";
  const errorAnnouncer = document.createElement("div");
  errorAnnouncer.setAttribute("aria-live", "polite");
  errorAnnouncer.className = "visually-hidden";
  root.append(errorAnnouncer);
  const introCard = document.createElement("section");
  introCard.className = "rm-card";
  const introTitle = document.createElement("h2");
  introTitle.className = "rm-section-title";
  introTitle.textContent = "4-Band Google Admin Console Policy Generator";
  const introDesc = document.createElement("p");
  introDesc.className = "rm-section-subtitle";
  introDesc.textContent = "Configure grade-band controls below, then paste each OU JSON into Google Admin Console under Devices → Chrome → Apps & extensions → Users & browsers → Policy for extensions.";
  const udmCallout = document.createElement("div");
  udmCallout.className = "rm-callout rm-callout-amber mt-sm";
  const udmText = document.createElement("span");
  udmText.textContent = "Note: Google's Web-only mode (udm=14) hides AI Overviews while keeping Images, Videos, Shopping, and News tabs working, but also hides Knowledge Panels, Calculator, Unit Converter, and Dictionary cards. Recommended ON for Grades K–5 and OFF for Grades 6–12.";
  udmCallout.append(udmText);
  introCard.append(introTitle, introDesc, udmCallout);
  root.append(introCard);
  const toolbar = document.createElement("div");
  toolbar.className = "pg-toolbar";
  const leftButtons = document.createElement("div");
  leftButtons.className = "btn-row";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "rm-btn";
  resetBtn.textContent = "Reset to Recommended Presets";
  const staffToggleBtn = document.createElement("button");
  staffToggleBtn.type = "button";
  staffToggleBtn.className = "rm-btn";
  staffToggleBtn.setAttribute("aria-pressed", "false");
  staffToggleBtn.textContent = "Show Staff OU Preset";
  leftButtons.append(resetBtn, staffToggleBtn);
  const rightButtons = document.createElement("div");
  rightButtons.className = "btn-row";
  const downloadAllBtn = document.createElement("button");
  downloadAllBtn.type = "button";
  downloadAllBtn.className = "rm-btn rm-btn-navy";
  downloadAllBtn.textContent = "Download All 4 JSON Files";
  rightButtons.append(downloadAllBtn);
  toolbar.append(leftButtons, rightButtons);
  root.append(toolbar);
  const statusLine = document.createElement("p");
  statusLine.className = "status-line";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  root.append(statusLine);
  const setStatus = (message, isError = false) => {
    statusLine.textContent = message;
    statusLine.classList.toggle("status-line-error", isError);
    options?.onStatus?.(message);
  };
  const matrix = document.createElement("div");
  matrix.className = "pg-matrix";
  const cardRefs = {};
  for (const band of ALL_BANDS) {
    const preset = GRADE_BAND_PRESETS[band];
    const article = document.createElement("article");
    article.className = "band-card";
    article.dataset.gradeBand = band;
    if (band === "Staff") {
      article.hidden = !showStaffBand;
    }
    const header = document.createElement("div");
    header.className = "band-card-header";
    const title = document.createElement("h3");
    title.className = "band-card-title";
    title.textContent = band === "Staff" ? preset.label : `${preset.label} (${band})`;
    const subtitle = document.createElement("p");
    subtitle.className = "band-card-subtitle";
    subtitle.textContent = preset.subtitle;
    header.append(title, subtitle);
    const reminder = document.createElement("div");
    reminder.className = "band-reminder";
    reminder.dataset.aimodeReminder = band;
    reminder.append(
      document.createTextNode("Also set "),
      (() => {
        const code = document.createElement("code");
        code.textContent = "AIModeSettings = Do not allow (1)";
        return code;
      })(),
      document.createTextNode(" in this OU")
    );
    const togglesContainer = document.createElement("div");
    togglesContainer.className = "band-toggles";
    const toggleInputs = {};
    const toggleItems = {};
    for (const key of FEATURE_TOGGLE_KEYS) {
      const item = document.createElement("div");
      item.className = "band-toggle-item";
      const inputId = `${idPrefix}-${band}-${key}`;
      const label = document.createElement("label");
      label.htmlFor = inputId;
      label.className = "band-toggle-label";
      label.textContent = TOGGLE_LABELS[key];
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.className = "rm-switch";
      input.id = inputId;
      input.dataset.gradeBand = band;
      input.dataset.toggleKey = key;
      input.checked = bandStates[band][key];
      input.addEventListener("change", () => {
        bandStates[band][key] = input.checked;
        renderBandCard(band);
      });
      toggleInputs[key] = input;
      toggleItems[key] = item;
      item.append(label, input);
      togglesContainer.append(item);
    }
    const pre = document.createElement("pre");
    pre.className = "json-preview";
    const codeEl = document.createElement("code");
    codeEl.dataset.jsonOutput = band;
    pre.append(codeEl);
    const actions = document.createElement("div");
    actions.className = "band-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "rm-btn rm-btn-primary rm-btn-sm";
    copyBtn.dataset.copyBand = band;
    const copySr = document.createElement("span");
    copySr.className = "visually-hidden";
    copySr.textContent = ` for ${band}`;
    copyBtn.append(document.createTextNode("Copy Google Admin Console JSON"), copySr);
    copyBtn.addEventListener("click", async () => {
      const draftCheck = validatePolicyDraft({ gradeBand: band });
      const jsonText = buildBandAdminJsonString(band, bandStates[band]);
      const copied = await copyTextToClipboard(jsonText);
      if (!copied) {
        setStatus(`Could not copy ${band} JSON automatically. Select and copy from the preview box.`, true);
        return;
      }
      if (!draftCheck.valid) {
        setStatus(`Copied ${band} JSON (warning: ${draftCheck.errors[0]}).`, true);
      } else {
        setStatus(`Copied Google Admin Console JSON for ${band}.`);
      }
    });
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "rm-btn rm-btn-sm";
    dlBtn.dataset.downloadBand = band;
    const dlSr = document.createElement("span");
    dlSr.className = "visually-hidden";
    dlSr.textContent = ` for ${band}`;
    dlBtn.append(document.createTextNode("Download .json"), dlSr);
    dlBtn.addEventListener("click", () => {
      const jsonText = buildBandAdminJsonString(band, bandStates[band]);
      triggerFileDownload(`raisemark-search-guard-${band}.json`, jsonText);
      setStatus(`Downloaded raisemark-search-guard-${band}.json.`);
    });
    actions.append(copyBtn, dlBtn);
    article.append(header, reminder, togglesContainer, pre, actions);
    matrix.append(article);
    cardRefs[band] = {
      article,
      reminder,
      codeEl,
      toggleInputs,
      toggleItems
    };
  }
  root.append(matrix);
  container.append(root);
  function renderBandCard(band) {
    const refs = cardRefs[band];
    const toggles = bandStates[band];
    for (const key of FEATURE_TOGGLE_KEYS) {
      refs.toggleInputs[key].checked = toggles[key];
      if (key !== "masterEnabled") {
        refs.toggleItems[key].classList.toggle("band-toggle-item-paused", !toggles.masterEnabled);
      }
    }
    const showAiModeReminder = toggles.masterEnabled && (toggles.blockAiModeNavigation || toggles.hideAiModeUi);
    refs.reminder.hidden = !showAiModeReminder;
    refs.codeEl.textContent = buildBandAdminJsonString(band, toggles);
  }
  function renderAllBands() {
    for (const band of ALL_BANDS) {
      renderBandCard(band);
    }
  }
  resetBtn.addEventListener("click", () => {
    bandStates = createDefaultBandStates();
    renderAllBands();
    setStatus("Reset all grade-band cards to recommended K–12 presets.");
  });
  staffToggleBtn.addEventListener("click", () => {
    showStaffBand = !showStaffBand;
    cardRefs.Staff.article.hidden = !showStaffBand;
    staffToggleBtn.setAttribute("aria-pressed", String(showStaffBand));
    staffToggleBtn.textContent = showStaffBand ? "Hide Staff OU Preset" : "Show Staff OU Preset";
  });
  downloadAllBtn.addEventListener("click", () => {
    for (const band of PRIMARY_BANDS) {
      const jsonText = buildBandAdminJsonString(band, bandStates[band]);
      triggerFileDownload(`raisemark-search-guard-${band}.json`, jsonText);
    }
    setStatus("Downloaded all 4 grade-band JSON files (K-2, 3-5, 6-8, 9-12).");
  });
  renderAllBands();
}

// src/ui/options.ts
var RESET_CONFIRM_WINDOW_MS = 1e4;
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
function escapeCsvCell(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
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
        telemetry = localData[STORAGE_KEYS.TELEMETRY];
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
function setupAccessibleTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
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
    tab.addEventListener("keydown", (event) => {
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
  const gradeBandSelect = document.getElementById("grade-band-select");
  const togglesSubtitle = document.getElementById("toggles-subtitle");
  const statusSaveFeedback = document.getElementById("status-save-feedback");
  const lockBadges = Array.from(document.querySelectorAll("[data-lock-badge]"));
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
        policyTitle.textContent = "Managed by Google Admin Console (Degraded — Fail-Closed)";
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
        policyDetail.textContent = policy.source === "local-unmanaged" ? "Running with local IT testing overrides saved in chrome.storage.local. Push managed JSON via Google Admin Console for student Chromebooks." : "No Google Admin Console policy detected — Strict Maximum Lockdown defaults are active. Toggle switches below to test locally.";
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
      `raisemark-search-guard-metrics-${snapshot.generatedAtDate}.csv`,
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
