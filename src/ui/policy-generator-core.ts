/**
 * Admin Policy Generator: per-grade-band toggles that render Google Admin Console
 * "Policy for extensions" JSON to copy or download.
 * Runs in: extension page (options.html, Generator tab).
 * Must never: send generated JSON or settings anywhere; output leaves only via copy/download.
 * Shared with: shared/defaults.ts, shared/policy.ts, ui/options.ts.
 */

import { EXTRA_SELECTOR_CATEGORIES, FEATURE_TOGGLE_KEYS, GRADE_BAND_PRESETS, MAX_EXTRA_SELECTORS_PER_CATEGORY, MAX_EXTRA_SELECTOR_LENGTH } from "../shared/defaults";
import { formatAdminConsolePolicyJson, trimCssWhitespace, validatePolicyDraft } from "../shared/policy";
import type { ExtraSelectorCategory, GradeBand, ToggleKey, Toggles } from "../shared/types";

/** A grade band that has a generator card (every band but "Unassigned"). */
export type PresetBand = Exclude<GradeBand, "Unassigned">;

/** DOM nodes of one band card that renderBandCard() updates. */
interface BandCardRefs {
  article: HTMLElement;
  reminder: HTMLElement;
  codeEl: HTMLElement;
  toggleInputs: Record<ToggleKey, HTMLInputElement>;
  toggleItems: Record<ToggleKey, HTMLElement>;
  extraTextareas: Record<ExtraSelectorCategory, HTMLTextAreaElement>;
  extraErrors: Record<ExtraSelectorCategory, HTMLElement>;
}

export const EXTRA_SELECTOR_LABELS: Record<ExtraSelectorCategory, string> = {
  overview: "AI Overview selectors",
  aimode: "AI Mode UI selectors",
  aux: "Auxiliary AI selectors"
};

export const PRIMARY_BANDS: PresetBand[] = ["K-2", "3-5", "6-8", "9-12"];

export const ALL_BANDS: PresetBand[] = ["K-2", "3-5", "6-8", "9-12", "Staff"];

export const TOGGLE_LABELS: Record<ToggleKey, string> = {
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
export function createDefaultBandStates(): Record<PresetBand, Toggles> {
  return {
    "K-2": { ...GRADE_BAND_PRESETS["K-2"].toggles },
    "3-5": { ...GRADE_BAND_PRESETS["3-5"].toggles },
    "6-8": { ...GRADE_BAND_PRESETS["6-8"].toggles },
    "9-12": { ...GRADE_BAND_PRESETS["9-12"].toggles },
    Staff: { ...GRADE_BAND_PRESETS.Staff.toggles }
  };
}

/**
 * Create empty per-band raw textarea strings for extraHideSelectors.
 * @returns Map of band -> { overview, aimode, aux } initialized to "".
 */
export function createDefaultExtraRawStates(): Record<PresetBand, Record<ExtraSelectorCategory, string>> {
  return {
    "K-2": { overview: "", aimode: "", aux: "" },
    "3-5": { overview: "", aimode: "", aux: "" },
    "6-8": { overview: "", aimode: "", aux: "" },
    "9-12": { overview: "", aimode: "", aux: "" },
    Staff: { overview: "", aimode: "", aux: "" }
  };
}

/**
 * Parse and validate newline-separated CSS selectors from one extraHideSelectors textarea.
 * Checks line count (<=20), length (<=300 chars) and native CSS selector syntax via a
 * detached DocumentFragment probe when DOM APIs exist.
 * @param raw - Raw textarea string.
 * @returns Trimmed non-empty selector list and optional validation error message.
 */
export function parseExtraSelectorsInput(raw: string): { selectors: string[]; error: string | null } {
  const selectors = raw
    .split(/\r?\n/)
    .map((line) => trimCssWhitespace(line))
    .filter((line) => line.length > 0);
  if (selectors.length > MAX_EXTRA_SELECTORS_PER_CATEGORY) {
    return {
      selectors,
      error: `At most ${MAX_EXTRA_SELECTORS_PER_CATEGORY} selectors per category are allowed.`
    };
  }
  for (const line of selectors) {
    if (line.length > MAX_EXTRA_SELECTOR_LENGTH) {
      return {
        selectors,
        error: `Each selector must be at most ${MAX_EXTRA_SELECTOR_LENGTH} characters.`
      };
    }
  }
  if (typeof document !== "undefined" && typeof document.createDocumentFragment === "function") {
    const probe = document.createDocumentFragment();
    for (const line of selectors) {
      try {
        probe.querySelector(line);
      } catch {
        return {
          selectors,
          error: `Invalid CSS selector syntax: "${line.slice(0, 60)}"`
        };
      }
    }
  }
  return { selectors, error: null };
}

/**
 * Render one band's settings as formatted Admin Console JSON.
 * @param gradeBand - Band label.
 * @param toggles - Feature toggles.
 * @param extraHideSelectors - Optional per-category custom selectors (omitted when empty).
 * @returns Pretty-printed JSON string.
 */
export function buildBandAdminJsonString(
  gradeBand: string,
  toggles: Toggles,
  extraHideSelectors?: Partial<Record<ExtraSelectorCategory, string[]>>
): string {
  const payload = formatAdminConsolePolicyJson({
    gradeBand,
    ...toggles,
    extraHideSelectors
  });
  return JSON.stringify(payload, null, 2);
}

/**
 * Copy text with the Clipboard API, falling back to execCommand.
 * @param text - Text to copy.
 * @returns true if copied.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
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
export function triggerFileDownload(filename: string, content: string, mimeType: string = "application/json"): void {
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
export function syncFieldErrorLink(input: Element, errorId: string, shown: boolean): void {
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
export function mountPolicyGenerator(container: HTMLElement, options?: { onStatus?: (message: string) => void }): void {
  mountInstanceCounter += 1;
  const idPrefix = `rm-pg-${mountInstanceCounter}`;
  let bandStates = createDefaultBandStates();
  let extraRawStates = createDefaultExtraRawStates();
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
  const setStatus = (message: string, isError = false) => {
    statusLine.textContent = message;
    statusLine.classList.toggle("status-line-error", isError);
    options?.onStatus?.(message);
  };
  const matrix = document.createElement("div");
  matrix.className = "pg-matrix";
  const cardRefs = {} as Record<PresetBand, BandCardRefs>;
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
    const toggleInputs = {} as Record<ToggleKey, HTMLInputElement>;
    const toggleItems = {} as Record<ToggleKey, HTMLElement>;
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
    const advancedDetails = document.createElement("details");
    advancedDetails.className = "band-advanced";
    advancedDetails.dataset.advancedBand = band;
    const advancedSummary = document.createElement("summary");
    advancedSummary.className = "band-advanced-summary";
    advancedSummary.textContent = "Advanced: Extra Hide Selectors (Hotfix)";
    const advancedBody = document.createElement("div");
    advancedBody.className = "band-advanced-body";
    const hintId = `${idPrefix}-${band}-extra-hint`;
    const advancedHint = document.createElement("p");
    advancedHint.id = hintId;
    advancedHint.className = "field-hint";
    advancedHint.textContent = `Optional CSS selectors (one per line, max ${MAX_EXTRA_SELECTORS_PER_CATEGORY} per category, max ${MAX_EXTRA_SELECTOR_LENGTH} chars each). Only emitted in JSON when filled.`;
    advancedBody.append(advancedHint);
    const extraTextareas = {} as Record<ExtraSelectorCategory, HTMLTextAreaElement>;
    const extraErrors = {} as Record<ExtraSelectorCategory, HTMLElement>;
    for (const category of EXTRA_SELECTOR_CATEGORIES) {
      const row = document.createElement("div");
      row.className = "field-row";
      const inputId = `${idPrefix}-${band}-extra-${category}`;
      const errorId = `${inputId}-error`;
      const label = document.createElement("label");
      label.htmlFor = inputId;
      label.className = "field-label";
      label.textContent = EXTRA_SELECTOR_LABELS[category];
      const textarea = document.createElement("textarea");
      textarea.id = inputId;
      textarea.name = `${band}-extra-${category}`;
      textarea.className = "rm-textarea";
      textarea.rows = 2;
      textarea.setAttribute("autocorrect", "off");
      textarea.setAttribute("autocapitalize", "none");
      textarea.spellcheck = false;
      textarea.setAttribute("aria-invalid", "false");
      textarea.setAttribute("aria-describedby", hintId);
      textarea.dataset.gradeBand = band;
      textarea.dataset.extraCategory = category;
      const errorEl = document.createElement("p");
      errorEl.id = errorId;
      errorEl.className = "field-error";
      errorEl.hidden = true;
      textarea.addEventListener("input", () => {
        extraRawStates[band][category] = textarea.value;
        renderBandCard(band);
        // Clear existing error state as soon as input becomes valid; never nag on every keystroke.
        if (textarea.getAttribute("aria-invalid") === "true") {
          const check = parseExtraSelectorsInput(textarea.value);
          if (!check.error) {
            textarea.setAttribute("aria-invalid", "false");
            errorEl.textContent = "";
            errorEl.hidden = true;
            syncFieldErrorLink(textarea, errorId, false);
          }
        }
      });
      textarea.addEventListener("blur", () => {
        validateExtraCategory(band, category, true);
      });
      extraTextareas[category] = textarea;
      extraErrors[category] = errorEl;
      row.append(label, textarea, errorEl);
      advancedBody.append(row);
    }
    advancedDetails.append(advancedSummary, advancedBody);
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
      const extraValidation = collectAndValidateBandExtras(band);
      const draftCheck = validatePolicyDraft({
        gradeBand: band,
        extraHideSelectors: extraValidation.selectors
      });
      const jsonText = buildBandAdminJsonString(band, bandStates[band], extraValidation.selectors);
      const copied = await copyTextToClipboard(jsonText);
      if (!copied) {
        setStatus(`Could not copy ${band} JSON automatically. Select and copy from the preview box.`, true);
        return;
      }
      const warning = extraValidation.firstError ?? draftCheck.errors[0];
      if (warning) {
        setStatus(`Copied ${band} JSON (warning: ${warning}).`, true);
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
      const extraValidation = collectAndValidateBandExtras(band);
      const draftCheck = validatePolicyDraft({
        gradeBand: band,
        extraHideSelectors: extraValidation.selectors
      });
      const jsonText = buildBandAdminJsonString(band, bandStates[band], extraValidation.selectors);
      triggerFileDownload(`raisemark-ai-search-controls-${band}.json`, jsonText);
      const warning = extraValidation.firstError ?? draftCheck.errors[0];
      if (warning) {
        setStatus(`Downloaded raisemark-ai-search-controls-${band}.json (warning: ${warning}).`, true);
      } else {
        setStatus(`Downloaded raisemark-ai-search-controls-${band}.json.`);
      }
    });
    actions.append(copyBtn, dlBtn);
    article.append(header, reminder, togglesContainer, advancedDetails, pre, actions);
    matrix.append(article);
    cardRefs[band] = {
      article,
      reminder,
      codeEl,
      toggleInputs,
      toggleItems,
      extraTextareas,
      extraErrors
    };
  }
  root.append(matrix);
  container.append(root);
  /**
   * Validate one extra-selector textarea, sync aria-invalid / aria-describedby, and optionally announce.
   * @param band - Grade band card.
   * @param category - Selector category.
   * @param announceError - Whether to push validation message to the polite live region.
   * @returns Parsed selectors and optional error message.
   */
  function validateExtraCategory(band: PresetBand, category: ExtraSelectorCategory, announceError: boolean) {
    const refs = cardRefs[band];
    const textarea = refs.extraTextareas[category];
    const errorEl = refs.extraErrors[category];
    const parsed = parseExtraSelectorsInput(extraRawStates[band][category]);
    const hasError = parsed.error !== null;
    textarea.setAttribute("aria-invalid", hasError ? "true" : "false");
    errorEl.textContent = parsed.error ?? "";
    errorEl.hidden = !hasError;
    syncFieldErrorLink(textarea, errorEl.id, hasError);
    if (hasError && announceError) {
      errorAnnouncer.textContent = "";
      errorAnnouncer.textContent = `${EXTRA_SELECTOR_LABELS[category]} (${band}): ${parsed.error}`;
    }
    return parsed;
  }
  /**
   * Validate all three extra-selector categories on a card and gather their parsed arrays.
   * @param band - Grade band card.
   * @returns Per-category selector arrays and the first validation error, if any.
   */
  function collectAndValidateBandExtras(band: PresetBand) {
    const selectors = {} as Record<ExtraSelectorCategory, string[]>;
    let firstError: string | null = null;
    for (const category of EXTRA_SELECTOR_CATEGORIES) {
      const parsed = validateExtraCategory(band, category, false);
      selectors[category] = parsed.selectors;
      if (!firstError && parsed.error) {
        firstError = parsed.error;
      }
    }
    return { selectors, firstError };
  }
  /**
   * Read parsed extra selectors for one band without toggling validation UI state.
   * @param band - Grade band card.
   * @returns Per-category selector arrays.
   */
  function getBandExtraSelectors(band: PresetBand): Record<ExtraSelectorCategory, string[]> {
    return {
      overview: parseExtraSelectorsInput(extraRawStates[band].overview).selectors,
      aimode: parseExtraSelectorsInput(extraRawStates[band].aimode).selectors,
      aux: parseExtraSelectorsInput(extraRawStates[band].aux).selectors
    };
  }
  function renderBandCard(band: PresetBand): void {
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
    refs.codeEl.textContent = buildBandAdminJsonString(band, toggles, getBandExtraSelectors(band));
  }
  function renderAllBands() {
    for (const band of ALL_BANDS) {
      renderBandCard(band);
    }
  }
  resetBtn.addEventListener("click", () => {
    bandStates = createDefaultBandStates();
    extraRawStates = createDefaultExtraRawStates();
    for (const band of ALL_BANDS) {
      const refs = cardRefs[band];
      for (const category of EXTRA_SELECTOR_CATEGORIES) {
        const textarea = refs.extraTextareas[category];
        const errorEl = refs.extraErrors[category];
        textarea.value = "";
        textarea.setAttribute("aria-invalid", "false");
        errorEl.textContent = "";
        errorEl.hidden = true;
        syncFieldErrorLink(textarea, errorEl.id, false);
      }
    }
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
    let firstWarning: string | null = null;
    for (const band of PRIMARY_BANDS) {
      const extraValidation = collectAndValidateBandExtras(band);
      if (!firstWarning && extraValidation.firstError) {
        firstWarning = `${band}: ${extraValidation.firstError}`;
      }
      const jsonText = buildBandAdminJsonString(band, bandStates[band], extraValidation.selectors);
      triggerFileDownload(`raisemark-ai-search-controls-${band}.json`, jsonText);
    }
    if (firstWarning) {
      setStatus(`Downloaded all 4 grade-band JSON files (warning in ${firstWarning}).`, true);
    } else {
      setStatus("Downloaded all 4 grade-band JSON files (K-2, 3-5, 6-8, 9-12).");
    }
  });
  renderAllBands();
}
