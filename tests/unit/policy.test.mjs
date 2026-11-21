// U-01a–d, U-03, U-04 (docs/07 §6.2): parsePolicy behavior, run on each target's service worker in node:vm.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { equivalent, plain } from "../helpers/equivalence.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";

const INSTALL_TYPES = ["admin", "development", "normal", "unknown"];
const VALID_MANAGED = { gradeBand: "6-8", forceWebOnlySearch: false };
const PARTLY_INVALID = { gradeBand: "6-8", hideAiOverviews: "true" };

/** Call parsePolicy inside the worker's realm and return plain JSON. */
function parse(sw, managed, local, installType) {
  return plain(sw.ctx.parsePolicy(managed, local, new sw.ctx.Date(), installType));
}

equivalent("U-01a", "admin/sideload/other/unknown/missing install type with no managed keys → locked strict defaults (admin-no-policy)", (target) => {
  const sw = loadServiceWorker(target);
  const out = {};
  for (const installType of ["admin", "sideload", "other", "unknown", undefined]) {
    const { policy } = parse(sw, {}, { masterEnabled: false }, installType);
    out[String(installType)] = { isManaged: policy.isManaged, source: policy.source, masterEnabled: policy.masterEnabled };
    assert.equal(policy.isManaged, true, `${installType}: must lock`);
    assert.equal(policy.source, "admin-no-policy");
    assert.equal(policy.masterEnabled, true);
  }
  return out;
}, { bp: "BP-01" });

equivalent("U-01d", "service worker: install type unreadable (getSelf throws or is missing) → GET_EFFECTIVE_POLICY is locked", async (target) => {
  const out = {};
  for (const [label, opts] of [["throws", { installTypeError: "management unavailable" }], ["missing", { noManagement: true }]]) {
    const sw = loadServiceWorker(target, opts);
    const policy = await sw.send({ type: "GET_EFFECTIVE_POLICY" });
    assert.equal(policy.isManaged, true, `${label}: must lock`);
    assert.equal(policy.source, "admin-no-policy");
    out[label] = { isManaged: policy.isManaged, source: policy.source };
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
  };
  const { policy, errors } = parse(sw, managed, null);
  for (const key of ["masterEnabled", "hideAiOverviews", "blockAiModeNavigation", "forceWebOnlySearch", "hideAuxiliaryAiFeatures"]) {
    assert.equal(policy[key], true, `${key} must fall back to ON`);
    assert.ok(policy.invalidFields.includes(key), `${key} listed as invalid`);
  }
  assert.equal(policy.gradeBand, "Unassigned");
  assert.ok(policy.invalidFields.includes("gradeBand"));
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

equivalent("U-04b", "extraHideSelectors: partial objects, unknown keys, bounds (20 items / 300 chars), local override isolation, and generator JSON formatting", async (target) => {
  const sw = loadServiceWorker(target);
  const partial = parse(sw, { extraHideSelectors: { overview: ["  div.a  "] } }, null);
  assert.deepEqual(partial.policy.extraHideSelectors, { overview: ["div.a"], aimode: [], aux: [] });
  assert.deepEqual(partial.policy.invalidFields, []);
  assert.equal(partial.policy.source, "managed");

  const unknownKey = parse(sw, { extraHideSelectors: { not: "valid", overview: ["div.a"] } }, null);
  assert.ok(unknownKey.policy.invalidFields.includes("extraHideSelectors"));
  assert.equal(unknownKey.policy.source, "managed-degraded");
  assert.deepEqual(unknownKey.policy.extraHideSelectors.overview, ["div.a"]);

  const mixedItems = parse(sw, { extraHideSelectors: { overview: ["div.ok", 123, "   "], aimode: [null] } }, null);
  assert.ok(mixedItems.policy.invalidFields.includes("extraHideSelectors"));
  assert.deepEqual(mixedItems.policy.extraHideSelectors, { overview: ["div.ok"], aimode: [], aux: [] });

  const exact20 = Array.from({ length: 20 }, (_, i) => `div.s${i}`);
  const exact300 = "a".repeat(300);
  const maxOk = parse(sw, { extraHideSelectors: { overview: exact20, aimode: [exact300] } }, null);
  assert.deepEqual(maxOk.policy.invalidFields, []);
  assert.equal(maxOk.policy.extraHideSelectors.overview.length, 20);
  assert.equal(maxOk.policy.extraHideSelectors.aimode[0].length, 300);

  const tooManyOrLong = parse(sw, { extraHideSelectors: { overview: Array(21).fill("div.x"), aimode: ["a".repeat(301)] } }, null);
  assert.ok(tooManyOrLong.policy.invalidFields.includes("extraHideSelectors"));
  assert.deepEqual(tooManyOrLong.policy.extraHideSelectors, { overview: [], aimode: [], aux: [] });

  for (const installType of ["development", "normal", "admin"]) {
    const localIgnored = parse(sw, {}, { masterEnabled: false, extraHideSelectors: { overview: ["div.sneaky"] } }, installType).policy;
    assert.deepEqual(localIgnored.extraHideSelectors, { overview: [], aimode: [], aux: [] });
  }

  const optionsMod = await import(pathToFileURL(path.join(target.dir, "ui/options.js")).href);
  const baseDraft = {
    gradeBand: "K-2",
    masterEnabled: true,
    hideAiOverviews: true,
    hideAiModeUi: true,
    blockAiModeNavigation: true,
    forceWebOnlySearch: true,
    hideAuxiliaryAiFeatures: true,
  };
  const emptyJson = optionsMod.formatAdminConsolePolicyJson({ ...baseDraft, extraHideSelectors: { overview: ["  "], aimode: [], aux: [] } });
  assert.equal("extraHideSelectors" in emptyJson, false);

  const filledJson = optionsMod.formatAdminConsolePolicyJson({ ...baseDraft, extraHideSelectors: { overview: [" div.test-ai "], aimode: [], aux: [] } });
  assert.deepEqual(filledJson.extraHideSelectors, { Value: { overview: ["div.test-ai"] } });

  const nbspPolicy = parse(sw, { extraHideSelectors: { overview: [" \t.ai\u00a0\r\f ", " \t div.a \f\r\n", "\u00a0"] } }, null);
  assert.deepEqual(nbspPolicy.policy.invalidFields, []);
  assert.deepEqual(nbspPolicy.policy.extraHideSelectors.overview, [".ai\u00a0", "div.a", "\u00a0"]);
  const cssWsOnly = parse(sw, { extraHideSelectors: { overview: [" \t\f\r\n "] } }, null);
  assert.ok(cssWsOnly.policy.invalidFields.includes("extraHideSelectors"));
  assert.deepEqual(cssWsOnly.policy.extraHideSelectors.overview, []);

  const nbspJson = optionsMod.formatAdminConsolePolicyJson({
    ...baseDraft,
    extraHideSelectors: { overview: [" \t.ai\u00a0\r\f ", " \t\f "], aimode: ["\t div.b \n"], aux: [] },
  });
  assert.deepEqual(nbspJson.extraHideSelectors, { Value: { overview: [".ai\u00a0"], aimode: ["div.b"] } });
  const parsedInput = optionsMod.parseExtraSelectorsInput(" \t.ai\u00a0\r\f \n \t\f \n  div.ok \r\n");
  assert.equal(parsedInput.error, null);
  assert.deepEqual(parsedInput.selectors, [".ai\u00a0", "div.ok"]);

  return { partial: partial.policy.extraHideSelectors, emptyKeys: Object.keys(emptyJson), filledExtra: filledJson.extraHideSelectors, nbspSelectors: nbspPolicy.policy.extraHideSelectors.overview };
}, { bp: "BP-04" });
