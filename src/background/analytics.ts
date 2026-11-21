/**
 * Opt-in district analytics: builds allowlisted aggregate payloads and POSTs them to the
 * district's own Google Apps Script web app, with jittered alarms and exponential backoff.
 * Runs in: service worker.
 * Must never: send page text, queries, URLs, user or device identifiers, or precise timestamps.
 * Every payload passes assertNoPiiPayload() before any network call.
 * Shared with: shared/defaults.ts, shared/errors.ts, shared/policy.ts, shared/storage.ts.
 */

import { ANALYTICS_ALARM_NAME, METRIC_KEYS, VALID_GRADE_BANDS, createEmptyMetrics } from "../shared/defaults";
import { ALL_ERROR_CODES, getTodayDateBucket } from "../shared/errors";
import { isValidAppsScriptUrl } from "../shared/policy";
import { enqueueStorageOp, readTelemetryState, recordDiagnosticEntry, writeTelemetryState } from "../shared/storage";

/**
 * Only these top-level keys may appear in an analytics payload.
 */
export const ALLOWED_PAYLOAD_KEYS = [
  "schemaVersion",
  "extensionVersion",
  "token",
  "gradeBand",
  "dateBucket",
  "metrics",
  "errors"
];

export const ALLOWED_PAYLOAD_KEY_SET = new Set(ALLOWED_PAYLOAD_KEYS);

export const VALID_GRADE_BAND_SET = new Set(VALID_GRADE_BANDS);

export const VALID_METRIC_KEY_SET = new Set(METRIC_KEYS);

export const VALID_ERROR_CODE_SET = new Set(ALL_ERROR_CODES);

export const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

export const DATE_BUCKET_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_COUNT_VALUE = 1e5;

export const MAX_BACKOFF_MS = 24 * 60 * 60 * 1e3;

export const BASE_BACKOFF_MS = 15 * 60 * 1e3;

export const FETCH_TIMEOUT_MS = 15e3;

/**
 * Clamp a value to an integer in [0, MAX_COUNT_VALUE].
 * @param value - Untrusted count.
 * @returns Clean count; anything invalid becomes 0.
 */
export function sanitizeIntegerCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(MAX_COUNT_VALUE, Math.floor(value));
}

/**
 * Check for a non-null, non-array object.
 * @param value - Value to test.
 * @returns true for plain objects.
 */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sum all metric counters (used to skip empty daily buckets).
 * @param metrics - Metrics object.
 * @returns Total of the sanitized counts.
 */
export function sumMetrics(metrics) {
  let total = 0;
  for (const key of METRIC_KEYS) {
    total += sanitizeIntegerCount(metrics[key]);
  }
  return total;
}

/**
 * Build an allowlisted aggregate payload for one daily bucket.
 * @param input - Version, grade band, date bucket, metrics, errors and optional token.
 * @returns Payload containing only ALLOWED_PAYLOAD_KEYS; invalid fields get safe defaults.
 */
export function buildSanitizedPayload(input) {
  const cleanVersion = typeof input.extensionVersion === "string" && SEMVER_REGEX.test(input.extensionVersion.trim()) ? input.extensionVersion.trim() : "1.0.0";
  const cleanGradeBand = typeof input.gradeBand === "string" && VALID_GRADE_BAND_SET.has(input.gradeBand) ? input.gradeBand : "Unassigned";
  const cleanDateBucket = typeof input.dateBucket === "string" && DATE_BUCKET_REGEX.test(input.dateBucket) ? input.dateBucket : getTodayDateBucket();
  const cleanMetrics = createEmptyMetrics();
  if (isPlainObject(input.metrics)) {
    for (const key of METRIC_KEYS) {
      cleanMetrics[key] = sanitizeIntegerCount(input.metrics[key]);
    }
  }
  const cleanErrors = {};
  if (isPlainObject(input.errors)) {
    for (const code of ALL_ERROR_CODES) {
      const count = sanitizeIntegerCount(input.errors[code]);
      if (count > 0) {
        cleanErrors[code] = count;
      }
    }
  }
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    extensionVersion: cleanVersion,
    gradeBand: cleanGradeBand,
    dateBucket: cleanDateBucket,
    metrics: cleanMetrics,
    errors: cleanErrors
  };
  if (typeof input.token === "string") {
    const trimmedToken = input.token.trim();
    if (trimmedToken.length > 0) {
      payload.token = trimmedToken;
    }
  }
  return payload;
}

/**
 * Final check before any POST: the payload has only allowlisted keys and bounded values.
 * @param payload - Candidate payload.
 * @returns true if safe to send. Any unexpected key or value returns false, and the caller aborts the flush.
 */
export function assertNoPiiPayload(payload) {
  if (!isPlainObject(payload)) {
    return false;
  }
  const ownKeys = Object.getOwnPropertyNames(payload);
  for (const key of ownKeys) {
    if (!ALLOWED_PAYLOAD_KEY_SET.has(key)) {
      return false;
    }
  }
  if (payload.schemaVersion !== 1) {
    return false;
  }
  if (typeof payload.extensionVersion !== "string" || !SEMVER_REGEX.test(payload.extensionVersion)) {
    return false;
  }
  if (typeof payload.gradeBand !== "string" || !VALID_GRADE_BAND_SET.has(payload.gradeBand)) {
    return false;
  }
  if (typeof payload.dateBucket !== "string" || !DATE_BUCKET_REGEX.test(payload.dateBucket)) {
    return false;
  }
  if ("token" in payload) {
    if (typeof payload.token !== "string" || payload.token.trim().length === 0 || payload.token.length > 256) {
      return false;
    }
  }
  if (!isPlainObject(payload.metrics)) {
    return false;
  }
  const metricKeys = Object.getOwnPropertyNames(payload.metrics);
  if (metricKeys.length !== METRIC_KEYS.length) {
    return false;
  }
  for (const key of metricKeys) {
    if (!VALID_METRIC_KEY_SET.has(key)) {
      return false;
    }
    const val = payload.metrics[key];
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > MAX_COUNT_VALUE) {
      return false;
    }
  }
  if (!isPlainObject(payload.errors)) {
    return false;
  }
  const errorKeys = Object.getOwnPropertyNames(payload.errors);
  for (const key of errorKeys) {
    if (!VALID_ERROR_CODE_SET.has(key)) {
      return false;
    }
    const val = payload.errors[key];
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > MAX_COUNT_VALUE) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the retry delay after consecutive flush failures (15 min doubling, 24 h cap).
 * @param consecutiveFailures - Failure count so far.
 * @returns Delay in milliseconds.
 */
export function calculateBackoffMs(consecutiveFailures) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, consecutiveFailures - 1));
}

/**
 * Create the one-shot flush alarm (interval + 0–30 min jitter), or clear it when
 * analytics is off or the endpoint is invalid.
 * @param policy - Effective policy.
 * @param rng - Random source for jitter (injectable for tests).
 * @returns Resolves when the alarm is set or cleared. See BP-12: the chain can stop if a flush throws.
 */
export async function scheduleAnalyticsAlarm(policy, rng = Math.random) {
  if (!policy.analyticsEnabled || !isValidAppsScriptUrl(policy.analyticsEndpointUrl)) {
    await chrome.alarms.clear(ANALYTICS_ALARM_NAME);
    return;
  }
  const delayInMinutes = policy.analyticsFlushIntervalMinutes + Math.floor(rng() * 31);
  await chrome.alarms.create(ANALYTICS_ALARM_NAME, { delayInMinutes });
}

/**
 * Read the manifest version for payloads.
 * @returns X.Y.Z version, or "1.0.0" if unavailable or malformed.
 */
export function getDefaultExtensionVersion() {
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    const version = chrome.runtime.getManifest().version;
    if (typeof version === "string" && SEMVER_REGEX.test(version)) {
      return version;
    }
  }
  return "1.0.0";
}

/**
 * Send pending daily buckets to the district Apps Script endpoint, one POST per bucket.
 * Successful sends subtract exactly what was sent, so counts added meanwhile are kept.
 * @param policy - Effective policy (analytics fields).
 * @param options - force (skip backoff), fetchImpl, now, extensionVersion (injectable for tests).
 * @returns Flush result { attempted, status, flushedBuckets, message, errorCode? }.
 * Failures never throw: they set backoff, record ERR_ANALYTICS_FLUSH_FAILED and keep pending data.
 */
export async function flushAnalyticsIfDue(policy, options?) {
  const force = options?.force ?? false;
  const fetchFn = options?.fetchImpl ?? fetch;
  const now = options?.now ?? /* @__PURE__ */ new Date();
  const today = getTodayDateBucket(now);
  const extensionVersion = options?.extensionVersion ?? getDefaultExtensionVersion();
  if (!policy.analyticsEnabled) {
    await enqueueStorageOp(async () => {
      const state = await readTelemetryState();
      state.lastFlushStatus = "disabled";
      state.lastFlushMessage = "Analytics disabled (local-only mode).";
      await writeTelemetryState(state);
    });
    return {
      attempted: false,
      status: "disabled",
      flushedBuckets: 0,
      message: "Analytics disabled (local-only mode)."
    };
  }
  if (!isValidAppsScriptUrl(policy.analyticsEndpointUrl)) {
    const detail = policy.analyticsEndpointUrl ? "analyticsEndpointUrl failed Apps Script allowlist validation" : "analyticsEndpointUrl is missing";
    await enqueueStorageOp(async () => {
      const state = await readTelemetryState();
      state.lastFlushAttemptDate = today;
      state.lastFlushStatus = "error";
      state.lastFlushMessage = "Invalid Apps Script endpoint URL.";
      await writeTelemetryState(state);
    });
    await recordDiagnosticEntry("ERR_ANALYTICS_ENDPOINT_INVALID", detail, now);
    return {
      attempted: false,
      status: "error",
      flushedBuckets: 0,
      message: "Invalid Apps Script endpoint URL.",
      errorCode: "ERR_ANALYTICS_ENDPOINT_INVALID"
    };
  }
  const initialState = await readTelemetryState();
  if (!force && initialState.nextEligibleFlushAtMs > now.getTime()) {
    return {
      attempted: false,
      status: "idle",
      flushedBuckets: 0,
      message: "Flush deferred until exponential backoff window elapses."
    };
  }
  const errorsSnapshot = {};
  let hasPendingErrors = false;
  for (const code of ALL_ERROR_CODES) {
    const count = sanitizeIntegerCount(initialState.pendingErrorsByCode[code]);
    if (count > 0) {
      errorsSnapshot[code] = count;
      hasPendingErrors = true;
    }
  }
  const dateBuckets = Object.keys(initialState.pendingMetricsByDate).sort();
  const nonEmptyMetricBuckets = [];
  for (const dateBucket of dateBuckets) {
    if (!DATE_BUCKET_REGEX.test(dateBucket)) {
      continue;
    }
    const rawBucket = initialState.pendingMetricsByDate[dateBucket];
    const clonedMetrics = createEmptyMetrics();
    for (const key of METRIC_KEYS) {
      clonedMetrics[key] = sanitizeIntegerCount(rawBucket?.[key]);
    }
    if (sumMetrics(clonedMetrics) > 0) {
      nonEmptyMetricBuckets.push({ dateBucket, metrics: clonedMetrics });
    }
  }
  const snapshots = [];
  if (nonEmptyMetricBuckets.length > 0) {
    nonEmptyMetricBuckets.forEach((bucket, index) => {
      const isLast = index === nonEmptyMetricBuckets.length - 1;
      snapshots.push({
        dateBucket: bucket.dateBucket,
        metrics: bucket.metrics,
        errors: isLast ? errorsSnapshot : {}
      });
    });
  } else if (hasPendingErrors) {
    snapshots.push({
      dateBucket: today,
      metrics: createEmptyMetrics(),
      errors: errorsSnapshot
    });
  } else if (force) {
    snapshots.push({
      dateBucket: today,
      metrics: createEmptyMetrics(),
      errors: {}
    });
  } else {
    return {
      attempted: false,
      status: "idle",
      flushedBuckets: 0,
      message: "No pending metrics or errors to flush."
    };
  }
  let flushedBuckets = 0;
  try {
    for (const bucket of snapshots) {
      const payload = buildSanitizedPayload({
        extensionVersion,
        gradeBand: policy.gradeBand,
        dateBucket: bucket.dateBucket,
        metrics: bucket.metrics,
        errors: bucket.errors,
        token: policy.analyticsSharedToken || void 0
      });
      if (!assertNoPiiPayload(payload)) {
        throw new Error("Sanitized analytics payload failed zero-PII validation");
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetchFn(policy.analyticsEndpointUrl, {
          method: "POST",
          // text/plain keeps this a CORS "simple request"; Apps Script web apps cannot answer a preflight.
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          redirect: "follow",
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error("Invalid JSON response from Apps Script endpoint");
      }
      if (!isPlainObject(body) || body.status !== "ok") {
        const remoteCode = isPlainObject(body) && typeof body.code === "string" ? body.code : "NON_OK_RESPONSE";
        throw new Error(`Apps Script rejected batch (${remoteCode})`);
      }
      flushedBuckets += 1;
      await enqueueStorageOp(async () => {
        const current = await readTelemetryState();
        const currentBucket = current.pendingMetricsByDate[bucket.dateBucket];
        if (currentBucket) {
          let remainingSum = 0;
          for (const key of METRIC_KEYS) {
            const nextVal = Math.max(0, (currentBucket[key] ?? 0) - (bucket.metrics[key] ?? 0));
            currentBucket[key] = nextVal;
            remainingSum += nextVal;
          }
          if (remainingSum === 0) {
            delete current.pendingMetricsByDate[bucket.dateBucket];
          }
        }
        for (const [code, sentCount] of Object.entries(bucket.errors as Record<string, number>)) {
          const curCount = current.pendingErrorsByCode[code] ?? 0;
          const nextCount = Math.max(0, curCount - sentCount);
          if (nextCount === 0) {
            delete current.pendingErrorsByCode[code];
          } else {
            current.pendingErrorsByCode[code] = nextCount;
          }
        }
        current.lastFlushAttemptDate = today;
        current.lastFlushSuccessDate = today;
        current.lastFlushStatus = "ok";
        current.lastFlushMessage = `Flushed ${flushedBuckets} daily bucket(s) successfully.`;
        current.consecutiveFlushFailures = 0;
        current.nextEligibleFlushAtMs = 0;
        await writeTelemetryState(current);
      });
    }
    return {
      attempted: true,
      status: "ok",
      flushedBuckets,
      message: `Flushed ${flushedBuckets} daily bucket(s) successfully.`
    };
  } catch (err) {
    const detail = err instanceof Error ? err.name === "AbortError" ? "Request timed out after 15s" : err.message : String(err);
    await enqueueStorageOp(async () => {
      const current = await readTelemetryState();
      const nextFailures = current.consecutiveFlushFailures + 1;
      const backoffMs = calculateBackoffMs(nextFailures);
      current.consecutiveFlushFailures = nextFailures;
      current.nextEligibleFlushAtMs = now.getTime() + backoffMs;
      current.lastFlushAttemptDate = today;
      current.lastFlushStatus = "error";
      current.lastFlushMessage = detail;
      await writeTelemetryState(current);
    });
    await recordDiagnosticEntry("ERR_ANALYTICS_FLUSH_FAILED", detail, now);
    return {
      attempted: true,
      status: "error",
      flushedBuckets,
      message: detail,
      errorCode: "ERR_ANALYTICS_FLUSH_FAILED"
    };
  }
}
