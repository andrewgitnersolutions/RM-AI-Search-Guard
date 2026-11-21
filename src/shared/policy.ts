/**
 * Turns raw chrome.storage.managed / local data into the effective policy, and formats
 * Admin Console JSON for the generator.
 * Runs in: every bundle. All copies come from this one file.
 * Must never: read storage itself (callers pass raw data in) or relax a toggle on bad input.
 * Invalid managed values fail closed to the strict defaults and are listed in invalidFields.
 * Shared with: background/service-worker.ts, content/content.ts, ui/popup.ts, ui/options.ts,
 * ui/policy-generator-core.ts.
 */

import { EXTRA_SELECTOR_CATEGORIES, FEATURE_TOGGLE_KEYS, MAX_EXTRA_SELECTORS_PER_CATEGORY, MAX_EXTRA_SELECTOR_LENGTH, STRICT_LOCKDOWN_TOGGLES, VALID_GRADE_BANDS, createEmptyExtraHideSelectors } from "./defaults";
import type { EffectivePolicy, ExtraHideSelectors, ExtraSelectorCategory, GradeBand, InstallType, PolicyError, RawRecord, Toggles } from "./types";

/** Generator input: a grade band (possibly invalid), six toggles, and optional hotfix selectors. */
export interface PolicyDraft extends Partial<Toggles> {
  gradeBand: unknown;
  extraHideSelectors?: Partial<Record<ExtraSelectorCategory, string[]>>;
}

/**
 * Check that a value is one of VALID_GRADE_BANDS.
 * @param value - Candidate value.
 * @returns true for an allowed band string. Pure type guard; returns false for non-strings or unknown values, never throws.
 */
export function isValidGradeBand(value: unknown): value is GradeBand {
  return typeof value === "string" && (VALID_GRADE_BANDS as readonly string[]).includes(value);
}

/**
 * Whether an install type may use local test mode. Only an unpacked load ("development") or a
 * normal Web Store / .crx install by the user qualifies; anything else, including "admin"
 * (force-installed), "sideload", "other" and "unknown", is locked (BP-01, fail closed).
 * @param installType - Install type, or undefined if the caller couldn't learn it.
 * @returns true only for "normal" and "development".
 */
export function isUnlockableInstall(installType: InstallType | undefined): boolean {
  return installType === "normal" || installType === "development";
}

/**
 * Trim CSS Syntax Level 3 whitespace characters (U+0020, U+0009, U+000A, U+000C, U+000D) from
 * the start and end of a selector, preserving U+00A0 and other non-ASCII identifier characters.
 * @param value - Raw selector string.
 * @returns Selector string with CSS whitespace removed from both ends. Pure string helper; never throws.
 */
export function trimCssWhitespace(value: string): string {
  return value.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, "");
}

/**
 * Validate and normalize managed extraHideSelectors (BP-04).
 * Rejects non-objects, unknown category keys, arrays exceeding 20 items, non-strings,
 * blank strings, and selectors exceeding 300 characters.
 * @param raw - Untrusted managed extraHideSelectors value.
 * @returns Normalized selectors per category and whether every input key/item was valid.
 * Fails safe: invalid entries are dropped instead of throwing, and valid = false marks the
 * field invalid for ERR_POLICY_INVALID.
 */
export function parseExtraHideSelectors(raw: unknown): { value: ExtraHideSelectors; valid: boolean } {
  const value = createEmptyExtraHideSelectors();
  if (raw === null || raw === void 0 || typeof raw !== "object" || Array.isArray(raw)) {
    return { value, valid: false };
  }
  const obj = raw as RawRecord;
  let valid = true;
  const allowedKeys = new Set<string>(EXTRA_SELECTOR_CATEGORIES);
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
      const trimmed = trimCssWhitespace(item);
      if (trimmed.length === 0) {
        valid = false;
        continue;
      }
      value[category].push(trimmed);
    }
  }
  return { value, valid };
}

/**
 * Resolve the effective policy from raw managed and local storage data.
 * With managed keys, local overrides are ignored and each invalid value falls back to its
 * strict default. With no managed keys, the install type decides (BP-01): a normal or
 * development install is unlocked and local test overrides apply; any other install,
 * including a missing installType, gets locked strict defaults ("admin-no-policy").
 * @param managedRaw - Raw chrome.storage.managed object (or null).
 * @param localRaw - Raw local overrides object (or null).
 * @param now - Evaluation time, recorded as evaluatedAt.
 * @param installType - From chrome.management.getSelf(). Callers that can't read it (content
 * scripts, worker-unreachable fallbacks) omit it, which locks.
 * @returns { policy, errors }. Never throws for bad input: it fails closed and reports
 * ERR_POLICY_INVALID / WARN_NO_MANAGED_POLICY in errors.
 */
export function parsePolicy(
  managedRaw: RawRecord | null | undefined,
  localRaw: RawRecord | null | undefined,
  now: Date = /* @__PURE__ */ new Date(),
  installType?: InstallType
): { policy: EffectivePolicy; errors: PolicyError[] } {
  const evaluatedAt = now.toISOString();
  const errors: PolicyError[] = [];
  const hasManagedKeys = managedRaw !== null && managedRaw !== void 0 && typeof managedRaw === "object" && !Array.isArray(managedRaw) && Object.keys(managedRaw).length > 0;
  if (!hasManagedKeys) {
    errors.push({
      code: "WARN_NO_MANAGED_POLICY",
      detail: "chrome.storage.managed returned no policy keys"
    });
    const toggles = { ...STRICT_LOCKDOWN_TOGGLES };
    if (!isUnlockableInstall(installType)) {
      // Force-installed (or unknown) with no usable policy: lock strict defaults and ignore any
      // stale rmsg_local_overrides, so a student can't use test mode to switch protection off.
      const policy: EffectivePolicy = {
        ...toggles,
        gradeBand: "Unassigned",
        extraHideSelectors: createEmptyExtraHideSelectors(),
        source: "admin-no-policy",
        isManaged: true,
        invalidFields: [],
        evaluatedAt
      };
      return { policy, errors };
    }
    let gradeBand: GradeBand = "Unassigned";
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
    const policy: EffectivePolicy = {
      ...toggles,
      gradeBand,
      // Custom hotfix selectors are managed-only (BP-04): ignore any localRaw.extraHideSelectors.
      extraHideSelectors: createEmptyExtraHideSelectors(),
      source: appliedLocalOverride ? "local-unmanaged" : "defaults",
      isManaged: false,
      invalidFields: [],
      evaluatedAt
    };
    return { policy, errors };
  }
  const invalidFields: string[] = [];
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
  let gradeBand: GradeBand = "Unassigned";
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
  const policy: EffectivePolicy = {
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

/**
 * Wrap a generator config in Admin Console {"key": {"Value": …}} form.
 * Emits extraHideSelectors only when at least one category has a non-empty selector.
 * @param config - Grade band, six feature toggles, and optional hotfix selectors.
 * @returns Policy object ready to paste into the Admin Console. Coerces toggles with Boolean() and
 * skips non-string or blank extra selectors; never throws.
 */
export function formatAdminConsolePolicyJson(config: PolicyDraft) {
  const formatted: {
    gradeBand: { Value: unknown };
    masterEnabled: { Value: boolean };
    hideAiOverviews: { Value: boolean };
    hideAiModeUi: { Value: boolean };
    blockAiModeNavigation: { Value: boolean };
    forceWebOnlySearch: { Value: boolean };
    hideAuxiliaryAiFeatures: { Value: boolean };
    extraHideSelectors?: { Value: Partial<Record<ExtraSelectorCategory, string[]>> };
  } = {
    gradeBand: { Value: config.gradeBand },
    masterEnabled: { Value: Boolean(config.masterEnabled) },
    hideAiOverviews: { Value: Boolean(config.hideAiOverviews) },
    hideAiModeUi: { Value: Boolean(config.hideAiModeUi) },
    blockAiModeNavigation: { Value: Boolean(config.blockAiModeNavigation) },
    forceWebOnlySearch: { Value: Boolean(config.forceWebOnlySearch) },
    hideAuxiliaryAiFeatures: { Value: Boolean(config.hideAuxiliaryAiFeatures) }
  };
  if (config.extraHideSelectors) {
    const extraValue: Partial<Record<ExtraSelectorCategory, string[]>> = {};
    for (const category of EXTRA_SELECTOR_CATEGORIES) {
      const rawList = config.extraHideSelectors[category];
      if (!Array.isArray(rawList)) {
        continue;
      }
      const cleaned = rawList
        .filter((item): item is string => typeof item === "string")
        .map((item) => trimCssWhitespace(item))
        .filter((item) => item.length > 0);
      if (cleaned.length > 0) {
        extraValue[category] = cleaned;
      }
    }
    if (Object.keys(extraValue).length > 0) {
      formatted.extraHideSelectors = { Value: extraValue };
    }
  }
  return formatted;
}

/**
 * Validate a generator draft before it can be copied or downloaded.
 * @param config - Grade band, six feature toggles, and optional hotfix selectors.
 * @returns { valid, errors } with admin-readable messages. Never throws; reports all issues in errors.
 */
export function validatePolicyDraft(config: PolicyDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isValidGradeBand(config.gradeBand)) {
    errors.push(`Invalid grade band "${String(config.gradeBand)}".`);
  }
  if (config.extraHideSelectors !== void 0) {
    if (config.extraHideSelectors === null || typeof config.extraHideSelectors !== "object" || Array.isArray(config.extraHideSelectors)) {
      errors.push("extraHideSelectors must be an object.");
    } else {
      for (const category of EXTRA_SELECTOR_CATEGORIES) {
        const rawList = config.extraHideSelectors[category];
        if (rawList === void 0) {
          continue;
        }
        if (!Array.isArray(rawList)) {
          errors.push(`extraHideSelectors.${category} must be an array.`);
          continue;
        }
        if (rawList.length > MAX_EXTRA_SELECTORS_PER_CATEGORY) {
          errors.push(`extraHideSelectors.${category} allows at most ${MAX_EXTRA_SELECTORS_PER_CATEGORY} selectors.`);
        }
        for (const item of rawList) {
          if (typeof item !== "string") {
            errors.push(`extraHideSelectors.${category} must contain strings only.`);
            break;
          }
          if (trimCssWhitespace(item).length > MAX_EXTRA_SELECTOR_LENGTH || item.length > MAX_EXTRA_SELECTOR_LENGTH) {
            errors.push(`extraHideSelectors.${category} exceeds ${MAX_EXTRA_SELECTOR_LENGTH} characters per selector.`);
            break;
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
