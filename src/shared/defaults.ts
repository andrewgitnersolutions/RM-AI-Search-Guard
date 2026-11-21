/**
 * Default policy values, grade-band presets, metric keys and storage keys.
 * Runs in: every bundle (service worker, content script on google.com, popup, options).
 * Must never: hold anything secret or anything that identifies a student or device.
 * Shared with: bundled into all four entry points; esbuild drops what each one doesn't use.
 */

import type { ExtraHideSelectors, GradeBand, Metrics, TelemetryState, Toggles } from "./types";

/**
 * Strict defaults: every protection on. Used for missing or invalid values (fail closed).
 */
export const STRICT_LOCKDOWN_TOGGLES: Toggles = {
  masterEnabled: true,
  hideAiOverviews: true,
  hideAiModeUi: true,
  blockAiModeNavigation: true,
  forceWebOnlySearch: true,
  hideAuxiliaryAiFeatures: true
};

export const VALID_GRADE_BANDS = [
  "K-2",
  "3-5",
  "6-8",
  "9-12",
  "Staff",
  "Unassigned"
] as const;

export const FEATURE_TOGGLE_KEYS = [
  "masterEnabled",
  "hideAiOverviews",
  "hideAiModeUi",
  "blockAiModeNavigation",
  "forceWebOnlySearch",
  "hideAuxiliaryAiFeatures"
] as const;

/** A generator preset: display text plus the toggles it sets. */
export interface GradeBandPreset {
  label: string;
  subtitle: string;
  toggles: Toggles;
}

export const GRADE_BAND_PRESETS: Record<Exclude<GradeBand, "Unassigned">, GradeBandPreset> = {
  "K-2": {
    label: "Grades K\u20132",
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
    label: "Grades 3\u20135",
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
    label: "Grades 6\u20138",
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
    label: "Grades 9\u201312",
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

export const METRIC_KEYS = [
  "overviewsHidden",
  "aiModeUiHidden",
  "aiModeRedirects",
  "omniboxFallbackRedirects",
  "auxAiHidden"
] as const;

export const STORAGE_KEYS = {
  LOCAL_OVERRIDES: "rmsg_local_overrides",
  TELEMETRY: "rmsg_telemetry",
  LAST_POLICY: "rmsg_last_policy",
  METRICS_RESET_EPOCH: "rmsg_metrics_reset_epoch",
  UNSUPPORTED_LANG_DATES: "rmsg_unsupported_lang_dates"
};

export const MAX_DIAGNOSTIC_LOG_ENTRIES = 50;

export const EXTRA_SELECTOR_CATEGORIES = ["overview", "aimode", "aux"] as const;

export const MAX_EXTRA_SELECTORS_PER_CATEGORY = 20;

export const MAX_EXTRA_SELECTOR_LENGTH = 300;

/**
 * Create an empty extraHideSelectors map (no custom hotfix selectors).
 * @returns Empty per-category arrays.
 */
export function createEmptyExtraHideSelectors(): ExtraHideSelectors {
  return {
    overview: [],
    aimode: [],
    aux: []
  };
}

/**
 * Create a zeroed aggregate counter object.
 * @returns One zero per METRIC_KEYS entry.
 */
export function createEmptyMetrics(): Metrics {
  return {
    overviewsHidden: 0,
    aiModeUiHidden: 0,
    aiModeRedirects: 0,
    omniboxFallbackRedirects: 0,
    auxAiHidden: 0
  };
}

/**
 * Create the telemetry state for a new install or a reset.
 * @returns Zero lifetime counters and an empty diagnostic log.
 */
export function createInitialTelemetryState(): TelemetryState {
  return {
    lifetimeMetrics: createEmptyMetrics(),
    diagnosticLog: []
  };
}
