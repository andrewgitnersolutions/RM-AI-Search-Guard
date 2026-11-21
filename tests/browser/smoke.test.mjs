// B tests (docs/07 §6.3): the built extension in Chromium against mock Google pages served by
// route interception (tests/helpers/browser.mjs). No request reaches real Google.
// Not automated here: B-09 (performance profile), B-10 (needs managed policy), B-13 on a real
// managed profile (B-13b–d stub the worker's answer instead), and BP-09's churning-page half of
// B-08 — reported NOT RUN.
import assert from "node:assert/strict";
import { equivalent } from "../helpers/equivalence.mjs";
import { launchWithExtension, readTelemetry, settle, visibilityById } from "../helpers/browser.mjs";

/** Run a body with a fresh browser + extension for one target, always closing it. */
async function withBrowser(target, fn) {
  const b = await launchWithExtension(target);
  try {
    return await fn(b);
  } finally {
    await b.close();
  }
}

/** Set local (unmanaged) overrides through the Options page's own message path. */
async function setOverrides(b, toggles) {
  const page = await b.context.newPage();
  await page.goto(`chrome-extension://${b.extensionId}/ui/options.html`);
  const res = await page.evaluate((t) => chrome.runtime.sendMessage({ type: "SET_LOCAL_OVERRIDES", toggles: t }), toggles);
  await page.close();
  return res;
}

const SURFACES = ["ov-attr", "ov-heading", "tab-aimode", "dive", "labs", "lens", "followup-input", "paa-ai"];
const MUST_STAY = ["q", "search-form", "tab-all", "tab-images", "tab-news", "r1", "r2", "r3", "r4", "r5", "r6", "paa-normal", "footer-link"];

equivalent("B-03", "every AI surface hidden; search box, other tabs and ≥5 organic results visible; homepage AI Mode button hidden", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const serp = await visibilityById(page);
    const attrs = await page.evaluate(() => [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).sort());
    await page.goto("https://www.google.com/");
    await settle(page);
    const home = await visibilityById(page);
    const telemetry = await readTelemetry(b.sw);
    for (const id of SURFACES) assert.equal(serp[id], false, `${id} should be hidden`);
    for (const id of MUST_STAY) assert.equal(serp[id], true, `${id} should stay visible`);
    assert.equal(home["home-aimode"], false);
    assert.equal(home.q, true);
    return { serp, home, attrs, lifetime: telemetry.lifetimeMetrics, log: telemetry.diagnosticLog.map((e) => e.code) };
  }));

equivalent("B-03b", "DNR in the browser: udm=50 → udm=14, omnibox entry counted, /aimode → homepage, plain search → udm=14, Images untouched", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    const finals = {};
    for (const url of [
      "https://www.google.com/search?q=x&udm=50",
      "https://www.google.com/search?q=x&sourceid=chrome&udm=50",
      "https://www.google.com/aimode?q=x",
      "https://www.google.com/search?q=x",
      "https://www.google.com/search?q=x&udm=2",
    ]) {
      await page.goto(url);
      await settle(page);
      finals[url] = page.url();
    }
    const telemetry = await readTelemetry(b.sw);
    assert.equal(finals["https://www.google.com/search?q=x&udm=50"], "https://www.google.com/search?q=x&udm=14");
    assert.equal(finals["https://www.google.com/aimode?q=x"], "https://www.google.com/");
    assert.equal(finals["https://www.google.com/search?q=x"], "https://www.google.com/search?q=x&udm=14");
    assert.equal(finals["https://www.google.com/search?q=x&udm=2"], "https://www.google.com/search?q=x&udm=2");
    assert.equal(telemetry.lifetimeMetrics.aiModeRedirects, 3);
    assert.equal(telemetry.lifetimeMetrics.omniboxFallbackRedirects, 1);
    return { finals, requests: b.requests, lifetime: telemetry.lifetimeMetrics, log: telemetry.diagnosticLog.map((e) => e.code) };
  }));

equivalent("B-02", "local policy hideAiOverviews:false → Overview visible after load; master off → nothing hidden and no DNR rewrite", (target) =>
  withBrowser(target, async (b) => {
    const overridden = await setOverrides(b, { hideAiOverviews: false });
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const noOverviewHiding = await visibilityById(page);
    await setOverrides(b, { masterEnabled: false });
    await page.goto("https://www.google.com/search?q=x&udm=50");
    await settle(page);
    const masterOff = { url: page.url(), vis: await visibilityById(page) };
    assert.equal(overridden.hideAiOverviews, false);
    assert.equal(noOverviewHiding["ov-attr"], true);
    assert.equal(noOverviewHiding["ov-heading"], true);
    assert.equal(noOverviewHiding["tab-aimode"], false);
    assert.equal(masterOff.url, "https://www.google.com/search?q=x&udm=50");
    for (const id of SURFACES) assert.equal(masterOff.vis[id], true, `${id} visible with master off`);
    return { noOverviewHiding, masterOff };
  }));

equivalent("B-01", "html[data-rmsg-hide-*] attributes are set before any page script runs (no flash)", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const atParse = await page.evaluate(() => window.__attrAtParse);
    assert.equal(atParse, "1");
    return atParse;
  }), { bp: "BP-02" });

equivalent("B-04", "organic result linking to example.com/blog/aimode-review stays visible", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=aimode+review&fixture=organic-aimode&udm=14");
    await settle(page);
    const vis = await visibilityById(page);
    assert.equal(vis["organic-aimode"], true);
    return vis;
  }), { bp: "BP-08" });

equivalent("B-05", "Overview inside a data-hveid wrapper with 1 organic result: only the Overview card hides", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&fixture=hveid-wrapper&udm=14");
    await settle(page);
    const vis = await visibilityById(page);
    assert.equal(vis["ov-card"], false);
    assert.equal(vis["wrapped-organic"], true);
    return vis;
  }), { bp: "BP-08" });

equivalent("B-06", "history.pushState(…udm=50) + DOM mutation → clean URL; aiModeRedirects +1 exactly", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const before = (await readTelemetry(b.sw)).lifetimeMetrics.aiModeRedirects;
    await page.evaluate(() => {
      history.pushState({}, "", "/search?q=x&udm=50");
      document.body.append(document.createElement("div"));
    });
    await settle(page);
    const after = (await readTelemetry(b.sw)).lifetimeMetrics.aiModeRedirects;
    const url = page.url();
    assert.doesNotMatch(url, /udm=50/);
    assert.equal(after - before, 1);
    return { url, delta: after - before };
  }), { bp: "BP-05" });

equivalent("B-07", "same page reloaded 3× → each category counter +3 exactly", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const start = (await readTelemetry(b.sw)).lifetimeMetrics;
    for (let i = 0; i < 3; i += 1) {
      await page.reload();
      await settle(page);
    }
    const end = (await readTelemetry(b.sw)).lifetimeMetrics;
    const delta = Object.fromEntries(["overviewsHidden", "aiModeUiHidden", "auxAiHidden"].map((k) => [k, end[k] - start[k]]));
    assert.deepEqual(delta, { overviewsHidden: 3, aiModeUiHidden: 3, auxAiHidden: 3 });
    return delta;
  }), { bp: "BP-14" });

// Static page only: BP-09's real check needs a continuously mutating fixture (not built yet).
equivalent("B-08", "a single search on a static results page produces ≤2 telemetry writes", (target) =>
  withBrowser(target, async (b) => {
    await b.sw.evaluate(() => {
      globalThis.__writes = 0;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && "rmsg_telemetry" in changes) globalThis.__writes += 1;
      });
    });
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=50");
    await settle(page);
    const writes = await b.sw.evaluate(() => globalThis.__writes);
    assert.ok(writes <= 2, `${writes} telemetry writes`);
    return writes;
  }));

equivalent("B-11", "Tier 1/2 matches stripped from an Overview → WARN_AI_SURFACE_VISIBLE logged once", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    await page.evaluate(() => {
      const h = document.createElement("h2");
      h.textContent = "AI Overview";
      document.querySelector("#rso").prepend(h);
    });
    await settle(page);
    const codes = (await readTelemetry(b.sw)).diagnosticLog.map((e) => e.code);
    assert.equal(codes.filter((c) => c === "WARN_AI_SURFACE_VISIBLE").length, 1);
    return codes;
  }), { bp: "BP-04" });

/** Collect what B-12 inspects on the Options page. */
async function optionsState(page) {
  return page.evaluate(() => ({
    lockBadgesVisible: [...document.querySelectorAll("[data-lock-badge]")].filter((e) => e.checkVisibility()).length,
    cancelResetVisible: document.getElementById("btn-cancel-reset").checkVisibility(),
    staffCardVisible: document.querySelector('article[data-grade-band="Staff"]')?.checkVisibility() ?? null,
    selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null,
    modeBadge: document.getElementById("policy-mode-badge")?.textContent ?? null,
  }));
}

// The Test Flush half of B-12 went away with analytics (D6).
equivalent("B-12", "Options (unmanaged): no Locked badges; Cancel Reset only after first Reset; Staff card only after toggle; tabs switch", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto(`chrome-extension://${b.extensionId}/ui/options.html`);
    await page.waitForTimeout(500);
    const initial = await optionsState(page);
    await page.click("#tab-diagnostics");
    const diagnosticsTab = await optionsState(page);
    const diagnosticsPanelVisible = await page.evaluate(() => document.getElementById("panel-diagnostics").checkVisibility());
    await page.click("#btn-reset-metrics");
    const afterFirstReset = await optionsState(page);
    await page.click("#tab-generator");
    const generatorTab = await optionsState(page);
    const record = { initial, diagnosticsTab, diagnosticsPanelVisible, afterFirstReset, generatorTab };
    assert.equal(diagnosticsTab.selectedTab, "tab-diagnostics");
    assert.equal(diagnosticsPanelVisible, true);
    assert.equal(initial.lockBadgesVisible, 0, "Locked badges shown on an unmanaged device");
    assert.equal(initial.cancelResetVisible, false, "Cancel Reset visible before Reset");
    assert.equal(afterFirstReset.cancelResetVisible, true);
    assert.equal(generatorTab.staffCardVisible, false, "Staff card visible before toggle");
    return record;
  }), { bp: "BP-06" });

equivalent("B-13", "Popup: unmanaged view on an unpacked install (managed-view cases need a managed profile: NOT RUN)", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto(`chrome-extension://${b.extensionId}/ui/popup.html`);
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => document.getElementById("popup-root").innerText);
    assert.match(text, /Local Test Mode/);
    assert.doesNotMatch(text, /Managed by your school/);
    return text;
  }));

/**
 * Open an extension page whose GET_* policy answers are replaced, before any page script runs.
 * @param {object} b - Browser handle.
 * @param {string} pagePath - e.g. "ui/popup.html".
 * @param {"locked" | "unreachable"} mode - Report admin-no-policy, or throw as if the worker is gone.
 * @returns {Promise<import("playwright").Page>}
 */
async function openWithStubbedWorker(b, pagePath, mode) {
  const page = await b.context.newPage();
  await page.addInitScript((m) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (msg) => {
      if (msg?.type !== "GET_EFFECTIVE_POLICY" && msg?.type !== "GET_DIAGNOSTIC_SNAPSHOT") return real(msg);
      if (m === "unreachable") throw new Error("Could not establish connection. Receiving end does not exist.");
      const res = await real(msg);
      const lock = (p) => ({ ...p, isManaged: true, source: "admin-no-policy" });
      return msg.type === "GET_EFFECTIVE_POLICY" ? lock(res) : { ...res, policy: lock(res.policy) };
    };
  }, mode);
  await page.goto(`chrome-extension://${b.extensionId}/${pagePath}`);
  await page.waitForTimeout(400);
  return page;
}

equivalent("B-13b", "Popup: managed view when the service worker reports a locked (admin-no-policy) policy", (target) =>
  withBrowser(target, async (b) => {
    const page = await openWithStubbedWorker(b, "ui/popup.html", "locked");
    const text = await page.evaluate(() => document.getElementById("popup-root").innerText);
    assert.match(text, /Managed by your school/);
    assert.doesNotMatch(text, /Local Test Mode/);
    return text;
  }), { bp: "BP-01" });

equivalent("B-13c", "Popup: managed view (not unmanaged) when the service worker is unreachable", (target) =>
  withBrowser(target, async (b) => {
    const page = await openWithStubbedWorker(b, "ui/popup.html", "unreachable");
    const text = await page.evaluate(() => document.getElementById("popup-root").innerText);
    assert.match(text, /Managed by your school/);
    assert.doesNotMatch(text, /Local Test Mode/);
    return text;
  }), { bp: "BP-01" });

equivalent("B-13d", "Options: locked banner and disabled switches when the worker reports admin-no-policy, and when it is unreachable", (target) =>
  withBrowser(target, async (b) => {
    const out = {};
    for (const mode of ["locked", "unreachable"]) {
      const page = await openWithStubbedWorker(b, "ui/options.html", mode);
      out[mode] = await page.evaluate(() => ({
        title: document.getElementById("policy-source-title")?.textContent ?? null,
        badge: document.getElementById("policy-mode-badge")?.textContent ?? null,
        enabledSwitches: [...document.querySelectorAll('input[id^="toggle-"]')].filter((i) => !i.disabled).length,
        gradeBandDisabled: document.getElementById("grade-band-select")?.disabled ?? null,
      }));
      assert.match(out[mode].title, /No Grade-Band Policy Yet/, `${mode}: banner`);
      assert.equal(out[mode].badge, "Locked", `${mode}: badge`);
      assert.equal(out[mode].enabledSwitches, 0, `${mode}: every switch disabled`);
      assert.equal(out[mode].gradeBandDisabled, true, `${mode}: grade band locked`);
      await page.close();
    }
    return out;
  }), { bp: "BP-01" });

equivalent("B-14", "Policy generator: each band's JSON parses, uses {\"key\":{\"Value\":…}} wrappers and matches schema.json types", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto(`chrome-extension://${b.extensionId}/ui/options.html`);
    await page.click("#tab-generator");
    await page.waitForTimeout(300);
    const outputs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-json-output]")].map((el) => [el.dataset.jsonOutput, el.textContent])));
    const schema = await page.evaluate(async () => (await fetch(chrome.runtime.getURL("schema.json"))).json());
    const parsed = {};
    for (const [band, text] of Object.entries(outputs)) {
      const json = JSON.parse(text);
      parsed[band] = json;
      for (const [key, wrapper] of Object.entries(json)) {
        assert.deepEqual(Object.keys(wrapper), ["Value"], `${band}.${key} wrapper`);
        const prop = schema.properties[key];
        assert.ok(prop, `${band}.${key} not in schema`);
        const t = Number.isInteger(wrapper.Value) ? "integer" : typeof wrapper.Value;
        assert.ok(prop.type === t || (prop.type === "number" && t === "integer"), `${band}.${key}: ${t} vs ${prop.type}`);
        if (prop.enum) assert.ok(prop.enum.includes(wrapper.Value));
      }
    }
    assert.deepEqual(Object.keys(parsed).sort(), ["3-5", "6-8", "9-12", "K-2", "Staff"]);
    return parsed;
  }));
