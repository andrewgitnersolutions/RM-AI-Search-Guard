// U-21, U-22, U-23, U-23b (docs/07 §6.2): BP-09 content-script sweep throttling, metric batching, and reset epoch gating.
import assert from "node:assert/strict";
import { equivalent } from "../helpers/equivalence.mjs";
import { loadContentScript } from "../helpers/content-harness.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";

const ENABLED_POLICY = {
  masterEnabled: true,
  hideAiOverviews: true,
  hideAiModeUi: true,
  blockAiModeNavigation: true,
  forceWebOnlySearch: true,
  hideAuxiliaryAiFeatures: true,
  gradeBand: "K-2",
  isManaged: false,
};

const DISABLED_POLICY = { ...ENABLED_POLICY, masterEnabled: false };

/** Create a minimal DOM Element stub supporting dom-engine attribute, style and guard checks. */
function makeStubEl({ tagName = "DIV", id = "", category = null, matchSelector }) {
  const attrs = new Map();
  const styles = new Map();
  const el = {
    tagName,
    id,
    isConnected: true,
    parentElement: null,
    ownerDocument: null,
    textContent: "",
    children: [],
    style: {
      getPropertyValue: (k) => styles.get(k)?.value ?? "",
      getPropertyPriority: (k) => styles.get(k)?.priority ?? "",
      setProperty: (k, v, p = "") => styles.set(k, { value: v, priority: p }),
      removeProperty: (k) => styles.delete(k),
    },
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    matches: (sel) => matchSelector(sel),
    closest: () => null,
    contains: (other) => other === el,
    querySelector: () => null,
    querySelectorAll: () => [],
    compareDocumentPosition: () => 0,
    __category: category,
  };
  return el;
}

equivalent("U-21", "content script throttles burst mutations to >=150 ms, keeps first/idle sweep on rAF, and cancels timers when disabled", async (target) => {
  let sweepCount = 0;
  const cs = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel === '[data-rmsg-hidden="overview"]') sweepCount += 1;
      return [];
    },
  });

  await cs.flush();
  cs.policyRequests[0]({ ...ENABLED_POLICY });
  await cs.flush();
  // First sweep after policy arrives is queued immediately on rAF.
  assert.equal(cs.pendingRafCount(), 1);
  cs.flushRaf();
  assert.equal(sweepCount, 1);

  // 10 burst mutations across 50 ms must coalesce into a single trailing 150 ms timer.
  cs.advanceTime(10);
  for (let i = 0; i < 10; i += 1) {
    cs.triggerMutation();
    if (i < 9) cs.advanceTime(5);
  }
  assert.equal(sweepCount, 1, "burst mutations must not re-sweep before cooldown");
  assert.equal(cs.pendingRafCount(), 0);
  assert.equal(cs.pendingTimers(), 1);

  // At t=149 ms since first sweep, cooldown has 1 ms remaining.
  cs.advanceTime(149 - 55);
  assert.equal(sweepCount, 1);
  assert.equal(cs.pendingRafCount(), 0);

  // At t=150 ms the trailing timer queues one rAF sweep.
  cs.advanceTime(1);
  assert.equal(cs.pendingRafCount(), 1);
  cs.flushRaf();
  assert.equal(sweepCount, 2);

  // After >150 ms idle, a new mutation runs on the very next rAF with no throttle delay.
  cs.advanceTime(200);
  cs.triggerMutation();
  assert.equal(cs.pendingRafCount(), 1);
  assert.equal(cs.pendingTimers(), 0);
  cs.flushRaf();
  assert.equal(sweepCount, 3);

  // Turning masterEnabled off cancels any pending cooldown timer and does not sweep again.
  cs.advanceTime(20);
  cs.triggerMutation();
  assert.equal(cs.pendingTimers(), 1);
  cs.fireStorageChange();
  await cs.flush();
  cs.policyRequests[1]({ ...DISABLED_POLICY });
  await cs.flush();
  assert.equal(cs.pendingTimers(), 0);
  assert.equal(cs.pendingRafCount(), 0);
  cs.advanceTime(500);
  cs.flushRaf();
  assert.equal(sweepCount, 3);

  // Stripping data-rmsg-hide-overviews from <html> self-heals via attribute observer notifications without looping.
  const csHeal = loadContentScript(target, {
    fakeTimers: true,
    notifyRootAttributes: true,
    body: { tagName: "BODY" },
    querySelectorAll: () => [],
  });
  await csHeal.flush();
  csHeal.policyRequests[0]({ ...ENABLED_POLICY });
  await csHeal.flush();
  csHeal.flushRaf();
  await csHeal.flush();
  assert.equal(csHeal.rootAttrDeliveries(), 0, "idempotent bootstrap/sweep must not emit root attribute writes");

  csHeal.advanceTime(200);
  csHeal.removeRootAttr("data-rmsg-hide-overviews");
  await csHeal.flush();
  assert.equal(csHeal.attrs.get("data-rmsg-hide-overviews"), "1", "stripped root attribute must self-heal via rootObserver");
  assert.equal(csHeal.rootAttrDeliveries(), 2, "only removal + single restoration should trigger rootObserver");
  assert.equal(csHeal.pendingTimers(), 0);
  assert.equal(csHeal.pendingRafCount(), 1);

  csHeal.flushRaf();
  await csHeal.flush();
  assert.equal(csHeal.rootAttrDeliveries(), 2, "trailing sweep must not emit extra root attribute writes");
  assert.equal(csHeal.pendingTimers(), 0);
  assert.equal(csHeal.pendingRafCount(), 0);

  return { sweepCount };
}, { bp: "BP-09" });

equivalent("U-22", "content script batches metric deltas across sweeps, flushes once on hidden/pagehide, and flushes on the 10 s timer", async (target) => {
  const ovEl = makeStubEl({
    id: "ov-1",
    category: "overview",
    matchSelector: (sel) => sel.includes('data-attrid="AIOverview"'),
  });
  const aiEl = makeStubEl({
    tagName: "BUTTON",
    id: "ai-1",
    category: "aimode",
    matchSelector: (sel) => sel.includes("plR5qb"),
  });
  const auxEl = makeStubEl({
    tagName: "A",
    id: "aux-1",
    category: "aux",
    matchSelector: (sel) => sel.includes("labs.google.com"),
  });
  const elements = [ovEl, auxEl];

  const cs = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel.includes("data-rmsg-hidden=")) {
        const m = sel.match(/data-rmsg-hidden="([^"]+)"/);
        const cat = m?.[1];
        return elements.filter((e) => e.getAttribute("data-rmsg-hidden") === cat);
      }
      return elements.filter((e) => e.matches(sel));
    },
  });

  await cs.flush();
  cs.policyRequests[0]({ ...ENABLED_POLICY });
  await cs.flush();
  cs.flushRaf();

  const metricsMsgs = () => cs.messages.filter((m) => m.type === "INCREMENT_METRICS");
  assert.equal(metricsMsgs().length, 0, "deltas must be batched instead of sent right after sweep 1");

  // Add an AI Mode element and sweep again after the 150 ms cooldown.
  elements.push(aiEl);
  cs.advanceTime(200);
  cs.triggerMutation();
  cs.flushRaf();
  assert.equal(metricsMsgs().length, 0, "deltas must keep accumulating until flush");

  // visibilitychange while still visible must not flush.
  cs.setVisibilityState("visible");
  cs.fireDocumentEvent("visibilitychange");
  assert.equal(metricsMsgs().length, 0);

  // Transitioning to hidden flushes accumulated deltas once; a subsequent pagehide must not double-send.
  cs.setVisibilityState("hidden");
  cs.fireDocumentEvent("visibilitychange");
  cs.fireWindowEvent("pagehide");
  assert.equal(metricsMsgs().length, 1);
  assert.deepEqual(metricsMsgs()[0].deltas, {
    overviewsHidden: 1,
    auxAiHidden: 1,
    aiModeUiHidden: 1,
  });

  // Separate check for the 10,000 ms fallback timer while the tab stays visible.
  const ovOnly = makeStubEl({
    id: "ov-2",
    category: "overview",
    matchSelector: (sel) => sel.includes('data-attrid="AIOverview"'),
  });
  const csTimer = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel.includes("data-rmsg-hidden=")) return [];
      return ovOnly.matches(sel) ? [ovOnly] : [];
    },
  });
  await csTimer.flush();
  csTimer.policyRequests[0]({ ...ENABLED_POLICY });
  await csTimer.flush();
  csTimer.flushRaf();
  const timerMetrics = () => csTimer.messages.filter((m) => m.type === "INCREMENT_METRICS");
  csTimer.advanceTime(9_999);
  assert.equal(timerMetrics().length, 0, "must not flush before 10 s");
  csTimer.advanceTime(1);
  assert.equal(timerMetrics().length, 1, "must flush at 10 s");
  assert.deepEqual(timerMetrics()[0].deltas, { overviewsHidden: 1 });

  return { flushed: metricsMsgs()[0].deltas, timerFlushed: timerMetrics()[0].deltas };
}, { bp: "BP-09" });

equivalent("U-23", "RESET_LOCAL_METRICS discards pending pre-reset batches in open tabs and drops stale in-flight INCREMENT_METRICS via resetEpoch", async (target) => {
  const ovEl = makeStubEl({
    id: "ov-reset",
    category: "overview",
    matchSelector: (sel) => sel.includes('data-attrid="AIOverview"'),
  });
  let ovActive = true;
  const cs = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel.includes("data-rmsg-hidden=")) return [];
      return ovActive && ovEl.matches(sel) ? [ovEl] : [];
    },
  });

  await cs.flush();
  cs.policyRequests[0]({ ...ENABLED_POLICY });
  await cs.flush();
  cs.flushRaf();
  assert.equal(cs.pendingTimers(), 1, "10 s flush timer should be armed after hiding");

  // Reset happens in another tab before the 10 s timer fires.
  cs.fireMetricsReset(1);
  assert.equal(cs.pendingTimers(), 0, "reset must cancel the pending flush timer");
  cs.advanceTime(15_000);
  cs.fireWindowEvent("pagehide");
  const metricsMsgs = () => cs.messages.filter((m) => m.type === "INCREMENT_METRICS");
  assert.equal(metricsMsgs().length, 0, "pre-reset pending deltas must not flush after reset");

  // A subsequent search on the same tab records under the new resetEpoch.
  ovEl.removeAttribute("data-rmsg-hidden");
  ovActive = true;
  cs.setHref("https://www.google.com/search?q=after-reset&udm=14");
  cs.triggerMutation();
  cs.flushRaf();
  cs.fireWindowEvent("pagehide");
  assert.equal(metricsMsgs().length, 1);
  assert.equal(metricsMsgs()[0].resetEpoch, 1);

  // Service worker rejects stale pre-reset batches and malformed resetEpoch values.
  const OPTIONS_SENDER = { id: "testextensionid", url: "chrome-extension://testextensionid/ui/options.html" };
  const GOOGLE_TAB_SENDER = { id: "testextensionid", url: "https://www.google.com/search?q=x", tab: { id: 7, url: "https://www.google.com/search?q=x" } };
  const sw = loadServiceWorker(target, { installType: "development" });
  await sw.send({ type: "INCREMENT_METRICS", deltas: { overviewsHidden: 2 }, resetEpoch: 0 }, GOOGLE_TAB_SENDER);
  assert.equal(sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden, 2);

  await sw.send({ type: "RESET_LOCAL_METRICS" }, OPTIONS_SENDER);
  assert.equal(sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden, 0);
  assert.equal(sw.chrome.storage.local.data.rmsg_metrics_reset_epoch, 1);

  await sw.send({ type: "INCREMENT_METRICS", deltas: { overviewsHidden: 5 }, resetEpoch: 0 }, GOOGLE_TAB_SENDER);
  assert.equal(sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden, 0, "stale epoch 0 batch must be ignored");

  await sw.send({ type: "INCREMENT_METRICS", deltas: { overviewsHidden: 1 }, resetEpoch: 1 }, GOOGLE_TAB_SENDER);
  assert.equal(sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden, 1, "current epoch 1 batch must apply");

  const badEpoch = await sw.send({ type: "INCREMENT_METRICS", deltas: { overviewsHidden: 1 }, resetEpoch: -1 }, GOOGLE_TAB_SENDER);
  assert.equal(badEpoch?.error, "bad_message");

  return {
    tabPostResetMsg: metricsMsgs()[0],
    swEpoch: sw.chrome.storage.local.data.rmsg_metrics_reset_epoch,
    swOverviews: sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden,
  };
}, { bp: "BP-09" });

equivalent("U-23b", "delayed or failed epoch reads never emit untagged batches, never cache 0, and failed reset leaves stored epoch intact", async (target) => {
  const ovEl = makeStubEl({
    id: "ov-delayed",
    category: "overview",
    matchSelector: (sel) => sel.includes('data-attrid="AIOverview"'),
  });
  const makeQuery = () => (sel) => {
    if (sel.includes("data-rmsg-hidden=")) return [];
    return ovEl.matches(sel) ? [ovEl] : [];
  };

  // 1. Delayed initial epoch read + pagehide: discard unconfirmed batch instead of sending untagged.
  let resolveDelayed1;
  const csUnload = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll: makeQuery(),
    localGet: () => new Promise((resolve) => { resolveDelayed1 = resolve; }),
  });
  await csUnload.flush();
  csUnload.policyRequests[0]({ ...ENABLED_POLICY });
  await csUnload.flush();
  csUnload.flushRaf();
  csUnload.fireWindowEvent("pagehide");
  resolveDelayed1({ rmsg_metrics_reset_epoch: 0 });
  await csUnload.flush();
  assert.equal(csUnload.messages.filter((m) => m.type === "INCREMENT_METRICS").length, 0, "pagehide while epoch unknown must drop batch");

  // 2. Delayed initial epoch read + visibilitychange: waits for confirmed epoch, then sends tagged batch
  //    which the worker drops if a reset occurred meanwhile.
  ovEl.removeAttribute("data-rmsg-hidden");
  let resolveDelayed2;
  const csHidden = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll: makeQuery(),
    localGet: () => new Promise((resolve) => { resolveDelayed2 = resolve; }),
  });
  await csHidden.flush();
  csHidden.policyRequests[0]({ ...ENABLED_POLICY });
  await csHidden.flush();
  csHidden.flushRaf();
  csHidden.setVisibilityState("hidden");
  csHidden.fireDocumentEvent("visibilitychange");
  assert.equal(csHidden.messages.filter((m) => m.type === "INCREMENT_METRICS").length, 0, "must wait for confirmed epoch before sending");
  resolveDelayed2({ rmsg_metrics_reset_epoch: 0 });
  await csHidden.flush();
  const delayedBatches = csHidden.messages.filter((m) => m.type === "INCREMENT_METRICS");
  assert.equal(delayedBatches.length, 1);
  assert.equal(delayedBatches[0].resetEpoch, 0);

  // 3. Failed startup read: does not cache 0; visibilitychange retry reads real epoch 3.
  ovEl.removeAttribute("data-rmsg-hidden");
  let readAttempt = 0;
  const csRetry = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll: makeQuery(),
    localGet: async () => {
      readAttempt += 1;
      if (readAttempt === 1) throw new Error("transient storage error");
      return { rmsg_metrics_reset_epoch: 3 };
    },
  });
  await csRetry.flush();
  csRetry.policyRequests[0]({ ...ENABLED_POLICY });
  await csRetry.flush();
  csRetry.flushRaf();
  csRetry.setVisibilityState("hidden");
  csRetry.fireDocumentEvent("visibilitychange");
  await csRetry.flush();
  const retriedBatches = csRetry.messages.filter((m) => m.type === "INCREMENT_METRICS");
  assert.equal(retriedBatches.length, 1);
  assert.equal(retriedBatches[0].resetEpoch, 3, "retry must recover stored epoch 3 instead of caching 0");

  // 4. Consecutive failed epoch reads re-arm the 10 s fallback timer until a later read succeeds.
  ovEl.removeAttribute("data-rmsg-hidden");
  let timerReadAttempt = 0;
  const csTimerRetry = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll: makeQuery(),
    localGet: async () => {
      timerReadAttempt += 1;
      if (timerReadAttempt <= 2) throw new Error("transient storage error");
      return { rmsg_metrics_reset_epoch: 4 };
    },
  });
  await csTimerRetry.flush();
  csTimerRetry.policyRequests[0]({ ...ENABLED_POLICY });
  await csTimerRetry.flush();
  csTimerRetry.flushRaf();
  assert.equal(csTimerRetry.pendingTimers(), 1, "10 s fallback timer should be armed");
  csTimerRetry.advanceTime(10_000);
  await csTimerRetry.flush();
  assert.equal(csTimerRetry.messages.filter((m) => m.type === "INCREMENT_METRICS").length, 0, "failed retry must not flush");
  assert.equal(csTimerRetry.pendingTimers(), 1, "failed epoch retry must re-arm the 10 s fallback timer");
  csTimerRetry.advanceTime(10_000);
  await csTimerRetry.flush();
  const timerRetriedBatches = csTimerRetry.messages.filter((m) => m.type === "INCREMENT_METRICS");
  assert.equal(timerRetriedBatches.length, 1);
  assert.equal(timerRetriedBatches[0].resetEpoch, 4, "subsequent timer retry must flush with confirmed epoch 4");
  assert.equal(csTimerRetry.pendingTimers(), 0);

  // 5. Failed epoch read during RESET_LOCAL_METRICS leaves epoch 5 intact; retry advances to 6.
  const OPTIONS_SENDER = { id: "testextensionid", url: "chrome-extension://testextensionid/ui/options.html" };
  const GOOGLE_TAB_SENDER = { id: "testextensionid", url: "https://www.google.com/search?q=x", tab: { id: 7, url: "https://www.google.com/search?q=x" } };
  const sw = loadServiceWorker(target, {
    installType: "development",
    local: {
      rmsg_metrics_reset_epoch: 5,
      rmsg_telemetry: {
        lifetimeMetrics: { overviewsHidden: 4, aiModeUiHidden: 0, aiModeRedirects: 0, omniboxFallbackRedirects: 0, auxAiHidden: 0 },
        diagnosticLog: [],
      },
    },
  });
  const realGet = sw.chrome.storage.local.get;
  sw.chrome.storage.local.get = async () => {
    throw new Error("local storage read failed");
  };
  const failedReset = await sw.send({ type: "RESET_LOCAL_METRICS" }, OPTIONS_SENDER);
  assert.equal(failedReset?.ok, false);
  assert.equal(sw.chrome.storage.local.data.rmsg_metrics_reset_epoch, 5, "failed reset must keep stored epoch 5");
  assert.equal(sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden, 4);

  sw.chrome.storage.local.get = realGet;
  await sw.send({ type: "RESET_LOCAL_METRICS" }, OPTIONS_SENDER);
  assert.equal(sw.chrome.storage.local.data.rmsg_metrics_reset_epoch, 6);
  assert.equal(sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden, 0);

  // Stale epoch-0 delayed batch arriving after reset is ignored.
  await sw.send(delayedBatches[0], GOOGLE_TAB_SENDER);
  assert.equal(sw.chrome.storage.local.data.rmsg_telemetry.lifetimeMetrics.overviewsHidden, 0);

  return {
    delayedEpoch: delayedBatches[0].resetEpoch,
    retriedEpoch: retriedBatches[0].resetEpoch,
    timerRetriedEpoch: timerRetriedBatches[0].resetEpoch,
    finalSwEpoch: sw.chrome.storage.local.data.rmsg_metrics_reset_epoch,
  };
}, { bp: "BP-09" });
