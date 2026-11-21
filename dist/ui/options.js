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
var APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/;
var STORAGE_KEYS = {
  LOCAL_OVERRIDES: "rmsg_local_overrides",
  TELEMETRY: "rmsg_telemetry",
  LAST_POLICY: "rmsg_last_policy"
};
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
function getTodayDateBucket(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10);
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
function formatAdminConsolePolicyJson(config) {
  const result = {
    gradeBand: { Value: config.gradeBand },
    masterEnabled: { Value: Boolean(config.masterEnabled) },
    hideAiOverviews: { Value: Boolean(config.hideAiOverviews) },
    hideAiModeUi: { Value: Boolean(config.hideAiModeUi) },
    blockAiModeNavigation: { Value: Boolean(config.blockAiModeNavigation) },
    forceWebOnlySearch: { Value: Boolean(config.forceWebOnlySearch) },
    hideAuxiliaryAiFeatures: { Value: Boolean(config.hideAuxiliaryAiFeatures) },
    analyticsEnabled: { Value: Boolean(config.analyticsEnabled) }
  };
  if (config.analyticsEnabled) {
    const trimmedUrl = (config.analyticsEndpointUrl ?? "").trim();
    result.analyticsEndpointUrl = { Value: trimmedUrl };
    const trimmedToken = (config.analyticsSharedToken ?? "").trim();
    if (trimmedToken.length > 0) {
      result.analyticsSharedToken = { Value: trimmedToken };
    }
    const interval = config.analyticsFlushIntervalMinutes;
    const validInterval = typeof interval === "number" && Number.isInteger(interval) && interval >= MIN_FLUSH_INTERVAL_MINUTES && interval <= MAX_FLUSH_INTERVAL_MINUTES ? interval : DEFAULT_ANALYTICS_POLICY.analyticsFlushIntervalMinutes;
    result.analyticsFlushIntervalMinutes = { Value: validInterval };
  }
  return result;
}
function validatePolicyDraft(config) {
  const errors = [];
  if (!isValidGradeBand(config.gradeBand)) {
    errors.push(`Invalid grade band "${String(config.gradeBand)}".`);
  }
  if (config.analyticsEnabled) {
    const trimmedUrl = (config.analyticsEndpointUrl ?? "").trim();
    if (!trimmedUrl) {
      errors.push("District Google Apps Script Web App URL is required when analytics is enabled.");
    } else if (!isValidAppsScriptUrl(trimmedUrl)) {
      errors.push(
        "Analytics Endpoint URL must match https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
      );
    }
    if (config.analyticsFlushIntervalMinutes !== void 0) {
      const interval = config.analyticsFlushIntervalMinutes;
      if (typeof interval !== "number" || !Number.isInteger(interval) || interval < MIN_FLUSH_INTERVAL_MINUTES || interval > MAX_FLUSH_INTERVAL_MINUTES) {
        errors.push(
          `Analytics flush interval must be a whole number between ${MIN_FLUSH_INTERVAL_MINUTES} and ${MAX_FLUSH_INTERVAL_MINUTES} minutes.`
        );
      }
    }
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
function buildBandAdminJsonString(gradeBand, toggles, analytics) {
  const payload = formatAdminConsolePolicyJson({
    gradeBand,
    ...toggles,
    analyticsEnabled: analytics.analyticsEnabled,
    analyticsEndpointUrl: analytics.analyticsEndpointUrl,
    analyticsSharedToken: analytics.analyticsSharedToken,
    analyticsFlushIntervalMinutes: analytics.analyticsFlushIntervalMinutes
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
function syncFieldErrorLink(input, errorId, shown) {
  const existing = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id.length > 0 && id !== errorId);
  if (shown) {
    existing.push(errorId);
  }
  if (existing.length > 0) {
    input.setAttribute("aria-describedby", existing.join(" "));
  } else {
    input.removeAttribute("aria-describedby");
  }
}
function mountPolicyGenerator(container, options) {
  mountInstanceCounter += 1;
  const idPrefix = `rm-pg-${mountInstanceCounter}`;
  let bandStates = createDefaultBandStates();
  const analytics = { ...DEFAULT_ANALYTICS_POLICY };
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
  const copyAppsScriptBtn = document.createElement("button");
  copyAppsScriptBtn.type = "button";
  copyAppsScriptBtn.className = "rm-btn";
  copyAppsScriptBtn.textContent = "Copy Apps Script Template (Code.gs)";
  rightButtons.append(downloadAllBtn, copyAppsScriptBtn);
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
  const analyticsFieldset = document.createElement("fieldset");
  analyticsFieldset.className = "pg-analytics-fieldset";
  const analyticsLegend = document.createElement("legend");
  analyticsLegend.className = "pg-analytics-legend";
  analyticsLegend.textContent = "Optional Shared District Google Sheets Analytics ($0, Zero PII)";
  analyticsFieldset.append(analyticsLegend);
  const enableRow = document.createElement("div");
  const enableCheckbox = document.createElement("input");
  enableCheckbox.type = "checkbox";
  enableCheckbox.id = `${idPrefix}-analytics-enabled`;
  enableCheckbox.name = "analyticsEnabled";
  enableCheckbox.className = "rm-checkbox";
  enableCheckbox.checked = analytics.analyticsEnabled;
  const enableLabel = document.createElement("label");
  enableLabel.htmlFor = enableCheckbox.id;
  enableLabel.className = "rm-checkbox-label";
  enableLabel.append(enableCheckbox, document.createTextNode("Enable District Google Sheets Analytics across all generated policies"));
  enableRow.append(enableLabel);
  analyticsFieldset.append(enableRow);
  const analyticsGrid = document.createElement("div");
  analyticsGrid.className = "pg-analytics-grid";
  const urlRow = document.createElement("div");
  urlRow.className = "field-row";
  const urlId = `${idPrefix}-analytics-url`;
  const urlHintId = `${idPrefix}-analytics-url-hint`;
  const urlErrorId = `${idPrefix}-analytics-url-error`;
  const urlLabel = document.createElement("label");
  urlLabel.htmlFor = urlId;
  urlLabel.className = "field-label";
  urlLabel.textContent = "Google Apps Script Web App URL";
  const urlHint = document.createElement("p");
  urlHint.id = urlHintId;
  urlHint.className = "field-hint";
  urlHint.textContent = "Format: https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.id = urlId;
  urlInput.name = "analyticsEndpointUrl";
  urlInput.className = "rm-input";
  urlInput.placeholder = "https://script.google.com/macros/s/AKfycb.../exec";
  urlInput.setAttribute("autocorrect", "off");
  urlInput.setAttribute("autocapitalize", "none");
  urlInput.setAttribute("spellcheck", "false");
  urlInput.setAttribute("inputmode", "url");
  urlInput.setAttribute("aria-invalid", "false");
  urlInput.setAttribute("aria-describedby", urlHintId);
  urlInput.dataset.error = urlErrorId;
  const urlError = document.createElement("p");
  urlError.id = urlErrorId;
  urlError.className = "field-error";
  urlError.hidden = true;
  urlRow.append(urlLabel, urlHint, urlInput, urlError);
  const tokenRow = document.createElement("div");
  tokenRow.className = "field-row";
  const tokenId = `${idPrefix}-analytics-token`;
  const tokenHintId = `${idPrefix}-analytics-token-hint`;
  const tokenLabel = document.createElement("label");
  tokenLabel.htmlFor = tokenId;
  tokenLabel.className = "field-label";
  tokenLabel.textContent = "Optional Shared Token";
  const tokenHint = document.createElement("p");
  tokenHint.id = tokenHintId;
  tokenHint.className = "field-hint";
  tokenHint.textContent = "Must match SHARED_TOKEN in your district Code.gs (optional anti-spam check).";
  const tokenInput = document.createElement("input");
  tokenInput.type = "text";
  tokenInput.id = tokenId;
  tokenInput.name = "analyticsSharedToken";
  tokenInput.className = "rm-input";
  tokenInput.placeholder = "district-sg-2026";
  tokenInput.setAttribute("autocorrect", "off");
  tokenInput.setAttribute("autocapitalize", "none");
  tokenInput.setAttribute("spellcheck", "false");
  tokenInput.setAttribute("aria-invalid", "false");
  tokenInput.setAttribute("aria-describedby", tokenHintId);
  tokenRow.append(tokenLabel, tokenHint, tokenInput);
  const intervalRow = document.createElement("div");
  intervalRow.className = "field-row";
  const intervalId = `${idPrefix}-analytics-interval`;
  const intervalHintId = `${idPrefix}-analytics-interval-hint`;
  const intervalErrorId = `${idPrefix}-analytics-interval-error`;
  const intervalLabel = document.createElement("label");
  intervalLabel.htmlFor = intervalId;
  intervalLabel.className = "field-label";
  intervalLabel.textContent = "Flush Interval (Minutes)";
  const intervalHint = document.createElement("p");
  intervalHint.id = intervalHintId;
  intervalHint.className = "field-hint";
  intervalHint.textContent = `Whole number between ${MIN_FLUSH_INTERVAL_MINUTES} and ${MAX_FLUSH_INTERVAL_MINUTES} (default 240).`;
  const intervalInput = document.createElement("input");
  intervalInput.type = "number";
  intervalInput.id = intervalId;
  intervalInput.name = "analyticsFlushIntervalMinutes";
  intervalInput.className = "rm-input";
  intervalInput.min = String(MIN_FLUSH_INTERVAL_MINUTES);
  intervalInput.max = String(MAX_FLUSH_INTERVAL_MINUTES);
  intervalInput.step = "1";
  intervalInput.value = String(analytics.analyticsFlushIntervalMinutes);
  intervalInput.setAttribute("aria-invalid", "false");
  intervalInput.setAttribute("aria-describedby", intervalHintId);
  intervalInput.dataset.error = intervalErrorId;
  const intervalError = document.createElement("p");
  intervalError.id = intervalErrorId;
  intervalError.className = "field-error";
  intervalError.hidden = true;
  intervalRow.append(intervalLabel, intervalHint, intervalInput, intervalError);
  analyticsGrid.append(urlRow, tokenRow, intervalRow);
  analyticsFieldset.append(analyticsGrid);
  root.append(analyticsFieldset);
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
      const draftCheck = validatePolicyDraft({
        gradeBand: band,
        analyticsEnabled: analytics.analyticsEnabled,
        analyticsEndpointUrl: analytics.analyticsEndpointUrl,
        analyticsFlushIntervalMinutes: analytics.analyticsFlushIntervalMinutes
      });
      validateAnalyticsInputs(true);
      const jsonText = buildBandAdminJsonString(band, bandStates[band], analytics);
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
      const jsonText = buildBandAdminJsonString(band, bandStates[band], analytics);
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
    refs.codeEl.textContent = buildBandAdminJsonString(band, toggles, analytics);
  }
  function renderAllBands() {
    for (const band of ALL_BANDS) {
      renderBandCard(band);
    }
  }
  function validateAnalyticsInputs(announce = false) {
    const trimmedUrl = urlInput.value.trim();
    let urlMessage = "";
    if (trimmedUrl.length > 0 && !APPS_SCRIPT_URL_REGEX.test(trimmedUrl)) {
      urlMessage = "Invalid Apps Script URL. Must match https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec.";
    } else if (analytics.analyticsEnabled && trimmedUrl.length === 0) {
      urlMessage = "Apps Script Web App URL is required when District Analytics is enabled (https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec).";
    }
    const urlInvalid = urlMessage.length > 0;
    urlInput.setCustomValidity(urlMessage);
    urlInput.setAttribute("aria-invalid", urlInvalid ? "true" : "false");
    urlError.textContent = urlMessage;
    urlError.hidden = !urlInvalid;
    syncFieldErrorLink(urlInput, urlErrorId, urlInvalid);
    const parsedInterval = Number(intervalInput.value);
    const intervalInvalid = analytics.analyticsEnabled && (!Number.isInteger(parsedInterval) || parsedInterval < MIN_FLUSH_INTERVAL_MINUTES || parsedInterval > MAX_FLUSH_INTERVAL_MINUTES);
    const intervalMessage = intervalInvalid ? `Flush interval must be a whole number between ${MIN_FLUSH_INTERVAL_MINUTES} and ${MAX_FLUSH_INTERVAL_MINUTES} minutes.` : "";
    intervalInput.setCustomValidity(intervalMessage);
    intervalInput.setAttribute("aria-invalid", intervalInvalid ? "true" : "false");
    intervalError.textContent = intervalMessage;
    intervalError.hidden = !intervalInvalid;
    syncFieldErrorLink(intervalInput, intervalErrorId, intervalInvalid);
    if (announce && (urlInvalid || intervalInvalid)) {
      errorAnnouncer.textContent = "";
      errorAnnouncer.textContent = urlMessage || intervalMessage;
    } else if (!urlInvalid && !intervalInvalid) {
      errorAnnouncer.textContent = "";
    }
    return !urlInvalid && !intervalInvalid;
  }
  enableCheckbox.addEventListener("change", () => {
    analytics.analyticsEnabled = enableCheckbox.checked;
    validateAnalyticsInputs(true);
    renderAllBands();
  });
  urlInput.addEventListener("input", () => {
    analytics.analyticsEndpointUrl = urlInput.value.trim();
    validateAnalyticsInputs(false);
    renderAllBands();
  });
  urlInput.addEventListener("blur", () => {
    analytics.analyticsEndpointUrl = urlInput.value.trim();
    validateAnalyticsInputs(true);
    renderAllBands();
  });
  tokenInput.addEventListener("input", () => {
    analytics.analyticsSharedToken = tokenInput.value.trim();
    renderAllBands();
  });
  intervalInput.addEventListener("input", () => {
    const parsed = Number(intervalInput.value);
    if (Number.isInteger(parsed) && parsed >= MIN_FLUSH_INTERVAL_MINUTES && parsed <= MAX_FLUSH_INTERVAL_MINUTES) {
      analytics.analyticsFlushIntervalMinutes = parsed;
    }
    validateAnalyticsInputs(false);
    renderAllBands();
  });
  intervalInput.addEventListener("blur", () => {
    validateAnalyticsInputs(true);
    renderAllBands();
  });
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
    validateAnalyticsInputs(true);
    for (const band of PRIMARY_BANDS) {
      const jsonText = buildBandAdminJsonString(band, bandStates[band], analytics);
      triggerFileDownload(`raisemark-search-guard-${band}.json`, jsonText);
    }
    const validAnalytics = !analytics.analyticsEnabled || isValidAppsScriptUrl(analytics.analyticsEndpointUrl);
    if (!validAnalytics) {
      setStatus(
        "Downloaded all 4 grade-band JSON files (warning: Apps Script URL is invalid or blank).",
        true
      );
    } else {
      setStatus("Downloaded all 4 grade-band JSON files (K-2, 3-5, 6-8, 9-12).");
    }
  });
  copyAppsScriptBtn.addEventListener("click", async () => {
    const template = options?.appsScriptTemplate;
    if (!template) {
      setStatus(
        "Apps Script template (templates/apps-script/Code.gs) is not bundled in this view. Copy it directly from the repository.",
        true
      );
      return;
    }
    const copied = await copyTextToClipboard(template);
    if (copied) {
      setStatus("Copied district Google Apps Script template (Code.gs) to clipboard.");
    } else {
      setStatus("Could not access clipboard to copy Code.gs.", true);
    }
  });
  renderAllBands();
}

// src/ui/options.ts
var EMBEDDED_APPS_SCRIPT_TEMPLATE = true ? "/**\n * RaiseMark AI Search Guard — District-Owned Zero-PII Analytics Sink\n *\n * Deployment Instructions:\n * 1. Create a Google Sheet inside your school district's Google Workspace.\n * 2. Open Extensions -> Apps Script and paste this entire file into Code.gs.\n * 3. (Optional) Set SHARED_TOKEN below to match `analyticsSharedToken` in your\n *    Google Admin Console extension policy JSON.\n * 4. Click Deploy -> New deployment -> Web app:\n *      - Execute as: Me\n *      - Who has access: Anyone\n * 5. Copy the resulting https://script.google.com/macros/s/<ID>/exec URL into\n *    the RaiseMark AI Search Guard Admin Policy Generator.\n *\n * Privacy Guarantee:\n * - Strictly allowlists aggregate counts only (zero PII, zero search queries,\n *   zero student emails, zero device IDs, zero IP logging).\n * - Rejects any payload containing unexpected or non-allowlisted fields.\n */\n\nvar SHARED_TOKEN = '';\nvar DAILY_SHEET_NAME = 'Daily_Rollup';\nvar ERROR_SHEET_NAME = 'Error_Summary';\nvar MAX_COUNT_PER_BATCH = 100000;\n\nvar ALLOWED_TOP_LEVEL_KEYS = [\n  'schemaVersion',\n  'extensionVersion',\n  'token',\n  'gradeBand',\n  'dateBucket',\n  'metrics',\n  'errors',\n];\n\nvar ALLOWED_GRADE_BANDS = ['K-2', '3-5', '6-8', '9-12', 'Staff', 'Unassigned'];\n\nvar ALLOWED_METRIC_KEYS = [\n  'overviewsHidden',\n  'aiModeUiHidden',\n  'aiModeRedirects',\n  'omniboxFallbackRedirects',\n  'auxAiHidden',\n];\n\nvar ALLOWED_ERROR_CODES = [\n  'ERR_POLICY_INVALID',\n  'ERR_DNR_SYNC_FAILED',\n  'ERR_SELECTOR_SYNTAX',\n  'ERR_SAFETY_GUARD_TRIPPED',\n  'ERR_ANALYTICS_ENDPOINT_INVALID',\n  'ERR_ANALYTICS_FLUSH_FAILED',\n  'ERR_STORAGE_FAILURE',\n  'WARN_NO_MANAGED_POLICY',\n  'WARN_OMNIBOX_POLICY_MISSING',\n];\n\nvar DAILY_HEADERS = [\n  'Date',\n  'GradeBand',\n  'ExtensionVersion',\n  'OverviewsHidden',\n  'AiModeUiHidden',\n  'AiModeRedirects',\n  'OmniboxFallbackRedirects',\n  'AuxAiHidden',\n  'ReportingBatches',\n];\n\nvar ERROR_HEADERS = ['Date', 'GradeBand', 'ErrorCode', 'Count'];\n\nfunction doGet() {\n  return jsonResponse_({\n    status: 'ok',\n    service: 'RaiseMark AI Search Guard Analytics Sink',\n    message: 'Endpoint is active. Submit anonymous daily aggregates via HTTP POST.',\n  });\n}\n\nfunction doPost(e) {\n  if (!e || !e.postData || typeof e.postData.contents !== 'string') {\n    return jsonResponse_({ status: 'error', code: 'EMPTY_BODY' });\n  }\n\n  var payload;\n  try {\n    payload = JSON.parse(e.postData.contents);\n  } catch (_err) {\n    return jsonResponse_({ status: 'error', code: 'INVALID_JSON' });\n  }\n\n  if (!isPlainObject_(payload)) {\n    return jsonResponse_({ status: 'error', code: 'INVALID_PAYLOAD' });\n  }\n\n  if (typeof SHARED_TOKEN === 'string' && SHARED_TOKEN.length > 0) {\n    if (typeof payload.token !== 'string' || payload.token !== SHARED_TOKEN) {\n      return jsonResponse_({ status: 'error', code: 'UNAUTHORIZED' });\n    }\n  }\n\n  var validation = validatePayload_(payload);\n  if (!validation.ok) {\n    return jsonResponse_({\n      status: 'error',\n      code: validation.code,\n      message: validation.message,\n    });\n  }\n\n  var lock = LockService.getScriptLock();\n  var lockAcquired = false;\n  try {\n    lock.waitLock(15000);\n    lockAcquired = true;\n\n    var ss = SpreadsheetApp.getActiveSpreadsheet();\n    upsertDailyRollup_(ss, validation.data);\n    upsertErrorSummary_(ss, validation.data);\n\n    return jsonResponse_({ status: 'ok' });\n  } catch (err) {\n    return jsonResponse_({\n      status: 'error',\n      code: lockAcquired ? 'WRITE_FAILED' : 'LOCK_TIMEOUT',\n      message: err && err.message ? String(err.message) : 'Unexpected server error',\n    });\n  } finally {\n    if (lockAcquired) {\n      lock.releaseLock();\n    }\n  }\n}\n\nfunction isPlainObject_(value) {\n  return value !== null && typeof value === 'object' && !Array.isArray(value);\n}\n\nfunction isValidCount_(value) {\n  return (\n    typeof value === 'number' &&\n    isFinite(value) &&\n    Math.floor(value) === value &&\n    value >= 0 &&\n    value <= MAX_COUNT_PER_BATCH\n  );\n}\n\nfunction validatePayload_(payload) {\n  var topKeys = Object.keys(payload);\n  for (var i = 0; i < topKeys.length; i++) {\n    if (ALLOWED_TOP_LEVEL_KEYS.indexOf(topKeys[i]) === -1) {\n      return {\n        ok: false,\n        code: 'INVALID_PAYLOAD',\n        message: 'Unexpected field rejected by zero-PII allowlist',\n      };\n    }\n  }\n\n  if (payload.schemaVersion !== 1) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Unsupported schemaVersion' };\n  }\n\n  if (\n    typeof payload.extensionVersion !== 'string' ||\n    !/^\\d+\\.\\d+\\.\\d+$/.test(payload.extensionVersion)\n  ) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid extensionVersion' };\n  }\n\n  if (payload.token !== undefined && typeof payload.token !== 'string') {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid token type' };\n  }\n\n  if (\n    typeof payload.gradeBand !== 'string' ||\n    ALLOWED_GRADE_BANDS.indexOf(payload.gradeBand) === -1\n  ) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid gradeBand' };\n  }\n\n  if (typeof payload.dateBucket !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.dateBucket)) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid dateBucket' };\n  }\n\n  if (!isPlainObject_(payload.metrics)) {\n    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Missing or invalid metrics object' };\n  }\n\n  var metricKeys = Object.keys(payload.metrics);\n  for (var m = 0; m < metricKeys.length; m++) {\n    if (ALLOWED_METRIC_KEYS.indexOf(metricKeys[m]) === -1) {\n      return {\n        ok: false,\n        code: 'INVALID_PAYLOAD',\n        message: 'Unexpected metric key rejected by allowlist',\n      };\n    }\n  }\n\n  var cleanMetrics = {};\n  for (var k = 0; k < ALLOWED_METRIC_KEYS.length; k++) {\n    var mKey = ALLOWED_METRIC_KEYS[k];\n    var mVal = payload.metrics[mKey];\n    if (mVal === undefined) {\n      cleanMetrics[mKey] = 0;\n    } else if (!isValidCount_(mVal)) {\n      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid metric value' };\n    } else {\n      cleanMetrics[mKey] = mVal;\n    }\n  }\n\n  var cleanErrors = {};\n  if (payload.errors !== undefined) {\n    if (!isPlainObject_(payload.errors)) {\n      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid errors object' };\n    }\n    var errKeys = Object.keys(payload.errors);\n    for (var eIdx = 0; eIdx < errKeys.length; eIdx++) {\n      var errCode = errKeys[eIdx];\n      if (ALLOWED_ERROR_CODES.indexOf(errCode) === -1) {\n        return {\n          ok: false,\n          code: 'INVALID_PAYLOAD',\n          message: 'Unexpected error code rejected by allowlist',\n        };\n      }\n      var errVal = payload.errors[errCode];\n      if (!isValidCount_(errVal)) {\n        return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid error count' };\n      }\n      if (errVal > 0) {\n        cleanErrors[errCode] = errVal;\n      }\n    }\n  }\n\n  return {\n    ok: true,\n    data: {\n      schemaVersion: 1,\n      extensionVersion: payload.extensionVersion,\n      gradeBand: payload.gradeBand,\n      dateBucket: payload.dateBucket,\n      metrics: cleanMetrics,\n      errors: cleanErrors,\n    },\n  };\n}\n\nfunction getOrCreateSheet_(ss, name, headers) {\n  var sheet = ss.getSheetByName(name);\n  if (!sheet) {\n    sheet = ss.insertSheet(name);\n  }\n  if (sheet.getLastRow() === 0) {\n    sheet.appendRow(headers);\n  }\n  return sheet;\n}\n\nfunction normalizeDateCell_(value) {\n  if (value instanceof Date && !isNaN(value.getTime())) {\n    return value.toISOString().slice(0, 10);\n  }\n  return String(value);\n}\n\nfunction upsertDailyRollup_(ss, data) {\n  var sheet = getOrCreateSheet_(ss, DAILY_SHEET_NAME, DAILY_HEADERS);\n  var lastRow = sheet.getLastRow();\n  var m = data.metrics;\n\n  if (lastRow > 1) {\n    var rows = sheet.getRange(2, 1, lastRow - 1, DAILY_HEADERS.length).getValues();\n    for (var i = 0; i < rows.length; i++) {\n      var row = rows[i];\n      if (\n        normalizeDateCell_(row[0]) === data.dateBucket &&\n        String(row[1]) === data.gradeBand &&\n        String(row[2]) === data.extensionVersion\n      ) {\n        var updated = [\n          data.dateBucket,\n          data.gradeBand,\n          data.extensionVersion,\n          (Number(row[3]) || 0) + m.overviewsHidden,\n          (Number(row[4]) || 0) + m.aiModeUiHidden,\n          (Number(row[5]) || 0) + m.aiModeRedirects,\n          (Number(row[6]) || 0) + m.omniboxFallbackRedirects,\n          (Number(row[7]) || 0) + m.auxAiHidden,\n          (Number(row[8]) || 0) + 1,\n        ];\n        sheet.getRange(i + 2, 1, 1, DAILY_HEADERS.length).setValues([updated]);\n        return;\n      }\n    }\n  }\n\n  sheet.appendRow([\n    data.dateBucket,\n    data.gradeBand,\n    data.extensionVersion,\n    m.overviewsHidden,\n    m.aiModeUiHidden,\n    m.aiModeRedirects,\n    m.omniboxFallbackRedirects,\n    m.auxAiHidden,\n    1,\n  ]);\n}\n\nfunction upsertErrorSummary_(ss, data) {\n  var sheet = getOrCreateSheet_(ss, ERROR_SHEET_NAME, ERROR_HEADERS);\n  var errorCodes = Object.keys(data.errors);\n  if (errorCodes.length === 0) {\n    return;\n  }\n\n  for (var idx = 0; idx < errorCodes.length; idx++) {\n    var code = errorCodes[idx];\n    var count = data.errors[code];\n    if (!count || count <= 0) {\n      continue;\n    }\n\n    var lastRow = sheet.getLastRow();\n    var matched = false;\n    if (lastRow > 1) {\n      var rows = sheet.getRange(2, 1, lastRow - 1, ERROR_HEADERS.length).getValues();\n      for (var r = 0; r < rows.length; r++) {\n        var row = rows[r];\n        if (\n          normalizeDateCell_(row[0]) === data.dateBucket &&\n          String(row[1]) === data.gradeBand &&\n          String(row[2]) === code\n        ) {\n          var updated = [data.dateBucket, data.gradeBand, code, (Number(row[3]) || 0) + count];\n          sheet.getRange(r + 2, 1, 1, ERROR_HEADERS.length).setValues([updated]);\n          matched = true;\n          break;\n        }\n      }\n    }\n\n    if (!matched) {\n      sheet.appendRow([data.dateBucket, data.gradeBand, code, count]);\n    }\n  }\n}\n\nfunction jsonResponse_(obj) {\n  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(\n    ContentService.MimeType.JSON\n  );\n}\n" : void 0;
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
  const analyticsBadge = document.getElementById("analytics-config-badge");
  const analyticsLastAttempt = document.getElementById("analytics-last-attempt");
  const analyticsLastSuccess = document.getElementById("analytics-last-success");
  const analyticsPendingCount = document.getElementById("analytics-pending-count");
  const analyticsLastMessage = document.getElementById("analytics-last-message");
  const testFlushBtn = document.getElementById("btn-test-flush");
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
        analyticsBadge.textContent = "Configured — Invalid Endpoint URL";
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
    setDiagFeedback("Running test flush to district Apps Script endpoint…");
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
