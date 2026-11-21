/**
 * Admin Policy Generator: per-grade-band toggles that render Google Admin Console
 * "Policy for extensions" JSON to copy or download.
 * Runs in: extension page (options.html, Generator tab).
 * Must never: send generated JSON or settings anywhere; output leaves only via copy/download.
 * Shared with: shared/defaults.ts, shared/policy.ts, ui/options.ts.
 */

import { FEATURE_TOGGLE_KEYS, GRADE_BAND_PRESETS } from "../shared/defaults";
import { formatAdminConsolePolicyJson, validatePolicyDraft } from "../shared/policy";

export const PRIMARY_BANDS = ["K-2", "3-5", "6-8", "9-12"];

export const ALL_BANDS = ["K-2", "3-5", "6-8", "9-12", "Staff"];

export const TOGGLE_LABELS = {
  masterEnabled: "Master Protection Switch",
  hideAiOverviews: "Hide AI Overviews",
  hideAiModeUi: "Hide AI Mode Buttons & Tabs",
  blockAiModeNavigation: "Block & Redirect AI Mode URLs",
  forceWebOnlySearch: "Force Web-Only Search (udm=14)",
  hideAuxiliaryAiFeatures: "Hide Auxiliary AI (Labs / Lens / Follow-Ups)"
};

/**
 * Counter that keeps element IDs unique if the generator is mounted more than once.
 */
export let mountInstanceCounter = 0;

/**
 * Copy the recommended presets into editable per-band state.
 * @returns Map of band → { toggles }.
 */
export function createDefaultBandStates() {
  return {
    "K-2": { ...GRADE_BAND_PRESETS["K-2"].toggles },
    "3-5": { ...GRADE_BAND_PRESETS["3-5"].toggles },
    "6-8": { ...GRADE_BAND_PRESETS["6-8"].toggles },
    "9-12": { ...GRADE_BAND_PRESETS["9-12"].toggles },
    Staff: { ...GRADE_BAND_PRESETS.Staff.toggles }
  };
}

/**
 * Render one band's settings as formatted Admin Console JSON.
 * @param gradeBand - Band label.
 * @param toggles - Feature toggles.
 * @returns Pretty-printed JSON string.
 */
export function buildBandAdminJsonString(gradeBand, toggles) {
  const payload = formatAdminConsolePolicyJson({
    gradeBand,
    ...toggles
  });
  return JSON.stringify(payload, null, 2);
}

/**
 * Copy text with the Clipboard API, falling back to execCommand.
 * @param text - Text to copy.
 * @returns true if copied.
 */
export async function copyTextToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
    }
  }
  if (typeof document === "undefined" || !document.body) {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.className = "visually-hidden";
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
}

/**
 * Download text as a file through a temporary Blob URL.
 * @param filename - Suggested file name.
 * @param content - File contents.
 * @param mimeType - MIME type.
 */
export function triggerFileDownload(filename, content, mimeType = "application/json") {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.className = "visually-hidden";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1e3);
}

/**
 * Add or remove an error ID from an input's aria-describedby.
 * @param input - Form control.
 * @param errorId - Error element ID.
 * @param shown - Whether the error is visible.
 */
export function syncFieldErrorLink(input, errorId, shown) {
  const existing = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id.length > 0 && id !== errorId);
  if (shown) {
    existing.push(errorId);
  }
  if (existing.length > 0) {
    input.setAttribute("aria-describedby", existing.join(" "));
  } else {
    input.removeAttribute("aria-describedby");
  }
}

/**
 * Render the generator UI into a container and wire its controls.
 * @param container - Mount element (its children are replaced).
 * @param options - Optional callbacks (onStatus).
 * A draft that fails validation is still copied, with a warning in the status line.
 */
export function mountPolicyGenerator(container, options) {
  mountInstanceCounter += 1;
  const idPrefix = `rm-pg-${mountInstanceCounter}`;
  let bandStates = createDefaultBandStates();
  let showStaffBand = false;
  container.replaceChildren();
  const root = document.createElement("div");
  root.className = "pg-root";
  const errorAnnouncer = document.createElement("div");
  errorAnnouncer.setAttribute("aria-live", "polite");
  errorAnnouncer.className = "visually-hidden";
  root.append(errorAnnouncer);
  const introCard = document.createElement("section");
  introCard.className = "rm-card";
  const introTitle = document.createElement("h2");
  introTitle.className = "rm-section-title";
  introTitle.textContent = "4-Band Google Admin Console Policy Generator";
  const introDesc = document.createElement("p");
  introDesc.className = "rm-section-subtitle";
  introDesc.textContent = "Configure grade-band controls below, then paste each OU JSON into Google Admin Console under Devices \u2192 Chrome \u2192 Apps & extensions \u2192 Users & browsers \u2192 Policy for extensions.";
  const udmCallout = document.createElement("div");
  udmCallout.className = "rm-callout rm-callout-amber mt-sm";
  const udmText = document.createElement("span");
  udmText.textContent = "Note: Google's Web-only mode (udm=14) hides AI Overviews while keeping Images, Videos, Shopping, and News tabs working, but also hides Knowledge Panels, Calculator, Unit Converter, and Dictionary cards. Recommended ON for Grades K\u20135 and OFF for Grades 6\u201312.";
  udmCallout.append(udmText);
  introCard.append(introTitle, introDesc, udmCallout);
  root.append(introCard);
  const toolbar = document.createElement("div");
  toolbar.className = "pg-toolbar";
  const leftButtons = document.createElement("div");
  leftButtons.className = "btn-row";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "rm-btn";
  resetBtn.textContent = "Reset to Recommended Presets";
  const staffToggleBtn = document.createElement("button");
  staffToggleBtn.type = "button";
  staffToggleBtn.className = "rm-btn";
  staffToggleBtn.setAttribute("aria-pressed", "false");
  staffToggleBtn.textContent = "Show Staff OU Preset";
  leftButtons.append(resetBtn, staffToggleBtn);
  const rightButtons = document.createElement("div");
  rightButtons.className = "btn-row";
  const downloadAllBtn = document.createElement("button");
  downloadAllBtn.type = "button";
  downloadAllBtn.className = "rm-btn rm-btn-navy";
  downloadAllBtn.textContent = "Download All 4 JSON Files";
  rightButtons.append(downloadAllBtn);
  toolbar.append(leftButtons, rightButtons);
  root.append(toolbar);
  const statusLine = document.createElement("p");
  statusLine.className = "status-line";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  root.append(statusLine);
  const setStatus = (message, isError = false) => {
    statusLine.textContent = message;
    statusLine.classList.toggle("status-line-error", isError);
    options?.onStatus?.(message);
  };
  const matrix = document.createElement("div");
  matrix.className = "pg-matrix";
  const cardRefs: Record<string, any> = {};
  for (const band of ALL_BANDS) {
    const preset = GRADE_BAND_PRESETS[band];
    const article = document.createElement("article");
    article.className = "band-card";
    article.dataset.gradeBand = band;
    if (band === "Staff") {
      article.hidden = !showStaffBand;
    }
    const header = document.createElement("div");
    header.className = "band-card-header";
    const title = document.createElement("h3");
    title.className = "band-card-title";
    title.textContent = band === "Staff" ? preset.label : `${preset.label} (${band})`;
    const subtitle = document.createElement("p");
    subtitle.className = "band-card-subtitle";
    subtitle.textContent = preset.subtitle;
    header.append(title, subtitle);
    const reminder = document.createElement("div");
    reminder.className = "band-reminder";
    reminder.dataset.aimodeReminder = band;
    reminder.append(
      document.createTextNode("Also set "),
      (() => {
        const code = document.createElement("code");
        code.textContent = "AIModeSettings = Do not allow (1)";
        return code;
      })(),
      document.createTextNode(" in this OU")
    );
    const togglesContainer = document.createElement("div");
    togglesContainer.className = "band-toggles";
    const toggleInputs = {};
    const toggleItems = {};
    for (const key of FEATURE_TOGGLE_KEYS) {
      const item = document.createElement("div");
      item.className = "band-toggle-item";
      const inputId = `${idPrefix}-${band}-${key}`;
      const label = document.createElement("label");
      label.htmlFor = inputId;
      label.className = "band-toggle-label";
      label.textContent = TOGGLE_LABELS[key];
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.className = "rm-switch";
      input.id = inputId;
      input.dataset.gradeBand = band;
      input.dataset.toggleKey = key;
      input.checked = bandStates[band][key];
      input.addEventListener("change", () => {
        bandStates[band][key] = input.checked;
        renderBandCard(band);
      });
      toggleInputs[key] = input;
      toggleItems[key] = item;
      item.append(label, input);
      togglesContainer.append(item);
    }
    const pre = document.createElement("pre");
    pre.className = "json-preview";
    const codeEl = document.createElement("code");
    codeEl.dataset.jsonOutput = band;
    pre.append(codeEl);
    const actions = document.createElement("div");
    actions.className = "band-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "rm-btn rm-btn-primary rm-btn-sm";
    copyBtn.dataset.copyBand = band;
    const copySr = document.createElement("span");
    copySr.className = "visually-hidden";
    copySr.textContent = ` for ${band}`;
    copyBtn.append(document.createTextNode("Copy Google Admin Console JSON"), copySr);
    copyBtn.addEventListener("click", async () => {
      const draftCheck = validatePolicyDraft({ gradeBand: band });
      const jsonText = buildBandAdminJsonString(band, bandStates[band]);
      const copied = await copyTextToClipboard(jsonText);
      if (!copied) {
        setStatus(`Could not copy ${band} JSON automatically. Select and copy from the preview box.`, true);
        return;
      }
      if (!draftCheck.valid) {
        setStatus(`Copied ${band} JSON (warning: ${draftCheck.errors[0]}).`, true);
      } else {
        setStatus(`Copied Google Admin Console JSON for ${band}.`);
      }
    });
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "rm-btn rm-btn-sm";
    dlBtn.dataset.downloadBand = band;
    const dlSr = document.createElement("span");
    dlSr.className = "visually-hidden";
    dlSr.textContent = ` for ${band}`;
    dlBtn.append(document.createTextNode("Download .json"), dlSr);
    dlBtn.addEventListener("click", () => {
      const jsonText = buildBandAdminJsonString(band, bandStates[band]);
      triggerFileDownload(`raisemark-ai-search-controls-${band}.json`, jsonText);
      setStatus(`Downloaded raisemark-ai-search-controls-${band}.json.`);
    });
    actions.append(copyBtn, dlBtn);
    article.append(header, reminder, togglesContainer, pre, actions);
    matrix.append(article);
    cardRefs[band] = {
      article,
      reminder,
      codeEl,
      toggleInputs,
      toggleItems
    };
  }
  root.append(matrix);
  container.append(root);
  function renderBandCard(band) {
    const refs = cardRefs[band];
    const toggles = bandStates[band];
    for (const key of FEATURE_TOGGLE_KEYS) {
      refs.toggleInputs[key].checked = toggles[key];
      if (key !== "masterEnabled") {
        refs.toggleItems[key].classList.toggle("band-toggle-item-paused", !toggles.masterEnabled);
      }
    }
    const showAiModeReminder = toggles.masterEnabled && (toggles.blockAiModeNavigation || toggles.hideAiModeUi);
    refs.reminder.hidden = !showAiModeReminder;
    refs.codeEl.textContent = buildBandAdminJsonString(band, toggles);
  }
  function renderAllBands() {
    for (const band of ALL_BANDS) {
      renderBandCard(band);
    }
  }
  resetBtn.addEventListener("click", () => {
    bandStates = createDefaultBandStates();
    renderAllBands();
    setStatus("Reset all grade-band cards to recommended K\u201312 presets.");
  });
  staffToggleBtn.addEventListener("click", () => {
    showStaffBand = !showStaffBand;
    cardRefs.Staff.article.hidden = !showStaffBand;
    staffToggleBtn.setAttribute("aria-pressed", String(showStaffBand));
    staffToggleBtn.textContent = showStaffBand ? "Hide Staff OU Preset" : "Show Staff OU Preset";
  });
  downloadAllBtn.addEventListener("click", () => {
    for (const band of PRIMARY_BANDS) {
      const jsonText = buildBandAdminJsonString(band, bandStates[band]);
      triggerFileDownload(`raisemark-ai-search-controls-${band}.json`, jsonText);
    }
    setStatus("Downloaded all 4 grade-band JSON files (K-2, 3-5, 6-8, 9-12).");
  });
  renderAllBands();
}
