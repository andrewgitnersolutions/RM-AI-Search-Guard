/**
 * Playwright helpers for the B tests: launch Chromium with a built extension loaded and serve
 * mock Google pages through route interception.
 * Runs in: Node test runner only. No request reaches real Google or any other host: every
 * google.com request is fulfilled from tests/browser/fixtures/ and everything else is aborted.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT } from "./targets.mjs";

const FIXTURES = path.join(ROOT, "tests/browser/fixtures");

/**
 * Pick the fixture for a mock Google URL.
 * @param {URL} url - Requested URL.
 * @returns {string | null} Fixture file name, or null for a 404.
 */
function fixtureFor(url) {
  if (url.pathname === "/") return "home.html";
  if (url.pathname === "/search") return `${url.searchParams.get("fixture") || "serp"}.html`;
  return null;
}

/**
 * Launch Chromium with one target build loaded as an unpacked extension.
 * @param {{ dir: string }} target - Build folder.
 * @returns {Promise<object>} { context, sw, extensionId, requests, close }
 */
export async function launchWithExtension(target) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "rm-pw-"));
  // RM_CHROMIUM_PATH points at a local Chromium / Chrome for Testing build (>= 134) when
  // Playwright's own download isn't available. Branded Chrome can't load unpacked extensions.
  const executablePath = process.env.RM_CHROMIUM_PATH || undefined;
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : { channel: "chromium" }),
    headless: true,
    args: [`--disable-extensions-except=${target.dir}`, `--load-extension=${target.dir}`],
  });
  const requests = [];
  // Registered first so it has the lowest precedence: any other web request is aborted.
  // chrome-extension:// URLs also pass through routing, so they must be left alone.
  await context.route((url) => url.protocol === "http:" || url.protocol === "https:", (route) => route.abort());
  await context.route(/^https:\/\/(www\.)?google\.com\//, (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    const file = fixtureFor(url);
    if (!file) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(path.join(FIXTURES, file), "utf8") });
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const extensionId = new URL(sw.url()).host;
  // Wait for onInstalled to finish installing the DNR rules before any navigation.
  await waitFor(async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length > 0);
  return {
    context,
    sw,
    extensionId,
    requests,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Poll until a condition is true.
 * @param {() => Promise<boolean>} fn - Condition.
 * @param {number} [timeoutMs] - Give up after this long.
 */
export async function waitFor(fn, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timed out");
}

/**
 * Let the content script resolve policy, sweep and report: load + two frames + a short pause.
 * @param {import("playwright").Page} page - Page.
 */
export async function settle(page) {
  await page.waitForLoadState("load");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);
}

/**
 * Visibility of every element with an id inside the page (checkVisibility()).
 * @param {import("playwright").Page} page - Page.
 * @returns {Promise<Record<string, boolean>>}
 */
export function visibilityById(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[id]")].map((el) => [el.id, el.checkVisibility()])));
}

/**
 * Read the stored telemetry from the extension service worker once it has settled.
 * @param {import("playwright").Worker} sw - Service worker.
 * @returns {Promise<object | null>}
 */
export async function readTelemetry(sw) {
  const read = () => sw.evaluate(async () => (await chrome.storage.local.get("rmsg_telemetry")).rmsg_telemetry ?? null);
  // Content-script messages land asynchronously; wait until the stored value stops changing.
  let prev = JSON.stringify(await read());
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const next = JSON.stringify(await read());
    if (next === prev) return JSON.parse(next);
    prev = next;
  }
  return JSON.parse(prev);
}
