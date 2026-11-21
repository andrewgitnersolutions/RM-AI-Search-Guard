// U-02, U-12a–f, U-13, U-14a–b, U-15 (docs/07 §6.2; U-12 and U-14 are split per behavior)
// plus X-01/X-02/X-03 regression probes of the message router and lifecycle listeners (not in
// docs/07; added for the Phase 0 gate).
import assert from "node:assert/strict";
import { equivalent, plain } from "../helpers/equivalence.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";

const OPTIONS_SENDER = { id: "testextensionid", url: "chrome-extension://testextensionid/ui/options.html" };
const GOOGLE_TAB_SENDER = { id: "testextensionid", url: "https://www.google.com/search?q=x", tab: { id: 7, url: "https://www.google.com/search?q=x" } };
const MANAGED = { gradeBand: "9-12" };

/** Read the stored telemetry object from a harness. */
const telemetry = (sw) => sw.chrome.storage.local.data.rmsg_telemetry ?? null;

equivalent("U-02", "SET_LOCAL_OVERRIDES refused when managed (locked); accepted on unmanaged development/normal installs", async (target) => {
  const managed = loadServiceWorker(target, { managed: { gradeBand: "K-2" } });
  const refused = await managed.send({ type: "SET_LOCAL_OVERRIDES", toggles: { masterEnabled: false } }, OPTIONS_SENDER);
  assert.equal(refused.masterEnabled, true);
  assert.equal(managed.chrome.storage.local.data.rmsg_local_overrides, undefined, "no override written when managed");

  const accepted = {};
  for (const installType of ["development", "normal"]) {
    const unmanaged = loadServiceWorker(target, { installType });
    accepted[installType] = await unmanaged.send({ type: "SET_LOCAL_OVERRIDES", toggles: { masterEnabled: false, gradeBand: "3-5", bogus: 1 } }, OPTIONS_SENDER);
    assert.equal(accepted[installType].masterEnabled, false, `${installType}: override accepted`);
    assert.deepEqual(plain(unmanaged.chrome.storage.local.data.rmsg_local_overrides), { masterEnabled: false, gradeBand: "3-5" });
    assert.deepEqual(plain(unmanaged.dynamicRules), [], "rules removed when master switch is off");
  }
  return { refused, accepted };
});

equivalent("U-02b", "SET_LOCAL_OVERRIDES refused on a force-installed device with no policy (installType admin)", async (target) => {
  const sw = loadServiceWorker(target, { installType: "admin" });
  const res = await sw.send({ type: "SET_LOCAL_OVERRIDES", toggles: { masterEnabled: false } }, OPTIONS_SENDER);
  assert.equal(res.masterEnabled, true);
  assert.equal(sw.chrome.storage.local.data.rmsg_local_overrides, undefined);
  return res;
}, { bp: "BP-01" });

// U-12 is split per behavior so each one is tracked (and can be fixed) on its own.
const PRIVILEGED = [
  ["U-12a", { type: "SET_LOCAL_OVERRIDES", toggles: { masterEnabled: false } }],
  ["U-12b", { type: "RESET_LOCAL_METRICS" }],
  ["U-12c", { type: "GET_DIAGNOSTIC_SNAPSHOT" }],
];
for (const [id, msg] of PRIVILEGED) {
  equivalent(id, `message gating: ${msg.type} refused from a google.com tab`, async (target) => {
    const sw = loadServiceWorker(target);
    const res = await sw.send(msg, GOOGLE_TAB_SENDER);
    assert.equal(res?.ok, false, `${msg.type} from a google.com tab must be refused`);
    return res;
  }, { bp: "BP-13" });
}

equivalent("U-12d", "message gating: SET_LOCAL_OVERRIDES / RESET_LOCAL_METRICS / GET_DIAGNOSTIC_SNAPSHOT accepted from an extension page", async (target) => {
  const fromPage = {};
  for (const [, msg] of PRIVILEGED) {
    const sw = loadServiceWorker(target);
    fromPage[msg.type] = await sw.send(msg, OPTIONS_SENDER);
    // A listener that never responds resolves undefined, which would slip past the ok check.
    assert.ok(fromPage[msg.type] !== undefined && fromPage[msg.type] !== null, `${msg.type} from an extension page got no response`);
    assert.notEqual(fromPage[msg.type].ok, false, `${msg.type} from an extension page must be accepted`);
  }
  return fromPage;
}, { bp: "BP-13" });

equivalent("U-12e", "message gating: LOG_DIAGNOSTIC with an unknown code → bad_message and no log entry", async (target) => {
  const sw = loadServiceWorker(target);
  const res = await sw.send({ type: "LOG_DIAGNOSTIC", code: "NOPE" }, OPTIONS_SENDER);
  assert.equal(res?.error, "bad_message");
  assert.equal(telemetry(sw)?.diagnosticLog?.length ?? 0, 0, "no log entry for a bad message");
  return res;
}, { bp: "BP-13" });

equivalent("U-12f", "message gating: INCREMENT_METRICS with no deltas → bad_message", async (target) => {
  const sw = loadServiceWorker(target);
  const res = await sw.send({ type: "INCREMENT_METRICS" }, GOOGLE_TAB_SENDER);
  assert.equal(res?.error, "bad_message");
  return res;
}, { bp: "BP-13" });

equivalent("U-13", "policy sent to content scripts has no analyticsEndpointUrl or analyticsSharedToken", async (target) => {
  const sw = loadServiceWorker(target, { managed: MANAGED });
  const policy = await sw.send({ type: "GET_EFFECTIVE_POLICY" }, GOOGLE_TAB_SENDER);
  const keys = Object.keys(policy).sort();
  assert.ok(!("analyticsEndpointUrl" in policy), "endpoint URL leaked to content script");
  assert.ok(!("analyticsSharedToken" in policy), "shared token leaked to content script");
  return keys;
});

// The former Test Flush rate-limit half of U-14 was dropped with analytics (D6; docs/07 §6.2).
// U-14 is split so the unlocked half is checked even while the locked half is a known failure.
equivalent("U-14a", "RESET_LOCAL_METRICS refused when locked (with a reason); counters kept", async (target) => {
  const locked = loadServiceWorker(target, { managed: { gradeBand: "6-8" } });
  await locked.send({ type: "INCREMENT_METRICS", deltas: { overviewsHidden: 2 } }, GOOGLE_TAB_SENDER);
  const refused = await locked.send({ type: "RESET_LOCAL_METRICS" }, OPTIONS_SENDER);
  assert.equal(refused?.ok, false, "reset must be refused when locked");
  assert.equal(typeof refused?.reason, "string", "refusal must give a reason");
  assert.equal(telemetry(locked).lifetimeMetrics.overviewsHidden, 2);
  return refused;
}, { bp: "BP-07" });

equivalent("U-14b", "RESET_LOCAL_METRICS accepted on unlocked development/normal installs and clears counters", async (target) => {
  const accepted = {};
  for (const installType of ["development", "normal"]) {
    const sw = loadServiceWorker(target, { installType });
    await sw.send({ type: "INCREMENT_METRICS", deltas: { overviewsHidden: 1 } }, GOOGLE_TAB_SENDER);
    accepted[installType] = await sw.send({ type: "RESET_LOCAL_METRICS" }, OPTIONS_SENDER);
    assert.equal(telemetry(sw).lifetimeMetrics.overviewsHidden, 0, `${installType}: reset must clear counters`);
  }
  return accepted;
}, { bp: "BP-07" });

equivalent("U-15", "diagnostic log: same code+detail dedupes and counts; 51st distinct entry evicts the oldest", async (target) => {
  const sw = loadServiceWorker(target);
  await sw.send({ type: "LOG_DIAGNOSTIC", code: "ERR_SELECTOR_SYNTAX", detail: "same  detail" });
  await sw.send({ type: "LOG_DIAGNOSTIC", code: "ERR_SELECTOR_SYNTAX", detail: "same detail" });
  let log = telemetry(sw).diagnosticLog;
  assert.equal(log.length, 1);
  assert.equal(log[0].count, 2);
  for (let i = 0; i < 50; i += 1) await sw.send({ type: "LOG_DIAGNOSTIC", code: "ERR_SAFETY_GUARD_TRIPPED", detail: `d${i}` });
  log = telemetry(sw).diagnosticLog;
  assert.equal(log.length, 50);
  assert.ok(!log.some((e) => e.detail === "same detail"), "oldest entry evicted");
  assert.equal(log[log.length - 1].detail, "d49");
  return telemetry(sw);
});

equivalent("X-01", "message router responses and stored state for every message type", async (target) => {
  const sw = loadServiceWorker(target, { managed: { gradeBand: "3-5", hideAiOverviews: "bad" } });
  const out = {};
  out.policy = await sw.send({ type: "GET_EFFECTIVE_POLICY" });
  out.increment = await sw.send({ type: "INCREMENT_METRICS", deltas: { overviewsHidden: 1, aiModeUiHidden: 2.7, auxAiHidden: -3, bogus: 9 } });
  out.redirectOmnibox = await sw.send({ type: "RECORD_REDIRECT", source: "omnibox" });
  out.redirectAimode = await sw.send({ type: "RECORD_REDIRECT", source: "aimode" });
  out.log = await sw.send({ type: "LOG_DIAGNOSTIC", code: "ERR_SAFETY_GUARD_TRIPPED", detail: "div#rso (overview)" });
  out.snapshot = await sw.send({ type: "GET_DIAGNOSTIC_SNAPSHOT" });
  out.unknownType = await sw.send({ type: "NOT_A_TYPE" });
  out.badCode = await sw.send({ type: "LOG_DIAGNOSTIC", code: "NOPE" });
  out.reset = await sw.send({ type: "RESET_LOCAL_METRICS" });
  out.stored = sw.chrome.storage.local.data;
  assert.equal(out.snapshot.telemetry.lifetimeMetrics.aiModeRedirects, 2);
  assert.equal(out.snapshot.telemetry.lifetimeMetrics.omniboxFallbackRedirects, 1);
  assert.equal(out.snapshot.telemetry.lifetimeMetrics.aiModeUiHidden, 2);
  return out;
});

equivalent("X-02", "lifecycle listeners: install, startup, managed change and local-override change sync DNR rules", async (target) => {
  const sw = loadServiceWorker(target, { managed: MANAGED });
  const out = {};
  await sw.fire("onInstalled", { reason: "install" });
  out.afterInstall = { rules: sw.dynamicRules.map((r) => r.id), log: telemetry(sw)?.diagnosticLog ?? [] };
  sw.chrome.storage.managed.data = { masterEnabled: false };
  await sw.fire("onChanged", { masterEnabled: { newValue: false } }, "managed");
  out.afterManagedChange = { rules: sw.dynamicRules.map((r) => r.id) };
  sw.chrome.storage.managed.data = {};
  await sw.fire("onStartup");
  out.afterStartup = { rules: sw.dynamicRules.map((r) => r.id) };
  sw.chrome.storage.local.data.rmsg_local_overrides = { forceWebOnlySearch: false };
  await sw.fire("onChanged", { rmsg_local_overrides: { newValue: {} } }, "local");
  out.afterLocalChange = { rules: sw.dynamicRules.map((r) => r.id), updates: sw.chrome.declarativeNetRequest.updates.length };
  assert.deepEqual(out.afterManagedChange.rules, []);
  assert.deepEqual(out.afterLocalChange.rules, [101, 102, 110, 111]);
  return out;
});

equivalent("X-03", "storage failures are logged as ERR_STORAGE_FAILURE and policy still resolves (unmanaged)", async (target) => {
  const sw = loadServiceWorker(target, { managedError: "managed storage exploded" });
  const policy = await sw.send({ type: "GET_EFFECTIVE_POLICY" });
  assert.equal(policy.masterEnabled, true);
  const log = telemetry(sw).diagnosticLog.map((e) => [e.code, e.detail]);
  assert.deepEqual(log, [["ERR_STORAGE_FAILURE", "managed read: managed storage exploded"]]);
  return { policy, log };
});
