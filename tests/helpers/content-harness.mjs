/**
 * Loads a built content script into node:vm with a minimal DOM stub and a controllable
 * `chrome` stub, for logic tests that need exact control over message timing (U-20).
 * Runs in: Node test runner only. No page, no network.
 *
 * The DOM stub models only what the policy-load path touches: <html> attributes, an empty
 * document (every query matches nothing), readyState "loading" (so no sweeps run) and no body.
 * Each GET_EFFECTIVE_POLICY call returns a promise the test resolves itself, in any order.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Load the content script of a target build.
 * @param {{ dir: string }} target - Build folder.
 * @returns {object} { attrs, policyRequests, fireStorageChange, flush }
 */
export function loadContentScript(target) {
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
  const window = {
    location: { pathname: "/search", search: "?q=x", hash: "" },
    history: { replaceState() {} },
    addEventListener() {},
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
  const ctx = vm.createContext({ window, document, chrome, MutationObserver, console });
  new vm.Script(code, { filename: file }).runInContext(ctx);

  /** Let pending promise callbacks run. */
  const flush = () => new Promise((r) => setImmediate(r));

  return {
    attrs,
    policyRequests,
    flush,
    /** Fire chrome.storage.onChanged for the local overrides key. */
    fireStorageChange() {
      for (const fn of storageListeners) void fn({ rmsg_local_overrides: { newValue: {} } }, "local");
    },
  };
}
