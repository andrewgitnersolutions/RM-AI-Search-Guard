// U-05, U-06, U-07 (docs/07 §6.2): DNR rule building and redirect simulation, plus X-04, a
// self-check of the simulator's matching rules (not in docs/07; it tests the harness, not a build).
import assert from "node:assert/strict";
import { test } from "node:test";
import { simulate } from "../helpers/dnr-sim.mjs";
import { loadContentScript } from "../helpers/content-harness.mjs";
import { equivalent, plain } from "../helpers/equivalence.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";

const BASE = { masterEnabled: true, hideAiOverviews: true, hideAiModeUi: true, hideAuxiliaryAiFeatures: true };

/** Build rules for a toggle combination inside the worker realm. */
function rulesFor(sw, block, force, master = true) {
  return plain(sw.ctx.buildDynamicRules({ ...BASE, masterEnabled: master, blockAiModeNavigation: block, forceWebOnlySearch: force }));
}

equivalent("U-05", "DNR rules for blockAiModeNavigation × forceWebOnlySearch; masterEnabled:false → []", (target) => {
  const sw = loadServiceWorker(target);
  const ids = (rules) => rules.map((r) => r.id);
  const out = {
    both: rulesFor(sw, true, true),
    blockOnly: rulesFor(sw, true, false),
    forceOnly: rulesFor(sw, false, true),
    neither: rulesFor(sw, false, false),
    masterOff: rulesFor(sw, true, true, false),
  };
  assert.deepEqual(ids(out.both), [101, 102, 110, 111, 112, 120, 130]);
  assert.deepEqual(ids(out.blockOnly), [101, 102, 110, 111, 112]);
  assert.deepEqual(ids(out.forceOnly), [120, 130]);
  assert.deepEqual(ids(out.neither), []);
  assert.deepEqual(out.masterOff, []);
  for (const r of out.both) assert.deepEqual(r.condition.resourceTypes, ["main_frame"]);
  return out;
});

const URLS = [
  "https://www.google.com/search?q=x&udm=50",
  "https://google.com/search?q=x&udm=50&aep=1",
  "https://www.google.com/search?q=x&sourceid=chrome&udm=50",
  "https://www.google.com/search?udm=50&q=x&sourceid=chrome",
  "https://www.google.com/ai",
  "https://www.google.com/aimode?q=x",
  "https://www.google.com/search?q=x",
  "https://www.google.com/search?q=x&udm=2",
  "https://www.google.com/search?q=x&tbm=nws",
  "https://www.google.com/search?q=x&udm=14",
];

equivalent("U-06", "redirect simulation: AI Mode → Web/clean results, omnibox marker, /ai → /, /aimode?q= keeps the search (BP-19), other tabs untouched, ≤2 hops", (target) => {
  const sw = loadServiceWorker(target);
  const out = {};
  for (const [label, force] of [["force", true], ["noForce", false]]) {
    const rules = rulesFor(sw, true, force);
    out[label] = Object.fromEntries(URLS.map((u) => [u, simulate(rules, u)]));
  }
  const f = out.force;
  assert.match(f[URLS[0]].url, /[?&]udm=14(&|#|$)/);
  assert.ok(f[URLS[2]].url.endsWith("#rm_sg_omnibox"));
  assert.ok(f[URLS[3]].url.endsWith("#rm_sg_omnibox"));
  assert.equal(f[URLS[4]].url, "https://www.google.com/#rm_sg_aimode");
  assert.equal(f[URLS[5]].url, "https://www.google.com/search?q=x&udm=14#rm_sg_aimode");
  assert.match(f[URLS[6]].url, /[?&]udm=14/);
  assert.equal(f[URLS[7]].url, URLS[7]);
  assert.equal(f[URLS[8]].url, URLS[8]);
  assert.doesNotMatch(out.noForce[URLS[0]].url, /udm=/);
  for (const mode of Object.values(out)) for (const r of Object.values(mode)) assert.ok(r.hops <= 2, `loop or >2 hops: ${JSON.stringify(r)}`);
  return out;
});

equivalent("U-19", "BP-19: /ai and /aimode with a query keep the search on /search (marker, udm cleaned); without one → homepage; ≤2 hops", (target) => {
  const sw = loadServiceWorker(target);
  const cases = {
    "https://www.google.com/aimode?q=fractions": ["https://www.google.com/search?q=fractions&udm=14#rm_sg_aimode", "https://www.google.com/search?q=fractions#rm_sg_aimode"],
    "https://google.com/ai?q=fractions&udm=50&aep=1": ["https://google.com/search?q=fractions&udm=14#rm_sg_aimode", "https://google.com/search?q=fractions#rm_sg_aimode"],
    "https://www.google.com/aimode/session?hl=en&q=photosynthesis": ["https://www.google.com/search?hl=en&q=photosynthesis&udm=14#rm_sg_aimode", "https://www.google.com/search?hl=en&q=photosynthesis#rm_sg_aimode"],
    "https://www.google.com/ai": ["https://www.google.com/#rm_sg_aimode", "https://www.google.com/#rm_sg_aimode"],
    "https://www.google.com/aimode?q=": ["https://www.google.com/#rm_sg_aimode", "https://www.google.com/#rm_sg_aimode"],
    "https://www.google.com/aimode?hl=en": ["https://www.google.com/#rm_sg_aimode", "https://www.google.com/#rm_sg_aimode"],
  };
  const out = {};
  for (const [label, force, idx] of [["force", true, 0], ["noForce", false, 1]]) {
    const rules = rulesFor(sw, true, force);
    out[label] = {};
    for (const [from, expected] of Object.entries(cases)) {
      const r = simulate(rules, from);
      out[label][from] = r;
      assert.equal(r.url, expected[idx], `${label}: ${from}`);
      assert.ok(r.hops <= 2, `${label}: ${from} took ${r.hops} hops`);
    }
  }
  return out;
}, { bp: "BP-19" });

const AI_MODE_RULE_IDS = new Set([101, 102, 110, 111, 112]);
const U07_URLS = [
  ...URLS,
  "https://www.google.com/aimode?q=fractions",
  "https://www.google.com/aimode/session?hl=en&q=photosynthesis",
  "https://www.google.com/aimode?hl=en",
  "https://www.google.com/search?q=x&udm=50#frag",
  "https://example.com/search?q=x&udm=50",
];

// Runs the real content bundle (vm harness) at each URL: the in-page redirect it starts must be
// exactly where DNR would send a full page load, and it must leave non-AI-Mode URLs alone.
equivalent("U-07", "content script (BP-05 JS copy): in-page redirect target equals the DNR simulation for every AI Mode URL; no redirect otherwise", async (target) => {
  const sw = loadServiceWorker(target);
  const out = {};
  for (const [label, force] of [["force", true], ["noForce", false]]) {
    const rules = rulesFor(sw, true, force);
    const policy = { ...BASE, blockAiModeNavigation: true, forceWebOnlySearch: force, isManaged: false };
    out[label] = {};
    for (const u of U07_URLS) {
      const sim = new URL(u).hostname.endsWith("google.com") ? simulate(rules, u) : { ruleIds: [] };
      const expected = AI_MODE_RULE_IDS.has(sim.ruleIds[0]) ? sim.url : null;
      const cs = loadContentScript(target, { href: u });
      await cs.flush();
      cs.policyRequests[0]?.({ ...policy });
      await cs.flush();
      const actual = cs.replaced[0] ?? null;
      out[label][u] = actual;
      assert.equal(actual, expected, `${label}: ${u}`);
      assert.ok(cs.replaced.length <= 1, `${label}: ${u} redirected more than once`);
    }
  }
  // Policy that doesn't block AI Mode: never redirect.
  const off = loadContentScript(target, { href: URLS[0] });
  await off.flush();
  off.policyRequests[0]?.({ ...BASE, blockAiModeNavigation: false, forceWebOnlySearch: true, isManaged: false });
  await off.flush();
  off.fireWindowEvent("popstate");
  assert.deepEqual(off.replaced, [], "redirected although blockAiModeNavigation is off");
  return out;
}, { bp: "BP-05" });

equivalent("U-07b", "content script: popstate and pageshow into an AI Mode URL each start exactly one clean redirect", async (target) => {
  const out = {};
  for (const event of ["popstate", "pageshow"]) {
    const cs = loadContentScript(target, { href: "https://www.google.com/search?q=x&udm=14" });
    await cs.flush();
    cs.policyRequests[0]?.({ ...BASE, blockAiModeNavigation: true, forceWebOnlySearch: true, isManaged: false });
    await cs.flush();
    assert.deepEqual(cs.replaced, [], `${event}: redirected a normal search`);
    cs.setHref("https://www.google.com/search?q=x&udm=50");
    cs.fireWindowEvent(event);
    cs.fireWindowEvent(event);
    out[event] = [...cs.replaced];
    assert.deepEqual(out[event], ["https://www.google.com/search?q=x&udm=14#rm_sg_aimode"], `${event}: one clean redirect`);
  }
  return out;
}, { bp: "BP-05" });

test("X-04 DNR simulator: regexFilter is case-insensitive by default; isUrlFilterCaseSensitive:true is honored", () => {
  const rule = (extra) => [{
    id: 1,
    priority: 1,
    action: { type: "redirect", redirect: { url: "https://www.google.com/" } },
    condition: { regexFilter: "^https://www\\.google\\.com/aimode", resourceTypes: ["main_frame"], ...extra },
  }];
  const upper = "https://www.google.com/AIMODE?q=x";
  assert.deepEqual(simulate(rule({}), upper).ruleIds, [1], "default: case-insensitive, like Chrome");
  assert.deepEqual(simulate(rule({ isUrlFilterCaseSensitive: false }), upper).ruleIds, [1]);
  assert.deepEqual(simulate(rule({ isUrlFilterCaseSensitive: true }), upper).ruleIds, [], "explicit true: case-sensitive");
  assert.deepEqual(simulate(rule({ isUrlFilterCaseSensitive: true }), "https://www.google.com/aimode?q=x").ruleIds, [1]);
});
