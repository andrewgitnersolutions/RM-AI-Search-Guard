// A-01..A-04: district analytics (schema v1) as shipped in the original dist/. These exist only
// for the Phase 0a equivalence gate ("analytics included") and are deleted with analytics in
// Phase 0b (D6). docs/07 U-08..U-11 describe a v2 redesign that D6 dropped.
import assert from "node:assert/strict";
import { equivalent, plain } from "../helpers/equivalence.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";

const ENDPOINT = "https://script.google.com/macros/s/AKfycbTestDeploymentId123/exec";
const POLICY = { analyticsEnabled: true, analyticsEndpointUrl: ENDPOINT, analyticsSharedToken: "tok", analyticsFlushIntervalMinutes: 240, gradeBand: "6-8" };

/** Seed telemetry with pending buckets for three days and two error codes. */
function seeded() {
  const day = (n) => ({ overviewsHidden: n, aiModeUiHidden: 0, aiModeRedirects: 1, omniboxFallbackRedirects: 0, auxAiHidden: 0 });
  return {
    rmsg_telemetry: {
      lifetimeMetrics: day(6),
      pendingMetricsByDate: { "2026-11-18": day(1), "2026-11-19": day(2), "2026-11-20": day(3) },
      pendingErrorsByCode: { ERR_SELECTOR_SYNTAX: 2, WARN_OMNIBOX_POLICY_MISSING: 1 },
      diagnosticLog: [],
    },
  };
}

equivalent("A-01", "payload builder is allowlisted; assertNoPiiPayload rejects extra keys and PII-shaped fields", (target) => {
  const sw = loadServiceWorker(target);
  const payload = plain(sw.ctx.buildSanitizedPayload({ extensionVersion: "1.0.0", gradeBand: "K-2", dateBucket: "2026-11-20", metrics: { overviewsHidden: 3, email: 5 }, errors: { ERR_SELECTOR_SYNTAX: 1, NOPE: 4 }, token: " t ", url: "https://x" }));
  assert.deepEqual(Object.keys(payload).sort(), ["dateBucket", "errors", "extensionVersion", "gradeBand", "metrics", "schemaVersion", "token"]);
  const ok = sw.ctx.assertNoPiiPayload(sw.ctx.buildSanitizedPayload({ gradeBand: "K-2", dateBucket: "2026-11-20" }));
  const rejects = [
    { ...payload, query: "photosynthesis" },
    { ...payload, metrics: { ...payload.metrics, userEmail: 1 } },
    { ...payload, errors: { ERR_FAKE: 1 } },
    { ...payload, gradeBand: "student@example.org" },
    { ...payload, schemaVersion: 2 },
  ].map((p) => sw.ctx.assertNoPiiPayload(p));
  assert.equal(ok, true);
  assert.deepEqual(rejects, [false, false, false, false, false]);
  return { payload, rejects };
});

equivalent("A-02", "flush with mock fetch: one POST per pending day, text/plain body, sent counts subtracted", async (target) => {
  const bodies = [];
  const sw = loadServiceWorker(target, {
    local: seeded(),
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response('{"status":"ok"}', { status: 200 });
    },
  });
  const result = await sw.ctx.flushAnalyticsIfDue(POLICY);
  const state = sw.chrome.storage.local.data.rmsg_telemetry;
  assert.equal(sw.fetchCalls.length, 3);
  assert.equal(sw.fetchCalls[0].init.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.deepEqual(plain(state.pendingMetricsByDate), {});
  assert.deepEqual(plain(state.pendingErrorsByCode), {});
  return { result, bodies, calls: sw.fetchCalls.map((c) => c.url), state };
});

equivalent("A-03", "flush failures (HTTP 500, non-JSON, status:error, thrown) back off 15m→30m→1h… capped at 24h and log ERR_ANALYTICS_FLUSH_FAILED", async (target) => {
  const responders = [
    async () => new Response("oops", { status: 500 }),
    async () => new Response("not json", { status: 200 }),
    async () => new Response('{"status":"error","code":"UNAUTHORIZED"}', { status: 200 }),
    async () => {
      throw new Error("offline");
    },
  ];
  const out = [];
  for (const responder of responders) {
    const sw = loadServiceWorker(target, { local: seeded(), fetch: responder });
    const result = await sw.ctx.flushAnalyticsIfDue(POLICY, { force: true });
    const state = sw.chrome.storage.local.data.rmsg_telemetry;
    out.push({ result, failures: state.consecutiveFlushFailures, next: state.nextEligibleFlushAtMs, log: state.diagnosticLog.map((e) => e.code) });
    assert.equal(result.errorCode, "ERR_ANALYTICS_FLUSH_FAILED");
    assert.ok(state.diagnosticLog.some((e) => e.code === "ERR_ANALYTICS_FLUSH_FAILED"));
  }
  const sw = loadServiceWorker(target);
  const backoff = [1, 2, 3, 4, 8, 20].map((n) => sw.ctx.calculateBackoffMs(n));
  assert.deepEqual(backoff, [9e5, 18e5, 36e5, 72e5, 864e5, 864e5]);
  return { out, backoff };
});

equivalent("A-04", "alarm: one-shot with 0–30 min jitter when enabled and valid; cleared when disabled or endpoint invalid; disabled flush is local-only", async (target) => {
  const sw = loadServiceWorker(target);
  await sw.ctx.scheduleAnalyticsAlarm(POLICY, () => 0.5);
  const enabled = plain([...sw.alarms.values()]);
  await sw.ctx.scheduleAnalyticsAlarm({ ...POLICY, analyticsEndpointUrl: "https://evil.example/exec" });
  const invalid = plain([...sw.alarms.values()]);
  await sw.ctx.scheduleAnalyticsAlarm(POLICY, () => 0);
  await sw.ctx.scheduleAnalyticsAlarm({ ...POLICY, analyticsEnabled: false });
  const disabled = plain([...sw.alarms.values()]);
  const disabledFlush = await sw.ctx.flushAnalyticsIfDue({ ...POLICY, analyticsEnabled: false });
  assert.deepEqual(enabled, [{ name: "rmsg-analytics-flush", delayInMinutes: 255 }]);
  assert.deepEqual(invalid, []);
  assert.deepEqual(disabled, []);
  assert.equal(sw.fetchCalls.length, 0);
  return { enabled, invalid, disabled, disabledFlush };
});
