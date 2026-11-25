// U-24, U-25 (docs/07 §6.2): BP-03 UI language detection & daily dedupe, and BP-04
// extraHideSelectors + visible-AI leak detection.
import assert from "node:assert/strict";
import { equivalent, plain } from "../helpers/equivalence.mjs";
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
  extraHideSelectors: { overview: [], aimode: [], aux: [] },
};

/** Build a minimal DOM Element stub supporting dom-engine hiding, guard and leak checks. */
function makeStubEl({
  tagName = "DIV",
  id = "",
  textContent = "",
  attrs: initialAttrs = {},
  matchSelector = () => false,
  containsFn = null,
}) {
  const attrs = new Map(Object.entries(initialAttrs));
  const styles = new Map();
  const el = {
    tagName,
    id,
    isConnected: true,
    parentElement: null,
    ownerDocument: null,
    textContent,
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
    contains: (other) => (containsFn ? containsFn(other, el) : other === el),
    querySelector: () => null,
    querySelectorAll: () => [],
    compareDocumentPosition: () => 0,
  };
  return el;
}

equivalent("U-24", "WARN_UNSUPPORTED_UI_LANGUAGE ignores en/es variants and blank lang, and logs unsupported languages once per language per UTC day", async (target) => {
  const startNow = Date.parse("2026-11-21T23:59:50.000Z");
  const cs = loadContentScript(target, {
    fakeTimers: true,
    startNow,
    lang: "en-US",
    body: { tagName: "BODY" },
  });
  await cs.flush();
  cs.policyRequests[0]({ ...ENABLED_POLICY });
  await cs.flush();
  cs.flushRaf();

  const langLogs = () => cs.messages.filter((m) => m.type === "LOG_DIAGNOSTIC" && m.code === "WARN_UNSUPPORTED_UI_LANGUAGE");

  for (const supportedLang of ["en", "en-US", "es", "es-419", "es-US", ""]) {
    cs.setLang(supportedLang);
    cs.advanceTime(200);
    cs.triggerMutation();
    cs.flushRaf();
  }
  assert.equal(langLogs().length, 0, "supported or blank languages must not emit warnings");

  // French (fr, then fr-CA on the same UTC date) must emit only once with detail "fr".
  cs.setLang("fr");
  cs.advanceTime(200);
  cs.triggerMutation();
  cs.flushRaf();
  cs.setLang("fr-CA");
  cs.advanceTime(200);
  cs.triggerMutation();
  cs.flushRaf();
  assert.equal(langLogs().length, 1);
  assert.equal(langLogs()[0].detail, "fr");

  // Crossing UTC midnight allows logging again for the new date bucket.
  cs.advanceTime(20_000);
  cs.triggerMutation();
  cs.flushRaf();
  assert.equal(langLogs().length, 2);

  // Service worker enforces once-per-language-per-UTC-day across tabs/restarts.
  const sw = loadServiceWorker(target, { installType: "development" });
  const day1 = new sw.ctx.Date("2026-11-21T10:00:00.000Z");
  const day2 = new sw.ctx.Date("2026-11-22T10:00:00.000Z");
  const day3 = new sw.ctx.Date("2026-11-23T10:00:00.000Z");
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day1);
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day1);
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "de", day1);
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day2);

  const log = plain(sw.chrome.storage.local.data.rmsg_telemetry.diagnosticLog);
  const frEntry = log.find((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "fr");
  const deEntry = log.find((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "de");
  assert.equal(frEntry.count, 2, "two UTC days should yield count 2, ignoring same-day duplicate");
  assert.equal(deEntry.count, 1);
  const swCounts = { fr: frEntry.count, de: deEntry.count };

  // Evicting "fr" from the 50-entry diagnosticLog on day2 must NOT allow re-logging "fr" on day2.
  for (let i = 0; i < 50; i += 1) {
    await sw.ctx.recordDiagnosticEntry("ERR_SELECTOR_SYNTAX", `sel-${i}`, day2);
  }
  assert.equal(
    sw.chrome.storage.local.data.rmsg_telemetry.diagnosticLog.some((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "fr"),
    false,
    "setup: 50 distinct entries should evict fr from diagnosticLog",
  );
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day2);
  assert.equal(
    sw.chrome.storage.local.data.rmsg_telemetry.diagnosticLog.some((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "fr"),
    false,
    "evicted fr must stay suppressed for the remainder of day2",
  );

  // Advancing to day3 allows logging again.
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day3);
  const day3Entry = plain(sw.chrome.storage.local.data.rmsg_telemetry.diagnosticLog).find((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "fr");
  assert.equal(day3Entry.count, 1);
  assert.equal(day3Entry.lastSeenDate, "2026-11-23");

  // Intentional reset clears independent language suppression so day3 can log again.
  await sw.ctx.resetLocalTelemetry();
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day3);
  const postResetEntry = plain(sw.chrome.storage.local.data.rmsg_telemetry.diagnosticLog).find((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "fr");
  assert.equal(postResetEntry.count, 1);

  return { tabWarnings: langLogs(), swCounts, postResetCount: postResetEntry.count };
}, { bp: "BP-03" });

equivalent("U-25", "extraHideSelectors hides valid matches, preserves U+00A0, restores withdrawn selectors preserving display, enforces safety guard, and leak detector reports visible AI labels once per page", async (target) => {
  const validExtra = makeStubEl({
    id: "valid-extra",
    matchSelector: (sel) => sel === "div.valid-extra",
  });
  validExtra.style.setProperty("display", "inline-flex", "important");
  const nbspExtra = makeStubEl({
    id: "nbsp-extra",
    matchSelector: (sel) => sel === ".ai\u00a0",
  });
  const builtInOv = makeStubEl({
    id: "built-in-ov",
    attrs: { "data-attrid": "AIOverview" },
    matchSelector: (sel) => sel.split(",").map((s) => s.trim()).includes('[data-attrid="AIOverview"]'),
  });
  const unsafeExtra = makeStubEl({
    id: "rso",
    matchSelector: (sel) => sel.split(",").map((s) => s.trim()).includes("#rso"),
  });
  const longUnsafeExtra = makeStubEl({
    id: "What_is_photosynthesis_query_slug",
    matchSelector: (sel) => sel.includes(".long-unsafe"),
    containsFn: (other, self) => other === self || other === unsafeExtra,
  });
  const leakedHeading = makeStubEl({
    tagName: "H2",
    id: "leaked-heading",
    textContent: "AI Overview",
    matchSelector: (sel) => sel.includes('role="heading"') || sel.includes("h2"),
  });
  const leakedAiModeBtn = makeStubEl({
    tagName: "BUTTON",
    id: "leaked-aimode-btn",
    textContent: "Modo IA",
    matchSelector: (sel) => sel.includes("button"),
  });
  // Keep leakedHeading/leakedAiModeBtn out of built-in tier matching by only matching leakDetector & specific selectors.
  let activeElements = [validExtra, nbspExtra, builtInOv, unsafeExtra, longUnsafeExtra];
  const cs = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel.includes("[data-rmsg-hidden=")) {
        const m = sel.match(/data-rmsg-hidden="([^"]+)"/);
        const cat = m?.[1];
        return activeElements.filter((e) => e.getAttribute("data-rmsg-hidden") === cat);
      }
      if (sel === "div[invalid!!") {
        throw new SyntaxError("invalid selector");
      }
      if (sel === "#main, #cnt, #rcnt, #center_col, #search, #rso, #botstuff, #top_nav, form[role=\"search\"], #searchform") {
        return [unsafeExtra];
      }
      return activeElements.filter((e) => e.matches(sel));
    },
  });

  await cs.flush();
  cs.policyRequests[0]({
    ...ENABLED_POLICY,
    isManaged: true,
    extraHideSelectors: {
      overview: ["div[invalid!!", "div.valid-extra", " \t.ai\u00a0\r\f ", "#rso", ".long-unsafe"],
      aimode: [],
      aux: [],
    },
  });
  await cs.flush();
  cs.flushRaf();

  assert.equal(validExtra.getAttribute("data-rmsg-hidden"), "overview", "valid extra selector must still match despite earlier invalid one");
  assert.equal(nbspExtra.getAttribute("data-rmsg-hidden"), "overview", "selector trailing U+00A0 must be preserved when matching");
  assert.equal(builtInOv.getAttribute("data-rmsg-hidden"), "overview", "built-in Overview must be hidden");
  assert.equal(unsafeExtra.getAttribute("data-rmsg-hidden"), null, "safety guard must refuse #rso even from extraHideSelectors");
  assert.equal(longUnsafeExtra.getAttribute("data-rmsg-hidden"), null, "safety guard must refuse long-id wrapper");

  const diagCodes = () => cs.messages.filter((m) => m.type === "LOG_DIAGNOSTIC").map((m) => [m.code, m.detail]);
  assert.ok(diagCodes().some(([c]) => c === "ERR_SELECTOR_SYNTAX"), "ERR_SELECTOR_SYNTAX logged");
  assert.ok(diagCodes().some(([c]) => c === "ERR_SAFETY_GUARD_TRIPPED"), "ERR_SAFETY_GUARD_TRIPPED logged");
  assert.ok(!diagCodes().some(([, d]) => String(d).includes("What_is_photosynthesis")), "long DOM id must be omitted from diagnostic detail");

  // Flush the initial batched metric delta so we can verify withdrawing extras emits no duplicate delta.
  cs.advanceTime(11_000);
  const metricMsgsBeforeRollback = cs.messages.filter((m) => m.type === "INCREMENT_METRICS").length;
  assert.equal(metricMsgsBeforeRollback, 1);

  // Removing extraHideSelectors via storage change restores previously hidden extra elements
  // (preserving prior inline display) while built-in selectors stay hidden.
  cs.fireStorageChange();
  await cs.flush();
  cs.policyRequests[1]({
    ...ENABLED_POLICY,
    isManaged: true,
    extraHideSelectors: { overview: [], aimode: [], aux: [] },
  });
  await cs.flush();
  assert.equal(validExtra.getAttribute("data-rmsg-hidden"), null, "withdrawn extra selector element must be restored");
  assert.equal(validExtra.style.getPropertyValue("display"), "inline-flex", "restored element preserves prior inline display");
  assert.equal(validExtra.style.getPropertyPriority("display"), "important", "restored element preserves display priority");
  assert.equal(nbspExtra.getAttribute("data-rmsg-hidden"), null, "withdrawn U+00A0 selector element must be restored");
  assert.equal(builtInOv.getAttribute("data-rmsg-hidden"), "overview", "built-in Overview stays hidden after rollback sweep");
  cs.advanceTime(11_000);
  assert.equal(
    cs.messages.filter((m) => m.type === "INCREMENT_METRICS").length,
    metricMsgsBeforeRollback,
    "re-hiding built-in Overview on the same page must not double-count overviewsHidden",
  );

  // Leak detector: visible Spanish AI Overview heading + AI Mode button under lang="es-419".
  // Make normal heading collection skip it (simulate Google structural change) by matching only leakDetector's combined string.
  const leakOnlyHeading = makeStubEl({
    tagName: "H2",
    id: "leak-only-h2",
    textContent: "Visión general creada por IA",
    matchSelector: (sel) => sel === 'h1, h2, [role="heading"], [role="tab"], button',
  });
  const leakOnlyBtn = makeStubEl({
    tagName: "BUTTON",
    id: "leak-only-btn",
    textContent: "Modo IA",
    matchSelector: (sel) => sel === 'h1, h2, [role="heading"], [role="tab"], button',
  });
  activeElements = [leakOnlyHeading, leakOnlyBtn];
  cs.setLang("es-419");
  cs.advanceTime(200);
  cs.triggerMutation();
  cs.flushRaf();

  const leakLogs = cs.messages.filter((m) => m.type === "LOG_DIAGNOSTIC" && m.code === "WARN_AI_SURFACE_VISIBLE");
  assert.deepEqual(
    leakLogs.map((l) => l.detail).sort(),
    ["aimode", "overview"],
    "leak detector must emit category-only WARN_AI_SURFACE_VISIBLE for leaked Spanish surfaces",
  );

  // Repeating sweep on the same page must not duplicate WARN_AI_SURFACE_VISIBLE.
  cs.advanceTime(200);
  cs.triggerMutation();
  cs.flushRaf();
  assert.equal(cs.messages.filter((m) => m.type === "LOG_DIAGNOSTIC" && m.code === "WARN_AI_SURFACE_VISIBLE").length, 2);

  // When hideAiOverviews and hideAiModeUi are disabled, no leak warnings are emitted.
  const csAllowed = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel.includes("[data-rmsg-hidden=")) return [];
      return [leakedHeading, leakedAiModeBtn].filter((e) => e.matches(sel));
    },
  });
  await csAllowed.flush();
  csAllowed.policyRequests[0]({
    ...ENABLED_POLICY,
    hideAiOverviews: false,
    hideAiModeUi: false,
  });
  await csAllowed.flush();
  csAllowed.flushRaf();
  assert.equal(csAllowed.messages.filter((m) => m.type === "LOG_DIAGNOSTIC" && m.code === "WARN_AI_SURFACE_VISIBLE").length, 0);

  // Stale data-rmsg-hidden="overview" ancestor when hideAiOverviews=false must not blind hideAiModeUi=true.
  const staleOvParent = makeStubEl({ id: "stale-ov", attrs: { "data-rmsg-hidden": "overview" }, matchSelector: () => false });
  const innerAiBtn = makeStubEl({
    tagName: "BUTTON",
    id: "inner-ai-btn",
    textContent: "AI Mode",
    matchSelector: (sel) => sel.includes("plR5qb"),
  });
  innerAiBtn.parentElement = { closest: (sel) => (sel.includes('"overview"') ? staleOvParent : null) };
  const csStale = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel.includes("data-rmsg-hidden=")) return [];
      return innerAiBtn.matches(sel) ? [innerAiBtn] : [];
    },
  });
  await csStale.flush();
  csStale.policyRequests[0]({ ...ENABLED_POLICY, hideAiOverviews: false, hideAiModeUi: true });
  await csStale.flush();
  csStale.flushRaf();
  assert.equal(innerAiBtn.getAttribute("data-rmsg-hidden"), "aimode", "disabled-category overview marker must not blind active aimode hiding");

  // Disabling masterEnabled must restore extension-owned elements even if data-rmsg-hidden was
  // rewritten to an unrecognized value, while leaving unowned page-marked elements untouched.
  const ownedMutable = makeStubEl({
    id: "owned-mutable",
    attrs: { "data-attrid": "AIOverview" },
    matchSelector: (sel) => sel.includes('data-attrid="AIOverview"'),
  });
  ownedMutable.style.setProperty("display", "flex", "");
  const unownedPageMarked = makeStubEl({
    id: "unowned-page-marked",
    attrs: { "data-rmsg-hidden": "stale" },
    matchSelector: () => false,
  });
  unownedPageMarked.style.setProperty("display", "block", "");
  const csOwned = loadContentScript(target, {
    fakeTimers: true,
    body: { tagName: "BODY" },
    querySelectorAll(sel) {
      if (sel.includes("data-rmsg-hidden=")) {
        return [ownedMutable, unownedPageMarked].filter((e) => {
          if (!e.isConnected) return false;
          const val = e.getAttribute("data-rmsg-hidden");
          return val !== null && sel.includes(`"${val}"`);
        });
      }
      return ownedMutable.isConnected && ownedMutable.matches(sel) ? [ownedMutable] : [];
    },
  });
  await csOwned.flush();
  csOwned.policyRequests[0]({ ...ENABLED_POLICY });
  await csOwned.flush();
  csOwned.flushRaf();
  assert.equal(ownedMutable.getAttribute("data-rmsg-hidden"), "overview");
  assert.equal(ownedMutable.style.getPropertyValue("display"), "none");

  // Detaching during a sweep prunes ownership without discarding the WeakMap display backup,
  // so reinserting without the marker and re-hiding still restores the original "flex" display.
  ownedMutable.isConnected = false;
  csOwned.advanceTime(200);
  csOwned.triggerMutation();
  csOwned.flushRaf();
  ownedMutable.isConnected = true;
  ownedMutable.removeAttribute("data-rmsg-hidden");
  csOwned.advanceTime(200);
  csOwned.triggerMutation();
  csOwned.flushRaf();
  assert.equal(ownedMutable.getAttribute("data-rmsg-hidden"), "overview", "reinserted element must be re-hidden");

  ownedMutable.setAttribute("data-rmsg-hidden", "stale");
  csOwned.fireStorageChange();
  await csOwned.flush();
  csOwned.policyRequests[1]({ ...ENABLED_POLICY, masterEnabled: false });
  await csOwned.flush();
  assert.equal(ownedMutable.getAttribute("data-rmsg-hidden"), null, "owned element must be restored despite mutated marker");
  assert.equal(ownedMutable.style.getPropertyValue("display"), "flex", "owned element original inline display must be restored");
  assert.equal(unownedPageMarked.getAttribute("data-rmsg-hidden"), "stale", "unowned page-marked element must stay untouched");
  assert.equal(unownedPageMarked.style.getPropertyValue("display"), "block", "unowned page-marked inline display must stay untouched");

  return {
    extraHidden: validExtra.getAttribute("data-rmsg-hidden"),
    leaks: leakLogs.map((l) => l.detail).sort(),
  };
}, { bp: "BP-04" });
