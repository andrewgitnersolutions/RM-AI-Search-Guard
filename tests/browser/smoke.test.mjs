// B tests (docs/07 §6.3): the built extension in Chromium against mock Google pages served by
// route interception (tests/helpers/browser.mjs). No request reaches real Google.
// Not automated here: B-09 (CDP CPU profile benchmark), B-10 (needs managed policy), and B-13 on
// a real managed profile (B-13b–d stub the worker's answer instead) — reported NOT RUN where skipped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { equivalent } from "../helpers/equivalence.mjs";
import { launchWithExtension, readTelemetry, settle, visibilityById } from "../helpers/browser.mjs";
import { ROOT } from "../helpers/targets.mjs";

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

equivalent("B-03b", "DNR in the browser: udm=50 → udm=14, omnibox entry counted, /aimode?q= keeps the search, /ai → homepage, plain search → udm=14, Images untouched", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    const finals = {};
    for (const url of [
      "https://www.google.com/search?q=x&udm=50",
      "https://www.google.com/search?q=x&sourceid=chrome&udm=50",
      "https://www.google.com/aimode?q=x",
      "https://www.google.com/ai",
      "https://www.google.com/search?q=x",
      "https://www.google.com/search?q=x&udm=2",
    ]) {
      await page.goto(url);
      await settle(page);
      finals[url] = page.url();
    }
    const telemetry = await readTelemetry(b.sw);
    assert.equal(finals["https://www.google.com/search?q=x&udm=50"], "https://www.google.com/search?q=x&udm=14");
    assert.equal(finals["https://www.google.com/aimode?q=x"], "https://www.google.com/search?q=x&udm=14");
    assert.equal(finals["https://www.google.com/ai"], "https://www.google.com/");
    assert.equal(finals["https://www.google.com/search?q=x"], "https://www.google.com/search?q=x&udm=14");
    assert.equal(finals["https://www.google.com/search?q=x&udm=2"], "https://www.google.com/search?q=x&udm=2");
    assert.equal(telemetry.lifetimeMetrics.aiModeRedirects, 4);
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

equivalent("B-01", "html[data-rmsg-hide-*] attributes are set before any page script runs; with 6× CPU throttle the Overview is already hidden when parsed (no flash)", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    const cdp = await b.context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const atParse = await page.evaluate(() => window.__attrAtParse);
    const allAtParse = await page.evaluate(() => window.__attrsAtParse);
    assert.equal(atParse, "1");
    assert.deepEqual(allAtParse, ["1", "1", "1"], "all three hide attributes set before page scripts");
    const ovVisibleAtParse = await page.evaluate(() => window.__ovVisibleAtParse);
    assert.equal(ovVisibleAtParse, false, "AI Overview visible at the moment it was parsed (flash)");
    return { allAtParse, ovVisibleAtParse };
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

equivalent("B-05b", "Overview container wrapping an organic result stays visible (CSS defers to the guard) and logs ERR_SAFETY_GUARD_TRIPPED; external udm=50 link visible; absolute Google AI Mode link hidden", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&fixture=overview-organic&udm=14");
    await settle(page);
    const vis = await visibilityById(page);
    const telemetry = await readTelemetry(b.sw);
    const codes = telemetry.diagnosticLog.map((e) => e.code);
    assert.equal(vis["ov-wrap"], true, "Overview wrapper holding an organic result was hidden");
    assert.equal(vis["ow-r1"], true);
    assert.equal(vis["ext-udm"], true, "external link with udm=50 in its URL was hidden");
    assert.equal(vis["abs-aimode"], false, "absolute Google AI Mode link not hidden");
    assert.equal(vis["rel-q-aimode"], false, "query-only relative AI Mode link (?q=x&udm=50) not hidden");
    assert.ok(codes.includes("ERR_SAFETY_GUARD_TRIPPED"), "guard refusal not logged");
    return { vis, codes };
  }), { bp: "BP-08" });

equivalent("B-16", "unhide restores an original inline display:none; a leftover hide marker stops hiding once its category's policy attribute is off", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&fixture=restore&udm=14");
    await settle(page);
    const whileHidden = await page.evaluate(() => ({
      marker: document.getElementById("ov-google-hidden").getAttribute("data-rmsg-hidden"),
      markerOnlyVisible: document.getElementById("marker-only").checkVisibility(),
    }));
    await setOverrides(b, { hideAiOverviews: false });
    await page.waitForFunction(() => !document.getElementById("ov-google-hidden").hasAttribute("data-rmsg-hidden"));
    const afterUnhide = await page.evaluate(() => {
      const el = document.getElementById("ov-google-hidden");
      return { inlineDisplay: el.style.display, visible: el.checkVisibility() };
    });
    // Simulate a marker that outlived its policy: the category attribute is off, marker stays.
    await setOverrides(b, { hideAiOverviews: true });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-rmsg-hide-overviews") === "1");
    const markerAfterReenable = await page.evaluate(() => {
      const el = document.getElementById("marker-only");
      el.setAttribute("data-rmsg-hidden", "overview");
      const hiddenWithAttr = !el.checkVisibility();
      document.documentElement.removeAttribute("data-rmsg-hide-overviews");
      return { hiddenWithAttr, visibleWithoutAttr: el.checkVisibility() };
    });
    assert.equal(whileHidden.marker, "overview", "Overview was swept");
    assert.equal(whileHidden.markerOnlyVisible, false, "marker hides while its category is on");
    assert.equal(afterUnhide.inlineDisplay, "none", "Google's own inline display:none was not restored");
    assert.equal(afterUnhide.visible, false);
    assert.equal(markerAfterReenable.hiddenWithAttr, true);
    assert.equal(markerAfterReenable.visibleWithoutAttr, true, "leftover marker still hides with its category off");
    return { whileHidden, afterUnhide, markerAfterReenable };
  }), { bp: "BP-18" });

equivalent("B-05c", "an Overview wrapper hidden while empty is un-hidden when an organic result is inserted later, with ERR_SAFETY_GUARD_TRIPPED", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&fixture=overview-organic&udm=14");
    await settle(page);
    const before = await page.evaluate(() => document.getElementById("ov-late").checkVisibility());
    await page.evaluate(() => {
      const r = document.createElement("div");
      r.className = "g";
      r.id = "late-organic";
      r.innerHTML = '<a href="https://example.com/late"><h3 class="LC20lb">Late organic result</h3></a>';
      document.getElementById("ov-late").append(r);
    });
    await settle(page);
    const after = await visibilityById(page);
    const telemetry = await readTelemetry(b.sw);
    const unHid = telemetry.diagnosticLog.some((e) => e.code === "ERR_SAFETY_GUARD_TRIPPED" && /Un-hid div#ov-late/.test(e.detail));
    assert.equal(before, false, "empty Overview wrapper should start hidden");
    assert.equal(after["ov-late"], true, "wrapper still hidden after an organic result arrived");
    assert.equal(after["late-organic"], true);
    assert.ok(unHid, "un-hide not logged");
    return { before, after: { wrapper: after["ov-late"], organic: after["late-organic"] }, unHid };
  }), { bp: "BP-08" });

equivalent("B-05d", "restored AI Mode wrapper releases inner button and short anchor to be hidden in the exact same sweep", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&fixture=aimode-restore&udm=14");
    await settle(page);
    const before = await page.evaluate(() => ({
      btnWrapAttr: document.getElementById("wrap-btn")?.getAttribute("data-rmsg-hidden"),
      linkWrapAttr: document.getElementById("wrap-link")?.getAttribute("data-rmsg-hidden"),
    }));
    assert.equal(before.btnWrapAttr, "aimode");
    assert.equal(before.linkWrapAttr, "aimode");

    // Append 3 organic results into each hidden wrapper in one mutation (no subsequent mutations).
    await page.evaluate(() => {
      for (const [wrapId, prefix] of [["wrap-btn", "btn"], ["wrap-link", "lnk"]]) {
        const wrap = document.getElementById(wrapId);
        for (let i = 1; i <= 3; i += 1) {
          const r = document.createElement("div");
          r.className = "g";
          r.id = `${prefix}-r${i}`;
          r.innerHTML = `<a href="https://example.com/${prefix}-${i}"><h3 class="LC20lb">Organic ${prefix} ${i}</h3></a>`;
          wrap.append(r);
        }
      }
    });
    await settle(page);
    const after = await visibilityById(page);
    const telemetry = await readTelemetry(b.sw);
    const unHidBtn = telemetry.diagnosticLog.some((e) => e.code === "ERR_SAFETY_GUARD_TRIPPED" && /Un-hid div#wrap-btn/.test(e.detail));
    const unHidLink = telemetry.diagnosticLog.some((e) => e.code === "ERR_SAFETY_GUARD_TRIPPED" && /Un-hid div#wrap-link/.test(e.detail));
    assert.equal(after["wrap-btn"], true, "button wrapper should be restored");
    assert.equal(after["wrap-link"], true, "link wrapper should be restored");
    for (const id of ["btn-r1", "btn-r2", "btn-r3", "lnk-r1", "lnk-r2", "lnk-r3"]) {
      assert.equal(after[id], true, `${id} should be visible`);
    }
    assert.equal(after["ai-btn-inside"], false, "inner AI Mode button stayed visible after wrapper restore");
    assert.equal(after["ai-link-inside"], false, "inner AI Mode short anchor stayed visible after wrapper restore");
    assert.ok(unHidBtn && unHidLink, "un-hide diagnostic not logged for restored wrappers");
    return { before, after, unHidBtn, unHidLink };
  }), { bp: "BP-09" });

equivalent("B-06", "history.pushState(…udm=50) + DOM mutation → clean URL; aiModeRedirects +1 exactly", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const before = (await readTelemetry(b.sw)).lifetimeMetrics.aiModeRedirects;
    // The redirect can start before evaluate() returns (Navigation API), which tears down the
    // page's execution context: that is the fix working, not a test failure.
    await page.evaluate(() => {
      history.pushState({}, "", "/search?q=x&udm=50");
      document.body.append(document.createElement("div"));
    }).catch((err) => {
      if (!/Execution context was destroyed/.test(err.message)) throw err;
    });
    await page.waitForURL((u) => !u.href.includes("udm=50"), { timeout: 5000 });
    await settle(page);
    const after = (await readTelemetry(b.sw)).lifetimeMetrics.aiModeRedirects;
    const url = page.url();
    assert.doesNotMatch(url, /udm=50/);
    assert.equal(after - before, 1);
    return { url, delta: after - before };
  }), { bp: "BP-05" });

equivalent("B-06b", "history.pushState(…udm=50) with no DOM mutation → clean URL via the Navigation API; aiModeRedirects +1 exactly", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    const before = (await readTelemetry(b.sw)).lifetimeMetrics.aiModeRedirects;
    await page.evaluate(() => history.pushState({}, "", "/search?q=x&udm=50")).catch((err) => {
      if (!/Execution context was destroyed/.test(err.message)) throw err;
    });
    await page.waitForURL((u) => !u.href.includes("udm=50"), { timeout: 5000 });
    await settle(page);
    const afterPush = page.url();
    const delta = (await readTelemetry(b.sw)).lifetimeMetrics.aiModeRedirects - before;
    assert.doesNotMatch(afterPush, /udm=50/);
    assert.equal(delta, 1, "exactly one redirect counted");
    return { afterPush, delta };
  }), { bp: "BP-05" });

equivalent("B-07", "same page reloaded 3× with re-render churn → each category counter +3 exactly", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=14");
    await settle(page);
    await page.goto("about:blank");
    const start = (await readTelemetry(b.sw)).lifetimeMetrics;
    for (let i = 0; i < 3; i += 1) {
      if (i === 0) {
        await page.goto("https://www.google.com/search?q=x&udm=14");
      } else {
        await page.reload();
      }
      await settle(page);
      // Simulate Google re-rendering fresh AI surfaces across multiple sweeps on the same page.
      await page.evaluate(async () => {
        const rso = document.getElementById("rso");
        for (let burst = 0; burst < 3; burst += 1) {
          const ov = document.createElement("div");
          ov.setAttribute("data-attrid", "AIOverview");
          ov.textContent = `Re-rendered overview ${burst}`;
          const aiBtn = document.createElement("button");
          aiBtn.className = "plR5qb";
          aiBtn.textContent = "AI Mode";
          const labs = document.createElement("a");
          labs.href = "https://labs.google.com/search";
          labs.textContent = "Search Labs";
          rso.append(ov, aiBtn, labs);
          await new Promise((r) => setTimeout(r, 80));
        }
      });
      await settle(page);
    }
    await page.goto("about:blank");
    const end = (await readTelemetry(b.sw)).lifetimeMetrics;
    const delta = Object.fromEntries(["overviewsHidden", "aiModeUiHidden", "auxAiHidden"].map((k) => [k, end[k] - start[k]]));
    assert.deepEqual(delta, { overviewsHidden: 3, aiModeUiHidden: 3, auxAiHidden: 3 });
    return delta;
  }), { bp: "BP-14" });

equivalent("B-08", "a single search on a churning results page produces ≤2 telemetry writes and flushes all counters on pagehide", (target) =>
  withBrowser(target, async (b) => {
    await b.sw.evaluate(() => {
      globalThis.__writes = 0;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && "rmsg_telemetry" in changes) globalThis.__writes += 1;
      });
    });
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&udm=50&fixture=churn");
    await settle(page);
    await page.evaluate(async () => {
      const rso = document.getElementById("rso");
      for (let step = 0; step < 25; step += 1) {
        const box = document.createElement("div");
        if (step % 3 === 0) {
          box.setAttribute("data-attrid", "AIOverview");
          box.textContent = `Streaming AI chunk ${step}`;
        } else if (step % 3 === 1) {
          const btn = document.createElement("button");
          btn.className = "plR5qb";
          btn.textContent = "AI Mode";
          box.append(btn);
        } else {
          const lens = document.createElement("div");
          lens.setAttribute("role", "button");
          lens.setAttribute("aria-label", "Search by image");
          box.append(lens);
        }
        rso.append(box);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    await settle(page);
    await page.goto("about:blank");
    const telemetry = await readTelemetry(b.sw);
    const writes = await b.sw.evaluate(() => globalThis.__writes);
    assert.ok(writes <= 2, `${writes} telemetry writes`);
    assert.equal(telemetry.lifetimeMetrics.aiModeRedirects, 1);
    assert.equal(telemetry.lifetimeMetrics.overviewsHidden, 1);
    assert.equal(telemetry.lifetimeMetrics.aiModeUiHidden, 1);
    assert.equal(telemetry.lifetimeMetrics.auxAiHidden, 1);
    return { writes, lifetime: telemetry.lifetimeMetrics };
  }), { bp: "BP-09" });

equivalent("B-08b", "Options skips telemetry-only storage refreshes while IT Diagnostics is hidden and refreshes when opened", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.addInitScript(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__snapCalls = 0;
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.type === "GET_DIAGNOSTIC_SNAPSHOT") window.__snapCalls += 1;
        return real(msg);
      };
    });
    await page.goto(`chrome-extension://${b.extensionId}/ui/options.html`);
    await page.waitForFunction(() => window.__snapCalls === 1);
    await page.waitForTimeout(150);

    // Telemetry-only change while Status tab is active must not trigger a snapshot refresh.
    await b.sw.evaluate(async () => {
      const cur = (await chrome.storage.local.get("rmsg_telemetry")).rmsg_telemetry ?? {
        lifetimeMetrics: { overviewsHidden: 0, aiModeUiHidden: 0, aiModeRedirects: 0, omniboxFallbackRedirects: 0, auxAiHidden: 0 },
        diagnosticLog: [],
      };
      cur.lifetimeMetrics.overviewsHidden = 7;
      await chrome.storage.local.set({ rmsg_telemetry: cur });
    });
    await page.waitForTimeout(300);
    const callsWhileHidden = await page.evaluate(() => window.__snapCalls);
    assert.equal(callsWhileHidden, 1, "Options re-rendered on telemetry write while Diagnostics tab was hidden");

    // Switching to Diagnostics pulls the stale update once.
    await page.click("#tab-diagnostics");
    await page.waitForFunction(() => window.__snapCalls === 2);
    await page.waitForFunction(() => document.getElementById("metric-overviewsHidden")?.textContent === "7");

    // Telemetry change while Diagnostics is visible must live-refresh immediately.
    await b.sw.evaluate(async () => {
      const cur = (await chrome.storage.local.get("rmsg_telemetry")).rmsg_telemetry;
      cur.lifetimeMetrics.overviewsHidden = 9;
      await chrome.storage.local.set({ rmsg_telemetry: cur });
    });
    await page.waitForFunction(() => window.__snapCalls === 3);
    await page.waitForFunction(() => document.getElementById("metric-overviewsHidden")?.textContent === "9");

    const callsFinal = await page.evaluate(() => window.__snapCalls);
    const displayed = await page.evaluate(() => document.getElementById("metric-overviewsHidden")?.textContent);
    return { callsWhileHidden, callsFinal, displayed };
  }), { bp: "BP-09" });

equivalent("B-10", "managed extraHideSelectors hides custom surfaces, isolates bad syntax into ERR_SELECTOR_SYNTAX, and still enforces the safety guard", (target) =>
  withBrowser(target, async (b) => {
    const stubbed = await b.sw.evaluate(() => {
      const managedPolicy = {
        gradeBand: "K-2",
        extraHideSelectors: {
          overview: ["div.test-ai", "div[invalid!!", "div.test-ai-unsafe"],
          aimode: ["div.test-aimode"],
          aux: ["div.test-aux"],
        },
      };
      const fakeGet = async () => managedPolicy;
      try {
        chrome.storage.managed.get = fakeGet;
        if (chrome.storage.managed.get === fakeGet) return true;
      } catch {
      }
      try {
        Object.defineProperty(chrome.storage.managed, "get", {
          value: fakeGet,
          configurable: true,
          writable: true,
        });
        return chrome.storage.managed.get === fakeGet;
      } catch {
      }
      return false;
    });
    assert.equal(stubbed, true, "could not stub chrome.storage.managed.get in service worker");
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&fixture=extra-selectors&udm=14");
    await settle(page);
    const vis = await visibilityById(page);
    const telemetry = await readTelemetry(b.sw);
    const codes = telemetry.diagnosticLog.map((e) => e.code);
    assert.equal(vis["ov-attr"], false, "built-in Overview should hide");
    assert.equal(vis["extra-ov"], false, "extra overview selector should hide");
    assert.equal(vis["extra-aimode"], false, "extra aimode selector should hide");
    assert.equal(vis["extra-aux"], false, "extra aux selector should hide");
    assert.equal(vis["extra-unsafe"], true, "safety guard must refuse unsafe extra selector");
    assert.equal(vis["unsafe-organic"], true);
    assert.equal(vis["r1"], true);
    assert.ok(codes.includes("ERR_SELECTOR_SYNTAX"), "invalid extra selector should log ERR_SELECTOR_SYNTAX");
    assert.ok(codes.includes("ERR_SAFETY_GUARD_TRIPPED"), "unsafe extra selector should log ERR_SAFETY_GUARD_TRIPPED");
    return { vis, codes };
  }), { bp: "BP-04" });

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
    resetDisabled: document.getElementById("btn-reset-metrics")?.disabled ?? null,
  }));
}

// The Test Flush half of B-12 went away with analytics (D6).
equivalent("B-12", "Options (unmanaged): no Locked badges; Cancel Reset only after first Reset; Staff card only after toggle; reminders follow their band; tabs switch and stay findable", (target) =>
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
    const reminders = await page.evaluate(() => ({
      k2: document.querySelector('[data-aimode-reminder="K-2"]')?.checkVisibility() ?? null,
    }));
    // Inactive until-found panels must stay in layout (not display:none) so Ctrl+F can find them.
    const inactivePanelDisplay = await page.evaluate(() => getComputedStyle(document.getElementById("panel-status")).display);
    await page.getByRole("button", { name: "Show Staff OU Preset" }).click();
    const staffAfterToggle = await optionsState(page);
    const record = { initial, diagnosticsTab, diagnosticsPanelVisible, afterFirstReset, generatorTab, reminders, inactivePanelDisplay, staffAfterToggle };
    assert.equal(diagnosticsTab.selectedTab, "tab-diagnostics");
    assert.equal(diagnosticsPanelVisible, true);
    assert.equal(initial.lockBadgesVisible, 0, "Locked badges shown on an unmanaged device");
    assert.equal(initial.cancelResetVisible, false, "Cancel Reset visible before Reset");
    assert.equal(initial.resetDisabled, false, "Reset available on an unmanaged test install (BP-07)");
    assert.equal(afterFirstReset.cancelResetVisible, true);
    assert.equal(generatorTab.staffCardVisible, false, "Staff card visible before toggle");
    assert.equal(staffAfterToggle.staffCardVisible, true, "Staff card shown after toggle");
    assert.equal(reminders.k2, true, "K-2 AIModeSettings reminder shown");
    assert.notEqual(inactivePanelDisplay, "none", "inactive tab panel must stay findable (hidden=until-found)");
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

equivalent("B-13d", "Options: locked banner, disabled switches and disabled Reset when the worker reports admin-no-policy, and when it is unreachable", (target) =>
  withBrowser(target, async (b) => {
    const out = {};
    for (const mode of ["locked", "unreachable"]) {
      const page = await openWithStubbedWorker(b, "ui/options.html", mode);
      out[mode] = await page.evaluate(() => ({
        title: document.getElementById("policy-source-title")?.textContent ?? null,
        badge: document.getElementById("policy-mode-badge")?.textContent ?? null,
        enabledSwitches: [...document.querySelectorAll('input[id^="toggle-"]')].filter((i) => !i.disabled).length,
        gradeBandDisabled: document.getElementById("grade-band-select")?.disabled ?? null,
        resetDisabled: document.getElementById("btn-reset-metrics")?.disabled ?? null,
        // The note lives in the (inactive, until-found) Diagnostics tab, so check its own hidden flag.
        resetNoteShown: document.getElementById("reset-locked-note")?.hidden === false,
      }));
      assert.match(out[mode].title, /No Grade-Band Policy Yet/, `${mode}: banner`);
      assert.equal(out[mode].badge, "Locked", `${mode}: badge`);
      assert.equal(out[mode].enabledSwitches, 0, `${mode}: every switch disabled`);
      assert.equal(out[mode].gradeBandDisabled, true, `${mode}: grade band locked`);
      assert.equal(out[mode].resetDisabled, true, `${mode}: Reset disabled when locked (BP-07)`);
      assert.equal(out[mode].resetNoteShown, true, `${mode}: locked-reset note shown`);
      await page.close();
    }
    return out;
  }), { bp: "BP-01" });

equivalent("B-15", "Options: two overlapping refreshes whose snapshots arrive in reverse order → the newer snapshot stays rendered", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    // Hold every diagnostic snapshot until the test releases it, stamped with a marker count.
    await page.addInitScript(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__snap = [];
      chrome.runtime.sendMessage = (msg) => msg?.type !== "GET_DIAGNOSTIC_SNAPSHOT"
        ? real(msg)
        : new Promise((resolve) => window.__snap.push(async (count) => resolve({ ...(await real(msg)), activeRuleCount: count })));
    });
    await page.goto(`chrome-extension://${b.extensionId}/ui/options.html`);
    await page.waitForFunction(() => window.__snap.length === 1);
    await page.evaluate(() => window.__snap[0](6));
    await page.click("#tab-diagnostics");
    await page.click("#btn-refresh-diag");
    await page.click("#btn-refresh-diag");
    await page.waitForFunction(() => window.__snap.length === 3);
    await page.evaluate(() => window.__snap[2](22));
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__snap[1](11));
    await page.waitForTimeout(150);
    const pill = await page.evaluate(() => document.getElementById("active-rule-count-pill").textContent);
    assert.match(pill, /^22 /, "an older snapshot replaced the newer one");
    return pill;
  }), { bp: "BP-17" });

equivalent("B-14", "Policy generator: each band's JSON parses, uses {\"key\":{\"Value\":…}} wrappers, matches schema.json types, omits empty extraHideSelectors, validates extras on blur, and emits populated extras", (target) =>
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
      assert.equal("extraHideSelectors" in json, false, `${band} must omit empty extraHideSelectors by default`);
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

    // Open Advanced disclosure on K-2 and enter valid overview extra selectors.
    await page.click('details[data-advanced-band="K-2"] > summary');
    const ovTextarea = page.locator('textarea[data-grade-band="K-2"][data-extra-category="overview"]');
    await ovTextarea.fill("div.test-ai\nsection.extra-ov");
    const k2AfterExtra = JSON.parse(await page.locator('code[data-json-output="K-2"]').textContent());
    assert.deepEqual(k2AfterExtra.extraHideSelectors, { Value: { overview: ["div.test-ai", "section.extra-ov"] } });
    assert.equal(schema.properties.extraHideSelectors.type, "object");
    for (const [cat, list] of Object.entries(k2AfterExtra.extraHideSelectors.Value)) {
      const catProp = schema.properties.extraHideSelectors.properties[cat];
      assert.equal(catProp.type, "array");
      assert.ok(list.length <= catProp.maxItems);
      for (const item of list) {
        assert.equal(typeof item, catProp.items.type);
        assert.ok(item.length <= catProp.items.maxLength);
      }
    }

    // Enter invalid CSS selector in K-2 aimode textarea and trigger blur → aria-invalid + aria-describedby error link.
    const aimTextarea = page.locator('textarea[data-grade-band="K-2"][data-extra-category="aimode"]');
    await aimTextarea.fill("div[invalid!!");
    await aimTextarea.blur();
    const invalidState = await aimTextarea.evaluate((el) => {
      const errorId = el.getAttribute("aria-describedby")?.split(/\s+/).find((id) => id.endsWith("-error"));
      const errorEl = errorId ? document.getElementById(errorId) : null;
      return {
        ariaInvalid: el.getAttribute("aria-invalid"),
        errorVisible: errorEl ? errorEl.checkVisibility() : false,
        errorText: errorEl?.textContent ?? "",
      };
    });
    assert.equal(invalidState.ariaInvalid, "true", "invalid selector should set aria-invalid=true on blur");
    assert.equal(invalidState.errorVisible, true, "field error should become visible on blur");
    assert.match(invalidState.errorText, /Invalid CSS selector syntax/);

    // Reset to Recommended Presets clears extra selectors and error state.
    await page.getByRole("button", { name: "Reset to Recommended Presets" }).click();
    const afterReset = await page.evaluate(() => {
      const ov = document.querySelector('textarea[data-grade-band="K-2"][data-extra-category="overview"]');
      const aim = document.querySelector('textarea[data-grade-band="K-2"][data-extra-category="aimode"]');
      return {
        ovVal: ov.value,
        aimVal: aim.value,
        aimInvalid: aim.getAttribute("aria-invalid"),
        k2Json: JSON.parse(document.querySelector('code[data-json-output="K-2"]').textContent),
      };
    });
    assert.equal(afterReset.ovVal, "");
    assert.equal(afterReset.aimVal, "");
    assert.equal(afterReset.aimInvalid, "false");
    assert.equal("extraHideSelectors" in afterReset.k2Json, false);

    return { parsed, k2AfterExtra, invalidState, afterReset };
  }));

equivalent("B-17", "Spanish Google SERP (es-419 and es-US): hides Spanish AI Overview, AI Mode, Lens, follow-up and PAA while keeping organic results and emitting zero warnings", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    const esSurfaces = ["es-ov-aria", "es-ov-heading", "es-tab-aimode", "es-aimode-btn", "es-lens", "es-followup", "es-paa-ai"];
    const esKeep = ["q", "es-tab-all", "es-tab-images", "r1", "r2", "r3", "r4", "r5", "es-paa-normal", "footer-link"];

    await page.goto("https://www.google.com/search?q=fotosintesis&fixture=serp-es&udm=14");
    await settle(page);
    const vis419 = await visibilityById(page);
    for (const id of esSurfaces) assert.equal(vis419[id], false, `es-419: ${id} should be hidden`);
    for (const id of esKeep) assert.equal(vis419[id], true, `es-419: ${id} should stay visible`);

    // Also verify lang="es-US" (what live Google served for ?hl=es).
    const esUsHtml = readFileSync(path.join(ROOT, "tests/browser/fixtures/serp-es.html"), "utf8").replace('<html lang="es-419">', '<html lang="es-US">');
    assert.ok(esUsHtml.includes('<html lang="es-US">'), "es-US html root replacement must match");
    await page.route(/^https:\/\/(www\.)?google\.com\/search\?q=fotosintesis-us/, (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: esUsHtml }),
    );
    await page.goto("https://www.google.com/search?q=fotosintesis-us&udm=14");
    await settle(page);
    const docLang = await page.evaluate(() => document.documentElement.lang);
    assert.equal(docLang, "es-US", "B-17 second navigation must load with lang=es-US");
    const visUs = await visibilityById(page);
    for (const id of esSurfaces) assert.equal(visUs[id], false, `es-US: ${id} should be hidden`);
    for (const id of esKeep) assert.equal(visUs[id], true, `es-US: ${id} should stay visible`);

    // Verify static CSS and JS guard keep elements visible when they hold textarea[name="q"] (PR #7 review).
    await page.evaluate(() => {
      const rcnt = document.getElementById("rcnt") || document.body;
      const plate = document.createElement("div");
      plate.id = "protected-plate";
      plate.setAttribute("data-xid", "aim-mars-input-plate");
      const q1 = document.createElement("textarea");
      q1.name = "q";
      q1.value = "x";
      plate.append(q1);
      const ov = document.createElement("div");
      ov.id = "protected-es-ov";
      ov.setAttribute("aria-label", "Visión general creada por IA");
      const q2 = document.createElement("textarea");
      q2.name = "q";
      q2.value = "x";
      ov.append(q2);
      const lensWrap = document.createElement("div");
      lensWrap.id = "protected-es-lens";
      lensWrap.setAttribute("aria-label", "Búsqueda por imagen");
      const q3 = document.createElement("textarea");
      q3.name = "q";
      q3.value = "x";
      lensWrap.append(q3);
      rcnt.append(plate, ov, lensWrap);
    });
    await settle(page);
    const protectedVis = await page.evaluate(() => ({
      plate: document.getElementById("protected-plate")?.checkVisibility() ?? false,
      esOv: document.getElementById("protected-es-ov")?.checkVisibility() ?? false,
      esLens: document.getElementById("protected-es-lens")?.checkVisibility() ?? false,
    }));
    assert.equal(protectedVis.plate, true, "plate containing textarea[name=q] must remain visible");
    assert.equal(protectedVis.esOv, true, "Spanish overview containing textarea[name=q] must remain visible");
    assert.equal(protectedVis.esLens, true, "Spanish image-search wrapper containing textarea[name=q] must remain visible");

    const telemetry = await readTelemetry(b.sw);
    const codes = telemetry.diagnosticLog.map((e) => e.code);
    assert.ok(!codes.includes("WARN_UNSUPPORTED_UI_LANGUAGE"), "Spanish must not emit WARN_UNSUPPORTED_UI_LANGUAGE");
    assert.ok(!codes.includes("WARN_AI_SURFACE_VISIBLE"), "hidden Spanish surfaces must not emit WARN_AI_SURFACE_VISIBLE");
    return { vis419, docLang, visUs, protectedVis, codes };
  }), { bp: "BP-03" });

equivalent("B-18", "Unsupported UI language (hl=fr): structural hiding still works and WARN_UNSUPPORTED_UI_LANGUAGE logs once per day", (target) =>
  withBrowser(target, async (b) => {
    const page = await b.context.newPage();
    await page.goto("https://www.google.com/search?q=x&fixture=serp-fr&udm=14");
    await settle(page);
    await page.reload();
    await settle(page);
    const vis = await visibilityById(page);
    assert.equal(vis["fr-ov-attr"], false, "structural Overview should still hide on lang=fr");
    assert.equal(vis["fr-tab-aimode"], false, "udm=50 AI Mode tab should still hide on lang=fr");
    for (const id of ["q", "fr-tab-all", "r1", "r2", "r3", "r4", "r5"]) {
      assert.equal(vis[id], true, `${id} should stay visible`);
    }
    const telemetry = await readTelemetry(b.sw);
    const langEntries = telemetry.diagnosticLog.filter((e) => e.code === "WARN_UNSUPPORTED_UI_LANGUAGE");
    assert.equal(langEntries.length, 1);
    assert.equal(langEntries[0].detail, "fr");
    assert.equal(langEntries[0].count, 1, "unsupported language warning should log once per day across reloads");
    return { vis, langEntry: langEntries[0] };
  }), { bp: "BP-03" });
