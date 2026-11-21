// U-05, U-06, U-07 (docs/07 §6.2): DNR rule building and redirect simulation.
import assert from "node:assert/strict";
import { simulate } from "../helpers/dnr-sim.mjs";
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
  assert.deepEqual(ids(out.both), [101, 102, 110, 111, 120, 130]);
  assert.deepEqual(ids(out.blockOnly), [101, 102, 110, 111]);
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

equivalent("U-06", "redirect simulation: AI Mode → Web/clean results, omnibox marker, /ai → /, other tabs untouched, ≤2 hops", (target) => {
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
  assert.equal(f[URLS[5]].url, "https://www.google.com/#rm_sg_aimode");
  assert.match(f[URLS[6]].url, /[?&]udm=14/);
  assert.equal(f[URLS[7]].url, URLS[7]);
  assert.equal(f[URLS[8]].url, URLS[8]);
  assert.doesNotMatch(out.noForce[URLS[0]].url, /udm=/);
  for (const mode of Object.values(out)) for (const r of Object.values(mode)) assert.ok(r.hops <= 2, `loop or >2 hops: ${JSON.stringify(r)}`);
  return out;
});

equivalent("U-07", "cleanAiModeUrl() (BP-05 JS copy) matches the DNR simulation for every test URL", (target) => {
  const sw = loadServiceWorker(target);
  assert.equal(typeof sw.ctx.cleanAiModeUrl, "function", "cleanAiModeUrl is not implemented");
  const rules = rulesFor(sw, true, true);
  for (const u of URLS) assert.equal(sw.ctx.cleanAiModeUrl(u, { ...BASE, blockAiModeNavigation: true, forceWebOnlySearch: true }), simulate(rules, u).url);
  return true;
}, { bp: "BP-05" });
