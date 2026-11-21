/**
 * Builds and installs the declarativeNetRequest dynamic rules that redirect AI Mode URLs
 * and (optionally) force Web-only results.
 * Runs in: service worker.
 * Must never: touch subresource requests or hosts other than google.com / www.google.com.
 * Shared with: background/service-worker.ts. BP-05 will add a JS copy of this transform in the
 * content script; the two must stay in sync.
 */

import { enqueueStorageOp } from "../shared/storage";
import type { Toggles } from "../shared/types";

type Rule = chrome.declarativeNetRequest.Rule;
type QueryTransform = chrome.declarativeNetRequest.QueryTransform;

/**
 * Every dynamic rule ID this extension owns; all are removed before each re-sync.
 */
export const ALL_MANAGED_RULE_IDS = [101, 102, 110, 111, 120, 130];

export const ACTION_REDIRECT = "redirect" as chrome.declarativeNetRequest.RuleActionType.REDIRECT;

export const ACTION_ALLOW = "allow" as chrome.declarativeNetRequest.RuleActionType.ALLOW;

export const RESOURCE_MAIN_FRAME = "main_frame" as chrome.declarativeNetRequest.ResourceType.MAIN_FRAME;

// FRAGILE(google-dom, last verified NONE, see test L-07): udm=14 (Web-only results) and AI Mode session params aep, arv, mstk, csuir.
/**
 * Build the query transform used when redirecting out of AI Mode.
 * @param forceWebOnlySearch - true replaces udm with 14; false removes udm.
 * @returns DNR queryTransform that also strips AI Mode session params.
 */
export function createAiModeQueryTransform(forceWebOnlySearch: boolean): QueryTransform {
  if (forceWebOnlySearch) {
    return {
      addOrReplaceParams: [{ key: "udm", value: "14" }],
      removeParams: ["aep", "arv", "mstk", "csuir"]
    };
  }
  return {
    removeParams: ["udm", "aep", "arv", "mstk", "csuir"]
  };
}

// RE2 has no lookahead, so rule order is done with priorities: 101/102 (55) catch omnibox
// entries before generic AI Mode 110 (50); allow 120 (40) exempts explicit tabs (udm=/tbm=)
// from the Web-only rewrite 130 (30).
// FRAGILE(google-dom, last verified NONE, see test L-07): udm=50 = AI Mode, sourceid=chrome / aep= = omnibox entry, /ai and /aimode paths.
/**
 * Build the dynamic DNR rules for a policy.
 * @param policy - Effective policy.
 * @returns Rule list; [] when masterEnabled is false.
 */
export function buildDynamicRules(policy: Toggles): Rule[] {
  if (!policy.masterEnabled) {
    return [];
  }
  const rules: Rule[] = [];
  if (policy.blockAiModeNavigation) {
    rules.push({
      id: 101,
      priority: 55,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_omnibox"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?(sourceid=chrome|aep=)[^#]*&udm=50(&|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 102,
      priority: 55,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_omnibox"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50&[^#]*(sourceid=chrome|aep=)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 110,
      priority: 50,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_aimode"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50(&|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 111,
      priority: 50,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          url: "https://www.google.com/#rm_sg_aimode"
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(ai|aimode)(/|\\?|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
  }
  if (policy.forceWebOnlySearch) {
    rules.push({
      id: 120,
      priority: 40,
      action: {
        type: ACTION_ALLOW
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?(udm=|tbm=)",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
    rules.push({
      id: 130,
      priority: 30,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [{ key: "udm", value: "14" }]
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/search\\?([^#]*&)?q=",
        resourceTypes: [RESOURCE_MAIN_FRAME]
      }
    });
  }
  return rules;
}

/**
 * Atomically replace this extension's dynamic rules with the rules for a policy.
 * @param policy - Effective policy.
 * @returns { activeRuleCount, error? }. Never throws; on failure error is set and the caller logs
 * ERR_DNR_SYNC_FAILED (rules Chrome already had stay in place).
 */
export async function syncDynamicRules(policy: Toggles): Promise<{ activeRuleCount: number; error?: string }> {
  return enqueueStorageOp(async () => {
    try {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = Array.from(
        /* @__PURE__ */ new Set([...ALL_MANAGED_RULE_IDS, ...existingRules.map((rule) => rule.id)])
      );
      const addRules = buildDynamicRules(policy);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules
      });
      return { activeRuleCount: addRules.length };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { activeRuleCount: 0, error: detail };
    }
  });
}
