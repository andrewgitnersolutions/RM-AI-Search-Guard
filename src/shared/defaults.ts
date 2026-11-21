/**
 * Default policy values, grade-band presets, metric keys and storage keys.
 * Runs in: every bundle (service worker, content script on google.com, popup, options).
 * Must never: hold anything secret or anything that identifies a student or device.
 * Shared with: bundled into all four entry points; esbuild drops what each one doesn't use.
 */

/**
 * Strict defaults: every protection on. Used for missing or invalid values (fail closed).
 */
export const STRICT_LOCKDOWN_TOGGLES = {
  masterEnabled: true,
  hideAiOverviews: true,
  hideAiModeUi: true,
  blockAiModeNavigation: true,
  forceWebOnlySearch: true,
  hideAuxiliaryAiFeatures: true
};

export const DEFAULT_ANALYTICS_POLICY = {
  analyticsEnabled: false,
  analyticsEndpointUrl: "",
  analyticsSharedToken: "",
  analyticsFlushIntervalMinutes: 240
};

export const VALID_GRADE_BANDS = [
  "K-2",
  "3-5",
  "6-8",
  "9-12",
  "Staff",
  "Unassigned"
];

export const FEATURE_TOGGLE_KEYS = [
  "masterEnabled",
  "hideAiOverviews",
  "hideAiModeUi",
  "blockAiModeNavigation",
  "forceWebOnlySearch",
  "hideAuxiliaryAiFeatures"
];

export const GRADE_BAND_PRESETS = {
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

export const APPS_SCRIPT_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/;

export const METRIC_KEYS = [
  "overviewsHidden",
  "aiModeUiHidden",
  "aiModeRedirects",
  "omniboxFallbackRedirects",
  "auxAiHidden"
];

export const STORAGE_KEYS = {
  LOCAL_OVERRIDES: "rmsg_local_overrides",
  TELEMETRY: "rmsg_telemetry",
  LAST_POLICY: "rmsg_last_policy"
};

export const ANALYTICS_ALARM_NAME = "rmsg-analytics-flush";

export const MAX_DIAGNOSTIC_LOG_ENTRIES = 50;

export const MIN_FLUSH_INTERVAL_MINUTES = 60;

export const MAX_FLUSH_INTERVAL_MINUTES = 1440;

/**
 * Create a zeroed aggregate counter object.
 * @returns One zero per METRIC_KEYS entry.
 */
export function createEmptyMetrics() {
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
 * @returns Zero counters, empty log, analytics status "idle".
 */
export function createInitialTelemetryState() {
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
