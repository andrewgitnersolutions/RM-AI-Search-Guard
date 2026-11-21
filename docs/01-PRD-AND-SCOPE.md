# 01 — Product Requirements Document (PRD) & Project Scope

> **Current Implementation Note (2026-11-21, v1.0.1 — Phases 0–5 Complete):** This document is the original Phase 1 design specification retained for historical context. Per [`docs/07-BREAKPOINT-AUDIT-LOG.md`](07-BREAKPOINT-AUDIT-LOG.md) (decisions D1–D8), the shipped product is titled **RaiseMark: AI Search Controls for K-12**, requires **Chrome / ChromeOS 134+** (`minimum_chrome_version: "134"`), removes the optional Google Sheets / `script.google.com` district analytics sink and `chrome.alarms` permission (`archive/analytics-v1/`), and adds Phase 1–5 hardening: fail-closed `admin-no-policy` lock on force-installed devices, zero-flash `document_start` attribute locking, managed-only counter resets, English + Spanish text matching (`WARN_UNSUPPORTED_UI_LANGUAGE`), managed `extraHideSelectors` hotfix overrides, visible-surface leak detection (`WARN_AI_SURFACE_VISIBLE`), query-preserving `/aimode?q=…` & in-page SPA AI Mode redirects, and per-page counter accuracy. The shipped extension makes **zero external network requests**; see [`PRIVACY.md`](../PRIVACY.md) and [`docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md`](04-ADMIN-DEPLOYMENT-RUNBOOK.md) for current guarantees and coverage boundaries.

**Product:** RaiseMark: AI Search Controls for K-12 *(originally drafted as RaiseMark Search Guard for K-12)*  
**Publisher:** RaiseMark AI  
**Target Platform:** Google Chrome & ChromeOS (Manifest V3)  
**Distribution:** Public Chrome Web Store + Public Open-Source GitHub Repository (MIT License)

---

## 1. Problem Context & K-12 Market Research

### 1.1 The 2025–2026 K-12 Google Search AI Controversy
School districts across the United States rely heavily on Chromebooks and Google Workspace for Education, yet Google's deep architectural bundling of **AI Overviews** and **AI Mode (`udm=50`)** into Google Search created an acute governance gap:
1. **The "All-or-Nothing" Dilemma:** Google Admin Console historically offered no native per-OU toggle to keep traditional index-only Google Search while turning off AI Overviews and AI Mode—forcing districts into an untenable choice between unvetted generative answers or disabling Google Search altogether.
2. **Pedagogical & Developmental Mismatch:** Educators and independent evaluators (including Common Sense Media reviews) documented that AI Search summaries shortcut foundational critical thinking and source-evaluation skills, complete student assignments outright, produce hallucinations, and provide no age-appropriate differentiation across **K–2, 3–5, 6–8, and 9–12**.
3. **The Admin Cat-and-Mouse Burden:** K-12 sysadmins (`r/k12sysadmin`) report that native Chrome settings leave loopholes (direct visits to `google.com`, manual `?udm=50` or `google.com/ai` URLs, homepage AI Mode triggers, "Dive deeper in AI Mode" prompts, and rotating obfuscated DOM classes). Paid web-filter content-modification features (Linewize, GoGuardian, Securly) are not universally licensed, and strict K-12 privacy mandates (**FERPA, COPPA, SOPPA, NY Ed Law 2-d**) block extensions that harvest student data or require third-party vendor DPAs.

### 1.2 Gaps in Reference Baseline (`jimrtyler/hide-ai-overview`)
The community reference extension (`jimrtyler/hide-ai-overview`) proves that lightweight client-side hiding works, but lacks enterprise K-12 readiness:
* No Google Admin Console `chrome.storage.managed` configuration or per-grade-band toggles.
* No network-level blocking/redirection of `udm=50` or `google.com/ai` direct URL bypasses.
* No companion Omnibox/NTP `AIModeSettings` workflow or missing-policy diagnostic alert.
* Hardcoded obfuscated CSS classes (`YzCcne`, `olrp5b`, `plR5qb`) with silent `catch (e) {}` blocks—fails silently whenever Google updates Search DOM.
* No usage analytics, no error reporting, no automated regression canary.

---

## 2. Target Personas & Jobs-to-Be-Done

| Persona | Primary Goals | Key Pain Points Solved |
| :--- | :--- | :--- |
| **Google Super Admin / District IT Director** | Force-install once across managed Chromebooks; configure distinct AI policies for K–2, 3–5, 6–8, and 9–12 from Google Admin Console; answer board/parent questions with usage numbers; pass student privacy audits with zero vendor DPA. | Visual 4-band Policy JSON Generator eliminates JSON typos; fail-closed defaults protect students immediately; zero-cost district-owned Google Sheet analytics; public open-source (MIT) code for instant privacy review. |
| **Building IT Technician / Helpdesk** | Rapidly verify whether a Chromebook received the right grade-band policy and diagnose why an AI button appeared. | Dedicated IT Diagnostics tab on `options.html` showing effective policy, `ERR_*`/`WARN_*` codes with exact remediation steps (including `WARN_OMNIBOX_POLICY_MISSING`), and 1-click **Copy Diagnostic JSON**. |
| **Classroom Teacher / Instructional Coach** | Have students evaluate primary sources in elementary/middle grades while selectively re-enabling AI features in high school digital-literacy units. | Predictable, distraction-free Search experience; silent redirects keep student queries intact instead of throwing scary block screens. |
| **K-12 Student** | Run Google searches for classwork without broken layouts, flashing UI elements, or confusing error screens. | Strict minimal 1-line popup (*"Managed by your school"*); zero-flash DOM hiding; silent query-preserving redirects; Images/Videos/News tabs remain unbroken even under `udm=14`. |
| **RaiseMark Maintainer (`andrew@raisemarkai.com`)** | Keep selectors working reliably across all school districts at \$0 hosting cost without asking districts to patch CSS. | Deterministic paired Control-vs-Treatment Playwright Canary (`npm run canary`) in Phase 1 + Phase 2 daily local Antigravity self-healing workflow with CWS Draft & email approval gate. |

---

## 3. Scope Definition

### 3.1 Phase 1 — Minimum Viable Prototype (1-Shot Build Target)
Everything below MUST be completely implemented, built, unit-tested, and canary-verified in the 1-shot MVP:

1. **Manifest V3 Chrome Extension (TypeScript + esbuild + Vanilla HTML/CSS):**
   * Strictly scoped to `https://www.google.com/*` and `https://google.com/*` (plus `https://script.google.com/*` & `https://script.googleusercontent.com/*` exclusively for the optional district-owned analytics sink).
   * Strict minimal permissions: `storage`, `declarativeNetRequestWithHostAccess`, `alarms`.
   * Programmatically generated PNG icons (`16×16`, `48×48`, `128×128`) built into `dist/icons/`.
2. **Enterprise Managed Policy Engine (`chrome.storage.managed` + `schema.json`):**
   * Native per-OU and per-Group targeting via Google Admin Console **Policy for extensions**.
   * **6 Independent Feature Toggles** (all defaulting to `true` under **Strict Maximum Lockdown Defaults**):
     1. `masterEnabled` — Master per-OU kill-switch (`false` disables all blocking/hiding for that OU without uninstalling).
     2. `hideAiOverviews` — Suppress Google AI Overview cards on SERP.
     3. `hideAiModeUi` — Hide AI Mode homepage button, Search bar button, Search nav tab, and *"Dive deeper in AI Mode"* prompts.
     4. `blockAiModeNavigation` — Network-level silent redirect of `?udm=50`, `google.com/ai`, and `google.com/aimode` preserving student's search query `q=`.
     5. `forceWebOnlySearch` — Redirect standard Google Search queries to `udm=14` (classic Web-only results) while explicitly allowing non-AI vertical tabs (`udm=2` Images, `udm=7` Videos, `udm=28` Shopping, `tbm=nws` News, `tbm=bks` Books, etc.).
     6. `hideAuxiliaryAiFeatures` — Hide AI-assisted follow-ups, Search Labs entry points, Google Lens search-bar trigger, and AI-generated "People Also Ask" / guided prompt cards.
   * Metadata & analytics policy fields: `gradeBand` (`"K-2" | "3-5" | "6-8" | "9-12" | "Staff" | "Unassigned"`), `analyticsEnabled` (boolean, default `false`), `analyticsEndpointUrl` (strictly validated `https://script.google.com/macros/s/.../exec`), `analyticsSharedToken` (optional string), `analyticsFlushIntervalMinutes` (integer 60–1440, default `240`).
   * Fail-closed policy parser: missing or malformed policy falls back safely to Strict Maximum Lockdown Defaults and logs actionable `WARN_NO_MANAGED_POLICY` or `ERR_POLICY_INVALID`.
3. **Hybrid Omnibox & New Tab Page Defense-in-Depth:**
   * Network layer (`declarativeNetRequest`) detects Omnibox/NTP-originated AI Mode redirects (`sourceid=chrome` or `aep=` + `udm=50`) via client-side `#rm_sg_omnibox` fragment handoff (zero extra permissions, never sent to Google servers), silently redirects the student to clean Search, increments `omniboxFallbackRedirects`, and raises `WARN_OMNIBOX_POLICY_MISSING` with exact steps to enable `AIModeSettings = 1` in Admin Console.
4. **Multi-Tier Bundled Selector Engine:**
   * Tier 1 semantic/ARIA/URL-attribute rules (`a[href*="udm=50"]`, `[aria-label="AI Overview"]`, `[data-attrid="AIOverview"]`, heading/tab text matching).
   * Tier 2 structural fallback selectors isolated cleanly in `src/shared/selectors.ts`.
   * Zero-flash CSS (`static-guard.css` gated by `html[data-rmsg-*="1"]`) + `MutationObserver` with `requestAnimationFrame` batching + **Organic Results Safety Guard** (refuses to hide any container housing standard organic `#search` / `div#rso` multi-result lists).
5. **Dual-Surface UI (Minimal Student Popup + Comprehensive IT Options Page):**
   * **Popup (`popup.html`):** When managed by Admin Console, shows **strictly a single-line notice** (*"Managed by your school"* — zero toggles, zero counters, zero distractions). When unmanaged, shows status badge + button to open Options/Setup page.
   * **Options (`options.html`):** Three clean tabs:
     * **Status & Local Test:** Read-only enforced toggle display when managed; live interactive toggles (saved to `chrome.storage.local`) when unmanaged so IT admins can test locally before rollout.
     * **IT Diagnostics & Analytics:** Active policy source (`managed` vs `local` vs `fallback-defaults`), active `gradeBand`, local counters (AI Overviews hidden, AI Mode UI hidden, AI Mode redirects, Omnibox fallback redirects, Auxiliary AI hidden, total errors), actionable `ERR_*`/`WARN_*` table with step-by-step fixes, analytics flush status + "Test Flush Now" (when endpoint configured), **Copy Diagnostic JSON**, and **Export CSV**.
     * **Admin Policy Generator:** Interactive 4-band matrix (**K–2, 3–5, 6–8, 9–12**) with smart presets, `udm=14` impact warning callout (notes Calculator/Dictionary/Knowledge Cards behavior), optional district Google Apps Script webhook fields, real-time schema validation, and 1-click **Copy Admin Console JSON** per grade band (properly wrapped in Google Admin Console's `{"key": {"Value": ...}}` format!).
   * Also bundled as a standalone build output (`dist-admin-tool/policy-generator.html`) hostable on GitHub Pages for \$0 so IT admins can generate policy JSON before installing anything!
6. **Zero-Cost, Zero-PII Analytics & District BYOS Sink:**
   * Always counts anonymous metrics locally in `chrome.storage.local`.
   * Optional jittered `chrome.alarms` flush (with randomized jitter + exponential backoff) sending ONLY anonymous daily bucketed counts to the district's own Google Apps Script Web App (`Content-Type: text/plain;charset=utf-8`).
   * Complete, copy-paste-ready `templates/apps-script/Code.gs` (with `LockService.getScriptLock()`, shared token validation, strict schema whitelist rejecting unexpected keys/PII, and auto-sheet initialization).
7. **Automated Verification & Canary Harness:**
   * **Vitest Unit Test Suite (`npm test`):** Policy parsing/fail-closed defaults, Admin JSON export format, DNR rule generation & loop-freedom tests, URL allowlist & PII-free payload assertions, error catalog coverage, DOM hiding + organic-results safety guard tests (jsdom).
   * **Playwright Paired Canary Suite (`npm run canary`):** Launches Control (extension OFF) vs Treatment (extension ON via `--load-extension=./dist`), tests canonical queries + `?udm=50` + `google.com/ai` + `udm=2` Images preservation + organic search link count guard (`>= 5` visible organic results), captures `.webm` click-through verification video and structured JSON report (`canary-report.json`).

### 3.2 Explicitly Out of Scope for Phase 1 (Deferred to Phase 2 / Non-Goals)
* **Phase 2 (Spec'd in `docs/05-PHASE2-WATCHDOG-OPS-SPEC.md`, NOT built by 1-shot MVP agent):**
  * Daily Antigravity scheduled cron wiring, live Chrome Web Store Publish API OAuth automation, and automated email dispatch to `andrew@raisemarkai.com`.
* **Permanent Non-Goals (Intentional Guardrails):**
  * Custom Chrome New Tab Page override (`chrome_url_overrides.newtab`) — intentionally excluded to prevent district Clever/ClassLink conflicts and CWS Single Purpose rejection.
  * Collecting or transmitting student emails, names, Chrome profile IDs, device serials, search query text, visited URLs, or precise per-event timestamps.
  * Non-`google.com` country TLDs (e.g., `google.co.uk`, `google.ca`) — U.S. K-12 scope strictly uses `google.com` for minimum permissions.
  * Central RaiseMark-hosted telemetry database or paid cloud infrastructure.

---

## 4. Non-Functional Requirements & Privacy Compliance

| Category | Requirement |
| :--- | :--- |
| **Student Privacy (FERPA / COPPA / SOPPA / NY Ed Law 2-d)** | **Zero PII collected, stored, or transmitted.** No search query text, no user/device identifiers, no Google account email, no IP logging in Apps Script. Analytics payloads contain strictly aggregate integer counts bucketed by `gradeBand` + `YYYY-MM-DD` date. |
| **Least Privilege** | Only `storage`, `declarativeNetRequestWithHostAccess`, `alarms` + `host_permissions` for `google.com` & `script.google.com`/`script.googleusercontent.com`. |
| **Hosting Cost** | **\$0.00/month** ongoing cost to RaiseMark AI and **\$0.00/month** to school districts (Chrome Web Store one-time \$5 developer registration fee only). |
| **Performance** | Zero-flash CSS applied at `document_start`; DOM sweep batched via `requestAnimationFrame`; < 5ms incremental layout overhead per SERP load; ephemeral MV3 service worker holds zero in-memory state. |
| **Reliability & Fail-Safety** | Malformed or missing Admin Policy JSON NEVER crashes the extension and ALWAYS falls back to Strict Maximum Lockdown Defaults while recording an actionable `ERR_*`/`WARN_*` entry. |
| **Security** | Strict MV3 CSP (zero inline scripts, zero `eval`, zero remote code). Analytics endpoint strictly validated against `^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$` to prevent arbitrary URL exfiltration. |

---

## 5. Measurable Acceptance Criteria (MVP Definition of Done)

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-01** | `npm run typecheck` and `npm run build` succeed with 0 errors and produce a loadable MV3 extension in `dist/` with valid `16×16`, `48×48`, and `128×128` PNG icons. | Automated CLI build + PNG IHDR check |
| **AC-02** | `manifest.json` contains ONLY `permissions: ["storage", "declarativeNetRequestWithHostAccess", "alarms"]` and `host_permissions` strictly limited to `google.com`, `www.google.com`, `script.google.com`, `script.googleusercontent.com`. | Unit test asserting exact manifest keys |
| **AC-03** | When `chrome.storage.managed` is empty or invalid JSON/types, extension applies **Strict Maximum Lockdown Defaults** (all 6 toggles `true`) and records `WARN_NO_MANAGED_POLICY` or `ERR_POLICY_INVALID` with actionable remediation text. | Vitest unit tests |
| **AC-04** | Setting `masterEnabled: false` removes all active dynamic DNR rules and removes all `data-rmsg-*` HTML attributes so Google Search runs completely unmodified. | Vitest + Playwright test |
| **AC-05** | With `hideAiOverviews: true`, AI Overview containers matching Tier 1 or Tier 2 selectors are hidden before paint and `overviewsHidden` increments by 1 per SERP load (idempotent—no double-counting on mutations). | Vitest (jsdom) + Playwright Canary |
| **AC-06** | With `hideAiModeUi: true`, homepage AI Mode button, Search nav AI Mode tab, and *"Dive deeper in AI Mode"* triggers are hidden and `aiModeUiHidden` increments accurately. | Vitest (jsdom) + Playwright Canary |
| **AC-07** | With `blockAiModeNavigation: true`, navigating to `https://www.google.com/search?q=photosynthesis&udm=50` silently redirects to standard search preserving `q=photosynthesis` (with `udm=14` if `forceWebOnlySearch: true`, or stripped `udm` if `false`), strips `#rm_sg_*` hash cleanly via `history.replaceState`, and increments `aiModeRedirects`. | Vitest DNR builder + Playwright Canary |
| **AC-08** | With `blockAiModeNavigation: true`, navigating to `https://www.google.com/ai` or `https://www.google.com/aimode` silently redirects to `https://www.google.com/` and increments `aiModeRedirects`. | Vitest DNR builder + Playwright Canary |
| **AC-09** | When an AI Mode URL includes Omnibox markers (`sourceid=chrome` or `aep=` + `udm=50`), redirect fires cleanly, increments `omniboxFallbackRedirects`, and records `WARN_OMNIBOX_POLICY_MISSING` with exact Admin Console `AIModeSettings = 1` instructions. | Vitest DNR builder + Playwright test |
| **AC-10** | With `forceWebOnlySearch: true`, `https://www.google.com/search?q=mitosis` redirects to `udm=14` with **zero redirect loop**, AND non-AI tabs (`?q=mitosis&udm=2` Images, `?q=mitosis&udm=7` Videos, `?q=mitosis&tbm=nws` News) load unmodified. | Vitest DNR priority test + Playwright test |
| **AC-11** | With `hideAuxiliaryAiFeatures: true`, Search Labs triggers, Google Lens search-bar trigger, and AI follow-up/PAA cards are hidden while organic search links remain intact (`>= 5` organic `<h3>` results visible). | Vitest (jsdom) + Playwright Canary |
| **AC-12** | **Organic Results Safety Guard:** Selector engine refuses to hide `body`, `#main`, `#search`, `#rso`, or any ancestor containing `>= 3` organic `<h3>` result links, logging `ERR_SAFETY_GUARD_TRIPPED` if a selector ever attempts to match one. | Vitest unit test |
| **AC-13** | When managed (`chrome.storage.managed` present), `popup.html` displays **strictly** a 1-line *"Managed by your school"* notice with zero toggles, counters, or links. | Playwright / Vitest DOM assertion |
| **AC-14** | `options.html` renders read-only enforced settings when managed, interactive local testing toggles when unmanaged, full IT Diagnostics (counters + actionable `ERR_*`/`WARN_*` table + Copy Diagnostic JSON + CSV export), and the 4-band Admin Policy Generator (`K-2`, `3-5`, `6-8`, `9-12`) outputting valid Google Admin Console `{"key":{"Value":...}}` JSON. | Vitest + Playwright UI test |
| **AC-15** | Analytics flush payload contains ONLY allowlisted aggregate fields (`schemaVersion`, `extensionVersion`, `gradeBand`, `dateBucket`, `metrics`, `errors`) and strictly rejects any non-Apps-Script URL (`ERR_ANALYTICS_ENDPOINT_INVALID`). | Vitest unit test |
| **AC-16** | `templates/apps-script/Code.gs` validates shared token, acquires `LockService.getScriptLock()`, rejects non-allowlisted fields, appends/aggregates zero-PII daily rows into Google Sheets, and returns JSON via `ContentService`. | Code review + Vitest mock harness test |
| **AC-17** | `npm run canary` runs paired Control vs Treatment Chromium sessions, handles Google anti-bot/CAPTCHA gracefully as `INCONCLUSIVE` (never tries to bypass), validates all active protections + organic-link regression guard, writes `canary-report.json`, and saves `.webm` click-through video. | Local CLI execution |
| **AC-18** | Standalone static Admin Policy Generator (`dist-admin-tool/policy-generator.html`) opens offline/on GitHub Pages with zero external runtime dependencies and generates valid Admin Console JSON for all 4 grade bands. | Automated build + Playwright test |
