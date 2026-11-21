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
var EXTRA_SELECTOR_CATEGORIES = ["overview", "aimode", "aux"];
var MAX_EXTRA_SELECTORS_PER_CATEGORY = 20;
var MAX_EXTRA_SELECTOR_LENGTH = 300;
function createEmptyExtraHideSelectors() {
  return {
    overview: [],
    aimode: [],
    aux: []
  };
}

// src/shared/policy.ts
function isValidGradeBand(value) {
  return typeof value === "string" && VALID_GRADE_BANDS.includes(value);
}
function isUnlockableInstall(installType) {
  return installType === "normal" || installType === "development";
}
function parseExtraHideSelectors(raw) {
  const value = createEmptyExtraHideSelectors();
  if (raw === null || raw === void 0 || typeof raw !== "object" || Array.isArray(raw)) {
    return { value, valid: false };
  }
  const obj = raw;
  let valid = true;
  const allowedKeys = new Set(EXTRA_SELECTOR_CATEGORIES);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      valid = false;
    }
  }
  for (const category of EXTRA_SELECTOR_CATEGORIES) {
    if (!(category in obj) || obj[category] === void 0) {
      continue;
    }
    const rawList = obj[category];
    if (!Array.isArray(rawList) || rawList.length > MAX_EXTRA_SELECTORS_PER_CATEGORY) {
      valid = false;
      continue;
    }
    for (const item of rawList) {
      if (typeof item !== "string" || item.length > MAX_EXTRA_SELECTOR_LENGTH) {
        valid = false;
        continue;
      }
      const trimmed = item.trim();
      if (trimmed.length === 0) {
        valid = false;
        continue;
      }
      value[category].push(trimmed);
    }
  }
  return { value, valid };
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
        extraHideSelectors: createEmptyExtraHideSelectors(),
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
      // Custom hotfix selectors are managed-only (BP-04): ignore any localRaw.extraHideSelectors.
      extraHideSelectors: createEmptyExtraHideSelectors(),
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
  let extraHideSelectors = createEmptyExtraHideSelectors();
  if ("extraHideSelectors" in managedRaw && managedRaw.extraHideSelectors !== void 0) {
    const parsedExtras = parseExtraHideSelectors(managedRaw.extraHideSelectors);
    extraHideSelectors = parsedExtras.value;
    if (!parsedExtras.valid) {
      invalidFields.push("extraHideSelectors");
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
    extraHideSelectors,
    source: invalidFields.length > 0 ? "managed-degraded" : "managed",
    isManaged: true,
    invalidFields,
    evaluatedAt
  };
  return { policy, errors };
}

// src/ui/popup.ts
var SVG_NS = "http://www.w3.org/2000/svg";
function createShieldIcon(className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const shieldPath = document.createElementNS(SVG_NS, "path");
  shieldPath.setAttribute("d", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z");
  const checkPath = document.createElementNS(SVG_NS, "path");
  checkPath.setAttribute("d", "m9 12 2 2 4-4");
  svg.append(shieldPath, checkPath);
  return svg;
}
function countActiveProtections(policy) {
  if (!policy.masterEnabled) {
    return 0;
  }
  let count = 0;
  for (const key of FEATURE_TOGGLE_KEYS) {
    if (policy[key]) {
      count += 1;
    }
  }
  return count;
}
async function openOptionsPageSafe() {
  if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
  }
}
function renderPopup(root, policy, onOpenOptions) {
  root.replaceChildren();
  if (policy.isManaged) {
    const notice = document.createElement("div");
    notice.className = "popup-managed";
    const icon = createShieldIcon("popup-managed-icon");
    const text = document.createElement("span");
    text.className = "popup-managed-text";
    text.textContent = "Managed by your school";
    notice.append(icon, text);
    root.append(notice);
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "popup-unmanaged";
  const header = document.createElement("div");
  header.className = "popup-unmanaged-header";
  const title = document.createElement("span");
  title.textContent = "RaiseMark: AI Search Controls for K-12";
  header.append(createShieldIcon("popup-managed-icon"), title);
  const statusPill = document.createElement("p");
  statusPill.className = "rm-pill rm-pill-amber";
  statusPill.textContent = "Local Test Mode — Unmanaged";
  const activeCount = countActiveProtections(policy);
  const summary = document.createElement("p");
  summary.className = "popup-summary";
  summary.textContent = policy.masterEnabled ? `${activeCount} of 6 protections active` : "0 of 6 protections active (Paused)";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "rm-btn rm-btn-primary popup-action-btn";
  openBtn.textContent = "Open Setup & Policy Generator";
  openBtn.addEventListener("click", () => {
    if (onOpenOptions) {
      onOpenOptions();
    } else {
      void openOptionsPageSafe();
    }
  });
  wrapper.append(header, statusPill, summary, openBtn);
  root.append(wrapper);
}
async function resolvePopupPolicy() {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_EFFECTIVE_POLICY"
      });
      if (response && typeof response.isManaged === "boolean") {
        return response;
      }
    } catch {
    }
  }
  return parsePolicy(null, null).policy;
}
async function bootPopup() {
  if (typeof document === "undefined" || typeof chrome === "undefined") {
    return;
  }
  const root = document.getElementById("popup-root");
  if (!root) {
    return;
  }
  const policy = await resolvePopupPolicy();
  renderPopup(root, policy, () => {
    void openOptionsPageSafe();
  });
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void bootPopup();
    });
  } else {
    void bootPopup();
  }
}
export {
  renderPopup
};
