/**
 * chrome.storage wrappers: managed policy and local override reads, telemetry state
 * normalization, metric counters and the diagnostic log.
 * Runs in: service worker (all functions) and content script (read helpers only).
 * Must never: store page text, URLs, queries or identifiers. Counters are aggregate integers.
 * Shared with: background/*, content/content.ts.
 */

import { MAX_DIAGNOSTIC_LOG_ENTRIES, METRIC_KEYS, STORAGE_KEYS, createEmptyMetrics, createInitialTelemetryState } from "./defaults";
import { ALL_ERROR_CODES, createDiagnosticEntry, formatRemediation, getTodayDateBucket } from "./errors";
import type { DiagnosticEntry, ErrorCode, Metrics, RawRecord, TelemetryState } from "./types";

/**
 * Tail of the promise chain that serializes read-modify-write storage operations.
 */
export let storageQueueTail: Promise<void> = Promise.resolve();

/**
 * Run an async storage operation after all earlier queued ones finish.
 * Serializing avoids lost updates when several messages modify telemetry at once.
 * @param fn - Operation to run.
 * @returns fn's result. A rejection propagates to the caller but never blocks the queue.
 */
export async function enqueueStorageOp<T>(fn: () => Promise<T>): Promise<T> {
  const previous = storageQueueTail;
  let release!: () => void;
  storageQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Convert any thrown value into a message string.
 * @param err - Thrown value.
 * @returns err.message for Errors, otherwise String(err). Pure; never throws.
 */
export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Normalize a stored metrics object to non-negative integers.
 * @param raw - Untrusted stored value.
 * @returns Clean metrics; bad or missing fields default to 0. Pure; never throws.
 */
export function sanitizeMetrics(raw: unknown): Metrics {
  const metrics = createEmptyMetrics();
  if (!raw || typeof raw !== "object") {
    return metrics;
  }
  const obj = raw as RawRecord;
  for (const key of METRIC_KEYS) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      metrics[key] = Math.floor(val);
    }
  }
  return metrics;
}

/**
 * Normalize the stored diagnostic log.
 * @param raw - Untrusted stored value.
 * @returns Up to MAX_DIAGNOSTIC_LOG_ENTRIES entries with known codes; malformed or unknown entries are dropped. Pure; never throws.
 */
export function sanitizeDiagnosticLog(raw: unknown): DiagnosticEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const validCodes = new Set<string>(ALL_ERROR_CODES);
  const entries: DiagnosticEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as RawRecord;
    if (typeof candidate.code !== "string" || !validCodes.has(candidate.code)) {
      continue;
    }
    const code = candidate.code as ErrorCode;
    const detail = typeof candidate.detail === "string" ? candidate.detail : "";
    const firstSeenDate = typeof candidate.firstSeenDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.firstSeenDate) ? candidate.firstSeenDate : getTodayDateBucket();
    const lastSeenDate = typeof candidate.lastSeenDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.lastSeenDate) ? candidate.lastSeenDate : firstSeenDate;
    const count = typeof candidate.count === "number" && Number.isFinite(candidate.count) && candidate.count > 0 ? Math.floor(candidate.count) : 1;
    const base = createDiagnosticEntry(code, detail, firstSeenDate);
    entries.push({
      ...base,
      count,
      firstSeenDate,
      lastSeenDate
    });
    if (entries.length >= MAX_DIAGNOSTIC_LOG_ENTRIES) {
      break;
    }
  }
  return entries;
}

/**
 * Normalize raw stored telemetry into a complete telemetry state.
 * @param raw - Untrusted value from chrome.storage.local.
 * @returns A valid state; malformed input resets to the initial state. Pure; never throws.
 */
export function normalizeTelemetryState(raw: unknown): TelemetryState {
  const initial = createInitialTelemetryState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return initial;
  }
  // Only known fields are kept, so leftovers from older versions (e.g. the removed
  // analytics buckets) are dropped on the next write.
  const obj = raw as RawRecord;
  return {
    lifetimeMetrics: sanitizeMetrics(obj.lifetimeMetrics),
    diagnosticLog: sanitizeDiagnosticLog(obj.diagnosticLog)
  };
}

/**
 * Read the whole chrome.storage.managed object.
 * @returns { data, error? }. On failure data is {} and error is set; parsePolicy then locks strict
 * defaults on force-installed or unknown installs and unlocks only normal/development installs (BP-01, fail closed).
 */
export async function readManagedPolicyRaw(): Promise<{ data: RawRecord; error?: string }> {
  if (typeof chrome === "undefined" || !chrome.storage?.managed) {
    return { data: {} };
  }
  try {
    const result = await chrome.storage.managed.get(null);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return { data: {} };
    }
    return { data: result };
  } catch (err) {
    return { data: {}, error: formatErrorMessage(err) };
  }
}

/**
 * Read local IT test-mode overrides from chrome.storage.local.
 * @returns { data, error? }. data is null when absent, malformed or unreadable; errors are returned in error (never throws).
 */
export async function readLocalOverrides(): Promise<{ data: RawRecord | null; error?: string }> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return { data: null };
  }
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LOCAL_OVERRIDES);
    const raw = result?.[STORAGE_KEYS.LOCAL_OVERRIDES];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { data: null };
    }
    return { data: raw as RawRecord };
  } catch (err) {
    return { data: null, error: formatErrorMessage(err) };
  }
}

/**
 * Merge sanitized changes into the stored local IT test-mode overrides. The read, merge and
 * write run as one queued operation (BP-17), so two quick toggle clicks can't both merge into
 * the same old object and lose one edit.
 * @param patch - Sanitized toggle/gradeBand changes.
 * @returns The merged overrides that were written. Throws if chrome.storage.local is
 * unavailable. An unreadable existing value is treated as empty, as before.
 */
export async function mergeLocalOverrides(patch: RawRecord): Promise<RawRecord> {
  return enqueueStorageOp(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
    const existing = await readLocalOverrides();
    const merged = { ...existing.data ?? {}, ...patch };
    await chrome.storage.local.set({ [STORAGE_KEYS.LOCAL_OVERRIDES]: merged });
    return merged;
  });
}

/**
 * Read and normalize telemetry state from chrome.storage.local.
 * @returns Telemetry state; the initial state when storage is unavailable. Read errors propagate.
 */
export async function readTelemetryState(): Promise<TelemetryState> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return createInitialTelemetryState();
  }
  const result = await chrome.storage.local.get(STORAGE_KEYS.TELEMETRY);
  return normalizeTelemetryState(result?.[STORAGE_KEYS.TELEMETRY]);
}

/**
 * Save telemetry state to chrome.storage.local.
 * @param state - Full telemetry state.
 * @returns Resolves when written. Throws if storage is unavailable.
 */
export async function writeTelemetryState(state: TelemetryState): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    throw new Error("chrome.storage.local is unavailable");
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.TELEMETRY]: state });
}

/**
 * Read the monotonic reset generation counter from chrome.storage.local.
 * Used to drop stale pre-reset metric batches from open tabs after Reset Local Counters.
 * @returns Non-negative integer epoch (0 when the key is missing, invalid, or outside Chrome).
 * Storage read failures propagate so resetLocalTelemetry() leaves the stored generation intact
 * instead of regressing to 1 and content scripts know the epoch is unconfirmed.
 */
export async function readMetricsResetEpoch(): Promise<number> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return 0;
  }
  const result = await chrome.storage.local.get(STORAGE_KEYS.METRICS_RESET_EPOCH);
  const raw = result?.[STORAGE_KEYS.METRICS_RESET_EPOCH];
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  return 0;
}

const MAX_METRIC_DELTA_PER_BATCH = 50;

/**
 * Add aggregate counter deltas to the lifetime totals, dropping stale pre-reset batches.
 * @param deltas - Partial metrics; non-positive or non-numeric values are ignored and each key is
 * capped at MAX_METRIC_DELTA_PER_BATCH so a compromised tab cannot overflow lifetime counters.
 * @param batchResetEpoch - Reset generation captured when the batch was queued, if any.
 * @returns Updated state (or current state unchanged when batchResetEpoch predates a reset).
 * Storage errors propagate to the caller without blocking later queued operations.
 */
export async function incrementTelemetryMetrics(
  deltas: Partial<Record<string, unknown>>,
  batchResetEpoch?: number
): Promise<TelemetryState> {
  return enqueueStorageOp(async () => {
    if (batchResetEpoch !== undefined) {
      const currentEpoch = await readMetricsResetEpoch();
      if (batchResetEpoch < currentEpoch) {
        return await readTelemetryState();
      }
    }
    const state = await readTelemetryState();
    let changed = false;
    for (const key of METRIC_KEYS) {
      const rawDelta = deltas[key];
      if (typeof rawDelta === "number" && Number.isFinite(rawDelta) && rawDelta > 0) {
        const delta = Math.min(Math.floor(rawDelta), MAX_METRIC_DELTA_PER_BATCH);
        if (delta > 0) {
          state.lifetimeMetrics[key] = (state.lifetimeMetrics[key] ?? 0) + delta;
          changed = true;
        }
      }
    }
    if (changed) {
      await writeTelemetryState(state);
    }
    return state;
  });
}

const MAX_UNSUPPORTED_LANG_DATES = 200;
const SAFE_LANG_KEY_RE = /^[a-z0-9-]{1,16}$/;
const FORBIDDEN_LANG_KEYS = new Set(["constructor", "prototype"]);

/**
 * Check whether a key is a safe lowercase primary language subtag (no prototype keys).
 * @param key - Candidate map key.
 * @returns true for alphanumeric/hyphen subtags up to 16 chars excluding prototype properties.
 */
function isSafeLangKey(key: string): boolean {
  return SAFE_LANG_KEY_RE.test(key) && !FORBIDDEN_LANG_KEYS.has(key);
}

/**
 * Define an own enumerable string property without invoking prototype setters.
 * @param target - Destination record.
 * @param key - Validated safe key.
 * @param value - YYYY-MM-DD UTC date bucket.
 * @returns Nothing; mutates target in place and never throws.
 */
function setOwnStringProp(target: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
}

/**
 * Normalize the stored language-to-UTC-date suppression map for WARN_UNSUPPORTED_UI_LANGUAGE.
 * @param raw - Untrusted value from chrome.storage.local.
 * @returns Clean map of sanitized language subtag to YYYY-MM-DD UTC date bucket; drops malformed
 * entries and prototype-polluting keys. Pure; never throws.
 */
function sanitizeUnsupportedLangDates(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  let count = 0;
  for (const [key, val] of Object.entries(raw as RawRecord)) {
    if (count >= MAX_UNSUPPORTED_LANG_DATES) {
      break;
    }
    if (isSafeLangKey(key) && typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      setOwnStringProp(out, key, val);
      count += 1;
    }
  }
  return out;
}

/**
 * Read the per-language UTC date suppression map for WARN_UNSUPPORTED_UI_LANGUAGE.
 * @returns Map of language subtag to YYYY-MM-DD date bucket (empty outside Chrome or if absent).
 * Storage read failures propagate to the caller.
 */
async function readUnsupportedLangDates(): Promise<Record<string, string>> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return {};
  }
  const result = await chrome.storage.local.get(STORAGE_KEYS.UNSUPPORTED_LANG_DATES);
  return sanitizeUnsupportedLangDates(result?.[STORAGE_KEYS.UNSUPPORTED_LANG_DATES]);
}

/**
 * Build an updated per-language UTC date suppression map, pruning past-day entries and bounding size.
 * @param existing - Current sanitized map.
 * @param lang - Sanitized language tag detail.
 * @param dateBucket - Current YYYY-MM-DD UTC date bucket.
 * @returns New bounded map with lang mapped to dateBucket; prunes past-day, invalid, and prototype keys. Pure; never throws.
 */
function recordUnsupportedLangDate(
  existing: Record<string, string>,
  lang: string,
  dateBucket: string
): Record<string, string> {
  const next: Record<string, string> = {};
  const addCurrent = isSafeLangKey(lang);
  const kept = Object.entries(existing).filter(
    ([k, v]) => isSafeLangKey(k) && v >= dateBucket && (!addCurrent || k !== lang)
  );
  if (addCurrent) {
    while (kept.length >= MAX_UNSUPPORTED_LANG_DATES) {
      kept.shift();
    }
  }
  for (const [k, v] of kept) {
    setOwnStringProp(next, k, v);
  }
  if (addCurrent) {
    setOwnStringProp(next, lang, dateBucket);
  }
  return next;
}

/**
 * Log a diagnostic code: add a new log entry or merge into a matching one.
 * Same code + detail merges into one entry; when full, the least recently seen entry is evicted.
 * @param code - Catalog code; an unknown code throws (BP-13).
 * @param detail - Detail text (cleaned and capped).
 * @param now - Time used for the date bucket.
 * @returns Updated state. Throws on unknown catalog code or missing/failing storage without blocking the queue.
 */
export async function recordDiagnosticEntry(code: ErrorCode, detail: string = "", now: Date = /* @__PURE__ */ new Date()): Promise<TelemetryState> {
  return enqueueStorageOp(async () => {
    const state = await readTelemetryState();
    const dateBucket = getTodayDateBucket(now);
    const cleanDetail = detail.trim().replace(/\s+/g, " ").slice(0, 240);
    const existingIndex = state.diagnosticLog.findIndex(
      (entry) => entry.code === code && entry.detail === cleanDetail
    );
    let nextLangDates: Record<string, string> | null = null;
    // BP-03: WARN_UNSUPPORTED_UI_LANGUAGE suppression is persisted independently of the bounded
    // diagnosticLog so evicting 50+ other diagnostics cannot re-trigger a same-day warning across tabs.
    if (code === "WARN_UNSUPPORTED_UI_LANGUAGE") {
      const langDates = await readUnsupportedLangDates();
      if (Object.prototype.hasOwnProperty.call(langDates, cleanDetail) && langDates[cleanDetail] === dateBucket) {
        return state;
      }
      // Upgrade fallback: profiles upgraded from an earlier build may already have today's entry in
      // diagnosticLog without UNSUPPORTED_LANG_DATES populated yet; backfill it without re-logging.
      if (existingIndex >= 0 && state.diagnosticLog[existingIndex].lastSeenDate === dateBucket) {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const backfilled = recordUnsupportedLangDate(langDates, cleanDetail, dateBucket);
          await chrome.storage.local.set({ [STORAGE_KEYS.UNSUPPORTED_LANG_DATES]: backfilled });
        }
        return state;
      }
      nextLangDates = recordUnsupportedLangDate(langDates, cleanDetail, dateBucket);
    }
    if (existingIndex >= 0) {
      const existing = state.diagnosticLog[existingIndex];
      existing.count += 1;
      existing.lastSeenDate = dateBucket;
      existing.remediation = formatRemediation(code, cleanDetail);
    } else {
      const newEntry = createDiagnosticEntry(code, cleanDetail, dateBucket);
      if (state.diagnosticLog.length >= MAX_DIAGNOSTIC_LOG_ENTRIES) {
        let evictIdx = 0;
        for (let i = 1; i < state.diagnosticLog.length; i++) {
          if (state.diagnosticLog[i].lastSeenDate < state.diagnosticLog[evictIdx].lastSeenDate) {
            evictIdx = i;
          }
        }
        state.diagnosticLog.splice(evictIdx, 1);
      }
      state.diagnosticLog.push(newEntry);
    }
    if (nextLangDates !== null) {
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        throw new Error("chrome.storage.local is unavailable");
      }
      await chrome.storage.local.set({
        [STORAGE_KEYS.TELEMETRY]: state,
        [STORAGE_KEYS.UNSUPPORTED_LANG_DATES]: nextLangDates
      });
    } else {
      await writeTelemetryState(state);
    }
    return state;
  });
}

/**
 * Replace telemetry with a fresh state (counters and log), advance the reset epoch so open tabs
 * discard unflushed pre-reset batches, and clear daily language warning suppression.
 * @returns The fresh state. Throws if storage is unavailable or read/write fails, leaving the stored epoch intact.
 */
export async function resetLocalTelemetry(): Promise<TelemetryState> {
  return enqueueStorageOp(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
    const fresh = createInitialTelemetryState();
    const nextEpoch = (await readMetricsResetEpoch()) + 1;
    await chrome.storage.local.set({
      [STORAGE_KEYS.TELEMETRY]: fresh,
      [STORAGE_KEYS.METRICS_RESET_EPOCH]: nextEpoch,
      [STORAGE_KEYS.UNSUPPORTED_LANG_DATES]: {}
    });
    return fresh;
  });
}
