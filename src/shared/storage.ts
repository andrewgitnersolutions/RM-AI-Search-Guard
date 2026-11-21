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
 * @returns err.message for Errors, otherwise String(err).
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
 * @returns Clean metrics; bad or missing fields become 0.
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
 * @returns Up to MAX_DIAGNOSTIC_LOG_ENTRIES entries with known codes; others are dropped.
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
 * @returns A valid state; anything malformed is reset to its initial value.
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
 * @returns { data, error? }. On failure data is {} and error is set; parsePolicy then
 * treats the device as unmanaged (see BP-01).
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
 * @returns { data, error? }. data is null when absent, malformed or unreadable.
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
 * Add aggregate counter deltas to the lifetime totals.
 * @param deltas - Partial metrics; non-positive or non-numeric values are ignored.
 * @returns Updated state. Writes only if something changed. A missing deltas object throws (BP-13).
 */
export async function incrementTelemetryMetrics(deltas: Partial<Record<string, unknown>>): Promise<TelemetryState> {
  return enqueueStorageOp(async () => {
    const state = await readTelemetryState();
    let changed = false;
    for (const key of METRIC_KEYS) {
      const rawDelta = deltas[key];
      if (typeof rawDelta === "number" && Number.isFinite(rawDelta) && rawDelta > 0) {
        const delta = Math.floor(rawDelta);
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

/**
 * Log a diagnostic code: add a new log entry or merge into a matching one.
 * Same code + detail merges into one entry; when full, the least recently seen entry is evicted.
 * @param code - Catalog code; an unknown code throws (BP-13).
 * @param detail - Detail text (cleaned and capped).
 * @param now - Time used for the date bucket.
 * @returns Updated state.
 */
export async function recordDiagnosticEntry(code: ErrorCode, detail: string = "", now: Date = /* @__PURE__ */ new Date()): Promise<TelemetryState> {
  return enqueueStorageOp(async () => {
    const state = await readTelemetryState();
    const dateBucket = getTodayDateBucket(now);
    const cleanDetail = detail.trim().replace(/\s+/g, " ").slice(0, 240);
    const existingIndex = state.diagnosticLog.findIndex(
      (entry) => entry.code === code && entry.detail === cleanDetail
    );
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
    await writeTelemetryState(state);
    return state;
  });
}

/**
 * Replace telemetry with a fresh state (counters and log).
 * @returns The fresh state.
 */
export async function resetLocalTelemetry(): Promise<TelemetryState> {
  return enqueueStorageOp(async () => {
    const fresh = createInitialTelemetryState();
    await writeTelemetryState(fresh);
    return fresh;
  });
}
