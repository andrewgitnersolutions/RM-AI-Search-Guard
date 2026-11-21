/**
 * MV3 service worker entry point: keeps DNR rules in sync with policy and routes runtime
 * messages from the content script, popup and options page.
 * Runs in: service worker (ephemeral; all state lives in chrome.storage).
 * Must never: make network requests or send page content, queries, URLs or identifiers
 * anywhere. Counters and diagnostics stay in chrome.storage.local on the device.
 * Shared with: background/dnr-rules.ts, shared/*.
 */

import { FEATURE_TOGGLE_KEYS, STORAGE_KEYS, VALID_GRADE_BANDS } from "../shared/defaults";
import { getTodayDateBucket } from "../shared/errors";
import { isUnlockableInstall, parsePolicy } from "../shared/policy";
import { incrementTelemetryMetrics, readLocalOverrides, readManagedPolicyRaw, readTelemetryState, recordDiagnosticEntry, resetLocalTelemetry, writeLocalOverrides } from "../shared/storage";
import { syncDynamicRules } from "./dnr-rules";
import type { DiagnosticSnapshot, EffectivePolicy, ErrorCode, InstallType, RawRecord } from "../shared/types";

/**
 * Cached install type for this worker wake. Only a successful read is cached, so a failed
 * lookup is retried on the next policy resolve instead of sticking for the worker's lifetime.
 */
let cachedInstallType: InstallType | null = null;

/**
 * Learn how the extension was installed (BP-01). chrome.management.getSelf() needs no
 * "management" permission (verified 2026-11-21 in Chromium 153 with this manifest).
 * @returns The install type, or "unknown" if the API is missing or throws. "unknown" locks
 * (fail closed): a force-installed student device must never fall into local test mode.
 */
async function resolveInstallType(): Promise<InstallType> {
  if (cachedInstallType) {
    return cachedInstallType;
  }
  if (typeof chrome === "undefined" || typeof chrome.management?.getSelf !== "function") {
    return "unknown";
  }
  try {
    const self = await chrome.management.getSelf();
    if (typeof self?.installType === "string") {
      cachedInstallType = self.installType as InstallType;
      return cachedInstallType;
    }
  } catch {
  }
  return "unknown";
}

/**
 * Read the extension version from the manifest.
 * @returns Version string, or "1.0.0" outside Chrome.
 */
function getExtensionVersion(): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
    return chrome.runtime.getManifest().version;
  }
  return "1.0.0";
}

/**
 * Keep only boolean toggles and a valid gradeBand from an Options override request.
 * @param raw - Untrusted message payload.
 * @returns Clean override object.
 */
function sanitizeLocalOverridesInput(raw: RawRecord): RawRecord {
  const clean: Record<string, unknown> = {};
  for (const key of FEATURE_TOGGLE_KEYS) {
    if (typeof raw[key] === "boolean") {
      clean[key] = raw[key];
    }
  }
  if (typeof raw.gradeBand === "string" && (VALID_GRADE_BANDS as readonly string[]).includes(raw.gradeBand)) {
    clean.gradeBand = raw.gradeBand;
  }
  return clean;
}

/**
 * Count the dynamic DNR rules Chrome currently has.
 * @returns Rule count; 0 if the API is missing or fails (display only).
 */
async function getActiveDynamicRuleCount(): Promise<number> {
  if (typeof chrome === "undefined" || !chrome.declarativeNetRequest?.getDynamicRules) {
    return 0;
  }
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return rules.length;
  } catch {
    return 0;
  }
}

/**
 * Read managed and local storage plus the install type, log read failures, and parse the policy.
 * @returns parsePolicy result and the install type. Storage read errors are logged as
 * ERR_STORAGE_FAILURE and parsing continues with empty data; on a force-installed device that
 * means locked strict defaults, never test mode (BP-01).
 */
async function resolvePolicyFromStorage() {
  const [managedRes, localRes, installType] = await Promise.all([
    readManagedPolicyRaw(),
    readLocalOverrides(),
    resolveInstallType()
  ]);
  if (managedRes.error) {
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `managed read: ${managedRes.error}`);
  }
  if (localRes.error) {
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `local read: ${localRes.error}`);
  }
  return { ...parsePolicy(managedRes.data, localRes.data, new Date(), installType), installType };
}

/**
 * Bring DNR rules in line with the current policy.
 * @param options - recordPolicyDiagnostics: log policy warnings and errors.
 * @returns { policy, activeRuleCount }. DNR failures are logged as ERR_DNR_SYNC_FAILED, not thrown.
 */
async function syncRuntimeState(options: { recordPolicyDiagnostics: boolean }): Promise<{ policy: EffectivePolicy; activeRuleCount: number }> {
  const { policy, errors } = await resolvePolicyFromStorage();
  if (options.recordPolicyDiagnostics) {
    for (const err of errors) {
      await recordDiagnosticEntry(err.code, err.detail);
    }
  }
  const dnrResult = await syncDynamicRules(policy);
  if (dnrResult.error) {
    await recordDiagnosticEntry("ERR_DNR_SYNC_FAILED", dnrResult.error);
  }
  return { policy, activeRuleCount: dnrResult.activeRuleCount };
}

/**
 * Handle one runtime message from the content script, popup or options page.
 * Sender and payload shape are not checked yet (BP-13).
 * @param message - { type, ... }.
 * @returns The response for that type, or undefined for unknown types. Errors propagate to the onMessage wrapper.
 */
async function handleRuntimeMessage(message: RawRecord): Promise<unknown> {
  switch (message.type) {
    case "GET_EFFECTIVE_POLICY": {
      const { policy } = await resolvePolicyFromStorage();
      return policy;
    }
    case "INCREMENT_METRICS": {
      await incrementTelemetryMetrics(message.deltas as RawRecord);
      return { ok: true };
    }
    case "RECORD_REDIRECT": {
      if (message.source === "omnibox") {
        await incrementTelemetryMetrics({
          aiModeRedirects: 1,
          omniboxFallbackRedirects: 1
        });
        await recordDiagnosticEntry(
          "WARN_OMNIBOX_POLICY_MISSING",
          "Omnibox/NTP AI Mode redirect intercepted via #rm_sg_omnibox fallback"
        );
      } else {
        await incrementTelemetryMetrics({
          aiModeRedirects: 1
        });
      }
      return { ok: true };
    }
    case "LOG_DIAGNOSTIC": {
      await recordDiagnosticEntry(message.code as ErrorCode, (message.detail ?? "") as string);
      return { ok: true };
    }
    case "GET_DIAGNOSTIC_SNAPSHOT": {
      const [{ policy }, telemetry, activeRuleCount] = await Promise.all([
        resolvePolicyFromStorage(),
        readTelemetryState(),
        getActiveDynamicRuleCount()
      ]);
      const snapshot: DiagnosticSnapshot = {
        policy,
        telemetry,
        activeRuleCount,
        extensionVersion: getExtensionVersion(),
        generatedAtDate: getTodayDateBucket()
      };
      return snapshot;
    }
    case "SET_LOCAL_OVERRIDES": {
      const { policy: currentPolicy, installType } = await resolvePolicyFromStorage();
      // Locked devices get the unchanged policy back and nothing is written. The install-type
      // check repeats parsePolicy's decision on purpose: overrides must never be stored on a
      // force-installed device, even if a later change to parsePolicy got the lock wrong.
      if (currentPolicy.isManaged || !isUnlockableInstall(installType)) {
        return currentPolicy;
      }
      const existingLocalRes = await readLocalOverrides();
      const merged = {
        ...existingLocalRes.data ?? {},
        ...sanitizeLocalOverridesInput(message.toggles as RawRecord)
      };
      await writeLocalOverrides(merged);
      const { policy: updatedPolicy } = await syncRuntimeState({
        recordPolicyDiagnostics: false
      });
      return updatedPolicy;
    }
    case "RESET_LOCAL_METRICS": {
      return await resetLocalTelemetry();
    }
  }
}

// Install/update: sync rules and log policy warnings.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await syncRuntimeState({
      recordPolicyDiagnostics: true
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onInstalled: ${detail}`);
  }
});

// Browser start: re-sync rules in case policy changed while Chrome was closed.
chrome.runtime.onStartup.addListener(async () => {
  try {
    await syncRuntimeState({
      recordPolicyDiagnostics: true
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onStartup: ${detail}`);
  }
});

// Admin Console pushes arrive as managed-storage changes, so policy applies without a restart.
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  try {
    if (areaName === "managed") {
      await syncRuntimeState({
        recordPolicyDiagnostics: true
      });
      return;
    }
    if (areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) {
      await syncRuntimeState({
        recordPolicyDiagnostics: false
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `storage.onChanged: ${detail}`);
  }
});

// Returning true keeps the message channel open for the async sendResponse.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      const result = await handleRuntimeMessage(message);
      sendResponse(result);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      try {
        await recordDiagnosticEntry("ERR_STORAGE_FAILURE", `onMessage: ${detail}`);
      } catch {
      }
      sendResponse({ ok: false, error: detail });
    }
  })();
  return true;
});
