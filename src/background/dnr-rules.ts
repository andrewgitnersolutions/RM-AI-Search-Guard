/**
 * Builds and installs the declarativeNetRequest dynamic rules that redirect AI Mode URLs
 * and (optionally) force Web-only results.
 * Runs in: service worker.
 * Must never: touch subresource requests (xmlhttprequest/scripts/assets) or hosts other than
 * google.com / www.google.com; AI Mode redirect rules cover main_frame and sub_frame
 * navigations, and forceWebOnlySearch rules cover main_frame navigations.
 * Shared with: background/service-worker.ts. shared/ai-mode-url.ts mirrors these redirects for
 * in-page navigation (BP-05); the two must stay in sync (test U-07).
 */

import { enqueueStorageOp } from "../shared/storage";
import type { Toggles } from "../shared/types";

type Rule = chrome.declarativeNetRequest.Rule;
type QueryTransform = chrome.declarativeNetRequest.QueryTransform;

/**
 * Every dynamic rule ID this extension owns; all are removed before each re-sync.
 */
export const ALL_MANAGED_RULE_IDS = [101, 102, 110, 111, 112, 120, 130];

export const ACTION_REDIRECT = "redirect" as chrome.declarativeNetRequest.RuleActionType.REDIRECT;

export const ACTION_ALLOW = "allow" as chrome.declarativeNetRequest.RuleActionType.ALLOW;

export const RESOURCE_MAIN_FRAME = "main_frame" as chrome.declarativeNetRequest.ResourceType.MAIN_FRAME;

export const RESOURCE_SUB_FRAME = "sub_frame" as chrome.declarativeNetRequest.ResourceType.SUB_FRAME;

// FRAGILE(google-dom, last verified NONE, see tests L-02/L-06): udm=14 (Web-only results) and AI Mode session params aep, arv, mstk, csuir.
/**
 * Build the query transform used when redirecting out of AI Mode.
 * @param forceWebOnlySearch - true replaces udm with 14; false removes udm.
 * @returns DNR queryTransform that also strips AI Mode session params. Pure; never throws.
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
// entries before generic AI Mode 110 (50); /ai and /aimode with a query (111, 50) keep the
// student's search, the queryless fallback 112 (45) goes to the homepage; allow 120 (40)
// exempts explicit numeric udm=/alphabetic tbm= tabs from the Web-only rewrite 130 (30).
// FRAGILE(google-dom, last verified NONE, see tests L-02/L-06): udm=50 = AI Mode, sourceid=chrome / aep= = omnibox entry, /ai and /aimode paths.
/**
 * Build the dynamic DNR rules for a policy.
 * @param policy - Effective policy.
 * @returns Rule list; [] when masterEnabled is false. Pure; never throws.
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
            path: "/search",
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_omnibox"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(search|webhp)?\\?([^#]*&)?(sourceid=chrome|aep=)[^#]*&udm=(0|%30)*(5|%35)(0|%30)(&|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME, RESOURCE_SUB_FRAME]
      }
    });
    rules.push({
      id: 102,
      priority: 55,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            path: "/search",
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_omnibox"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(search|webhp)?\\?([^#]*&)?udm=(0|%30)*(5|%35)(0|%30)&[^#]*(sourceid=chrome|aep=)",
        resourceTypes: [RESOURCE_MAIN_FRAME, RESOURCE_SUB_FRAME]
      }
    });
    rules.push({
      id: 110,
      priority: 50,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            path: "/search",
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_aimode"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(search|webhp)?\\?([^#]*&)?udm=(0|%30)*(5|%35)(0|%30)(&|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME, RESOURCE_SUB_FRAME]
      }
    });
    // BP-19 (owner decision 2026-11-21): /aimode?q=fractions keeps the search. The path becomes
    // /search and the same AI Mode query transform as 110 applies (q kept, udm/session params
    // cleaned), so the student lands on ordinary results instead of retyping on the homepage.
    rules.push({
      id: 111,
      priority: 50,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          transform: {
            path: "/search",
            queryTransform: createAiModeQueryTransform(policy.forceWebOnlySearch),
            fragment: "#rm_sg_aimode"
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(ai|aimode)(/[^?#]*)?\\?([^#]*&)?q=[^&#]",
        resourceTypes: [RESOURCE_MAIN_FRAME, RESOURCE_SUB_FRAME]
      }
    });
    rules.push({
      id: 112,
      priority: 45,
      action: {
        type: ACTION_REDIRECT,
        redirect: {
          url: "https://www.google.com/#rm_sg_aimode"
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(ai|aimode)(/|\\?|$)",
        resourceTypes: [RESOURCE_MAIN_FRAME, RESOURCE_SUB_FRAME]
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
        regexFilter: "^https://(www\\.)?google\\.com/(search|webhp)?\\?([^#]*&)?(udm=[1-9][0-9]*|tbm=[a-z]+)(&|$)",
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
            path: "/search",
            queryTransform: {
              addOrReplaceParams: [{ key: "udm", value: "14" }]
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://(www\\.)?google\\.com/(search|webhp)?\\?([^#]*&)?q=[^&#]",
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
