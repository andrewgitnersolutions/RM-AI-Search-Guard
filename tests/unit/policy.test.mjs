// U-01, U-03, U-04 (docs/07 §6.2): parsePolicy behavior, run on each target's service worker in node:vm.
import assert from "node:assert/strict";
import { equivalent, plain } from "../helpers/equivalence.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";

const INSTALL_TYPES = ["admin", "development", "normal", "unknown"];
const VALID_MANAGED = { gradeBand: "6-8", forceWebOnlySearch: false };
const PARTLY_INVALID = { gradeBand: "6-8", hideAiOverviews: "true" };

/** Call parsePolicy inside the worker's realm and return plain JSON. */
function parse(sw, managed, local, installType) {
  return plain(sw.ctx.parsePolicy(managed, local, new sw.ctx.Date(), installType));
}

equivalent("U-01a", "admin/unknown install with no managed keys → locked strict defaults (admin-no-policy)", (target) => {
  const sw = loadServiceWorker(target);
  const out = {};
  for (const installType of ["admin", "unknown"]) {
    const { policy } = parse(sw, {}, { masterEnabled: false }, installType);
    out[installType] = { isManaged: policy.isManaged, source: policy.source, masterEnabled: policy.masterEnabled };
    assert.equal(policy.isManaged, true, `${installType}: must lock`);
    assert.equal(policy.source, "admin-no-policy");
    assert.equal(policy.masterEnabled, true);
  }
  return out;
}, { bp: "BP-01" });

equivalent("U-01b", "development/normal install with no managed keys → unlocked; local overrides apply", (target) => {
  const sw = loadServiceWorker(target);
  const out = {};
  for (const installType of ["development", "normal"]) {
    const none = parse(sw, {}, null, installType).policy;
    const withLocal = parse(sw, {}, { masterEnabled: false, gradeBand: "9-12" }, installType).policy;
    assert.equal(none.isManaged, false);
    assert.equal(none.source, "defaults");
    assert.equal(withLocal.source, "local-unmanaged");
    assert.equal(withLocal.masterEnabled, false);
    out[installType] = { none, withLocal };
  }
  return out;
});

equivalent("U-01c", "any valid managed keys → managed for every install type; partly invalid → managed-degraded", (target) => {
  const sw = loadServiceWorker(target);
  const out = {};
  for (const installType of INSTALL_TYPES) {
    const valid = parse(sw, VALID_MANAGED, { masterEnabled: false }, installType);
    const partly = parse(sw, PARTLY_INVALID, null, installType);
    assert.equal(valid.policy.isManaged, true);
    assert.equal(valid.policy.source, "managed");
    assert.equal(valid.policy.masterEnabled, true, "local override must be ignored when managed");
    assert.equal(partly.policy.source, "managed-degraded");
    out[installType] = { valid, partly };
  }
  return out;
});

equivalent("U-03", "invalid managed values fall back fail-closed and are listed in invalidFields", (target) => {
  const sw = loadServiceWorker(target);
  const managed = {
    masterEnabled: "true",
    hideAiOverviews: 0,
    hideAiModeUi: null,
    blockAiModeNavigation: "false",
    forceWebOnlySearch: [],
    hideAuxiliaryAiFeatures: {},
    gradeBand: "13",
    analyticsEnabled: "yes",
    analyticsEndpointUrl: 42,
    analyticsSharedToken: false,
    analyticsFlushIntervalMinutes: 5,
  };
  const { policy, errors } = parse(sw, managed, null);
  for (const key of ["masterEnabled", "hideAiOverviews", "blockAiModeNavigation", "forceWebOnlySearch", "hideAuxiliaryAiFeatures"]) {
    assert.equal(policy[key], true, `${key} must fall back to ON`);
    assert.ok(policy.invalidFields.includes(key), `${key} listed as invalid`);
  }
  assert.equal(policy.gradeBand, "Unassigned");
  assert.ok(policy.invalidFields.includes("gradeBand"));
  assert.ok(policy.invalidFields.includes("analyticsFlushIntervalMinutes"));
  assert.equal(policy.source, "managed-degraded");
  assert.ok(errors.some((e) => e.code === "ERR_POLICY_INVALID"));
  return { policy, errors };
});

equivalent("U-04", "extraHideSelectors: valid string arrays accepted; bad shapes rejected into invalidFields; ignored when unmanaged", (target) => {
  const sw = loadServiceWorker(target);
  const ok = parse(sw, { extraHideSelectors: { overview: ["div.test-ai"], aimode: [], aux: [] } }, null).policy;
  assert.deepEqual(ok.extraHideSelectors?.overview, ["div.test-ai"]);
  const bad = parse(sw, { extraHideSelectors: { overview: "div.x", aux: Array(21).fill("a"), aimode: ["x".repeat(301)] } }, null).policy;
  assert.ok(bad.invalidFields.includes("extraHideSelectors"));
  const unmanaged = parse(sw, {}, { extraHideSelectors: { overview: ["div.x"] } }).policy;
  assert.equal(unmanaged.extraHideSelectors?.overview?.length ?? 0, 0);
  return { ok, bad };
}, { bp: "BP-04" });
