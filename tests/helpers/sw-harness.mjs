/**
 * Loads a built service worker into node:vm with an in-memory `chrome` stub.
 * Runs in: Node test runner only. Never touches the network: fetch is injected per test.
 *
 * The bundled service worker has no import/export, so it runs as a classic script and its
 * top-level functions (parsePolicy, buildDynamicRules, handleRuntimeMessage, ...) become
 * properties of the vm context. Date and Math.random are fixed so two builds produce
 * byte-comparable observations.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const FIXED_NOW = Date.parse("2026-11-20T15:00:00.000Z");

/**
 * Build a chrome.storage area stub backed by a plain object.
 * @param {Record<string, unknown>} initial - Initial contents.
 * @param {{ getError?: string }} opts - Make get() reject with this message.
 * @returns {object} Storage area with get/set/remove and its backing `data`.
 */
function makeArea(initial, opts = {}) {
  const area = {
    data: structuredClone(initial ?? {}),
    writes: 0,
    async get(keys) {
      if (opts.getError) throw new (area.ErrorCtor ?? Error)(opts.getError);
      const all = structuredClone(area.data);
      if (keys === null || keys === undefined) return all;
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in all) out[k] = all[k];
      return out;
    },
    async set(obj) {
      area.writes += 1;
      Object.assign(area.data, structuredClone(obj));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete area.data[k];
    },
  };
  return area;
}

/**
 * Create a listener registry like chrome.*.onX.
 * @returns {{ addListener: Function, listeners: Function[] }}
 */
function makeEvent() {
  const listeners = [];
  return { listeners, addListener: (fn) => listeners.push(fn), removeListener() {}, hasListener: () => listeners.length > 0 };
}

/**
 * Load the service worker of a target build.
 * @param {{ dir: string }} target - Build folder.
 * @param {object} [opts]
 * @param {object} [opts.managed] - chrome.storage.managed contents.
 * @param {object} [opts.local] - chrome.storage.local contents.
 * @param {string} [opts.managedError] - Make managed reads fail.
 * @param {Function} [opts.fetch] - fetch implementation visible to the worker.
 * @param {string} [opts.installType] - chrome.management.getSelf().installType (BP-01 tests).
 * @param {string} [opts.installTypeError] - Make getSelf() reject with this message.
 * @param {boolean} [opts.noManagement] - Leave chrome.management undefined.
 * @returns {object} { ctx, chrome, send, fire, settle }
 */
export function loadServiceWorker(target, opts = {}) {
  const file = path.join(target.dir, "background/service-worker.js");
  const code = readFileSync(file, "utf8");
  const dynamicRules = [];
  const alarms = new Map();
  const events = {
    onInstalled: makeEvent(),
    onStartup: makeEvent(),
    onMessage: makeEvent(),
    onChanged: makeEvent(),
    onAlarm: makeEvent(),
  };
  const chrome = {
    runtime: {
      id: "testextensionid",
      getManifest: () => ({ version: opts.version ?? "1.0.0" }),
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onMessage: events.onMessage,
      lastError: undefined,
    },
    management: opts.noManagement
      ? undefined
      : {
          async getSelf() {
            if (opts.installTypeError) throw new Error(opts.installTypeError);
            return { installType: opts.installType ?? "development" };
          },
        },
    storage: {
      managed: makeArea(opts.managed ?? {}, { getError: opts.managedError }),
      local: makeArea(opts.local ?? {}),
      onChanged: events.onChanged,
    },
    declarativeNetRequest: {
      updates: [],
      async getDynamicRules() {
        return structuredClone(dynamicRules);
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        chrome.declarativeNetRequest.updates.push(structuredClone({ removeRuleIds, addRules }));
        for (let i = dynamicRules.length - 1; i >= 0; i -= 1) if (removeRuleIds.includes(dynamicRules[i].id)) dynamicRules.splice(i, 1);
        dynamicRules.push(...structuredClone(addRules));
      },
    },
    alarms: {
      map: alarms,
      async create(name, info) {
        alarms.set(name, structuredClone({ name, ...info }));
      },
      async clear(name) {
        return alarms.delete(name);
      },
      async get(name) {
        return alarms.get(name);
      },
      async getAll() {
        return [...alarms.values()];
      },
      onAlarm: events.onAlarm,
    },
  };
  const fetchCalls = [];
  const fetchImpl = opts.fetch
    ? async (url, init) => {
        fetchCalls.push({ url, init: { ...init, signal: undefined } });
        try {
          return await opts.fetch(url, init);
        } catch (err) {
          // Re-throw in the worker's realm, as real fetch would, so `instanceof Error` holds.
          const RealmError = vm.runInContext("Error", ctx);
          const e = new RealmError(err.message);
          e.name = err.name;
          throw e;
        }
      }
    : async () => {
        throw new Error("network disabled in tests");
      };
  const ctx = vm.createContext({
    chrome,
    console,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    AbortController,
    structuredClone,
    __FIXED_NOW__: FIXED_NOW,
  });
  // Deterministic clock and RNG so baseline and rebuilt workers produce identical output.
  vm.runInContext(
    `(() => {
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...a) { if (a.length === 0) super(__FIXED_NOW__); else super(...a); }
        static now() { return __FIXED_NOW__; }
      };
      let seed = 42;
      Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    })();`,
    ctx,
  );
  // Chrome API errors are thrown in the caller's realm; match that for `instanceof Error` checks.
  chrome.storage.managed.ErrorCtor = vm.runInContext("Error", ctx);
  chrome.storage.local.ErrorCtor = chrome.storage.managed.ErrorCtor;
  new vm.Script(code, { filename: file }).runInContext(ctx);

  /**
   * Deliver a runtime message through the registered onMessage listener.
   * @param {object} message - Message.
   * @param {object} [sender] - Sender (defaults to an extension page).
   * @returns {Promise<unknown>} The value passed to sendResponse.
   */
  function send(message, sender = { id: "testextensionid", url: "chrome-extension://testextensionid/ui/options.html" }) {
    return new Promise((resolve) => {
      const listener = events.onMessage.listeners[0];
      const keepOpen = listener(message, sender, resolve);
      if (keepOpen !== true) resolve(undefined);
    });
  }

  /**
   * Invoke every listener of an event and wait for them.
   * @param {string} name - Event key (onInstalled, onStartup, onChanged, onAlarm).
   * @param {...unknown} args - Listener arguments.
   */
  async function fire(name, ...args) {
    await Promise.all(events[name].listeners.map((fn) => fn(...args)));
  }

  return { ctx, chrome, send, fire, fetchCalls, dynamicRules, alarms };
}
