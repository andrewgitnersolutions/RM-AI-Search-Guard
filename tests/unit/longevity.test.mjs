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
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day1);
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day1);
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "de", day1);
  await sw.ctx.recordDiagnosticEntry("WARN_UNSUPPORTED_UI_LANGUAGE", "fr", day2);

  const log = plain(sw.chrome.storage.local.data.rmsg_telemetry.diagnosticLog);
  const frEntry = log.find((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "fr");
  const deEntry = log.find((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE" && e.detail === "de");
  assert.equal(frEntry.count, 2, "two UTC days should yield count 2, ignoring same-day duplicate");
  assert.equal(deEntry.count, 1);

  return { tabWarnings: langLogs(), swCounts: { fr: frEntry.count, de: deEntry.count } };
}, { bp: "BP-03" });

equivalent("U-25", "extraHideSelectors hides valid matches, isolates syntax errors, enforces safety guard, and leak detector reports visible AI labels once per page", async (target) => {
  const validExtra = makeStubEl({
    id: "valid-extra",
    matchSelector: (sel) => sel === "div.valid-extra",
  });
  const unsafeExtra = makeStubEl({
    id: "rso",
    matchSelector: (sel) => sel.split(",").map((s) => s.trim()).includes("#rso"),
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
  let activeElements = [validExtra, unsafeExtra];
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
      return activeElements.filter((e) => e.matches(sel));
    },
  });

  await cs.flush();
  cs.policyRequests[0]({
    ...ENABLED_POLICY,
    isManaged: true,
    extraHideSelectors: {
      overview: ["div[invalid!!", "div.valid-extra", "#rso"],
      aimode: [],
      aux: [],
    },
  });
  await cs.flush();
  cs.flushRaf();

  assert.equal(validExtra.getAttribute("data-rmsg-hidden"), "overview", "valid extra selector must still match despite earlier invalid one");
  assert.equal(unsafeExtra.getAttribute("data-rmsg-hidden"), null, "safety guard must refuse #rso even from extraHideSelectors");

  const diagCodes = () => cs.messages.filter((m) => m.type === "LOG_DIAGNOSTIC").map((m) => [m.code, m.detail]);
  assert.ok(diagCodes().some(([c]) => c === "ERR_SELECTOR_SYNTAX"), "ERR_SELECTOR_SYNTAX logged");
  assert.ok(diagCodes().some(([c]) => c === "ERR_SAFETY_GUARD_TRIPPED"), "ERR_SAFETY_GUARD_TRIPPED logged");

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

  return {
    extraHidden: validExtra.getAttribute("data-rmsg-hidden"),
    leaks: leakLogs.map((l) => l.detail).sort(),
  };
}, { bp: "BP-04" });
