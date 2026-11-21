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
import { incrementTelemetryMetrics, readLocalOverrides, readManagedPolicyRaw, readTelemetryState, recordDiagnosticEntry, resetLocalTelemetry, mergeLocalOverrides } from "../shared/storage";
import { syncDynamicRules } from "./dnr-rules";
import { BAD_MESSAGE, FORBIDDEN, PRIVILEGED_MESSAGE_TYPES, isFromExtensionPage, toContentPolicy, validateMessage } from "./messages";
import type { DiagnosticSnapshot, EffectivePolicy, InstallType, RawRecord } from "../shared/types";

/**
 * Learn how the extension was installed (BP-01). chrome.management.getSelf() needs no
 * "management" permission (verified 2026-11-21 in Chromium 153 with this manifest). It is
 * read on every policy resolve rather than cached: docs/03 allows no mutable module-level
 * state in the service worker, and the call is cheap.
 * @returns The install type, or "unknown" if the API is missing or throws. "unknown" locks
 * (fail closed): a force-installed student device must never fall into local test mode.
 */
async function resolveInstallType(): Promise<InstallType> {
  if (typeof chrome === "undefined" || typeof chrome.management?.getSelf !== "function") {
    return "unknown";
  }
  try {
    const self = await chrome.management.getSelf();
    if (typeof self?.installType === "string") {
      return self.installType as InstallType;
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
 * Tail of the chain that runs whole policy syncs one at a time (BP-17). It is separate from the
 * storage queue on purpose: a sync enqueues storage operations itself, so running it inside
 * that queue would deadlock. Like storageQueueTail it only orders work within one worker wake;
 * it holds no policy or user state, so docs/03's no-module-state rule isn't broken.
 */
let syncChainTail: Promise<unknown> = Promise.resolve();

/**
 * Bring DNR rules in line with the current policy. Each call runs after the previous one has
 * finished resolving *and* installing (BP-17): only serializing the DNR update let an older
 * sync, still waiting on its diagnostics, install stale rules after a newer policy's rules.
 * @param options - recordPolicyDiagnostics: log policy warnings and errors.
 * @returns { policy, activeRuleCount }. DNR failures are logged as ERR_DNR_SYNC_FAILED, not
 * thrown. A rejection reaches the caller but never blocks later syncs.
 */
function syncRuntimeState(options: { recordPolicyDiagnostics: boolean }): Promise<{ policy: EffectivePolicy; activeRuleCount: number }> {
  const run = syncChainTail.then(() => syncRuntimeStateNow(options));
  syncChainTail = run.catch(() => {});
  return run;
}

/**
 * One policy sync: resolve, log diagnostics, install rules. Call only via syncRuntimeState().
 * @param options - recordPolicyDiagnostics: log policy warnings and errors.
 * @returns { policy, activeRuleCount }.
 */
async function syncRuntimeStateNow(options: { recordPolicyDiagnostics: boolean }): Promise<{ policy: EffectivePolicy; activeRuleCount: number }> {
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
 * Handle one runtime message from the content script, popup or options page (BP-13).
 * @param message - Untrusted message.
 * @param sender - Who sent it.
 * @returns The response for that type. A malformed message gets bad_message and a privileged
 * one from a google.com tab gets forbidden; neither is logged, so a bad message can't fill the
 * diagnostic log with misleading entries. Other errors propagate to the onMessage wrapper.
 */
async function handleRuntimeMessage(message: unknown, sender: chrome.runtime.MessageSender | undefined): Promise<unknown> {
  if (!validateMessage(message)) {
    return BAD_MESSAGE;
  }
  const fromExtensionPage = isFromExtensionPage(sender);
  if (PRIVILEGED_MESSAGE_TYPES.has(message.type) && !fromExtensionPage) {
    return FORBIDDEN;
  }
  switch (message.type) {
    case "GET_EFFECTIVE_POLICY": {
      const { policy } = await resolvePolicyFromStorage();
      // Pages show source and lock state; a content script only needs what to hide.
      return fromExtensionPage ? policy : toContentPolicy(policy);
    }
    case "INCREMENT_METRICS": {
      await incrementTelemetryMetrics(message.deltas, message.resetEpoch);
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
      await recordDiagnosticEntry(message.code, message.detail ?? "");
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
      await mergeLocalOverrides(sanitizeLocalOverridesInput(message.toggles));
      const { policy: updatedPolicy } = await syncRuntimeState({
        recordPolicyDiagnostics: false
      });
      return updatedPolicy;
    }
    case "RESET_LOCAL_METRICS": {
      // BP-07: on a locked device a student could otherwise wipe the record that AI Mode was
      // attempted. Same lock rule as SET_LOCAL_OVERRIDES; IT test installs can still reset.
      const { policy, installType } = await resolvePolicyFromStorage();
      if (policy.isManaged || !isUnlockableInstall(installType)) {
        return { ok: false, reason: "locked" };
      }
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const result = await handleRuntimeMessage(message, sender);
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
