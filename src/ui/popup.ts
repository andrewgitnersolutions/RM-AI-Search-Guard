/**
 * Toolbar popup: one-line "managed by your school" view, or a short unmanaged status view
 * with a link to the Options hub.
 * Runs in: extension page (popup.html).
 * Must never: change policy or send anything off the device.
 * Shared with: shared/defaults.ts, shared/policy.ts.
 */

import { FEATURE_TOGGLE_KEYS, STORAGE_KEYS } from "../shared/defaults";
import { parsePolicy } from "../shared/policy";
import type { EffectivePolicy, RawRecord } from "../shared/types";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build the 18×18 shield icon with DOM APIs (no innerHTML).
 * @param className - Class for the <svg>.
 * @returns SVG element.
 */
function createShieldIcon(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const shieldPath = document.createElementNS(SVG_NS, "path");
  shieldPath.setAttribute("d", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z");
  const checkPath = document.createElementNS(SVG_NS, "path");
  checkPath.setAttribute("d", "m9 12 2 2 4-4");
  svg.append(shieldPath, checkPath);
  return svg;
}

/**
 * Count enabled protections, excluding the master switch.
 * @param policy - Effective policy.
 * @returns Number of the five feature toggles that are on.
 */
function countActiveProtections(policy: EffectivePolicy): number {
  if (!policy.masterEnabled) {
    return 0;
  }
  let count = 0;
  for (const key of FEATURE_TOGGLE_KEYS) {
    if (policy[key]) {
      count += 1;
    }
  }
  return count;
}

/**
 * Open the Options hub, falling back to a new tab if openOptionsPage fails.
 */
async function openOptionsPageSafe() {
  if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
  }
}

/**
 * Render the managed or unmanaged popup view.
 * @param root - Mount element.
 * @param policy - Effective policy.
 * @param onOpenOptions - Click handler for the Options link.
 */
function renderPopup(root: HTMLElement, policy: EffectivePolicy, onOpenOptions?: () => void): void {
  root.replaceChildren();
  if (policy.isManaged) {
    const notice = document.createElement("div");
    notice.className = "popup-managed";
    const icon = createShieldIcon("popup-managed-icon");
    const text = document.createElement("span");
    text.className = "popup-managed-text";
    text.textContent = "Managed by your school";
    notice.append(icon, text);
    root.append(notice);
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "popup-unmanaged";
  const header = document.createElement("div");
  header.className = "popup-unmanaged-header";
  const title = document.createElement("span");
  title.textContent = "RaiseMark: AI Search Controls for K-12";
  header.append(createShieldIcon("popup-managed-icon"), title);
  const statusPill = document.createElement("p");
  statusPill.className = "rm-pill rm-pill-amber";
  statusPill.textContent = "Local Test Mode \u2014 Unmanaged";
  const activeCount = countActiveProtections(policy);
  const summary = document.createElement("p");
  summary.className = "popup-summary";
  summary.textContent = policy.masterEnabled ? `${activeCount} of 6 protections active` : "0 of 6 protections active (Paused)";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "rm-btn rm-btn-primary popup-action-btn";
  openBtn.textContent = "Open Setup & Policy Generator";
  openBtn.addEventListener("click", () => {
    if (onOpenOptions) {
      onOpenOptions();
    } else {
      void openOptionsPageSafe();
    }
  });
  wrapper.append(header, statusPill, summary, openBtn);
  root.append(wrapper);
}

/**
 * Resolve the policy to display: managed storage, then the service worker, then local overrides.
 * @returns Effective policy. With no managed keys this shows the unmanaged view (BP-01).
 */
async function resolvePopupPolicy(): Promise<EffectivePolicy> {
  if (typeof chrome !== "undefined" && chrome.storage?.managed?.get) {
    try {
      const managedRaw = await chrome.storage.managed.get(null);
      if (managedRaw && typeof managedRaw === "object" && Object.keys(managedRaw).length > 0) {
        return parsePolicy(managedRaw, null).policy;
      }
    } catch {
    }
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_EFFECTIVE_POLICY"
      }) as Partial<EffectivePolicy> | null;
      if (response && typeof response.isManaged === "boolean") {
        return response as EffectivePolicy;
      }
    } catch {
    }
  }
  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    try {
      const localResult = await chrome.storage.local.get(STORAGE_KEYS.LOCAL_OVERRIDES);
      const localRaw = (localResult[STORAGE_KEYS.LOCAL_OVERRIDES] ?? null) as RawRecord | null;
      return parsePolicy(null, localRaw).policy;
    } catch {
    }
  }
  return parsePolicy(null, null).policy;
}

/**
 * Resolve the policy and render the popup into #popup-root.
 */
async function bootPopup() {
  if (typeof document === "undefined" || typeof chrome === "undefined") {
    return;
  }
  const root = document.getElementById("popup-root");
  if (!root) {
    return;
  }
  const policy = await resolvePopupPolicy();
  renderPopup(root, policy, () => {
    void openOptionsPageSafe();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void bootPopup();
    });
  } else {
    void bootPopup();
  }
}

export {
  renderPopup
};
