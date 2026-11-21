// U-17, U-18, U-20 (docs/07 §6.2): BP-17 ordering. Overlapping async policy work must end with
// the newest state, whatever order the awaits finish in.
import assert from "node:assert/strict";
import { equivalent, plain } from "../helpers/equivalence.mjs";
import { loadContentScript } from "../helpers/content-harness.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";

const OPTIONS_SENDER = { id: "testextensionid", url: "chrome-extension://testextensionid/ui/options.html" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

equivalent("U-17", "two overlapping policy syncs, the older resolving last → the newer policy's DNR rules are installed", async (target) => {
  // The first managed read (onStartup) sees the old disabled policy and is slow.
  const sw = loadServiceWorker(target, { managed: { masterEnabled: false }, managedGetDelays: [60] });
  const older = sw.fire("onStartup");
  await sleep(5);
  sw.chrome.storage.managed.data = { masterEnabled: true, gradeBand: "K-2" };
  const newer = sw.fire("onChanged", { masterEnabled: { newValue: true } }, "managed");
  await Promise.all([older, newer]);
  const ids = sw.dynamicRules.map((r) => r.id);
  assert.deepEqual(ids, [101, 102, 110, 111, 120, 130], "stale disabled sync removed the newer policy's rules");
  return ids;
}, { bp: "BP-17" });

equivalent("U-18", "two concurrent SET_LOCAL_OVERRIDES with different toggles → both edits stored", async (target) => {
  const sw = loadServiceWorker(target, { installType: "development" });
  await Promise.all([
    sw.send({ type: "SET_LOCAL_OVERRIDES", toggles: { hideAiOverviews: false } }, OPTIONS_SENDER),
    sw.send({ type: "SET_LOCAL_OVERRIDES", toggles: { hideAiModeUi: false } }, OPTIONS_SENDER),
  ]);
  const stored = plain(sw.chrome.storage.local.data.rmsg_local_overrides);
  assert.deepEqual(stored, { hideAiOverviews: false, hideAiModeUi: false }, "one toggle edit was lost");
  return stored;
}, { bp: "BP-17" });

equivalent("U-20", "content script: an older policy load finishing after a newer one is dropped (tab stays protected)", async (target) => {
  const cs = loadContentScript(target);
  await cs.flush();
  // Load 1 (bootstrap) is pending; a storage change starts load 2.
  cs.fireStorageChange();
  await cs.flush();
  assert.equal(cs.policyRequests.length, 2, "expected two overlapping policy loads");
  const enabled = { masterEnabled: true, hideAiOverviews: true, hideAiModeUi: true, hideAuxiliaryAiFeatures: true, blockAiModeNavigation: true, forceWebOnlySearch: true, isManaged: false };
  cs.policyRequests[1]({ ...enabled });
  await cs.flush();
  cs.policyRequests[0]({ ...enabled, masterEnabled: false });
  await cs.flush();
  const attrs = Object.fromEntries(cs.attrs);
  assert.deepEqual(attrs, { "data-rmsg-hide-overviews": "1", "data-rmsg-hide-aimode": "1", "data-rmsg-hide-aux": "1" }, "stale disabled load unprotected the tab");
  return attrs;
}, { bp: "BP-17" });
