/**
 * Runtime-message checks for the service worker (BP-13): who may send which message, what a
 * well-formed message looks like, and the policy view a content script is allowed to see.
 * Runs in: service worker.
 * Must never: let a google.com tab change settings, reset counters or read diagnostics, or
 * hand a content script more policy than it needs.
 * Shared with: background/service-worker.ts.
 */

import { ALL_ERROR_CODES } from "../shared/errors";
import type { EffectivePolicy, ErrorCode, ExtraHideSelectors, GradeBand, RawRecord, Toggles } from "../shared/types";

/** Every message the service worker understands, after validateMessage(). */
export type RuntimeMessage =
  | { type: "GET_EFFECTIVE_POLICY" }
  | { type: "GET_DIAGNOSTIC_SNAPSHOT" }
  | { type: "RESET_LOCAL_METRICS" }
  | { type: "INCREMENT_METRICS"; deltas: RawRecord; resetEpoch?: number }
  | { type: "RECORD_REDIRECT"; source: "omnibox" | "aimode" }
  | { type: "LOG_DIAGNOSTIC"; code: ErrorCode; detail?: string }
  | { type: "SET_LOCAL_OVERRIDES"; toggles: RawRecord };

/** The policy a content script receives: what it needs to hide and redirect, nothing more. */
export type ContentPolicy = Toggles & {
  gradeBand: GradeBand;
  isManaged: boolean;
  extraHideSelectors: ExtraHideSelectors;
};

/**
 * Messages that change settings, wipe counters or expose diagnostics. Only extension pages
 * (popup, Options) may send them; a google.com tab never can.
 */
export const PRIVILEGED_MESSAGE_TYPES = new Set(["SET_LOCAL_OVERRIDES", "RESET_LOCAL_METRICS", "GET_DIAGNOSTIC_SNAPSHOT"]);

/** Response for a message that fails validateMessage(). It is not logged as a diagnostic. */
export const BAD_MESSAGE = { ok: false, error: "bad_message" } as const;

/** Response for a privileged message from a sender that isn't an extension page. */
export const FORBIDDEN = { ok: false, error: "forbidden" } as const;

const ERROR_CODE_SET = new Set<string>(ALL_ERROR_CODES);

/**
 * Whether a value is a plain object (not null, not an array).
 * @param value - Untrusted value.
 * @returns true for a plain object.
 */
function isPlainObject(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a message came from one of this extension's own pages (popup or Options), as opposed
 * to a content script in a google.com tab.
 * @param sender - chrome.runtime.onMessage sender.
 * @returns true only when the sender is this extension and its URL is one of our pages. A
 * missing id or URL is treated as not a page (fail closed: privileged messages are refused).
 */
export function isFromExtensionPage(sender: chrome.runtime.MessageSender | undefined): boolean {
  const id = typeof chrome !== "undefined" ? chrome.runtime?.id : undefined;
  if (!id || !sender || sender.id !== id) {
    return false;
  }
  return typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${id}/`);
}

/**
 * Check a message's shape for its type.
 * @param message - Untrusted message.
 * @returns true if it is a known type with valid fields. Unknown types, a LOG_DIAGNOSTIC code
 * outside the catalog and a missing INCREMENT_METRICS deltas object all fail, so the caller
 * answers bad_message instead of throwing a misleading storage error.
 */
export function validateMessage(message: unknown): message is RuntimeMessage {
  if (!isPlainObject(message) || typeof message.type !== "string") {
    return false;
  }
  switch (message.type) {
    case "GET_EFFECTIVE_POLICY":
    case "GET_DIAGNOSTIC_SNAPSHOT":
    case "RESET_LOCAL_METRICS":
      return true;
    case "INCREMENT_METRICS":
      return (
        isPlainObject(message.deltas) &&
        (message.resetEpoch === undefined ||
          (typeof message.resetEpoch === "number" && Number.isInteger(message.resetEpoch) && message.resetEpoch >= 0))
      );
    case "RECORD_REDIRECT":
      return message.source === "omnibox" || message.source === "aimode";
    case "LOG_DIAGNOSTIC":
      return typeof message.code === "string" && ERROR_CODE_SET.has(message.code) && (message.detail === undefined || typeof message.detail === "string");
    case "SET_LOCAL_OVERRIDES":
      return isPlainObject(message.toggles);
    default:
      return false;
  }
}

/**
 * Reduce the effective policy to what a content script needs.
 * @param policy - Full effective policy.
 * @returns The six toggles, gradeBand, isManaged and cloned extraHideSelectors. Source,
 * invalidFields and evaluatedAt stay in the worker and on extension pages.
 */
export function toContentPolicy(policy: EffectivePolicy): ContentPolicy {
  return {
    masterEnabled: policy.masterEnabled,
    hideAiOverviews: policy.hideAiOverviews,
    hideAiModeUi: policy.hideAiModeUi,
    blockAiModeNavigation: policy.blockAiModeNavigation,
    forceWebOnlySearch: policy.forceWebOnlySearch,
    hideAuxiliaryAiFeatures: policy.hideAuxiliaryAiFeatures,
    gradeBand: policy.gradeBand,
    isManaged: policy.isManaged,
    extraHideSelectors: {
      overview: [...policy.extraHideSelectors.overview],
      aimode: [...policy.extraHideSelectors.aimode],
      aux: [...policy.extraHideSelectors.aux]
    }
  };
}
