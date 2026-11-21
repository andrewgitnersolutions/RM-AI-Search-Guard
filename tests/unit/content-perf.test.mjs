// U-21, U-22 (docs/07 §6.2): BP-09 content-script sweep throttling and metric batching.
import assert from "node:assert/strict";
import { equivalent } from "../helpers/equivalence.mjs";
import { loadContentScript } from "../helpers/content-harness.mjs";

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
