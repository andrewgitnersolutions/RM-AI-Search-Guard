/**
 * Loads a built content script into node:vm with a minimal DOM stub and a controllable
 * `chrome` stub, for logic tests that need exact control over message timing (U-20) or timers
 * and animation frames (U-21, U-22).
 * Runs in: Node test runner only. No page, no network.
 *
 * By default the DOM stub models only what the policy-load path touches: <html> attributes, an
 * empty document, readyState "loading" and no body. Tests can supply body/query helpers and
 * `fakeTimers: true` to exercise sweep throttling and metric batching deterministically.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Load the content script of a target build.
 * @param {{ dir: string }} target - Build folder.
 * @param {object} [opts] - Optional href, DOM overrides and fakeTimers mode.
 * @returns {object} Harness state and helpers.
 */
export function loadContentScript(target, opts = {}) {
  const file = path.join(target.dir, "content/content.js");
  const code = readFileSync(file, "utf8");
  const attrs = new Map();
  const policyRequests = [];
  const messages = [];
  const storageListeners = [];
  const windowListeners = {};
  const documentListeners = {};

  let now = opts.startNow ?? 1_000_000;
  let nextTimerId = 1;
  let nextRafId = 1;
  const timers = new Map();
  let rafQueue = [];

  const setTimer = opts.fakeTimers
    ? (fn, delay = 0) => {
        const id = nextTimerId++;
        timers.set(id, { id, fn, runAt: now + Math.max(0, Number(delay) || 0) });
        return id;
      }
    : (...args) => globalThis.setTimeout(...args);

  const clearTimer = opts.fakeTimers
    ? (id) => {
        timers.delete(id);
      }
    : (id) => globalThis.clearTimeout(id);

  const requestFrame = opts.fakeTimers
    ? (fn) => {
        const id = nextRafId++;
        rafQueue.push({ id, fn });
        return id;
      }
    : () => 0;

  const cancelFrame = opts.fakeTimers
    ? (id) => {
        rafQueue = rafQueue.filter((item) => item.id !== id);
      }
    : () => {};

  const activeObservers = new Set();
  class MutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.target = null;
      this.options = {};
    }
    observe(targetNode, options = {}) {
      this.target = targetNode;
      this.options = options ?? {};
      activeObservers.add(this);
    }
    disconnect() {
      this.target = null;
      this.options = {};
      activeObservers.delete(this);
    }
  }

  let rootAttrDeliveries = 0;
  let rootAttrOverflowError = null;
  const maxRootAttrDeliveries = opts.maxRootAttrDeliveries ?? 20;
  function deliverRootAttrMutation(attrName) {
    if (!opts.notifyRootAttributes) return;
    queueMicrotask(() => {
      const rootObservers = [...activeObservers].filter(
        (obs) =>
          obs.target === documentElement &&
          obs.options?.attributes === true &&
          (!obs.options.attributeFilter || obs.options.attributeFilter.includes(attrName)),
      );
      if (rootObservers.length === 0) return;
      rootAttrDeliveries += 1;
      if (rootAttrDeliveries > maxRootAttrDeliveries) {
        rootAttrOverflowError = new Error(`Root attribute observer loop exceeded ${maxRootAttrDeliveries} deliveries`);
        return;
      }
      for (const obs of rootObservers) {
        obs.cb([{ type: "attributes", target: documentElement, attributeName: attrName }], obs);
      }
    });
  }

  const documentElement = {
    tagName: "HTML",
    lang: opts.lang ?? "en",
    setAttribute: (k, v) => {
      attrs.set(k, String(v));
      deliverRootAttrMutation(k);
    },
    removeAttribute: (k) => {
      const existed = attrs.delete(k);
      if (existed) deliverRootAttrMutation(k);
    },
    getAttribute: (k) => attrs.get(k) ?? null,
    hasAttribute: (k) => attrs.has(k),
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const document = {
    documentElement,
    body: opts.body ?? null,
    readyState: opts.readyState ?? "loading",
    visibilityState: opts.visibilityState ?? "visible",
    location: { href: opts.href ?? "https://www.google.com/search?q=x" },
    querySelectorAll: opts.querySelectorAll ?? (() => []),
    querySelector: opts.querySelector ?? (() => null),
    getElementsByTagName: opts.getElementsByTagName ?? (() => []),
    addEventListener: (name, fn) => (documentListeners[name] ??= []).push(fn),
  };

  const start = new URL(opts.href ?? "https://www.google.com/search?q=x&udm=14");
  const replaced = [];
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
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
  };

  const localData = structuredClone(opts.local ?? {});
  const chrome = {
    runtime: {
      sendMessage(msg) {
        messages.push(JSON.parse(JSON.stringify(msg)));
        if (msg?.type !== "GET_EFFECTIVE_POLICY") return Promise.resolve({ ok: true });
        return new Promise((resolve) => policyRequests.push(resolve));
      },
    },
    storage: {
      managed: { get: async () => ({}) },
      local: {
        get: async (keys) => {
          if (opts.localGet) return opts.localGet(keys, localData);
          if (keys === null || keys === undefined) return structuredClone(localData);
          const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const out = {};
          for (const k of list) if (k in localData) out[k] = structuredClone(localData[k]);
          return out;
        },
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  };

  const globals = {
    window,
    document,
    chrome,
    MutationObserver,
    console,
    URL,
    URLSearchParams,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
  };

  const ctx = vm.createContext(globals);
  if (opts.fakeTimers) {
    ctx.__getNow__ = () => now;
    vm.runInContext(
      `(() => {
        const RealDate = Date;
        globalThis.Date = class extends RealDate {
          constructor(...a) { if (a.length === 0) super(__getNow__()); else super(...a); }
          static now() { return __getNow__(); }
        };
      })();`,
      ctx,
    );
  }
  new vm.Script(code, { filename: file }).runInContext(ctx);

  /** Let pending microtasks and promise callbacks run. */
  const flush = async () => {
    await new Promise((r) => setImmediate(r));
    if (rootAttrOverflowError) throw rootAttrOverflowError;
  };

  return {
    attrs,
    policyRequests,
    messages,
    replaced,
    flush,
    /** Remove an attribute on <html>, firing root attribute observers when notifyRootAttributes is enabled. */
    removeRootAttr(k) {
      documentElement.removeAttribute(k);
    },
    /** Count of root attribute mutation batches delivered to active root observers. */
    rootAttrDeliveries() {
      return rootAttrDeliveries;
    },
    /** Run every animation frame currently queued (fakeTimers mode). */
    flushRaf() {
      const current = rafQueue;
      rafQueue = [];
      for (const item of current) item.fn(now);
    },
    /** Advance the manual clock by ms and run due timers in chronological order (fakeTimers mode). */
    advanceTime(ms) {
      const targetNow = now + ms;
      while (true) {
        let next = null;
        for (const t of timers.values()) {
          if (t.runAt <= targetNow && (!next || t.runAt < next.runAt || (t.runAt === next.runAt && t.id < next.id))) {
            next = t;
          }
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.runAt;
        next.fn();
      }
      now = targetNow;
    },
    /** Count of pending timers (fakeTimers mode). */
    pendingTimers() {
      return timers.size;
    },
    /** Count of queued animation frames (fakeTimers mode). */
    pendingRafCount() {
      return rafQueue.length;
    },
    /** Simulate a DOM mutation under body by invoking active MutationObservers. */
    triggerMutation() {
      for (const obs of [...activeObservers]) {
        obs.cb([], obs);
      }
    },
    /** Change the page URL without a load, as history.pushState / back-forward would. */
    setHref(href) {
      const u = new URL(href);
      Object.assign(window.location, { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash });
    },
    /** Set document.documentElement.lang (e.g. "es-419", "fr"). */
    setLang(lang) {
      documentElement.lang = lang;
    },
    /** Set document.visibilityState (e.g. "hidden" or "visible"). */
    setVisibilityState(state) {
      document.visibilityState = state;
    },
    /** Dispatch a window event (e.g. "popstate", "pageshow", "pagehide"). */
    fireWindowEvent(name) {
      for (const fn of windowListeners[name] ?? []) fn({ type: name });
    },
    /** Dispatch a document event (e.g. "visibilitychange"). */
    fireDocumentEvent(name) {
      for (const fn of documentListeners[name] ?? []) fn({ type: name });
    },
    /** Fire chrome.storage.onChanged for the local overrides key. */
    fireStorageChange() {
      for (const fn of storageListeners) void fn({ rmsg_local_overrides: { newValue: {} } }, "local");
    },
    /** Fire chrome.storage.onChanged for a local counter reset epoch bump. */
    fireMetricsReset(epoch) {
      localData.rmsg_metrics_reset_epoch = epoch;
      for (const fn of storageListeners) void fn({ rmsg_metrics_reset_epoch: { newValue: epoch } }, "local");
    },
  };
}
