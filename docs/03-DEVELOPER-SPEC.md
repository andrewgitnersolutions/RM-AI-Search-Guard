# 03 — Developer Specification (1-Shot MVP Implementation Blueprint)

> **Current Implementation Note (2026-11-21, v1.0.1 — Phases 0–5 Complete):** This document is the original MVP build blueprint kept for historical reference. Per [`docs/07-BREAKPOINT-AUDIT-LOG.md`](07-BREAKPOINT-AUDIT-LOG.md) (decisions D1–D8), the shipped product in `src/` and `dist/` is titled **RaiseMark: AI Search Controls for K-12** (`v1.0.1`), requires **Chrome / ChromeOS 134+**, uses `node --test` + Playwright (`npm test` / `npm run test:browser`), and **removes the optional Google Sheets / `script.google.com` analytics subsystem and `chrome.alarms` permission** (`archive/analytics-v1/`). Phases 1–5 also added `admin-no-policy` install-type locking, `shared/ai-mode-url.ts` (in-page AI Mode redirects), `background/messages.ts` (sender/shape gating), DNR rule 112 (query-preserving `/aimode?q=…`), English + Spanish selectors, `extraHideSelectors`, `WARN_UNSUPPORTED_UI_LANGUAGE`, `WARN_AI_SURFACE_VISIBLE`, throttled DOM sweeps, and batched per-page metrics. Where this blueprint differs from `docs/07-BREAKPOINT-AUDIT-LOG.md` or `src/`, `docs/07` and `src/` govern.

**Target:** Phase 1 Minimum Viable Prototype — **RaiseMark: AI Search Controls for K-12**  
**Stack:** TypeScript (strict), `esbuild`, Vanilla HTML/CSS (zero frontend frameworks), `node --test`, Playwright (`playwright` npm package)  
**MV3 Compliance Rules Enforced:**
* Strict `manifest_version: 3`, zero MV2 APIs.
* All PNG icons (`16×16`, `48×48`, `128×128`) generated as real verified PNG files in `dist/icons/`.
* Zero inline `<script>` tags and zero inline `on*` event handlers in any HTML file.
* Zero mutable state stored in Service Worker module-level variables (all state persisted in `chrome.storage.local`).
* `async`/`await` everywhere (no `.then()` chains); every async `chrome.runtime.onMessage` listener returns `true`.
* `chrome.alarms` used for all background scheduling (no `setInterval`/`setTimeout` in service worker).
* Content scripts batch DOM mutations with `requestAnimationFrame`.

---

## 1. Exact Repository Directory Structure

```text
raisemark-search-guard/
├── README.md
├── LICENSE                              # Standard MIT License (open source)
├── PRIVACY.md                           # Public K-12 Privacy Policy (FERPA/COPPA/SOPPA/NY Ed Law 2-d)
├── CHROMEWEBSTORE.md                    # Complete Chrome Web Store submission sheet
├── ONE_SHOT_PROMPT.md                   # Copy-paste prompt for 1-shot AI coding build
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docs/                                # Specification & runbook suite (01 through 06)
├── scripts/
│   ├── generate-icons.mjs               # Pure-Node PNG generator (16, 48, 128px) + IHDR verifier
│   ├── build.mjs                        # esbuild bundler -> dist/ + dist-admin-tool/ + zip helper
│   └── canary.ts                        # Paired Control vs Treatment Playwright Canary + .webm capture
├── templates/
│   └── apps-script/
│       └── Code.gs                      # District-owned $0 Google Sheets + Apps Script analytics sink
├── src/
│   ├── manifest.json                    # MV3 manifest (copied to dist/manifest.json)
│   ├── schema.json                      # Google Admin Console storage.managed_schema
│   ├── shared/
│   │   ├── types.ts                     # All TypeScript interfaces & RuntimeMessage union types
│   │   ├── defaults.ts                  # Strict Maximum Lockdown Defaults & grade-band presets
│   │   ├── errors.ts                    # Complete ERR_* / WARN_* catalog with actionable remediation
│   │   ├── policy.ts                    # Policy loader, validator, sanitizer & Admin JSON formatter
│   │   ├── selectors.ts                 # Versioned Tier 1 (semantic) + Tier 2 (structural) registry
│   │   └── storage.ts                   # Typed chrome.storage.local & chrome.storage.managed wrappers
│   ├── background/
│   │   ├── service-worker.ts            # Ephemeral MV3 SW entrypoint & message router
│   │   ├── dnr-rules.ts                 # Dynamic DNR rule builder (Priorities 55 / 50 / 40 / 30)
│   │   └── analytics.ts                 # Daily bucket aggregator, endpoint validator & jittered flusher
│   ├── content/
│   │   ├── static-guard.css             # Zero-flash CSS gated by html[data-rmsg-*="1"] attributes
│   │   ├── dom-engine.ts                # Multi-tier matcher + Organic Results Safety Guard (unit-testable)
│   │   └── content.ts                   # document_start orchestrator, hash telemetry reader, observer
│   └── ui/
│       ├── shared.css                   # Clean RaiseMark design tokens (accessible high-contrast)
│       ├── popup.html                   # Strict 1-line managed popup / minimal unmanaged launcher
│       ├── popup.ts
│       ├── options.html                 # 3-tab IT hub: Status/Test | Diagnostics | 4-Band Policy Generator
│       ├── options.ts
│       └── policy-generator-core.ts     # Shared generator logic bundled into BOTH options & standalone HTML
└── tests/
    ├── manifest.test.ts                 # Asserts strict least-privilege permissions & schema alignment
    ├── policy.test.ts                   # Fail-closed defaults, malformed JSON handling, Admin JSON output
    ├── dnr-rules.test.ts                # Priority order, RE2 regex matching, loop-freedom, Images/Videos pass
    ├── dom-engine.test.ts               # Tier 1/2 hiding, idempotency, Organic Results Safety Guard
    ├── analytics.test.ts                # Zero-PII payload whitelist, URL allowlist, delta subtraction, Apps Script
    └── ui.test.ts                       # Strict 1-line managed popup & Policy Generator output verification
```

---

## 2. Exact `src/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "RaiseMark Search Guard for K-12",
  "short_name": "Search Guard",
  "version": "1.0.0",
  "description": "Grade-level Google Admin Console controls to hide AI Overviews, remove AI Mode, and protect student search on Google.",
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_title": "RaiseMark Search Guard for K-12",
    "default_popup": "ui/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png"
    }
  },
  "options_page": "ui/options.html",
  "storage": {
    "managed_schema": "schema.json"
  },
  "permissions": [
    "storage",
    "declarativeNetRequestWithHostAccess",
    "alarms"
  ],
  "host_permissions": [
    "https://www.google.com/*",
    "https://google.com/*",
    "https://script.google.com/*",
    "https://script.googleusercontent.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.google.com/*",
        "https://google.com/*"
      ],
      "css": [
        "content/static-guard.css"
      ],
      "js": [
        "content/content.js"
      ],
      "run_at": "document_start"
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

---

## 3. Exact `src/schema.json` (Google Admin Console Managed Schema)

```json
{
  "type": "object",
  "properties": {
    "gradeBand": {
      "title": "Grade Band Label",
      "description": "Grade-band label for this Organizational Unit (used for diagnostics and anonymous aggregate analytics only).",
      "type": "string",
      "enum": ["K-2", "3-5", "6-8", "9-12", "Staff", "Unassigned"]
    },
    "masterEnabled": {
      "title": "Master Protection Switch",
      "description": "Enable or disable all Search Guard protections for this OU without uninstalling the extension. Defaults to true.",
      "type": "boolean"
    },
    "hideAiOverviews": {
      "title": "Hide Google AI Overviews",
      "description": "Suppress AI Overview summary boxes on Google Search results pages. Defaults to true.",
      "type": "boolean"
    },
    "hideAiModeUi": {
      "title": "Hide AI Mode Buttons & Tabs",
      "description": "Hide AI Mode buttons on the Google homepage, Search navigation bar, and 'Dive deeper in AI Mode' prompts. Defaults to true.",
      "type": "boolean"
    },
    "blockAiModeNavigation": {
      "title": "Block & Redirect AI Mode URLs",
      "description": "Silently redirect direct AI Mode URLs (?udm=50, google.com/ai, google.com/aimode) back to standard Google Search while preserving the query. Defaults to true.",
      "type": "boolean"
    },
    "forceWebOnlySearch": {
      "title": "Force Classic Web-Only Search (udm=14)",
      "description": "Redirect standard Google searches to classic Web-only results (udm=14) while preserving Images, Videos, Shopping, and News tabs. Note: udm=14 also hides Knowledge Panels, Calculator, and Dictionary cards. Defaults to true.",
      "type": "boolean"
    },
    "hideAuxiliaryAiFeatures": {
      "title": "Hide Auxiliary AI Features (Labs, Lens, AI Follow-Ups)",
      "description": "Hide Search Labs triggers, Google Lens search-bar buttons, AI follow-up input bars, and AI-generated prompt cards. Defaults to true.",
      "type": "boolean"
    },
    "analyticsEnabled": {
      "title": "Enable Optional District Google Sheets Analytics",
      "description": "When true and analyticsEndpointUrl is set, periodically flushes strictly anonymous daily aggregate counts to your district's Google Apps Script Web App. Defaults to false.",
      "type": "boolean"
    },
    "analyticsEndpointUrl": {
      "title": "District Google Apps Script Web App URL",
      "description": "Must match https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec owned by your district.",
      "type": "string"
    },
    "analyticsSharedToken": {
      "title": "Optional Shared Token for Apps Script Endpoint",
      "description": "Optional non-secret anti-spam token checked by your district's Code.gs webhook.",
      "type": "string"
    },
    "analyticsFlushIntervalMinutes": {
      "title": "Analytics Flush Interval (Minutes)",
      "description": "Base interval between anonymous batch flushes (60 to 1440 minutes; plus 0-30 min random jitter). Defaults to 240.",
      "type": "integer",
      "minimum": 60,
      "maximum": 1440
    }
  }
}
```

---

## 4. Core TypeScript Interfaces & Strict Maximum Lockdown Defaults

### `src/shared/types.ts`
```ts
export type GradeBand = 'K-2' | '3-5' | '6-8' | '9-12' | 'Staff' | 'Unassigned';

export type PolicySource = 'managed' | 'managed-degraded' | 'local-unmanaged' | 'defaults';

export interface FeatureToggles {
  masterEnabled: boolean;
  hideAiOverviews: boolean;
  hideAiModeUi: boolean;
  blockAiModeNavigation: boolean;
  forceWebOnlySearch: boolean;
  hideAuxiliaryAiFeatures: boolean;
}

export interface AnalyticsPolicy {
  analyticsEnabled: boolean;
  analyticsEndpointUrl: string;
  analyticsSharedToken: string;
  analyticsFlushIntervalMinutes: number;
}

export interface EffectivePolicy extends FeatureToggles, AnalyticsPolicy {
  gradeBand: GradeBand;
  source: PolicySource;
  isManaged: boolean;
  invalidFields: string[];
  evaluatedAt: string; // ISO date string
}

export type MetricKey =
  | 'overviewsHidden'
  | 'aiModeUiHidden'
  | 'aiModeRedirects'
  | 'omniboxFallbackRedirects'
  | 'auxAiHidden';

export type DailyMetrics = Record<MetricKey, number>;

export type ErrorSeverity = 'error' | 'warning';

export type ErrorCode =
  | 'ERR_POLICY_INVALID'
  | 'ERR_DNR_SYNC_FAILED'
  | 'ERR_SELECTOR_SYNTAX'
  | 'ERR_SAFETY_GUARD_TRIPPED'
  | 'ERR_ANALYTICS_ENDPOINT_INVALID'
  | 'ERR_ANALYTICS_FLUSH_FAILED'
  | 'ERR_STORAGE_FAILURE'
  | 'WARN_NO_MANAGED_POLICY'
  | 'WARN_OMNIBOX_POLICY_MISSING';

export interface DiagnosticLogEntry {
  code: ErrorCode;
  severity: ErrorSeverity;
  title: string;
  detail: string;
  remediation: string;
  count: number;
  firstSeenDate: string; // YYYY-MM-DD (no finer timestamps to prevent behavioral profiling)
  lastSeenDate: string;  // YYYY-MM-DD
}

export interface StoredTelemetryState {
  lifetimeMetrics: DailyMetrics;
  pendingMetricsByDate: Record<string, DailyMetrics>;
  pendingErrorsByCode: Partial<Record<ErrorCode, number>>;
  diagnosticLog: DiagnosticLogEntry[]; // Bounded max 50 distinct entries
  lastFlushAttemptDate: string | null;
  lastFlushSuccessDate: string | null;
  lastFlushStatus: 'idle' | 'ok' | 'error' | 'disabled';
  lastFlushMessage: string;
  consecutiveFlushFailures: number;
  nextEligibleFlushAtMs: number;
}

export interface AnalyticsFlushPayload {
  schemaVersion: 1;
  extensionVersion: string;
  token?: string;
  gradeBand: GradeBand;
  dateBucket: string; // YYYY-MM-DD
  metrics: DailyMetrics;
  errors: Partial<Record<ErrorCode, number>>;
}

export type RuntimeMessage =
  | { type: 'GET_EFFECTIVE_POLICY' }
  | { type: 'INCREMENT_METRICS'; deltas: Partial<DailyMetrics> }
  | { type: 'RECORD_REDIRECT'; source: 'aimode' | 'omnibox' }
  | { type: 'LOG_DIAGNOSTIC'; code: ErrorCode; detail?: string }
  | { type: 'GET_DIAGNOSTIC_SNAPSHOT' }
  | { type: 'SET_LOCAL_OVERRIDES'; toggles: Partial<FeatureToggles> & { gradeBand?: GradeBand } }
  | { type: 'RESET_LOCAL_METRICS' }
  | { type: 'TRIGGER_TEST_FLUSH' };
```

### `src/shared/defaults.ts`
* **Strict Maximum Lockdown Defaults** (fail-closed):
  ```ts
  export const STRICT_LOCKDOWN_TOGGLES: FeatureToggles = {
    masterEnabled: true,
    hideAiOverviews: true,
    hideAiModeUi: true,
    blockAiModeNavigation: true,
    forceWebOnlySearch: true,
    hideAuxiliaryAiFeatures: true,
  };
  ```
* **Recommended Grade-Band Presets** (for the 4-band Admin Policy Generator UI — admins can customize any toggle):
  * `K-2` (Maximum Protection): all 6 `true`
  * `3-5` (Elementary Research): `masterEnabled: true`, `hideAiOverviews: true`, `hideAiModeUi: true`, `blockAiModeNavigation: true`, `forceWebOnlySearch: true`, `hideAuxiliaryAiFeatures: true`
  * `6-8` (Middle School Standard Search — keeps Calculator/Dictionary): `masterEnabled: true`, `hideAiOverviews: true`, `hideAiModeUi: true`, `blockAiModeNavigation: true`, `forceWebOnlySearch: false`, `hideAuxiliaryAiFeatures: true`
  * `9-12` (High School Guided AI Literacy): `masterEnabled: true`, `hideAiOverviews: false`, `hideAiModeUi: true`, `blockAiModeNavigation: true`, `forceWebOnlySearch: false`, `hideAuxiliaryAiFeatures: false`
* **Analytics Endpoint Allowlist Regex:**
  ```ts
  export const APPS_SCRIPT_URL_REGEX =
    /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/;
  ```

---

## 5. Actionable Error & Warning Catalog (`src/shared/errors.ts`)

Every diagnostic code maps to a deterministic human-readable title and exact Admin Console / IT remediation steps:

| Code | Severity | Trigger | Actionable Remediation Message |
| :--- | :--- | :--- | :--- |
| `ERR_POLICY_INVALID` | `error` | Managed policy field has wrong type/enum/range. | "One or more fields in your Google Admin Console 'Policy for extensions' JSON are invalid (fields: {detail}). Invalid boolean toggles fell back to locked-down ON. Regenerate valid JSON in the Admin Policy Generator tab and re-save under Devices > Chrome > Apps & extensions." |
| `ERR_DNR_SYNC_FAILED` | `error` | `chrome.declarativeNetRequest.updateDynamicRules` throws. | "Chrome rejected a dynamic redirect rule update ({detail}). Reload the extension or verify Chrome version is 120+. If persistent, copy diagnostics and report to RaiseMark Support." |
| `ERR_SELECTOR_SYNTAX` | `error` | `document.querySelectorAll` throws `SyntaxError`. | "A bundled DOM selector failed browser validation ({detail}). Other detection tiers remain active. Update to the latest RaiseMark Search Guard release." |
| `ERR_SAFETY_GUARD_TRIPPED` | `error` | A selector attempted to hide a core page container (`#rso`, `#search`, or >=3 organic `h3` links). | "Safety Guard prevented hiding core Google Search results ({detail}). Google likely changed its page structure. Check for an extension update." |
| `ERR_ANALYTICS_ENDPOINT_INVALID` | `error` | `analyticsEnabled: true` with blank or non-Apps-Script URL. | "Analytics is enabled, but analyticsEndpointUrl does not match https://script.google.com/macros/s/<ID>/exec. Paste your deployed Google Apps Script Web App URL in the Admin Policy JSON." |
| `ERR_ANALYTICS_FLUSH_FAILED` | `error` | HTTP non-200, network timeout, or non-ok JSON response from Apps Script. | "Failed to flush anonymous counts to district Google Sheet ({detail}). Verify Apps Script is deployed as Web App -> Execute as: Me -> Who has access: Anyone, and that analyticsSharedToken matches Code.gs. Retrying with backoff." |
| `ERR_STORAGE_FAILURE` | `error` | `chrome.storage.local` or `chrome.storage.managed` read/write throws. | "Browser extension storage error ({detail}). Check Chrome profile disk quota or reload the browser." |
| `WARN_NO_MANAGED_POLICY` | `warning` | `chrome.storage.managed` is empty (unmanaged browser or admin forgot to paste JSON). | "No Google Admin Console policy detected. Strict Maximum Lockdown defaults are active (or local test toggles on unmanaged devices). To configure by grade level, paste JSON from the Admin Policy Generator into Devices > Chrome > Apps & extensions > Policy for extensions." |
| `WARN_OMNIBOX_POLICY_MISSING` | `warning` | DNR Priority 55 intercepted an AI Mode launch from Chrome Omnibox/NTP (`#rm_sg_omnibox`). | "An AI Mode click arrived from Chrome's native Omnibox or New Tab Page and was silently blocked. To remove the native browser button itself, set AIModeSettings = 'Do not allow' (1) under Devices > Chrome > Settings > Users & browsers for this grade OU (Chrome/ChromeOS 138+)." |

---

## 6. Dynamic DNR Rule Builder (`src/background/dnr-rules.ts`)

Pure, deterministic function `buildDynamicRules(policy: EffectivePolicy): chrome.declarativeNetRequest.Rule[]`:
* **When `!policy.masterEnabled`:** Returns `[]` (all dynamic rules removed).
* **Reserved Rule IDs (`ALL_MANAGED_RULE_IDS = [101, 102, 110, 111, 120, 130]`):** Always clear all existing dynamic rule IDs returned by `chrome.declarativeNetRequest.getDynamicRules()` before adding the newly built rules in one atomic `updateDynamicRules({ removeRuleIds, addRules })` call.
* **Exact Rules:**
  1. **When `policy.blockAiModeNavigation === true`:**
     * Helper `aiModeQueryTransform`:
       * If `policy.forceWebOnlySearch === true`: `{ addOrReplaceParams: [{ key: 'udm', value: '14' }], removeParams: ['aep', 'arv', 'mstk', 'csuir'] }`
       * Else: `{ removeParams: ['udm', 'aep', 'arv', 'mstk', 'csuir'] }`
     * **Rule `101` (Priority `55` — Omnibox `sourceid`/`aep` before `udm=50`):**
       * `condition`: `{ regexFilter: '^https://(www\\.)?google\\.com/search\\?([^#]*&)?(sourceid=chrome|aep=)[^#]*&udm=50(&|$)', resourceTypes: ['main_frame'] }`
       * `action`: `{ type: 'redirect', redirect: { transform: { queryTransform: aiModeQueryTransform, fragment: '#rm_sg_omnibox' } } }`
     * **Rule `102` (Priority `55` — Omnibox `udm=50` before `sourceid`/`aep`):**
       * `condition`: `{ regexFilter: '^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50&[^#]*(sourceid=chrome|aep=)', resourceTypes: ['main_frame'] }`
       * `action`: `{ type: 'redirect', redirect: { transform: { queryTransform: aiModeQueryTransform, fragment: '#rm_sg_omnibox' } } }`
     * **Rule `110` (Priority `50` — General `udm=50` AI Mode Search):**
       * `condition`: `{ regexFilter: '^https://(www\\.)?google\\.com/search\\?([^#]*&)?udm=50(&|$)', resourceTypes: ['main_frame'] }`
       * `action`: `{ type: 'redirect', redirect: { transform: { queryTransform: aiModeQueryTransform, fragment: '#rm_sg_aimode' } } }`
     * **Rule `111` (Priority `50` — Direct `google.com/ai` & `google.com/aimode`):**
       * `condition`: `{ regexFilter: '^https://(www\\.)?google\\.com/(ai|aimode)(/|\\?|$)', resourceTypes: ['main_frame'] }`
       * `action`: `{ type: 'redirect', redirect: { url: 'https://www.google.com/#rm_sg_aimode' } }`
  2. **When `policy.forceWebOnlySearch === true`:**
     * **Rule `120` (Priority `40` — Allow Non-AI Verticals & Already-`udm=14` URLs):**
       * `condition`: `{ regexFilter: '^https://(www\\.)?google\\.com/search\\?([^#]*&)?(udm=|tbm=)', resourceTypes: ['main_frame'] }`
       * `action`: `{ type: 'allow' }`
     * **Rule `130` (Priority `30` — Enforce `udm=14` Classic Web Search):**
       * `condition`: `{ regexFilter: '^https://(www\\.)?google\\.com/search\\?([^#]*&)?q=', resourceTypes: ['main_frame'] }`
       * `action`: `{ type: 'redirect', redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key: 'udm', value: '14' }] } } } }`

---

## 7. Multi-Tier Selector Engine & Content Script (`src/shared/selectors.ts`, `src/content/*`)

### 7.1 Zero-Flash Static CSS (`src/content/static-guard.css`)
Every rule MUST be gated by an attribute on `html` so disabling a toggle disables hiding cleanly with zero side effects:
* `html[data-rmsg-hide-overviews="1"]` gates:
  `div#eKIzJc`, `div[data-attrid="AIOverview"]`, `div[data-async-type="aiOverview"]`, `div[aria-label="AI Overview"]`, `div.YzCcne[data-mcpr]`, `div[data-mcp="18"]`
* `html[data-rmsg-hide-aimode="1"]` gates:
  `div[role="listitem"]:has(a[href*="udm=50"])`, `a[href*="udm=50"]`, `a[href*="/aimode"]`, `div.olrp5b`, `button.plR5qb`, `button[jsname="B6rgad"]`
* `html[data-rmsg-hide-aux="1"]` gates:
  `a[href*="labs.google.com"]`, `[aria-label*="Search Labs" i]`, `[aria-label*="Search by image" i]`, `[data-base-lens-url]`, `[aria-label*="Ask a follow up" i]`

Hidden style declaration:
```css
display: none !important;
visibility: hidden !important;
height: 0 !important;
min-height: 0 !important;
overflow: hidden !important;
margin: 0 !important;
padding: 0 !important;
```

### 7.2 Multi-Tier Semantic Engine (`src/content/dom-engine.ts`)
Pure, DOM-injectable module (tested in Vitest `jsdom` AND used by `content.ts`):
1. **Organic Results Safety Guard (`isUnsafeToHide(el: Element): boolean`):**
   * Returns `true` if `el` is `HTML`, `BODY`, `HEAD`, `MAIN`, or matches `#main, #cnt, #rcnt, #center_col, #search, #rso, #botstuff, #top_nav, form[role="search"], #searchform`.
   * Returns `true` if `el.querySelectorAll('a > h3, h3.LC20lb').length >= 3` (refuses to wipe out the organic results container!).
   * Returns `true` if `el.contains(document.querySelector('textarea[name="q"], input[name="q"]'))` (refuses to hide the main Google search input form!).
   * Whenever a candidate fails this check, `dom-engine.ts` skips hiding and reports `ERR_SAFETY_GUARD_TRIPPED`.
2. **Tier 1 (Semantic / ARIA / URL / Text-Anchor Rules — Most Durable):**
   * **AI Overviews:** `[data-attrid="AIOverview"]`, `[data-async-type="aiOverview"]`, `[aria-label="AI Overview"]`, plus walking `h1, h2, [role="heading"], div.Fzsovc` where `textContent.trim().toLowerCase() === 'ai overview'` → climbing to the nearest enclosing `[data-mcpr]`, `[data-attrid]`, `[data-async-type]`, `[data-hveid]`, or `div#eKIzJc` that passes `!isUnsafeToHide(container)`.
   * **AI Mode UI:** `a[href*="udm=50"]`, `a[href*="/aimode"]`, `a[href^="https://www.google.com/ai"]`, plus walking `[role="tab"], [role="listitem"] a, [role="listitem"] span, button, a` where normalized text matches exact `"ai mode"`, `"dive deeper in ai mode"`, or `"ask ai mode"` (climbing to `closest('[role="listitem"]')` when inside the nav bar).
   * **Auxiliary AI:** `a[href*="labs.google.com"]`, `[aria-label*="Search Labs" i]`, `[aria-label*="Search by image" i]`, `[data-base-lens-url]`, `[aria-label*="Ask a follow up" i]`, `[placeholder*="Ask a follow up" i]`, plus People Also Ask / expandable cards explicitly bearing an AI attribution label (`"AI Overview"`, `"Generative AI"`, `"AI-generated"`).
3. **Tier 2 (Structural Fallbacks):**
   * Isolated in `SELECTORS.tier2` (`#eKIzJc`, `div.YzCcne[data-mcpr]`, `div[data-mcp="18"]`, `div.olrp5b`, `button.plR5qb`, `button[jsname="B6rgad"]`, `div[jsname="R5mgy"]`).
4. **Idempotent Per-Page Counting:**
   * Mark every hidden element with `el.setAttribute('data-rmsg-hidden', category)`.
   * Track `overviewsHidden` with a per-URL guard (`Set<string>`) so one SERP with nested AI Overview sub-blocks increments `overviewsHidden` by **1**, not 4.
   * For `aiModeUiHidden` and `auxAiHidden`, increment once per newly hidden top-level element (`!el.hasAttribute('data-rmsg-hidden')` and `!el.parentElement?.closest('[data-rmsg-hidden]')`).

### 7.3 Content Script Lifecycle (`src/content/content.ts`)
Runs at `document_start`:
1. **Hash Telemetry Handoff (Synchronous, First Line):**
   * Check `window.location.hash`:
     * If `#rm_sg_omnibox`: strip hash via `history.replaceState(null, '', location.pathname + location.search)`, send `{ type: 'RECORD_REDIRECT', source: 'omnibox' }`.
     * If `#rm_sg_aimode`: strip hash via `history.replaceState(null, '', location.pathname + location.search)`, send `{ type: 'RECORD_REDIRECT', source: 'aimode' }`.
2. **Policy Application:**
   * Fetch effective policy via `chrome.runtime.sendMessage({ type: 'GET_EFFECTIVE_POLICY' })` (fallback to reading `chrome.storage.managed`/`local` directly if SW wakes slowly).
   * Apply/remove `data-rmsg-hide-overviews`, `data-rmsg-hide-aimode`, `data-rmsg-hide-aux` on `document.documentElement`.
   * If `!policy.masterEnabled`, remove all `data-rmsg-*` attributes, unhide any previously hidden elements, disconnect observer, and stop.
3. **rAF-Batched `MutationObserver`:**
   * Attach observer once `document.body` exists; coalesce rapid mutations via a single `pendingRaf` flag (`requestAnimationFrame`) so DOM sweeps never jank main-thread rendering.
   * Also re-sync dynamically on `chrome.storage.onChanged` (both `managed` and `local`).

---

## 8. Service Worker & Analytics Flusher (`src/background/*`)

### 8.1 Ephemeral Service Worker (`src/background/service-worker.ts`)
* Registers listeners synchronously at top level:
  * `chrome.runtime.onInstalled` → resolve policy → sync DNR rules → configure analytics alarm.
  * `chrome.runtime.onStartup` → resolve policy → sync DNR rules → ensure analytics alarm exists.
  * `chrome.storage.onChanged` → if `areaName === 'managed'` or `areaName === 'local'` (local override keys changed), re-resolve policy → sync DNR rules → re-configure alarm.
  * `chrome.alarms.onAlarm` (alarm name `'rmsg-analytics-flush'`) → call `flushAnalyticsIfDue()`.
  * `chrome.runtime.onMessage` → handles all `RuntimeMessage` types with `async/await` IIFE + `return true`.
* **Storage Mutation Serialization:** Use an in-turn promise chain helper (per SW wakeup) around `chrome.storage.local` counter updates so parallel content script messages in the same tick don't overwrite each other's increments.

### 8.2 Zero-PII Analytics & Jittered Flush (`src/background/analytics.ts`)
* **Alarm Scheduling:** When `policy.analyticsEnabled && policy.analyticsEndpointUrl`, schedule `'rmsg-analytics-flush'` with `delayInMinutes = policy.analyticsFlushIntervalMinutes + Math.floor(Math.random() * 31)` (0–30 min uniform jitter to prevent district-wide 8:00 AM thundering herds).
* **Strict Validation:** Validate `policy.analyticsEndpointUrl` against `APPS_SCRIPT_URL_REGEX`. If invalid, log `ERR_ANALYTICS_ENDPOINT_INVALID` and abort without making any network request.
* **Flush Execution:**
  * Snapshot all date buckets in `pendingMetricsByDate` (and `pendingErrorsByCode`) where total count > 0.
  * For each date bucket, build strictly allowlisted `AnalyticsFlushPayload` (verify via runtime sanitizer that ZERO unexpected keys exist!).
  * `fetch(endpointUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', body: JSON.stringify(payload) })` with a 15-second `AbortController` timeout.
  * Verify `response.ok` AND JSON body `{ status: 'ok' }`.
  * On success: subtract the exact flushed deltas from `pendingMetricsByDate` (deleting empty date keys) & `pendingErrorsByCode`, reset `consecutiveFlushFailures = 0`.
  * On failure: increment `consecutiveFlushFailures`, compute exponential backoff (`min(24h, 15m * 2^(failures - 1))`), log `ERR_ANALYTICS_FLUSH_FAILED` with HTTP status/reason.

---

## 9. District-Owned Zero-Cost Apps Script Sink (`templates/apps-script/Code.gs`)

Must ship complete, tested, and copy-paste-ready inside `templates/apps-script/Code.gs`:
* Configuration constants at top of file: `SHARED_TOKEN = ""` (optional, must match `analyticsSharedToken` if set), `DAILY_SHEET_NAME = "Daily_Rollup"`, `ERROR_SHEET_NAME = "Error_Summary"`.
* `doPost(e)`:
  1. Parses `JSON.parse(e.postData.contents)`.
  2. Checks `SHARED_TOKEN` if non-empty (returns `{ status: "error", code: "UNAUTHORIZED" }` on mismatch).
  3. **Strict PII / Schema Guard:** Validates `schemaVersion === 1`, `gradeBand` in allowlist `["K-2","3-5","6-8","9-12","Staff","Unassigned"]`, `dateBucket` matches `/^\d{4}-\d{2}-\d{2}$/`, `extensionVersion` matches `/^\d+\.\d+\.\d+$/`, and every metric/error value is a non-negative integer (`<= 100000`). **Explicitly ignores/rejects any extra fields.** Never writes IP addresses, user headers, or raw JSON blobs.
  4. Acquires `LockService.getScriptLock().waitLock(15000)`.
  5. **Upserts** `Daily_Rollup` row keyed by `(dateBucket, gradeBand, extensionVersion)` — summing columns `[Date, GradeBand, ExtensionVersion, OverviewsHidden, AiModeUiHidden, AiModeRedirects, OmniboxFallbackRedirects, AuxAiHidden, ReportingBatches]` so a 5,000-Chromebook district produces only **~4 clean rows per day** (one per grade band!) instead of 5,000 noisy rows!
  6. **Upserts** `Error_Summary` row keyed by `(dateBucket, gradeBand, errorCode)` summing counts.
  7. Releases lock in `finally` and returns `ContentService.createTextOutput(JSON.stringify({ status: "ok" })).setMimeType(ContentService.MimeType.JSON)`.

---

## 10. UI Specifications (Popup, Options & Standalone Policy Generator)

### 10.1 Strict Minimal Student Popup (`src/ui/popup.html` & `popup.ts`)
* Width: `260px`, zero animations, zero clutter, zero inline scripts.
* **Managed State (`policy.isManaged === true`):**
  * Displays **ONLY** a clean 1-line notice with shield icon:  
    **"Managed by your school"**
  * **ZERO** toggles, **ZERO** counters, **ZERO** links, **ZERO** diagnostic buttons.
* **Unmanaged State (`policy.isManaged === false`):**
  * Shows status pill (*"Local Test Mode — Unmanaged"*) + active protection summary + single button **"Open Setup & Policy Generator"** (`chrome.runtime.openOptionsPage()`).

### 10.2 IT Options Hub (`src/ui/options.html` & `options.ts`)
Clean 3-tab layout using `shared.css` (RaiseMark navy/slate/teal palette, WCAG AA contrast, keyboard-accessible tabs):
1. **Tab 1 — Status & Local Testing:**
   * Policy source banner (`Managed by Google Admin Console` [locked] vs `Unmanaged Local Testing Mode` [interactive]).
   * Active `gradeBand` pill + 6 feature toggle rows (with clear description of each, plus explicit amber callout on `forceWebOnlySearch`: *"Note: Google's Web-only mode (`udm=14`) also hides Knowledge Panels, Calculator, and Dictionary cards."*).
   * When managed: all inputs have `disabled = true` and a lock icon.
   * When unmanaged: toggling any switch persists to `chrome.storage.local` and immediately updates DNR rules + active Google tabs!
2. **Tab 2 — IT Diagnostics & Analytics:**
   * Metric cards (`AI Overviews Hidden`, `AI Mode UI Hidden`, `AI Mode URLs Redirected`, `Omnibox Fallbacks Caught`, `Auxiliary AI Hidden`, `Errors / Warnings`).
   * Analytics sync status bar (`Disabled (Local-Only)` vs `Configured`, last attempt/success date, pending batch count, **"Test Flush Now"** button when configured).
   * **Actionable Errors & Warnings Table:** Lists every entry in `diagnosticLog` sorted by severity (`error` first) with `code`, `count`, `lastSeenDate`, `detail`, and bold **How to Fix** remediation text.
   * Action buttons: **"Copy Diagnostic JSON"** (zero-PII bundle for IT tickets), **"Export Local Metrics CSV"**, and **"Reset Local Counters"** (with inline confirmation, no `window.confirm` blocking if avoidable, or clean confirmation button).
3. **Tab 3 — 4-Band Admin Policy Generator (powered by `policy-generator-core.ts`):**
   * Interactive 4-column matrix for **K–2**, **3–5**, **6–8**, and **9–12** (plus optional **Staff** toggle preset).
   * Shared District Analytics configuration section (Enable District Google Sheets Analytics checkbox, Apps Script Web App URL input with live regex validation, optional Shared Token, Flush Interval minutes).
   * Per-column **"Copy Google Admin Console JSON"** button that emits **exact** Chrome Admin Console wrapped format:
     ```json
     {
       "gradeBand": { "Value": "K-2" },
       "masterEnabled": { "Value": true },
       "hideAiOverviews": { "Value": true },
       "hideAiModeUi": { "Value": true },
       "blockAiModeNavigation": { "Value": true },
       "forceWebOnlySearch": { "Value": true },
       "hideAuxiliaryAiFeatures": { "Value": true },
       "analyticsEnabled": { "Value": false }
     }
     ```
   * Per-column reminder badge indicating recommended native Chrome setting: *"Also set `AIModeSettings = Do not allow (1)` in this OU"* whenever `blockAiModeNavigation` or `hideAiModeUi` is ON.
   * **"Download All 4 JSON Files"** / **"Copy Apps Script Template (`Code.gs`)"** convenience links.

### 10.3 Standalone Zero-Cost Web Policy Generator (`dist-admin-tool/policy-generator.html`)
`scripts/build.mjs` compiles `policy-generator-core.ts` + `shared.css` into a self-contained static HTML/JS/CSS bundle in `dist-admin-tool/` (zero `chrome.*` dependencies!) that can be hosted for \$0 on GitHub Pages or opened locally via `file://` so school IT directors can generate their 4 grade-band JSON configs before installing the extension.

---

## 11. Build, Icon Generation, Unit Tests & Paired Canary Harness

### 11.1 Pure-Node PNG Icon Generator (`scripts/generate-icons.mjs`)
* Uses ONLY Node built-ins (`node:zlib`, `node:fs`, `node:path`) — zero native C++ addons (`sharp`/`canvas`).
* Renders a clean, recognizable RaiseMark Search Guard shield + magnifying-glass emblem into RGBA pixel buffers at `16×16`, `48×48`, and `128×128`, writes valid PNG files with proper CRC32 checksums to `dist/icons/icon-{16,48,128}.png`, and parses back each file's PNG IHDR header to assert exact width/height!

### 11.2 Build Script (`scripts/build.mjs`)
* Bundles via `esbuild`:
  * `src/background/service-worker.ts` → `dist/background/service-worker.js` (`format: 'esm'`)
  * `src/content/content.ts` → `dist/content/content.js` (`format: 'iife'`)
  * `src/ui/popup.ts` → `dist/ui/popup.js` (`format: 'esm'`)
  * `src/ui/options.ts` → `dist/ui/options.js` (`format: 'esm'`)
  * Standalone policy generator → `dist-admin-tool/policy-generator.js` (`format: 'iife'`)
* Copies `manifest.json`, `schema.json`, `static-guard.css`, HTML/CSS UI files, and runs `generate-icons.mjs`.
* Optional `--zip` flag (`npm run package`) creates `release/raisemark-search-guard-v<version>.zip` excluding `.git`, `node_modules`, tests, and markdown docs.

### 11.3 `package.json` Scripts
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "node scripts/build.mjs",
    "package": "node scripts/build.mjs --zip",
    "test": "vitest run",
    "canary": "tsx scripts/canary.ts"
  }
}
```
Dependencies: zero runtime dependencies! DevDependencies strictly minimal: `typescript`, `esbuild`, `@types/chrome`, `vitest`, `jsdom`, `playwright`, `tsx`.

### 11.4 Paired Control-vs-Treatment Playwright Canary (`scripts/canary.ts`)
Must support TWO execution modes:
1. **`--fixture` mode (`npm run canary -- --fixture`):** Launches real Chromium with `--load-extension=./dist` against a local mock Google Search HTTP server (or Playwright route interception on `https://www.google.com/*`!) so the 1-shot AI coding agent can **100% deterministically verify** every single extension feature in real Chromium (DNR redirects for `?udm=50`, `?udm=50&sourceid=chrome`, `/ai`, `/aimode`, `udm=14` loop-freedom, `udm=2` Images passthrough, AI Overview/AI Mode/Aux hiding, organic results safety guard, minimal popup, options page, and `.webm` video recording) **without ever being blocked by Google anti-bot CAPTCHAs**!
2. **`--live` mode (`npm run canary -- --live`):** Launches TWO real Chromium persistent contexts (Control without extension, Treatment with `--load-extension=./dist`) against live `https://www.google.com` across canonical K-12 queries (`"what is photosynthesis"`, `"how does a bill become a law"`, `"explain mitosis"`):
   * **Anti-Bot / CAPTCHA Guard:** If Google serves `/sorry/` or a CAPTCHA/unusual-traffic gate, immediately aborts gracefully with exit code `2` and status `"INCONCLUSIVE_BOT_GATE"` (NEVER attempts to solve or bypass!).
   * **Paired Control Assertion:** Verifies whether AI Overview / AI Mode rendered in Control before asserting removal in Treatment (if Control showed no AI Overview across all queries, marks AI Overview check `"INCONCLUSIVE_NO_CONTROL_SIGNAL"` instead of falsely failing).
   * **Treatment Assertions:** Asserts AI Overview & AI Mode UI are hidden, `?q=photosynthesis&udm=50` silently redirects without `udm=50`, `google.com/ai` redirects to `google.com/`, and **Organic Results Regression Guard** confirms `>= 5` visible organic `<h3>` search results!
   * Writes structured `artifacts/canary-report.json` + `.webm` verification video to `artifacts/`.
