/**
 * Content script entry point: loads the effective policy, sets the html[data-rmsg-*] attributes
 * that static-guard.css keys on, runs throttled DOM sweeps on mutations and batches per-page
 * aggregate counts (BP-09, BP-14).
 * Runs in: content script on google.com at document_start (bundled as an IIFE).
 * Must never: send page text, queries, URLs or identifiers; the only page-derived value is an
 * opaque hash used locally to count each page once per category.
 * Fails closed (BP-02): all three hide attributes are set synchronously before anything else
 * runs, so static-guard.css hides AI surfaces from the first paint; the resolved policy then
 * only removes the ones it turns off. If no policy can be resolved, they stay on.
 * In-page navigation into AI Mode (history.pushState, no main_frame request) is caught here and
 * sent through the same redirect the DNR rules use (BP-05, shared/ai-mode-url.ts).
 * Shared with: shared/ai-mode-url.ts, shared/defaults.ts, shared/policy.ts, shared/storage.ts,
 * content/dom-engine.ts.
 */

import { cleanAiModeUrl } from "../shared/ai-mode-url";
import { STORAGE_KEYS } from "../shared/defaults";
import { parsePolicy } from "../shared/policy";
import { readLocalOverrides, readManagedPolicyRaw, readMetricsResetEpoch } from "../shared/storage";
import { applyPolicyAttributes, parseRedirectHash, sweepDom, unhideAllElements, unhideCategoryElements } from "./dom-engine";
import type { SeenCategoryPages } from "./dom-engine";
import type { EffectivePolicy, RawRecord } from "../shared/types";

/**
 * Turn every hide category on before the policy is known (BP-02). Google's HTML can stream and
 * paint before the worker round trip finishes, so waiting would flash AI content. An OU that
 * allows a feature sees it appear a moment later instead, which is the right trade for K-12.
 * Fails closed: a missing documentElement (non-HTML document) is simply skipped.
 */
function applyFailClosedAttributes(): void {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.setAttribute("data-rmsg-hide-overviews", "1");
  root.setAttribute("data-rmsg-hide-aimode", "1");
  root.setAttribute("data-rmsg-hide-aux", "1");
}

// First statement on purpose: before the redirect-marker handling and any await.
applyFailClosedAttributes();

/**
 * Send a message to the service worker.
 * @param message - Message object.
 * @returns The response, or null if the worker is unavailable or throws.
 */
async function sendRuntimeMessage(message: RawRecord): Promise<unknown> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return null;
  }
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return null;
  }
}

/**
 * Hash path + query (FNV-1a) into an opaque key so each page is counted once.
 * The key never leaves the content script.
 * @returns "p-<hex>".
 */
function computeOpaquePageKey(): string {
  const input = `${window.location.pathname}${window.location.search}`;
  // FNV-1a 32-bit offset basis and prime: a fast, non-reversible local key.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `p-${(hash >>> 0).toString(16)}`;
}

/**
 * If the URL carries a DNR redirect marker, strip it and report one redirect.
 * Only the marker type is sent, never the URL.
 */
function handleRedirectHashTelemetry() {
  const redirectSource = parseRedirectHash(window.location.hash);
  if (redirectSource === null) {
    return;
  }
  try {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    );
  } catch {
  }
  void sendRuntimeMessage({ type: "RECORD_REDIRECT", source: redirectSource });
}

// Handle a redirect marker before anything else so the fragment is gone before Google reads it.
handleRedirectHashTelemetry();

// Minimum gap between mutation-driven sweeps, and maximum age of batched counter deltas (BP-09).
const SWEEP_THROTTLE_MS = 150;
const METRICS_FLUSH_INTERVAL_MS = 10_000;

let currentPolicy: EffectivePolicy | null = null;

let bodyObserver: MutationObserver | null = null;

let rootObserver: MutationObserver | null = null;

let pendingRaf = false;
let pendingRafId: number | null = null;
let sweepTimer: ReturnType<typeof window.setTimeout> | null = null;
let lastSweepAt = -Infinity;

const seenOverviewPages = /* @__PURE__ */ new Set<string>();
const seenAiModePages = /* @__PURE__ */ new Set<string>();
const seenAuxPages = /* @__PURE__ */ new Set<string>();
const seenCategoryPages: SeenCategoryPages = {
  overview: seenOverviewPages,
  aimode: seenAiModePages,
  aux: seenAuxPages
};

const reportedErrorKeys = /* @__PURE__ */ new Set<string>();

let pendingMetricDeltas: Record<string, number> = {};
let metricsFlushTimer: ReturnType<typeof window.setTimeout> | null = null;
let currentResetEpoch: number | null = null;
let liveResetSeen = false;

/**
 * Load the stored metrics reset epoch once on startup without clobbering any newer epoch
 * already delivered live via storage.onChanged.
 */
async function initMetricsResetEpoch(): Promise<void> {
  const epoch = await readMetricsResetEpoch();
  if (!liveResetSeen && currentResetEpoch === null) {
    currentResetEpoch = epoch;
  }
}

/**
 * Discard any queued pre-reset metric deltas and cancel the fallback flush timer (PR #6 review).
 */
function clearPendingMetrics(): void {
  if (metricsFlushTimer !== null) {
    if (typeof window.clearTimeout === "function") {
      window.clearTimeout(metricsFlushTimer);
    }
    metricsFlushTimer = null;
  }
  pendingMetricDeltas = {};
}

/**
 * Cancel any pending throttle timer or animation-frame sweep callback.
 */
function cancelScheduledSweep(): void {
  if (sweepTimer !== null) {
    if (typeof window.clearTimeout === "function") {
      window.clearTimeout(sweepTimer);
    }
    sweepTimer = null;
  }
  if (pendingRafId !== null && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(pendingRafId);
  }
  pendingRafId = null;
  pendingRaf = false;
}

/**
 * Queue one sweep on the next animation frame.
 */
function queueSweepFrame(): void {
  pendingRaf = true;
  const id = window.requestAnimationFrame(() => {
    pendingRaf = false;
    pendingRafId = null;
    runSweepNow();
  });
  pendingRafId = typeof id === "number" ? id : null;
}

/**
 * Accumulate positive counter deltas and schedule the fallback 10 s flush timer (BP-09).
 * Batching avoids a storage write on every mutation frame on streaming results pages.
 * @param deltas - Non-negative integer deltas from sweepDom().
 */
function queueMetricDeltas(deltas: Record<string, number>): void {
  let added = false;
  for (const [key, rawValue] of Object.entries(deltas)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
      const value = Math.floor(rawValue);
      if (value > 0) {
        pendingMetricDeltas[key] = (pendingMetricDeltas[key] ?? 0) + value;
        added = true;
      }
    }
  }
  if (added && metricsFlushTimer === null && typeof window.setTimeout === "function") {
    metricsFlushTimer = window.setTimeout(() => {
      metricsFlushTimer = null;
      flushPendingMetrics();
    }, METRICS_FLUSH_INTERVAL_MS);
  }
}

/**
 * Send any queued counter deltas to the service worker and clear the flush timer.
 * Swaps the pending map synchronously so back-to-back visibilitychange and pagehide events
 * never double-send.
 */
function flushPendingMetrics(): void {
  if (metricsFlushTimer !== null) {
    if (typeof window.clearTimeout === "function") {
      window.clearTimeout(metricsFlushTimer);
    }
    metricsFlushTimer = null;
  }
  if (Object.keys(pendingMetricDeltas).length === 0) {
    return;
  }
  const deltas = pendingMetricDeltas;
  pendingMetricDeltas = {};
  const msg: RawRecord = { type: "INCREMENT_METRICS", deltas };
  if (currentResetEpoch !== null) {
    msg.resetEpoch = currentResetEpoch;
  }
  void sendRuntimeMessage(msg);
}

/**
 * Stop both MutationObservers and cancel any pending sweep callbacks.
 */
function disconnectObservers() {
  if (bodyObserver) {
    bodyObserver.disconnect();
    bodyObserver = null;
  }
  if (rootObserver) {
    rootObserver.disconnect();
    rootObserver = null;
  }
  cancelScheduledSweep();
}

/**
 * Set once this page has started a redirect out of AI Mode, so repeated sweeps or events
 * don't queue a second navigation while the first is loading.
 */
let aiModeRedirectStarted = false;

/**
 * If the URL changed into AI Mode without a page load, replace it with the clean URL the DNR
 * rules would have produced (BP-05). The marker in the new URL's fragment makes the next page
 * count exactly one redirect through the existing hash telemetry.
 * @returns true if a redirect was started. Does nothing until the policy is known or when it
 * doesn't block AI Mode; a full page load is still covered by DNR either way.
 */
function checkAiModeUrl(): boolean {
  if (aiModeRedirectStarted || !currentPolicy) {
    return false;
  }
  const clean = cleanAiModeUrl(window.location.href, currentPolicy);
  if (clean === null) {
    return false;
  }
  aiModeRedirectStarted = true;
  flushPendingMetrics();
  window.location.replace(clean);
  return true;
}

/**
 * Sweep immediately, queue any per-page deltas, and report deduped diagnostics.
 * No-op when there is no policy yet or masterEnabled is false; skipped when the URL check
 * starts an AI Mode redirect instead.
 */
function runSweepNow() {
  if (!currentPolicy || !currentPolicy.masterEnabled) {
    return;
  }
  cancelScheduledSweep();
  lastSweepAt = Date.now();
  // Google's in-page switch to AI Mode always mutates the DOM, so every sweep re-checks the URL.
  if (checkAiModeUrl()) {
    return;
  }
  const pageKey = computeOpaquePageKey();
  const { deltas, errors } = sweepDom(document, currentPolicy, seenCategoryPages, pageKey);
  if (Object.keys(deltas).length > 0) {
    queueMetricDeltas(deltas);
  }
  for (const err of errors) {
    const dedupeKey = `${pageKey}:${err.code}:${err.detail}`;
    if (!reportedErrorKeys.has(dedupeKey)) {
      reportedErrorKeys.add(dedupeKey);
      void sendRuntimeMessage({
        type: "LOG_DIAGNOSTIC",
        code: err.code,
        detail: err.detail
      });
    }
  }
}

/**
 * Throttle mutation sweeps to at most once per 150 ms while keeping the first/idle sweep on
 * the next animation frame and guaranteeing a trailing sweep after bursts settle (BP-09).
 * @param immediate - Skip throttle cooldown (used when a new policy is applied).
 */
function scheduleSweep(immediate = false) {
  if (!currentPolicy || !currentPolicy.masterEnabled) {
    return;
  }
  if (immediate) {
    if (sweepTimer !== null) {
      if (typeof window.clearTimeout === "function") {
        window.clearTimeout(sweepTimer);
      }
      sweepTimer = null;
    }
    if (!pendingRaf) {
      queueSweepFrame();
    }
    return;
  }
  if (pendingRaf || sweepTimer !== null) {
    return;
  }
  const elapsed = Date.now() - lastSweepAt;
  if (elapsed >= SWEEP_THROTTLE_MS || typeof window.setTimeout !== "function") {
    queueSweepFrame();
    return;
  }
  sweepTimer = window.setTimeout(() => {
    sweepTimer = null;
    if (!pendingRaf && currentPolicy?.masterEnabled) {
      queueSweepFrame();
    }
  }, SWEEP_THROTTLE_MS - elapsed);
}

/**
 * Observe <body> for added nodes; before <body> exists, watch <html> until it appears.
 */
function attachMutationObserver() {
  if (!currentPolicy || !currentPolicy.masterEnabled) {
    return;
  }
  if (document.body) {
    if (rootObserver) {
      rootObserver.disconnect();
      rootObserver = null;
    }
    if (!bodyObserver) {
      bodyObserver = new MutationObserver(() => {
        scheduleSweep();
      });
      bodyObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
    return;
  }
  if (!rootObserver && document.documentElement) {
    rootObserver = new MutationObserver(() => {
      if (document.body) {
        attachMutationObserver();
        scheduleSweep();
      }
    });
    rootObserver.observe(document.documentElement, { childList: true });
  }
}

/**
 * Apply a policy: set attributes, restore categories that were turned off, and start sweeping.
 * @param policy - Effective policy; masterEnabled false flushes deltas, unhides everything and stops observers.
 */
function applyEffectivePolicy(policy: EffectivePolicy): void {
  currentPolicy = policy;
  applyPolicyAttributes(document, policy);
  if (!policy.masterEnabled) {
    flushPendingMetrics();
    disconnectObservers();
    unhideAllElements(document);
    return;
  }
  if (!policy.hideAiOverviews) {
    unhideCategoryElements(document, "overview");
  }
  if (!policy.hideAiModeUi) {
    unhideCategoryElements(document, "aimode");
  }
  if (!policy.hideAuxiliaryAiFeatures) {
    unhideCategoryElements(document, "aux");
  }
  attachMutationObserver();
  scheduleSweep(true);
}

/**
 * Get the effective policy from the service worker, or parse storage directly if it doesn't answer.
 * @returns Effective policy. The fallback can't read the install type (content scripts have no
 * chrome.management), so with no managed keys it gets locked strict defaults (BP-01, fail closed).
 */
async function loadEffectivePolicy(): Promise<EffectivePolicy> {
  const fromSw = await sendRuntimeMessage({
    type: "GET_EFFECTIVE_POLICY"
  }) as Partial<EffectivePolicy> | null;
  if (fromSw && typeof fromSw.masterEnabled === "boolean") {
    return fromSw as EffectivePolicy;
  }
  const [managedRes, localRes] = await Promise.all([
    readManagedPolicyRaw(),
    readLocalOverrides()
  ]);
  // Worker unreachable and storage unreadable: the parse below falls back to locked strict
  // defaults, so the fail-closed attributes stay on. Report it (best effort: the worker may be
  // the thing that's down). The detail is the storage error text only, never page data.
  const storageError = managedRes.error ?? localRes.error;
  if (storageError) {
    void sendRuntimeMessage({ type: "LOG_DIAGNOSTIC", code: "ERR_STORAGE_FAILURE", detail: `content fallback: ${storageError}` });
  }
  return parsePolicy(managedRes.data, localRes.data).policy;
}

/**
 * Number of the newest policy load started in this tab (BP-17).
 */
let policyLoadSeq = 0;

/**
 * Load the policy and apply it, unless a newer load started meanwhile. Bootstrap and storage
 * changes both go through here so every policy source follows the same newest-wins rule.
 * @returns The applied policy, or null if this result was stale and dropped. Dropping is the
 * safe choice: an older "disabled" result finishing last would otherwise unhide everything and
 * disconnect the observers until the next reload (fail-open).
 */
async function loadAndApplyPolicy(): Promise<EffectivePolicy | null> {
  const seq = ++policyLoadSeq;
  const policy = await loadEffectivePolicy();
  if (seq !== policyLoadSeq) {
    return null;
  }
  applyEffectivePolicy(policy);
  // Catches a pushState into AI Mode that happened before the policy arrived, and backs up
  // DNR if its rules failed to install (BP-05).
  checkAiModeUrl();
  return policy;
}

/**
 * Load the policy, apply it, and sweep at once if the DOM is already parsed.
 */
async function bootstrapContentGuard() {
  const policy = await loadAndApplyPolicy();
  if (policy?.masterEnabled && document.readyState !== "loading") {
    runSweepNow();
  }
}

// Admin Console pushes and local test changes re-apply to open tabs without a reload; local
// counter resets discard unflushed pre-reset deltas before they can re-increment cleared totals.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === "local" && STORAGE_KEYS.METRICS_RESET_EPOCH in changes) {
      const nextEpoch = changes[STORAGE_KEYS.METRICS_RESET_EPOCH]?.newValue;
      if (typeof nextEpoch === "number" && Number.isInteger(nextEpoch) && nextEpoch >= 0) {
        liveResetSeen = true;
        currentResetEpoch = nextEpoch;
        clearPendingMetrics();
      }
    }
    if (areaName === "managed" || areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) {
      await loadAndApplyPolicy();
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  if (currentPolicy?.masterEnabled) {
    attachMutationObserver();
    runSweepNow();
  }
});

window.addEventListener("load", () => {
  if (currentPolicy?.masterEnabled) {
    scheduleSweep();
  }
});

window.addEventListener("hashchange", () => {
  handleRedirectHashTelemetry();
});

// Back/forward into an AI Mode entry, and bfcache restores, change the URL without a fresh
// main_frame request either.
window.addEventListener("popstate", () => {
  checkAiModeUrl();
});
window.addEventListener("pageshow", () => {
  checkAiModeUrl();
});

// Flush batched per-page metrics before leaving or backgrounding the tab (BP-09).
window.addEventListener("pagehide", () => {
  flushPendingMetrics();
});
if (typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingMetrics();
    }
  });
}

// Navigation API (Chrome 102+): fires after same-document navigations such as pushState, so
// AI Mode is caught even before the next DOM mutation. Feature-detected; sweeps cover the rest.
const navigationApi = (window as unknown as { navigation?: EventTarget }).navigation;
if (navigationApi && typeof navigationApi.addEventListener === "function") {
  navigationApi.addEventListener("navigatesuccess", () => {
    checkAiModeUrl();
  });
}

// Start at document_start. CSS hiding is already on (applyFailClosedAttributes); JS sweeps and
// any un-hiding wait for the policy.
void initMetricsResetEpoch();
void bootstrapContentGuard();
