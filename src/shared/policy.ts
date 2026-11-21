/**
 * Turns raw chrome.storage.managed / local data into the effective policy, and formats
 * Admin Console JSON for the generator.
 * Runs in: every bundle. All copies come from this one file.
 * Must never: read storage itself (callers pass raw data in) or relax a toggle on bad input.
 * Invalid managed values fail closed to the strict defaults and are listed in invalidFields.
 * Shared with: background/service-worker.ts, content/content.ts, ui/popup.ts, ui/options.ts,
 * ui/policy-generator-core.ts.
 */

import { FEATURE_TOGGLE_KEYS, STRICT_LOCKDOWN_TOGGLES, VALID_GRADE_BANDS } from "./defaults";

/**
 * Check that a value is one of VALID_GRADE_BANDS.
 * @param value - Candidate value.
 * @returns true for an allowed band string.
 */
export function isValidGradeBand(value) {
  return typeof value === "string" && VALID_GRADE_BANDS.includes(value);
}

/**
 * Resolve the effective policy from raw managed and local storage data.
 * With no managed keys, local overrides apply (unmanaged test mode; see BP-01). With managed
 * keys, local overrides are ignored and each invalid value falls back to its strict default.
 * @param managedRaw - Raw chrome.storage.managed object (or null).
 * @param localRaw - Raw local overrides object (or null).
 * @param now - Evaluation time, recorded as evaluatedAt.
 * @returns { policy, errors }. Never throws for bad input: it fails closed and reports
 * ERR_POLICY_INVALID / WARN_NO_MANAGED_POLICY in errors.
 */
export function parsePolicy(managedRaw, localRaw, now = /* @__PURE__ */ new Date()) {
  const evaluatedAt = now.toISOString();
  const errors = [];
  const hasManagedKeys = managedRaw !== null && managedRaw !== void 0 && typeof managedRaw === "object" && !Array.isArray(managedRaw) && Object.keys(managedRaw).length > 0;
  if (!hasManagedKeys) {
    errors.push({
      code: "WARN_NO_MANAGED_POLICY",
      detail: "chrome.storage.managed returned no policy keys"
    });
    const toggles = { ...STRICT_LOCKDOWN_TOGGLES };
    let gradeBand = "Unassigned";
    let appliedLocalOverride = false;
    if (localRaw !== null && localRaw !== void 0 && typeof localRaw === "object") {
      for (const key of FEATURE_TOGGLE_KEYS) {
        if (typeof localRaw[key] === "boolean") {
          toggles[key] = localRaw[key];
          appliedLocalOverride = true;
        }
      }
      if (isValidGradeBand(localRaw.gradeBand)) {
        gradeBand = localRaw.gradeBand;
        appliedLocalOverride = true;
      }
    }
    const policy = {
      ...toggles,
      gradeBand,
      source: appliedLocalOverride ? "local-unmanaged" : "defaults",
      isManaged: false,
      invalidFields: [],
      evaluatedAt
    };
    return { policy, errors };
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

/**
 * Wrap a generator config in Admin Console {"key": {"Value": …}} form.
 * @param config - Grade band plus the six feature toggles.
 * @returns Policy object ready to paste into the Admin Console.
 */
export function formatAdminConsolePolicyJson(config) {
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

/**
 * Validate a generator draft before it can be copied or downloaded.
 * @param config - Grade band plus the six feature toggles.
 * @returns { valid, errors } with admin-readable messages.
 */
export function validatePolicyDraft(config) {
  const errors = [];
  if (!isValidGradeBand(config.gradeBand)) {
    errors.push(`Invalid grade band "${String(config.gradeBand)}".`);
  }
  return { valid: errors.length === 0, errors };
}
