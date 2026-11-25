/**
 * Pure JS copy of the AI Mode redirects in background/dnr-rules.ts, for AI Mode reached by an
 * in-page (history.pushState) navigation that never produces a main_frame request, so DNR
 * can't see it (BP-05).
 * Runs in: content script on google.com.
 * Must never: change a URL that the DNR AI Mode rules (101, 102, 110, 111, 112) would leave
 * alone, or redirect off google.com. Keep it in step with buildDynamicRules: test U-07 checks
 * this function against the DNR simulation for every test URL.
 * Shared with: content/content.ts; mirrors background/dnr-rules.ts.
 */

import type { Toggles } from "./types";

// FRAGILE(google-dom, last verified NONE, see tests L-02/L-06): AI Mode session params, same list as createAiModeQueryTransform.
const AI_MODE_SESSION_PARAMS = ["aep", "arv", "mstk", "csuir"];

/**
 * Apply the same query cleanup as createAiModeQueryTransform().
 * @param params - Search params to modify in place.
 * @param forceWebOnlySearch - true sets udm=14; false removes udm.
 * @returns Nothing; mutates params in place and never throws.
 */
function applyAiModeQueryTransform(params: URLSearchParams, forceWebOnlySearch: boolean): void {
  for (const key of AI_MODE_SESSION_PARAMS) {
    params.delete(key);
  }
  if (forceWebOnlySearch) {
    params.set("udm", "14");
  } else {
    params.delete("udm");
  }
}

// FRAGILE(google-dom, last verified NONE, see tests L-02/L-06): udm=50 = AI Mode; sourceid=chrome / aep= mark an omnibox entry (rules 101/102).
/**
 * Work out where the DNR AI Mode rules would send a URL.
 * @param href - Current page URL.
 * @param policy - Effective toggles; nothing happens unless masterEnabled and
 * blockAiModeNavigation are both on.
 * @returns The clean URL (with the #rm_sg_aimode or #rm_sg_omnibox marker the DNR rules add),
 * or null when the URL is not an AI Mode URL or the policy doesn't block AI Mode. Unparsable
 * input returns null: the page is left alone rather than navigated somewhere unexpected.
 */
export function cleanAiModeUrl(href: string, policy: Toggles): string | null {
  if (!policy.masterEnabled || !policy.blockAiModeNavigation) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || (url.hostname !== "www.google.com" && url.hostname !== "google.com")) {
    return null;
  }
  url.hash = "";
  const params = url.searchParams;
  // DNR regexFilter matching is case-insensitive by default, so compare lowercased.
  const path = url.pathname.toLowerCase();
  const isSearchLikePath = path === "/search" || path === "/webhp" || path === "/";
  if (isSearchLikePath && params.getAll("udm").some((v) => /^0*50$/.test(v))) {
    // Normalize /webhp and / to /search, matching DNR rules 101, 102, and 110.
    url.pathname = "/search";
    // Rules 101/102: an omnibox / New Tab Page entry carries sourceid=chrome or aep=.
    const fromOmnibox = params.has("aep") || params.getAll("sourceid").some((v) => v.toLowerCase().startsWith("chrome"));
    applyAiModeQueryTransform(params, policy.forceWebOnlySearch);
    url.hash = fromOmnibox ? "#rm_sg_omnibox" : "#rm_sg_aimode";
    return url.href;
  }
  if (/^\/(ai|aimode)(\/|$)/.test(path)) {
    // Like rule 111's regex, any non-empty q counts, not just the first (?q=&q=fractions).
    if (params.getAll("q").some((q) => q !== "")) {
      // Rule 111 (BP-19): keep the student's search on /search.
      url.pathname = "/search";
      applyAiModeQueryTransform(params, policy.forceWebOnlySearch);
      url.hash = "#rm_sg_aimode";
      return url.href;
    }
    // Rule 112: no query, so the homepage.
    return "https://www.google.com/#rm_sg_aimode";
  }
  return null;
}
