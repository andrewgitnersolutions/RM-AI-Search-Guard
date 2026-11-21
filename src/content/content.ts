/**
 * Content script entry point: loads the effective policy, sets the html[data-rmsg-*] attributes
 * that static-guard.css keys on, runs DOM sweeps on mutations and reports aggregate counts.
 * Runs in: content script on google.com at document_start (bundled as an IIFE).
 * Must never: send page text, queries, URLs or identifiers; the only page-derived value is an
 * opaque hash used locally to count each page once.
 * Fails closed (BP-02): all three hide attributes are set synchronously before anything else
 * runs, so static-guard.css hides AI surfaces from the first paint; the resolved policy then
 * only removes the ones it turns off. If no policy can be resolved, they stay on.
 * Shared with: shared/defaults.ts, shared/policy.ts, shared/storage.ts, content/dom-engine.ts.
 */

import { STORAGE_KEYS } from "../shared/defaults";
import { parsePolicy } from "../shared/policy";
import { readLocalOverrides, readManagedPolicyRaw } from "../shared/storage";
import { applyPolicyAttributes, parseRedirectHash, sweepDom, unhideAllElements, unhideCategoryElements } from "./dom-engine";
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

let currentPolicy: EffectivePolicy | null = null;

let bodyObserver: MutationObserver | null = null;

let rootObserver: MutationObserver | null = null;

let pendingRaf = false;

const seenOverviewPages = /* @__PURE__ */ new Set<string>();

const reportedErrorKeys = /* @__PURE__ */ new Set<string>();

/**
 * Stop both MutationObservers and cancel the pending sweep flag.
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
  pendingRaf = false;
}

/**
 * Sweep immediately and report aggregate deltas and deduped diagnostics.
 * No-op when there is no policy yet or masterEnabled is false.
 */
function runSweepNow() {
  if (!currentPolicy || !currentPolicy.masterEnabled) {
    return;
  }
  const pageKey = computeOpaquePageKey();
  const { deltas, errors } = sweepDom(document, currentPolicy, seenOverviewPages, pageKey);
  if (Object.keys(deltas).length > 0) {
    void sendRuntimeMessage({ type: "INCREMENT_METRICS", deltas });
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
 * Coalesce mutations into at most one sweep per animation frame.
 */
function scheduleSweep() {
  if (pendingRaf || !currentPolicy || !currentPolicy.masterEnabled) {
    return;
  }
  pendingRaf = true;
  window.requestAnimationFrame(() => {
    pendingRaf = false;
    runSweepNow();
  });
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
 * @param policy - Effective policy; masterEnabled false unhides everything and stops observers.
 */
function applyEffectivePolicy(policy: EffectivePolicy): void {
  currentPolicy = policy;
  applyPolicyAttributes(document, policy);
  if (!policy.masterEnabled) {
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
  scheduleSweep();
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
 * Load the policy, apply it, and sweep at once if the DOM is already parsed.
 */
async function bootstrapContentGuard() {
  const policy = await loadEffectivePolicy();
  applyEffectivePolicy(policy);
  if (policy.masterEnabled && document.readyState !== "loading") {
    runSweepNow();
  }
}

// Admin Console pushes and local test changes re-apply to open tabs without a reload.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === "managed" || areaName === "local" && STORAGE_KEYS.LOCAL_OVERRIDES in changes) {
      const policy = await loadEffectivePolicy();
      applyEffectivePolicy(policy);
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

// Start at document_start. CSS hiding is already on (applyFailClosedAttributes); JS sweeps and
// any un-hiding wait for the policy.
void bootstrapContentGuard();
