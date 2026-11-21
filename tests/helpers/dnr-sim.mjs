/**
 * Minimal declarativeNetRequest simulator for redirect tests (U-06).
 * Runs in: Node test runner only.
 *
 * Applies the highest-priority matching rule to a main_frame URL, then re-evaluates the
 * redirected URL, the way Chrome re-runs rules on a redirected request. The fragment is not
 * part of the matched URL. regexFilter strings in this extension use only syntax that RE2
 * and JavaScript RegExp read the same way.
 */

/**
 * Apply a DNR queryTransform and optional fragment to a URL.
 * @param {URL} url - URL to modify (copied).
 * @param {object} transform - DNR transform.
 * @returns {string} New URL.
 */
function applyTransform(url, transform) {
  const next = new URL(url.href);
  const qt = transform.queryTransform;
  if (qt) {
    for (const key of qt.removeParams ?? []) next.searchParams.delete(key);
    for (const { key, value } of qt.addOrReplaceParams ?? []) next.searchParams.set(key, value);
  }
  if (transform.fragment !== undefined) next.hash = transform.fragment;
  return next.href;
}

/**
 * Follow redirects for one URL.
 * @param {object[]} rules - Dynamic rules.
 * @param {string} startUrl - Navigation URL.
 * @param {number} [maxHops] - Loop guard.
 * @returns {{ url: string, hops: number, ruleIds: number[], allowedBy: number | null }}
 */
export function simulate(rules, startUrl, maxHops = 5) {
  let url = startUrl;
  const ruleIds = [];
  for (let hops = 0; hops <= maxHops; hops += 1) {
    const u = new URL(url);
    const matchUrl = u.href.replace(/#.*$/, "");
    const matching = rules
      .filter((r) => r.condition.resourceTypes.includes("main_frame") && new RegExp(r.condition.regexFilter).test(matchUrl))
      .sort((a, b) => b.priority - a.priority || a.id - b.id);
    const rule = matching[0];
    if (!rule) return { url, hops, ruleIds, allowedBy: null };
    if (rule.action.type === "allow") return { url, hops, ruleIds, allowedBy: rule.id };
    ruleIds.push(rule.id);
    const r = rule.action.redirect;
    url = r.url ?? applyTransform(u, r.transform);
  }
  return { url, hops: Infinity, ruleIds, allowedBy: null };
}
