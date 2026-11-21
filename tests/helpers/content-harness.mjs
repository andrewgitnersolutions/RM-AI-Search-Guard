/**
 * Loads a built content script into node:vm with a minimal DOM stub and a controllable
 * `chrome` stub, for logic tests that need exact control over message timing (U-20).
 * Runs in: Node test runner only. No page, no network.
 *
 * The DOM stub models only what the policy-load path touches: <html> attributes, an empty
 * document (every query matches nothing), readyState "loading" (so no sweeps run) and no body.
 * Each GET_EFFECTIVE_POLICY call returns a promise the test resolves itself, in any order.
 * window.location starts at opts.href; location.replace() is recorded in `replaced`, never run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Load the content script of a target build.
 * @param {{ dir: string }} target - Build folder.
 * @param {{ href?: string }} [opts] - href: the page URL (default a plain Web search).
 * @returns {object} { attrs, policyRequests, replaced, setHref, fireStorageChange, fireWindowEvent, flush }
 */
export function loadContentScript(target, opts = {}) {
  const file = path.join(target.dir, "content/content.js");
  const code = readFileSync(file, "utf8");
  const attrs = new Map();
  const policyRequests = [];
  const storageListeners = [];
  const documentElement = {
    tagName: "HTML",
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => attrs.get(k) ?? null,
    hasAttribute: (k) => attrs.has(k),
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const document = {
    documentElement,
    body: null,
    readyState: "loading",
    location: { href: "https://www.google.com/search?q=x" },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const start = new URL(opts.href ?? "https://www.google.com/search?q=x&udm=14");
  const replaced = [];
  const windowListeners = {};
  const window = {
    location: {
      href: start.href,
      pathname: start.pathname,
      search: start.search,
      hash: start.hash,
      replace: (url) => replaced.push(String(url)),
    },
    history: { replaceState() {} },
    addEventListener: (name, fn) => (windowListeners[name] ??= []).push(fn),
    requestAnimationFrame() {},
  };
  const chrome = {
    runtime: {
      sendMessage(msg) {
        if (msg?.type !== "GET_EFFECTIVE_POLICY") return Promise.resolve({ ok: true });
        return new Promise((resolve) => policyRequests.push(resolve));
      },
    },
    storage: {
      managed: { get: async () => ({}) },
      local: { get: async () => ({}) },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const ctx = vm.createContext({ window, document, chrome, MutationObserver, console, URL, URLSearchParams });
  new vm.Script(code, { filename: file }).runInContext(ctx);

  /** Let pending promise callbacks run. */
  const flush = () => new Promise((r) => setImmediate(r));

  return {
    attrs,
    policyRequests,
    replaced,
    flush,
    /** Change the page URL without a load, as history.pushState / back-forward would. */
    setHref(href) {
      const u = new URL(href);
      Object.assign(window.location, { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash });
    },
    /** Dispatch a window event (e.g. "popstate", "pageshow") to the content script's listeners. */
    fireWindowEvent(name) {
      for (const fn of windowListeners[name] ?? []) fn({ type: name });
    },
    /** Fire chrome.storage.onChanged for the local overrides key. */
    fireStorageChange() {
      for (const fn of storageListeners) void fn({ rmsg_local_overrides: { newValue: {} } }, "local");
    },
  };
}
