# 07 — Break-Point Audit Log (v1.0.0 `dist/`)

**Audit date:** 2026-11-20
**Scope:** Everything in this folder: `dist/` (all JS/CSS/HTML/JSON), `docs/01–05`, `README.md`, `PRIVACY.md`, `LICENSE`, `.gitignore`, `local-cws/` (store docs, canary report, screenshots, release zip listing).
**Out of scope here:** per-OU admin tooling (Admin Console / Chrome Policy API work). That's a separate track.
**Audience:** the coding agent that will fix and re-comment the code, plus the project owner who has to make the decisions in §2.

---

## 0. How to use this log

1. Read §1 (ground truth about the codebase). It changes how every fix is made.
2. Get the owner's answers to §2 (decisions). Every decision has a default; use it if there's no answer.
3. Work the break points in the order given in §5. Each BP has a **To-do** checklist and an **Done when** test.
4. Don't fix anything that isn't listed here without asking. Don't weaken the Organic Results Safety Guard (`isUnsafeToHide`) or add permissions unless a BP explicitly says so.

Severity scale: **Critical**: a student can defeat protection, or protection silently doesn't apply. **High**: protection leaks in common real-world conditions. **Medium**: wrong behavior, scale failure or tamper risk with limited blast radius. **Low**: hygiene, accuracy or maintainability.

---

## 1. Ground truth about the codebase (read first)

- **There is no source tree.** `docs/03-DEVELOPER-SPEC.md` describes `src/`, `tests/`, `scripts/`, `templates/apps-script/Code.gs` and a `package.json` with esbuild/vitest/playwright. **None of those exist in this folder.** Only the built output in `dist/` is here. `dist/` is effectively the source code now.
- **Shared logic is duplicated four times.** `parsePolicy()` and its constants are copied into `dist/background/service-worker.js`, `dist/content/content.js`, `dist/ui/popup.js` and `dist/ui/options.js`. Verified 2026-11-20: all four `parsePolicy` copies are identical (ignoring indentation). Any policy-logic fix must be applied to all four, or the duplication removed (see D1).
- **The Apps Script sink exists only as a string** embedded at `dist/ui/options.js:820` (`EMBEDDED_APPS_SCRIPT_TEMPLATE`). There's no `Code.gs` file.
- **Git:** at audit time the folder sat inside the home-directory repo. **Resolved 2026-11-20:** `git init` was run in this folder, so it's now its own repo. Nothing is committed yet.
- **License:** `LICENSE` is the standard MIT text (verified word for word). **Resolved 2026-11-20:** the contradicting "source-available / All Rights Reserved" wording was removed from `docs/01`, `docs/03`, `PRIVACY.md` and `local-cws/06` (Part C now contains the MIT text).
- **The release zip is stale.** `local-cws/release/raisemark-search-guard-v1.0.0.zip` (built 11:32) still has the old name "RaiseMark Search Guard for K-12" and uncommented bundles. Current `dist/manifest.json` (15:28) says "RaiseMark AI Search Guard". Don't upload that zip.
- **The fixture canary passed** (`local-cws/artifacts/canary-report.json`, 16/16), but it ran against a mock Google page with an **unmanaged** extension. It doesn't exercise force-install, real managed policy, non-English Google, old Chrome versions, or live DOM drift. A green canary doesn't clear any BP below.
- **Comment style today:** almost every line has a trailing `// …` comment, including `// End if`-style closers. This is the "re-comment" target (see D2 and §4).

---

## 2. Decisions needed from the owner (defaults in **bold**)

| ID | Decision | Options | Default if no answer |
|---|---|---|---|
| D1 | How to edit code with no `src/` | (a) Edit `dist/` directly and keep the 4 shared copies in sync with a check script. (b) Rebuild a `src/` + esbuild pipeline per the spec so shared code exists once. | **Resolved 2026-11-20: (b) rebuild `src/` first.** See Phase 0 in §5. |
| D2 | Comment standard for the re-comment | (a) Keep per-line comments. (b) File header + doc block per function + inline "why" comments only; delete `// End …` closers. | **Resolved 2026-11-20: (b).** Comments live in `src/`; esbuild output in `dist/` is unminified but uncommented. Standard is kept in `AGENTS.md` and §4. |
| D3 | Give the project its own git repo | `git init` in this folder (separate from the home-directory repo) vs. leave as is | **Resolved: yes (done 2026-11-20).** |
| D4 | Minimum Chrome version | Set `minimum_chrome_version` (blocks install on older devices) vs. leave unset and degrade gracefully | **Resolved 2026-11-20: minimum `"134"`** (set in `dist/manifest.json`). Basis (Google docs): older Chrome can't install; existing installs below the minimum silently stop updating (none exist yet: store status is Draft); ephemeral-mode users count as new installs. Every ChromeOS LTS since Oct 2025 (138, 144) is above 134. The code needs at most ~105. Native `AIModeSettings` needs 138, so 134–137 devices rely on the extension's redirect for the address-bar button. |
| D5 | Languages to support in text matching | English only / English + Spanish / English + top district languages | **Resolved 2026-11-20: English + Spanish**, plus `WARN_UNSUPPORTED_UI_LANGUAGE` for any other UI language (BP-03). Spanish strings must be collected from live Google (`hl=es`), not translated. |
| D6 | Analytics payload change | Keep schema v1 / move to v2 (one POST per device per flush) | **Resolved 2026-11-20: drop district analytics for now.** Reason: the extension can't hold a secret, so the endpoint can't tell real reports from fakes, and the only real fix (district-sign-in-restricted script) would attach student identity to every report. Remove during the Phase 0 rebuild: analytics code, `alarms` + `script.google.com` / `script.googleusercontent.com` permissions, the 4 analytics policy fields, the generator's analytics section, the Code.gs template. Local counters, IT Diagnostics and CSV export stay. Archived 2026-11-20 for a future rebuild: tracked folder `archive/analytics-v1/` (extracted code + rebuild guide `README.md`) and local git tag `analytics-v1-archive` → `989c95a`. |
| D7 | Product name | Manifest/README/popup/options say "RaiseMark AI Search Guard"; `docs/01–04`, `local-cws/06`, store screenshots and the stale zip say "RaiseMark Search Guard for K-12". (License part: **resolved, standard MIT**.) | **Resolved 2026-11-20: "RaiseMark: AI Search Controls for K-12"** (manifest `name`, 38 chars); `short_name` **"RaiseMark"**. Drops "Search Guard" (avoids the unrelated Elasticsearch product of that name) and keeps "AI" out of the brand position so it doesn't read as AI-powered. "Google" stays out of the title per Chrome Web Store branding rules; the description may say "for Google Search™" with an attribution line. Apply to extension strings during the rebuild and to README, PRIVACY, docs and store files during the doc pass. GitHub repo name is the owner's call. |
| D8 | Test harness | (a) Zero-dependency: Node's built-in `node:test` for logic, plus manual browser checks. (b) Add Playwright as a dev dependency to automate the browser checks against mock Google pages, like the original canary. | **Resolved 2026-11-20: Node's built-in `node --test` for S/U tests + Playwright (dev dependency only) for the B tests**, loading the built extension in Chromium against mock Google pages served via route interception (never real Google). L and M tests stay manual. |

---

## 3. Break points

### Summary

| ID | Severity | Area | One-line problem |
|---|---|---|---|
| BP-01 | Critical | Policy / lock | Force-installed with no (or fully rejected) policy JSON means students can switch protection off in Options |
| BP-02 | High | Content | Protection is fail-open until the async policy round-trip finishes (AI content can flash) |
| BP-03 | High | Content | Text matching is English-only; non-English Google UI loses text-based hiding |
| BP-04 | High | Content | Selectors depend on Google's scrambled class names and undocumented params; no way to fix without a store release, and no signal when they stop matching |
| BP-05 | High | Network/Content | AI Mode reached by in-page (soft) navigation bypasses the DNR redirect |
| BP-06 | Medium | UI/CSS | `hidden` attribute is overridden by CSS: "Locked" badges, Cancel Reset, Test Flush and the Staff card always show |
| BP-07 | Medium | Options | Students on managed devices can reset counters (wipes pending analytics) and spam "Test Flush Now" |
| BP-08 | Medium | Content | Overly broad hiding can remove real results or links |
| BP-09 | Medium | Content | A full-page sweep on every DOM mutation frame, plus a storage write per sweep; slow on low-end Chromebooks |
| BP-10 | Low (was Medium) | CSS | One `:has()` selector shares a rule with other AI Mode selectors. Moot for support now that the minimum is 134 (`:has()` is supported); keep the split as hygiene |
| BP-11 | Medium | Analytics | Removed by D6 (analytics dropped 2026-11-20); kept for reference if analytics returns |
| BP-12 | Medium | Analytics | Removed by D6 (analytics dropped 2026-11-20); kept for reference if analytics returns |
| BP-13 | Low | Messaging | Messages aren't shape- or sender-checked; malformed input produces misleading errors; secrets sent to content scripts |
| BP-14 | Low | Metrics | AI Mode / Aux counters inflate on every Google re-render |
| BP-15 | Low | Maintainability | Four copies of shared logic, no tests, stale release zip, no project repo |
| BP-16 | Info | Coverage | Surfaces the extension can't cover (Incognito, Guest, other browsers, ccTLDs, Gemini app): admin runbook gaps |
| BP-17 | Medium | Policy / sync | Overlapping async policy loads can finish out of order, so an older result (stale DNR rules, a stale tab policy, a lost toggle edit) wins |
| BP-18 | Low | Content | Unhiding doesn't fully restore the page: an original inline `display:none` is lost, and marker CSS isn't gated by policy |
| BP-19 | Low | Network | `/ai?q=…` and `/aimode?q=…` redirect to the homepage and drop the student's query |

---

### BP-01 — Students can turn protection off when an OU has no valid policy (Critical)

**Where:** `dist/background/service-worker.js:179` (no-managed-keys branch → `isManaged: false`), `:1133` (`SET_LOCAL_OVERRIDES` accepted when `!isManaged`); `dist/ui/options.js:1246` (switches enabled when `!isManaged`); `dist/ui/popup.js:251` (popup shows unmanaged view).
**Contradicts:** `docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md` "Fail-Safe Notice" and `docs/02` "Critical Security Invariant", which promise strict lockdown that students can't change.

**Failure scenario:**
1. An admin force-installs at the Students OU and hasn't pasted JSON for a child OU yet, or pasted JSON that Chrome rejects entirely (Chrome drops policy values that fail `schema.json`).
2. `chrome.storage.managed` is empty, so the extension treats the device as an IT test machine.
3. A student opens `chrome-extension://<id>/ui/options.html`, flips **Master Protection Switch** off, and DNR rules plus DOM hiding are removed.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Lock when `chrome.management.getSelf().installType === "admin"` (force-installed), even with zero managed keys. Treat that state as "managed, strict defaults". | No new permission (`getSelf` doesn't need the `management` permission; verify in current Chrome docs). Exactly targets force-installed devices. Unpacked/CWS self-installs keep test mode. | `management` API isn't available in content scripts (they don't need it; they don't decide locking). Adds one async call per policy resolve (cache it per worker wake). |
| B. Remove local test mode from the shipped build entirely; allow overrides only when `installType === "development"` (unpacked). | Smallest attack surface. | IT staff lose the ability to try toggles on a normal CWS install before rollout. Changes documented behavior. |
| C. Protect local overrides with an admin PIN. | Keeps test mode everywhere. | PIN storage on a student device is weak; more UI; still bypassable by anyone who learns it. |

**Recommendation:** **A**, and also allow overrides when `installType === "development"`. Popup and Options must use the same "is locked" decision as the service worker.

**Owner decision 2026-11-21: option A.**

**To-do:**
- [x] Add `resolveInstallType()` in the service worker: `await chrome.management.getSelf()` → `installType`. Catch errors and treat failure as `"unknown"`, which must lock (fail closed).
- [x] Extend `parsePolicy(managedRaw, localRaw, now, installType)`. If `installType` is `"admin"` (or `"unknown"`) and there are no managed keys, return strict defaults with `isManaged: true`, `source: "admin-no-policy"`, and push `WARN_NO_MANAGED_POLICY`. Update all 4 copies (or the shared module per D1).
- [x] Add `"admin-no-policy"` wherever `source` is rendered (`options.js:1205-1223` banner; diagnostic bundle) with copy along the lines of: "Force-installed by your school, no grade-band policy yet. Maximum protection is active."
- [x] `SET_LOCAL_OVERRIDES` (`service-worker.js:1133`): reject unless policy is unmanaged **and** installType is `"normal"` or `"development"`.
- [x] Popup (`popup.js:251`): stop parsing managed storage itself. Ask the service worker for the effective policy (with installType), and fall back to the **managed/locked** view if the worker is unreachable, not the unmanaged view.
- [x] Options: when locked, disable switches and the grade-band select (existing code does this off `isManaged`; confirm it now covers `admin-no-policy`).
- [x] Ignore any stale `rmsg_local_overrides` when locked (already true via the managed branch; add an explicit guard and comment).
- [ ] **Still open:** run M-01, M-02 and M-05 on a real force-installed device in a test OU (owner has no managed Chromebook yet). BP-01 is not fully verified until they pass.

**2026-11-21, fixed in `src/` (Phase 1):**
- **Install types:** only `normal` and `development` unlock test mode. Everything else locks when there are no managed keys: `admin`, plus `sideload`, `other` (two more values Chrome can report), an unreadable install type and a missing one.
- **Permission check:** `chrome.management.getSelf()` was confirmed to work with no `management` permission. It was called from the service worker and the Options page of the current build in Chromium 153, and the `@types/chrome` docs say the same. The manifest is unchanged.
- **Install-type reads:** the worker reads the install type on every policy resolve, with no cache, because docs/03 allows no mutable module-level state (CodeRabbit review of PR #4).
- **Fallbacks:** every path that can't read the install type locks: the content-script storage fallback, the Options fallback, and the popup when the worker is unreachable.
- **Tests:** U-01a (admin, sideload, other, unknown, missing), U-01d (`getSelf` throws or is missing), U-02 (development and normal), U-02b, B-13, B-13b (popup locked view), B-13c (popup, worker unreachable) and B-13d (Options banner and disabled switches when locked or unreachable) all pass. U-01a and U-02b were removed from `tests/known-failures.json`.
- **NOT RUN:** M-01, M-02 and M-05 need a managed device.

**Done when:** with the extension force-installed (real managed Chromebook/profile in a test OU) and **no** extension policy, Options shows a locked state, toggling is impossible, `SET_LOCAL_OVERRIDES` sent from the Options page DevTools console is refused, and the popup shows "Managed by your school". On an unpacked install, local toggles still work.

---

### BP-02 — Fail-open until policy loads (High)

**Where:** `dist/content/content.js:376` (`applyPolicyAttributes`), `:791-797` (`bootstrapContentGuard` awaits a service-worker round trip, then storage fallback), `:820`. `static-guard.css` only hides when `html[data-rmsg-*="1"]` is set.

**Failure scenario:** On a cold service worker (first search after wake, slow Chromebook), Google's HTML streams and paints before the attributes are set. The AI Overview or the AI Mode button flashes, and a quick click on the AI Mode button can land before hiding applies (the DNR redirect still catches the navigation if `blockAiModeNavigation` is on).

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Set all three `data-rmsg-hide-*` attributes **synchronously** as the first statement of `content.js` (fail-closed), then remove the ones the resolved policy turns off. | Simple, no permissions, true zero-flash for the hide case. | OUs that **allow** a feature (e.g. 9-12 Overviews) briefly hide it, then it appears (a small layout shift). |
| B. Have the service worker register per-policy CSS with `chrome.scripting.registerContentScripts` so Chrome injects the right CSS at `document_start` with no async step. | No flash in either direction. | Needs the new `scripting` permission. Store re-review, permission justification, and conflicts with the "exact permissions" guardrail in `docs/01`/`ONE_SHOT_PROMPT`. |
| C. Cache the last policy somewhere synchronously readable. | — | Content scripts have no synchronous extension storage, so not viable. |

**Recommendation:** **A.** The flicker in "allowed" OUs is the right trade for a K-12 product.

**Owner decision 2026-11-21: option A.**

**To-do:**
- [x] At the very top of the content-script IIFE (before `handleRedirectHashTelemetry()`), set `data-rmsg-hide-overviews/aimode/aux="1"` on `document.documentElement`, guarded for a null `documentElement`.
- [x] Keep `applyPolicyAttributes` as the step that removes attributes per policy, including when `masterEnabled === false`.
- [x] If the policy can't be resolved at all (worker and storage both fail), keep the attributes on and log `ERR_STORAGE_FAILURE`.
- [x] Comment the fail-closed rationale at the top of the file.

**2026-11-21, fixed in `src/` (Phase 1):**
- **What changed:** `applyFailClosedAttributes()` is the content script's first statement, and the resolved policy only removes attributes. When the worker is unreachable and storage is unreadable, the fallback parse locks (BP-01), so the attributes stay on. `ERR_STORAGE_FAILURE` is then sent best-effort, with the storage error text only.
- **B-01:** now checks all three attributes at parse time. It also checks, under a 6× CPU throttle, that the Overview is already hidden the instant it is parsed (an inline probe sits right after it in the fixture). It passes 3/3 runs, fails against the unfixed `dist/`, and was removed from `tests/known-failures.json`.
- **B-02:** still passes (an allowed Overview appears after load).
- **NOT RUN:** the manual DevTools check on live Google (L-tests).

**Done when:** throttling the CPU 6× in DevTools and reloading a results page that has an AI Overview shows no visible flash. With `hideAiOverviews: false` the Overview still appears after load.

---

### BP-03 — English-only text matching (High)

**Where:** `dist/content/content.js:239-240` (`headingTexts: ["ai overview"]`), `:262` (`exactTexts`), `:280` (`aiAttributionMarkers`). `static-guard.css:11` (`aria-label="AI Overview"`) and `:41-44` (`"Search Labs"`, `"Search by image"`, `"Ask a follow up"`).

**Failure scenario:** A student whose Google account or browser is set to Spanish (`hl=es`), which is common for English learners, gets a translated AI Overview heading and AI Mode label. Only the language-neutral selectors (`data-attrid`, `udm=50` links, scrambled class names) still work. When those drift (BP-04), the Overview shows with no diagnostic.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Add localized strings per language, keyed by `document.documentElement.lang`. | Keeps current approach; precise. | Strings must be collected from live Google per language and maintained. |
| B. Force `hl=en` with a DNR query transform. | One rule fixes all text matching. | Changes every student's Google UI language. Hostile to English learners; not acceptable. |
| C. Lean harder on language-neutral signals (attributes, `udm=50` hrefs, structure). | No translation upkeep. | Those signals are exactly what drifts (BP-04). |
| D. Detect a non-supported UI language and log a warning. | Makes the gap visible to IT. | Doesn't fix hiding by itself. |

**Recommendation:** **A (English + Spanish; D5 resolved 2026-11-20) + D.** Keep C as Tier 1 as today.

**To-do:**
- [x] Restructure `SELECTORS.tier1.*` text lists into `{ en: [...], es: [...] }` maps. Resolve the active set from `document.documentElement.lang` (prefix match, e.g. `es-419` → `es`), always also including `en`.
- [x] **Collect the Spanish strings from live Google** (`hl=es`) for the AI Overview heading, AI Mode tab/button, "Dive deeper in AI Mode", Search Labs, Lens, and "Ask a follow up". Don't guess translations. Record the source date in a comment beside each string.
- [x] Move the language-specific `aria-label` CSS rules out of `static-guard.css` into the JS engine (CSS can't switch on language cleanly), or add `:lang(es)` variants.
- [x] Add diagnostic code `WARN_UNSUPPORTED_UI_LANGUAGE` (catalog entry plus remediation in every copy of `ALL_ERROR_CODES`/`ERROR_CATALOG`, the Apps Script allowlist, and the payload validator). Log it once per language per day when `lang` isn't supported.

**2026-11-21, fixed in `src/` (Phase 4):**
- **Live Google inspection (`?hl=es` resolved `es-US`, `?hl=es-419`, `?hl=en`, read-only without extension loaded, 0 CAPTCHAs):**
  - Verbatim Spanish strings observed identically on both `es-US` and `es-419`: Overview heading `"Visión general creada por IA"` (`div[role="heading"][aria-level="2"] > strong.WJFise`), AI Mode tab/button `"Modo IA"`, Lens `aria-label` `"Búsqueda por imagen"`, embedded follow-up composer (`[data-xid="aim-mars-input-plate"]` `textarea` `aria-label`/`placeholder`) `"Haz una pregunta"` (English is now `"Ask anything"`).
  - Surfaces not rendered in the test session (`"Dive deeper in AI Mode"`, `"Ask AI Mode"`, `"Search Labs"`, `"Generative AI"`, `"AI-generated"`) were intentionally **not** machine-translated (`aiAttributionMarkers.es` holds `"visión general creada por ia"` only).
- **Locale resolution & selectors (`src/shared/selectors.ts`, `src/content/dom-engine.ts`, `src/content/static-guard.css`):** `resolveUiLanguage()` matches primary subtags (`en*` → `en`, `es*` → `es`, blank → `en` without warning; anything else → `en` fallback + `WARN_UNSUPPORTED_UI_LANGUAGE`). Supported non-English sets always include English fallbacks. `static-guard.css` uses `:lang(es)` rules (with a standalone `:has()` rule for `S-05b`) and adds `[data-xid="aim-mars-input-plate"]`.
- **Daily diagnostic dedupe (`src/content/content.ts`, `src/shared/storage.ts`):** `WARN_UNSUPPORTED_UI_LANGUAGE` stores only the sanitized primary subtag (no URL/page text) and logs at most once per language per UTC day across sweeps, tabs, and worker restarts.
- **Tests:** `U-24`, `B-17` (`serp-es.html` under `es-419` and `es-US`), and `B-18` (`serp-fr.html`) pass, and `B-17`/`B-18` fail against the pre-Phase-4 `dist/`.
- **NOT RUN:** `L-04` and `L-05` with the built extension loaded on live `google.com` (live Google DOM strings were collected read-only without the extension loaded).
- **2026-11-21 (CodeRabbit review of PR #7):** Persisted `WARN_UNSUPPORTED_UI_LANGUAGE` daily suppression independently in `rmsg_unsupported_lang_dates` (`src/shared/defaults.ts`, `src/shared/storage.ts`, `src/ui/options.ts`) so 50+ diagnostic log evictions cannot re-enable same-day logging across tabs/restarts while `resetLocalTelemetry()` clears it intentionally (`U-24`). Extended `:lang(es)` static CSS Overview rule with `:not(...)` / `:not(:has(...))` protected-descendant exclusions (`src/content/static-guard.css`), fixed `B-17` to rewrite `<html lang="es-419">` instead of the fixture comment and assert `document.documentElement.lang === "es-US"`.

**Done when:** with `hl=es`, an Overview and the AI Mode tab are hidden, and with `hl=fr` the warning appears in IT Diagnostics.

---

### BP-04 — Selector rot with no hotfix path and no "it stopped working" signal (High)

**Where:** `dist/content/content.js:284-287` (`tier2`: `#eKIzJc`, `div.YzCcne[data-mcpr]`, `div[data-mcp="18"]`, `div.olrp5b`, `button.plR5qb`, `button[jsname="B6rgad"]`, `div[jsname="R5mgy"]`); same names in `static-guard.css`. DNR depends on undocumented `udm=14` / `udm=50`.

**Failure scenario:** Google changes markup, Tier 2 stops matching, and the Tier 1 text/attribute paths miss too. AI Overviews show for every student. Nothing is logged, because a "no match" isn't an error. The fix ships only after store review (days).

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Remote selector feed from RaiseMark. | Fastest fixes for every district. | Breaks the zero-network promise in `PRIVACY.md`, and `docs/05` explicitly forbids remote config fetches. Store remote-code scrutiny. |
| B. New managed-policy field `extraHideSelectors` (string array per category) that admins push via Admin Console. | No network. A district can hotfix within minutes. Still passes through the safety guard. | Admin typos could hide too much (mitigated by the safety guard plus `ERR_SELECTOR_SYNTAX`). Admins need a published "current hotfix selectors" note from RaiseMark. |
| C. Leak detector: after each sweep, if visible text matching a known AI label is still on screen, log `WARN_AI_SURFACE_VISIBLE`. | Turns silent failure into a diagnostic (and an analytics count, if enabled). | Only as good as the text lists (BP-03). Risk of false positives (e.g. an article titled "AI Overview"), so limit it to heading/button roles. |
| D. Phase 2 watchdog (`docs/05`). | Already designed. | Not built. Doesn't help districts between releases. |

**Recommendation:** **B + C** now; D later.

**To-do:**
- [x] `schema.json`: add `extraHideSelectors` as an object with `overview`, `aimode` and `aux` keys, each an array of strings, with `maxItems` 20 and `maxLength` 300 per string.
- [x] `parsePolicy`: validate (array of strings, bounded). Invalid → ignore and add to `invalidFields`. Pass through only on managed policy.
- [x] Content engine: append validated extras to each category's candidate collection. They go through `safeQueryAll` (syntax errors → `ERR_SELECTOR_SYNTAX`) and `isUnsafeToHide` like everything else.
- [x] Policy generator (`options.js` `mountPolicyGenerator`): optional advanced textarea per category, emitted only when non-empty.
- [x] Leak detector: after `sweepDom`, scan `h1, h2, [role="heading"], [role="tab"], button` for the active-language AI labels that are visible (`checkVisibility()` or an offsetParent check) and not inside `[data-rmsg-hidden]`. Log `WARN_AI_SURFACE_VISIBLE` once per page (detail is the category only, no text or URL). Add the code to every allowlist (see BP-03 to-do 4).
- [x] Add a comment by every Tier 2 selector giving the date it was last confirmed on live Google.

**2026-11-21, fixed in `src/` (Phase 4):**
- **Schema & policy validation (`src/schema.json`, `src/shared/policy.ts`, `src/background/messages.ts`, `src/ui/options.ts`):** Added `extraHideSelectors` (`overview`, `aimode`, `aux`; `maxItems: 20`, `maxLength: 300`). Note: Chrome's `storage.managed_schema` parser rejects boolean `"additionalProperties": false` (`Invalid type for attribute 'additionalProperties'`), so `schema.json` omits it while `parseExtraHideSelectors()` rejects unknown keys into `invalidFields` (`S-04`, `U-04b`). Local overrides never pass `extraHideSelectors` (`admin-no-policy` and unmanaged installs stay empty), `toContentPolicy()` clones them to content scripts, and `buildZeroPiiDiagnosticBundle()` includes them.
- **Engine & leak detector (`src/content/dom-engine.ts`):** `collectExtraSelectorCandidates()` queries each hotfix selector individually so one bad selector logs `ERR_SELECTOR_SYNTAX` without breaking valid siblings, and every match still runs through `isUnsafeToHide()`. `detectVisibleAiSurfaceLeaks()` scans `h1, h2, [role="heading"], [role="tab"], button` after sweeps (skipping hidden elements and checking text before `checkVisibility()`, zero layout flushes on clean pages) and emits `WARN_AI_SURFACE_VISIBLE` once per page per leaked category (`"overview"` or `"aimode"` only, no text/URL).
- **Policy generator (`src/ui/policy-generator-core.ts`, `src/ui/shared.css`):** Each band card has a collapsible `<details>` disclosure with newline-delimited `<textarea>` inputs for `overview`, `aimode`, and `aux`, CSS syntax/bounds validation on `blur` (`aria-invalid` + `aria-describedby` + live-region announcement), live preview updates, and JSON omission when empty.
- **Live Tier 2 verification (`L-07`, read-only on `hl=en`/`es`/`es-419` 2026-11-21):** `#eKIzJc`, `div.olrp5b`, `button.plR5qb`, `button[jsname="B6rgad"]`, and `div[jsname="R5mgy"]` confirmed (1 match each); `div.YzCcne[data-mcpr]` and `div[data-mcp="18"]` had 0 matches and remain as dated legacy fallbacks (bare `div.YzCcne` is unsafe because it matches 4 PAA skeletons).
- **Tests:** `S-04`, `S-06`, `U-04`, `U-04b`, `U-13b`, `U-25`, `B-10` (managed storage stubbed in worker), `B-11`, and `B-14` pass; `U-04`, `B-10`, and `B-11` fail on the pre-Phase-4 `dist/`. `U-04` and `B-11` were removed from `tests/known-failures.json`.
- **NOT RUN:** managed-device push test with `extraHideSelectors` (`M-*`, no managed device available).
- **2026-11-21 (CodeRabbit review of PR #7):** Added `trimCssWhitespace()` (`src/shared/policy.ts`, `src/ui/policy-generator-core.ts`, `src/content/dom-engine.ts`) so `extraHideSelectors` trims only CSS Syntax Level 3 whitespace (`U+0020`, `U+0009`, `U+000A`, `U+000C`, `U+000D`) and preserves `U+00A0` (`U-04b`, `U-25`). Updated `applyEffectivePolicy()` (`src/content/content.ts`) to restore a category and re-sweep synchronously when its `extraHideSelectors` change, preserving prior inline `display` styles (`U-25`). Split `[data-xid="aim-mars-input-plate"]`, `[aria-label*="Ask anything" i]`, and `:lang(es) [aria-label*="Haz una pregunta" i]` into standalone `:has()`-guarded rules in `src/content/static-guard.css` excluding `textarea[name="q"]`, `input[name="q"]`, and landmark descendants (`S-05b`, `B-17`).

**Done when:** pasting `{"extraHideSelectors":{"Value":{"overview":["div.test-ai"]}}}` hides `div.test-ai` on a fixture page, an invalid selector logs `ERR_SELECTOR_SYNTAX` without breaking other hiding, and removing the Tier 1/2 matches for a fixture Overview produces `WARN_AI_SURFACE_VISIBLE`.

---

### BP-05 — AI Mode via in-page navigation bypasses the redirect (High)

**Where:** All DNR rules use `resourceTypes: ["main_frame"]` (`service-worker.js:914-994`). The content script only listens for `hashchange` (`content.js:817`). There's no URL-change handling.

**Failure scenario:** Google switches to AI Mode with `history.pushState` plus fetches (single-page-app style) rather than a full page load. The URL becomes `/search?…&udm=50`, but no `main_frame` request happens, so DNR never fires. Only the AI Mode *buttons* are hidden; the AI Mode page content isn't.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Content script watches URL changes (on each sweep, plus `popstate`/`pageshow`, plus the Navigation API `navigate` event where available). On an AI Mode URL, `location.replace(cleanUrl)`, reusing the same transform as DNR (udm=50 → udm=14 or removed; strip `aep, arv, mstk, csuir`). | No permissions. Covers bfcache restores too. | Duplicates the DNR transform in JS (one more thing to keep in sync). Happens after the URL change, so a brief AI Mode frame is possible. |
| B. Add `xmlhttprequest` to DNR rules to block AI Mode fetches. | Stops content at the network layer. | High risk of breaking normal search, since Google fetch URLs aren't documented. |

**Recommendation:** **A.**

**To-do:**
- [x] Add `cleanAiModeUrl(url, policy)` (pure function) in the content script, mirroring `createAiModeQueryTransform` and rule 111 (`/ai`, `/aimode` → `https://www.google.com/`). Add a comment that it must match `buildDynamicRules`.
- [x] Track `lastHref`. In `runSweepNow`, on `popstate`, and on `pageshow`: if `blockAiModeNavigation && masterEnabled` and the URL is an AI Mode URL → `location.replace(clean + "#rm_sg_aimode")`, which reuses the existing telemetry path.
- [x] If `window.navigation` exists, add a `navigate` listener doing the same check before commit (verify it fires in the isolated world; drop it if not).

**2026-11-21, fixed in `src/` (Phase 2):**
- **New module:** `src/shared/ai-mode-url.ts` `cleanAiModeUrl()` mirrors DNR rules 101, 102, 110, 111 and 112, including BP-19's keep-the-search rule. It returns the exact URL DNR would produce, with the `#rm_sg_omnibox` or `#rm_sg_aimode` marker, or null.
- **When the content script checks:** before each sweep, after each applied policy, on `popstate` and `pageshow`, and on the Navigation API's `navigatesuccess`. It uses `navigatesuccess` rather than `navigate` because it runs after the URL commits. B-06b confirms it fires in the isolated world.
- **Redirect:** one `location.replace()` per page, guarded by a flag instead of `lastHref`.
- **Tests:**
  - U-07 now runs the real content bundle in the vm harness for 15 URLs × both Web-only settings. It checks the redirect target equals the DNR simulation for AI Mode URLs and that nothing else redirects, including when `blockAiModeNavigation` is off.
  - New U-07b covers `popstate` and `pageshow`.
  - B-06 (pushState + DOM mutation) and new B-06b (pushState only) each count exactly one redirect.
  - U-07 and U-07b fail on the old `dist/`. U-07 and B-06 were removed from `tests/known-failures.json`.
- **NOT RUN:** L-06 on live Google.
- **2026-11-21 (CodeRabbit review of PR #5):** `cleanAiModeUrl()` treats `/ai` or `/aimode` as having a search if *any* `q` value is non-empty, as rule 111's regex does (`?q=&q=fractions` keeps `fractions`). U-07 and U-19 now include that URL.

**Done when:** on a fixture page, `history.pushState({}, "", "/search?q=x&udm=50")` followed by a DOM mutation ends on `udm=14` (or no `udm`) and increments `aiModeRedirects` once.

---

### BP-06 — `hidden` attribute overridden by component CSS (Medium, visible today)

**Where:** `dist/ui/shared.css:505-506` (`.rm-btn { display: inline-flex }`), `:782-783` (`.lock-indicator { display: inline-flex }`), `:1037-1043` (`.band-card { display: flex }`). No global `[hidden]` rule exists. Author `display` beats the browser's built-in `[hidden]` style.
**Evidence:**
- `local-cws/artifacts/live-test-2-options-status.png` shows **"Locked" badges next to interactive switches** in "Unmanaged Local Testing Mode".
- `live-test-4-options-diagnostics.png` shows **"Cancel Reset" and "Test Flush Now" visible** while analytics is disabled and no reset is armed.
- The Staff card in the generator is likewise always visible even though "Show Staff OU Preset" is off.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. One global rule in the `reset` layer: `[hidden]:not([hidden="until-found"]) { display: none !important; }` | Fixes every instance at once, including future ones. | Must exclude `until-found` (tab panels rely on `content-visibility`, not `display:none`). Because the rule lives in a cascade layer, `!important` in an earlier layer wins over later layers, which is what we want; verify in Chrome. |
| B. Per-component `.rm-btn[hidden] { display:none }` rules | Surgical. | Easy to miss the next component. |

**Recommendation:** **A.**

**To-do:**
- [x] Add the rule in `@layer reset`.
- [x] Re-check every element that uses `hidden`: the 6 lock badges, Test Flush, Cancel Reset, field errors, the Staff card, the AIModeSettings reminders and the tab panels (must still switch, and Ctrl+F `beforematch` must still work).

**2026-11-21, fixed in `src/` (Phase 1):**
- **What changed:** `[hidden]:not([hidden="until-found"]) { display: none !important; }` is in `@layer reset`. As the first layer, its `!important` outranks every later layer.
- **Elements checked:** Test Flush no longer exists (D6). The policy generator has no field-error elements today (`syncFieldErrorLink` is unused).
- **Tests:** S-05a and B-12 pass, and both were removed from `tests/known-failures.json`. B-12 now also checks that the Staff card appears after "Show Staff OU Preset", that the K-2 AIModeSettings reminder shows, and that an inactive `until-found` tab panel keeps a non-`none` display, so it stays findable.
- **NOT RUN:** actually pressing Ctrl+F to trigger `beforematch` can't be automated in Playwright; it's a manual check.

**Done when:** the unmanaged Options page shows no "Locked" badges, Cancel Reset only appears after the first Reset click, Test Flush only appears when analytics is enabled, the Staff card only shows after clicking "Show Staff OU Preset", and tab switching still works.

---

### BP-07 — Students can tamper with diagnostics and analytics on managed devices (Medium)

**Where:** `dist/ui/options.js:1395-1422` (Reset Local Counters → `RESET_LOCAL_METRICS` → `resetLocalTelemetry()` wipes **pending** analytics buckets and the diagnostic log); `:1373-1394` and `service-worker.js:1153` (`TRIGGER_TEST_FLUSH` with `force: true` bypasses backoff on every click).

**Failure scenario:** A student clears counters to hide that AI Mode was attempted (district analytics under-reports), or clicks Test Flush repeatedly, hammering the district's Apps Script endpoint.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. When locked (BP-01's decision), disable Reset, and rate-limit Test Flush (e.g. once per 15 minutes per device, enforced in the service worker). | Keeps IT's ability to verify connectivity. | A rate limit still allows one extra POST per 15 minutes per device. |
| B. Hide the whole Diagnostics tab when locked. | Simplest. | IT technicians lose on-device diagnostics, a documented feature (`docs/04` step 5). |

**Recommendation:** **A.** Enforce in the **service worker**, not only the UI.

**To-do:**
- [x] Service worker: refuse `RESET_LOCAL_METRICS` when locked. Return `{ ok:false, reason:"locked" }`.
- [ ] ~~Service worker: store `lastManualFlushAtMs` in telemetry state and refuse `TRIGGER_TEST_FLUSH` within 15 minutes, returning the time remaining.~~ Removed by D6: Test Flush no longer exists.
- [x] Options: disable Reset with explanatory text when locked; show the rate-limit message.
- [x] Keep Reset fully available in unmanaged/development mode.

**2026-11-21, fixed in `src/` (Phase 2):**
- **Service worker:** refuses `RESET_LOCAL_METRICS` with `{ ok:false, reason:"locked" }` under the same lock rule as `SET_LOCAL_OVERRIDES`: managed or `admin-no-policy`, or an install type other than normal or development. BP-13 already refuses it from google.com tabs.
- **Options:** when the policy is locked, Options disables Reset, disarms a pending confirm and shows "Counters can't be reset on a device managed by your school". If the worker still refuses, it reports that. The rate-limit message no longer applies, since Test Flush is gone (D6).
- **Tests:** U-14a passes and was removed from `tests/known-failures.json`. U-14b (development and normal can reset), B-12 (Reset enabled when unmanaged) and B-13d (Reset disabled and the note shown when locked or the worker is unreachable) pass.
- **`docs/04`:** the verification step mentions it.
- **NOT RUN:** M-05 (managed device).

**Done when:** on a locked device, Reset is disabled and a console-sent `RESET_LOCAL_METRICS` is refused, and a second Test Flush within 15 minutes is refused with a clear message.

---

### BP-08 — Overly broad hiding (Medium)

**Where:**
- `static-guard.css:26` `a[href*="/aimode"]` hides **any** link containing `/aimode`, including organic results to other sites. `content.js:252` repeats it in JS.
- `content.js:253` / `:535` `a[href^="https://www.google.com/ai"]` also matches other paths that merely start with `/ai…`.
- `content.js:245` `[data-hveid]` as a stopping ancestor when walking up from an "AI Overview" heading. Google puts `data-hveid` on most result blocks, so the nearest one can be a wrapper that also contains real results.
- `content.js:229` safety threshold is **3** organic results, so a container with 1–2 real results can still be hidden.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Tighten selectors to Google-relative AI URLs: `a[href^="/aimode"]`, `a[href^="https://www.google.com/aimode"]`, `a[href="/ai"]`, `a[href^="/ai?"]`, `a[href^="/ai/"]` (plus the `google.com` host variants). Drop `[data-hveid]` from the overview ancestor list and cap the walk at about 8 levels. For the `overview` category only, refuse any candidate containing **≥1** organic result. | Removes false positives. | Some real AI Overview wrappers may no longer match. They then show up via BP-04's leak detector instead of being silently over-hidden. |
| B. Keep breadth, lower the threshold only. | Small change. | `/aimode` link false positives remain. |

**Recommendation:** **A.**

**To-do:**
- [x] Replace the broad href selectors in **both** `static-guard.css` and `SELECTORS.tier1.aiModeUi.directSelectors` and the extra selector at `content.js:535`.
- [x] Remove `"[data-hveid]"` from `containerAncestors`. Add a `maxAncestorDepth` constant (8) to `findOverviewHeadingContainer`.
- [x] Make the threshold per category: `overview: 1`, others `3`. Pass the category into `isUnsafeToHide`.
- [x] Keep `ERR_SAFETY_GUARD_TRIPPED` reporting as is.

**Done when:** a fixture with an organic result linking to `https://example.com/blog/aimode-review` still shows it, and a fixture where the AI Overview's nearest `data-hveid` wrapper also holds one organic result hides only the Overview card.

**Added 2026-11-21 (CodeRabbit review of PR #3, not yet verified):** the `static-guard.css` overview rules hide any matching `div[data-attrid="AIOverview"]` etc. outright, so the CSS path never runs `isUnsafeToHide()`. A matching container that also holds ≥3 organic results is hidden by CSS even though the JS guard would refuse it.
- [x] Confirm with a fixture (an `AIOverview` div wrapping 3 organic results). If confirmed, make the CSS path respect the guard (e.g. `:not(:has(a > h3 ~ …))`-style exclusions, or limit CSS to candidates the JS guard has marked) without weakening `isUnsafeToHide`.

**2026-11-21, fixed in `src/` (Phase 2):**
- **AI Mode links:** `SELECTORS.tier1.aiModeUi.directSelectors` and `static-guard.css` now share one Google-only list: `/search?…udm=50`, `/aimode…`, `/ai`, `/ai?…` and `/ai/…`, each relative or on `https://www.google.com` / `https://google.com`. The extra host selector in `dom-engine.ts` was folded into the list. The nav-tab `:has()` rule became three single-selector rules, to keep BP-10.
- **Overview containers:** `[data-hveid]` was removed from `containerAncestors`, and `findOverviewHeadingContainer` stops after 8 levels (`maxAncestorDepth`).
- **Safety guard:** `isUnsafeToHide(el, doc, category)` refuses an Overview candidate holding ≥1 organic result (`overviewOrganicResultThreshold`); other categories keep 3. This only makes the guard stricter.
- **CSS gap:** confirmed. The old CSS hid an `AIOverview` container that wrapped an organic result, and B-05b fails on the old `dist/` for exactly that. Each Overview CSS rule now carries `:not(:has(a > h3)):not(:has(h3.LC20lb))`, in one rule per selector, so the JS guard decides and logs `ERR_SAFETY_GUARD_TRIPPED`.
- **Tests:** B-04, B-05 and new B-05b (wrapped organic result visible with the guard error logged, external `?udm=50` link visible, absolute `https://www.google.com/aimode` link still hidden) pass. B-03 still passes. B-04 and B-05 were removed from `tests/known-failures.json`.
- **NOT RUN:** L-07 (re-confirming the selectors on live Google).

**2026-11-21, CodeRabbit review of PR #5:**
- **Re-check on every sweep:** `processCategoryCandidates()` now re-runs the guard on every element its category already hid. A wrapper hidden while empty that later receives an organic result is restored and logged as `ERR_SAFETY_GUARD_TRIPPED` ("Un-hid …"). Test: new B-05c.
- **Query-only links:** relative links such as `href="?q=x&udm=50"` (which resolve to `/search` on a results page) were added to the AI Mode link list in `selectors.ts` and `static-guard.css`. Test: B-05b.
- B-05b and B-05c fail on the code before this change.

---

### BP-09 — Sweep cost and storage churn (Medium)

**Where:**
- `content.js:738-744`: the observer fires for any change anywhere in `body`, and each animation frame runs a **full** sweep.
- `content.js:259` + `:546-550`: the text scan walks every `a` and `button` on the page and reads `textContent` for each.
- `content.js:470-472`: `topLevelCandidates` compares every candidate against every other (cost grows with the square of the count).
- `content.js:362`: `isUnsafeToHide` searches the whole document for the search input once per candidate.
- `content.js:704` → `service-worker.js:460`: every sweep that hides something sends a message, and the service worker reads and rewrites the **entire** telemetry object.
- `options.js:1427-1432`: the open Options page re-renders on every one of those writes.

**Failure scenario:** On a 4 GB Chromebook, Google results pages that mutate continuously (Overview streaming, People Also Ask expanding) cause input lag and battery drain. Telemetry writes happen several times per search.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Throttle: at most one sweep per 150 ms, plus a final sweep after mutations settle; keep rAF for the first sweep. | Small change, large win. | Up to 150 ms longer exposure for JS-hidden (non-CSS) items; CSS rules still apply instantly. |
| B. Incremental sweeps over added-node subtrees only. | Most efficient. | Complex. Misses attribute-only changes. Bug-prone. |
| C. Batch metrics in the content script; flush on `pagehide` / `visibilitychange` (hidden) and at most every 10 s. | Cuts storage writes by about 10×. | A few counts can be lost if the tab crashes (acceptable for aggregate stats). |
| D. Narrow the text scan to `[role="tab"], [role="listitem"] a, button, [role="button"]` plus anchors with short text (≤ 40 chars), and look up the search input once per sweep. | Large constant-factor win. | Tiny chance of missing a long-labelled AI link. |

**Recommendation:** **A + C + D.** Also make the Options page's storage listener ignore telemetry-only changes unless the Diagnostics tab is visible.

**To-do:**
- [x] Add throttling around `scheduleSweep`. Comment the timing rationale.
- [x] Look up the search input once per sweep and pass it into `isUnsafeToHide`.
- [x] Replace the all-pairs `topLevelCandidates` filter with a single pass (sort in document order, skip any candidate contained in the last kept one).
- [x] Accumulate `deltas` in a module-level object and flush via `INCREMENT_METRICS` on `pagehide`, on `visibilitychange` to hidden, and on a 10 s timer.
- [x] Options: in the storage listener, skip `refreshSnapshot()` for `local` changes that only touch `rmsg_telemetry` while the Diagnostics panel is hidden.

**2026-11-21, fixed in `src/` (Phase 3):**
- **Sweep throttling (`src/content/content.ts`):** `scheduleSweep()` runs first/idle sweeps on the next animation frame and throttles burst mutation sweeps to at most once every 150 ms with a trailing sweep after mutations settle; `disconnectObservers()` cancels pending timers and animation frames.
- **DOM sweep & safety-guard cache (`src/content/dom-engine.ts`, `src/shared/selectors.ts`):** `createSafetyGuardCache()` snapshots search inputs and protected landmarks once per sweep for `isUnsafeToHide()` (falling back to live queries for disconnected or non-light-DOM elements), `isUnsafeToHide()` uses a `querySelector` short-circuit at threshold 1, `filterTopLevelCandidates()` sorts in document order (`compareDocumentPosition`) for a single-pass containment filter, built-in selector lists are pre-combined at module load, already-hidden elements are skipped before normalization/walking, AI Mode `<a>` text matching skips anchors with trimmed length > 40 (`maxAnchorTextLength: 40`), and `hasAiAttributionBadge()` skips leaf text > 60 chars.
- **Batched metrics (`src/content/content.ts`):** `queueMetricDeltas()` accumulates deltas in memory and `flushPendingMetrics()` flushes once on `visibilitychange` (`hidden`), `pagehide`, AI Mode redirect, `masterEnabled: false`, or a 10 s fallback timer.
- **Options listener (`src/ui/options.ts`):** `chrome.storage.onChanged` skips `refreshSnapshot()` for `rmsg_telemetry`-only `local` updates while `#panel-diagnostics` is hidden and marks Diagnostics stale so switching to it refreshes once.
- **B-09 CDP CPU profile benchmark (Phase 2 `dist/` vs. Phase 3 `build/` on `tests/browser/fixtures/churn.html`, 2 s of 16 ms DOM mutations, 3 runs each):**
  - Phase 2 `dist/` baseline: **50.18 ms/s median** (50.55 ms/s mean; runs: 51.76, 50.18, 49.73 ms/s), **125** telemetry storage writes during the 2 s churn.
  - Phase 3 `build/`: **5.67 ms/s median** (5.76 ms/s mean; runs: 5.99, 5.67, 5.63 ms/s), **0** telemetry storage writes during the 2 s churn (flushed on exit/10 s).
  - Reduction: **88.7% median** (88.6% mean), exceeding the ≥50% target.
- **Tests:** `U-21`, `U-22`, `B-08` (churning SERP: ≤2 telemetry writes, all counters flushed on `pagehide`), `B-08b`, and `B-09` pass. `B-07`, `B-08`, and `B-08b` fail against the unfixed Phase 2 `dist/`.

**2026-11-21, CodeRabbit review of PR #6:**
- **Restore unsafe wrappers before collection (`src/content/dom-engine.ts`):** Extracted `restoreUnsafeHiddenElements()` and run it in `sweepDom()` before collecting any category candidates, so restored `[role="listitem"]` wrappers release inner AI Mode buttons and short anchors to be hidden in the same sweep (`B-05d`).
- **Reset epoch gating (`src/shared/defaults.ts`, `src/shared/storage.ts`, `src/background/messages.ts`, `src/background/service-worker.ts`, `src/content/content.ts`, `src/ui/options.ts`):** `readMetricsResetEpoch()` propagates storage read errors (`0` only when missing/malformed) so `resetLocalTelemetry()` cannot regress a stored epoch on failure and increments `rmsg_metrics_reset_epoch` atomically; open content scripts discard `pendingMetricDeltas` and cancel `metricsFlushTimer` on reset via `storage.onChanged`, confirm the epoch (retrying on transient error without caching `0` and dropping unconfirmed batches on unload rather than sending untagged messages), and tag every `INCREMENT_METRICS` batch with `resetEpoch` so stale pre-reset batches are ignored (`U-23`, `U-23b`).

**Done when:** on a recorded results page, a DevTools Performance profile shows sweep time per second reduced by at least 50% versus baseline, and a single search causes ≤ 2 telemetry writes.

---

### BP-10 — `:has()` invalidates the whole AI Mode CSS block on older Chrome (Medium)

**Where:** `dist/content/static-guard.css:24`. `div[role="listitem"]:has(a[href*="udm=50"])` is in the **same selector list** as the other five AI Mode selectors. CSS drops an entire rule if any selector in its list is unsupported, so on browsers without `:has()` **all** static AI Mode hiding disappears. The manifest has no `minimum_chrome_version`.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Move the `:has()` selector into its own rule block; leave the manifest without a minimum version (D4). | Older devices keep 5 of 6 AI Mode CSS selectors plus all JS hiding and DNR. | Nothing significant. |
| B. Set `minimum_chrome_version` to the newest feature used. | Clear support contract. | Older Chromebooks (past their update cutoff) can't install the extension at all and end up with **zero** protection. |

**Update 2026-11-20:** D4 resolved to a minimum of Chrome 134, which supports `:has()`, so the failure scenario no longer applies to any device that can install the extension. Still do option A's split (cheap insurance against future selector mistakes). `docs/04` now states the 134 requirement and that full two-layer protection needs 138.

**To-do:**
- [x] Split line 24 into a separate rule with the same declarations.
- [x] Audit every other selector list for features newer than the baseline (`[attr i]` flag is fine). Note any you find with a comment.

**2026-11-21, fixed in `src/` (Phase 1):**
- **What changed:** the `div[role="listitem"]:has(a[href*="udm=50"])` selector has its own rule in `static-guard.css`, with the same declarations and a comment saying why.
- **Audit:** the newest selector features in `static-guard.css` and `shared.css` are `:has()` (Chrome 105), `:is()` and `:where()` (88) and the `[attr i]` flag (49). All are below the 134 minimum. `shared.css`'s only `:has()` (`.toggle-row:has(.rm-switch:disabled)`) is alone in its rule. Nothing else needed a comment.
- **Tests:** S-05b passes and was removed from `tests/known-failures.json`. B-03 still passes (the AI Mode tab is hidden).
- [ ] Add a "Supported Chrome versions" line to `docs/04` (agent must look up which version shipped `:has()` and `hidden="until-found"` rather than guess).

**Done when:** in a browser with `:has()` disabled or unsupported, `button.plR5qb` and `a[href*="udm=50"]` are still hidden by CSS alone.

---

### BP-11 — Apps Script analytics sink won't scale (Medium)

**Where:** `dist/ui/options.js:820` (embedded `Code.gs`): every POST takes the script lock for up to 15 s, then `getRange(...).getValues()` scans **every row** of `Daily_Rollup` and `Error_Summary`. Client side (`service-worker.js:744-848`) sends **one POST per pending date bucket**. Web app must be "Anyone", and `SHARED_TOKEN` is readable in `chrome://policy`, so anyone can append junk rows.

**Failure scenario:** 10,000 devices at the default 240 min interval is about 60,000+ POSTs per day. Each serializes behind one lock and scans a growing sheet. Lock timeouts become `ERR_ANALYTICS_FLUSH_FAILED` everywhere, devices back off up to 24 h, and the district dashboard goes stale or wrong. Google's Apps Script concurrency and daily runtime quotas also apply (agent must check current quota numbers, not assume).

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. **Append-only** sink: `doPost` validates and does a single `appendRow` to a `Raw` sheet (no scan, very short or no lock). A **time-driven trigger** (hourly) rolls `Raw` up into `Daily_Rollup` / `Error_Summary` and clears processed rows. | Per-request cost stays constant; lock contention gone. | More moving parts for the district (installing a trigger). Rollup is up to an hour behind. |
| B. Payload v2: one POST per flush carrying **all** pending buckets; default interval raised to 720 min. | 2–5× fewer requests. | Schema change (OK per D6, since nothing is deployed). |
| C. Server-side shard by grade band (one sheet per band). | Less scanning. | Still scans; still one lock. |
| D. Accept spam risk, document it. | Honest. | — |

**Recommendation:** **A + B + D.** Note in `docs/04` that the token is anti-noise, not security.

**To-do:**
- [ ] ~~Extract the `Code.gs` string to a real file `templates/apps-script/Code.gs`. Keep the embedded copy generated or synced, and add it to the sync check (BP-15).~~ Removed by D6 (analytics dropped 2026-11-20).
- [ ] ~~Rewrite `doPost` as validate → `appendRow` to `Raw`. Add `rollup_()` plus an `installTrigger()` helper the admin runs once.~~ Removed by D6.
- [ ] ~~Payload `schemaVersion: 2`: `{ schemaVersion, extensionVersion, token?, gradeBand, buckets: [{ dateBucket, metrics }], errors }`. Update `ALLOWED_PAYLOAD_KEYS`, `buildSanitizedPayload`, `assertNoPiiPayload` (cap `buckets` at 14 entries) and the Code.gs validator. Keep the strict allowlist.~~ Removed by D6.
- [ ] ~~Client: one POST per flush; subtract only what was sent (current logic, per bucket).~~ Removed by D6.
- [ ] ~~Default interval: 720 (schema description, `DEFAULT_ANALYTICS_POLICY` in all copies, generator default, docs).~~ Removed by D6.
- [ ] ~~Update `docs/04` Step 4 (trigger install step; token caveat).~~ Removed by D6.

**2026-11-21 (Phase 4):** Confirmed N/A per D6 — district Google Sheets analytics and `Code.gs` remain absent (`S-06b` enforces this across `src/`, `build/`, and `dist/`).

**Done when:** a local harness (mock `SpreadsheetApp`/`LockService`, or a scratch Sheet) shows `doPost` never calls `getValues()`. The rollup produces the same totals as v1 for a fixed sample of payloads. The client sends exactly one POST for three pending days.

---

### BP-12 — Analytics alarm chain can die (Medium)

**Where:** `service-worker.js:655-662` creates a **one-shot** alarm (`delayInMinutes`, no `periodInMinutes`). `:1201-1213` reschedules only on the success path inside `try`. If `flushAnalyticsIfDue` or policy resolution throws, or the worker is killed before `scheduleAnalyticsAlarm` runs, no alarm exists until the next browser startup or policy change. On Chromebooks that sleep instead of restarting, that can be days.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Repeating alarm: `create(name, { delayInMinutes: interval + jitter, periodInMinutes: interval })`. Only recreate when the interval changes. | Survives exceptions and worker kills by design. | Jitter applies only to the first fire (fine: the first-fire jitter already spreads devices). |
| B. Move rescheduling to `finally`. | Minimal change. | Still lost if the worker is killed mid-handler. |

**Recommendation:** **A**, plus an "ensure alarm exists" check at top level on every worker wake (cheap `alarms.get`).

**To-do:**
- [ ] ~~Change `scheduleAnalyticsAlarm` to repeating. Store the configured interval in the alarm name or telemetry state so it's recreated only when the interval changes.~~ Removed by D6 (analytics and `chrome.alarms` dropped 2026-11-20).
- [ ] ~~`onAlarm`: no rescheduling; wrap the flush in try/catch only.~~ Removed by D6.
- [ ] ~~Top level: `void ensureAnalyticsAlarm()` (resolve policy → create or clear as needed).~~ Removed by D6.

**2026-11-21 (Phase 3):** Confirmed N/A per D6 — `chrome.alarms` and all analytics flush scheduling remain absent (`S-06b` enforces this across `src/`, `build/`, and `dist/`).

**Done when:** with an injected flush failure (e.g. invalid JSON response), the alarm still exists afterwards (`chrome.alarms.getAll()` in the service worker console) and fires again on schedule.

---

### BP-13 — Message handling hardening (Low)

**Where:** `service-worker.js:1214` (no `sender` check); `:1114` (`LOG_DIAGNOSTIC` with an unknown code: `createDiagnosticEntry` reads `ERROR_CATALOG[code]` as undefined at `:150` and throws, and the failure is logged as a misleading `ERR_STORAGE_FAILURE "onMessage: …"`); `:460` (`INCREMENT_METRICS` with missing `deltas` throws on `deltas[key]`); `:1089` (`GET_EFFECTIVE_POLICY` returns `analyticsSharedToken` and the endpoint URL to content scripts running on google.com).

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Validate every message: `sender.id === chrome.runtime.id`. **Privileged** types (`SET_LOCAL_OVERRIDES`, `RESET_LOCAL_METRICS`, `TRIGGER_TEST_FLUSH`, `GET_DIAGNOSTIC_SNAPSHOT`) only from extension pages (`sender.url` starts with `chrome-extension://<id>/`; no `sender.tab` with a google.com URL). Shape-check payloads; `code` must be in `ALL_ERROR_CODES`. Return a content-safe policy (toggles + `gradeBand` only) to content scripts. | Defense in depth; clean errors. | A little more code. |
| B. Leave as is. | — | Misleading diagnostics persist. |

**Recommendation:** **A.**

**To-do:**
- [x] Add `isFromExtensionPage(sender)` and `isFromContentScript(sender)` helpers. Gate the privileged types.
- [x] Add `validateMessage(message)` per type. On failure return `{ ok:false, error:"bad_message" }` **without** logging `ERR_STORAGE_FAILURE`.
- [x] Add `toContentPolicy(policy)` returning only the 6 toggles, `gradeBand`, `isManaged`, and `blockAiModeNavigation`/`forceWebOnlySearch` (needed by BP-05). Use it for messages from content scripts.
- [x] Content-script fallback path (`content.js:785-789`): unchanged. It reads managed storage directly and never transmits anything.

**2026-11-21, fixed in `src/` (Phase 2):**
- **New module:** `src/background/messages.ts` holds `isFromExtensionPage()`, `validateMessage()` (a typed message union), `toContentPolicy()` and `PRIVILEGED_MESSAGE_TYPES`.
- **Sender check:** an extension page is a sender whose `id` is ours and whose `url` is `chrome-extension://<id>/…`. Everything else counts as not a page, so `isFromContentScript()` wasn't needed. A missing id or URL fails closed.
- **Privileged messages:** `SET_LOCAL_OVERRIDES`, `RESET_LOCAL_METRICS` and `GET_DIAGNOSTIC_SNAPSHOT` from a non-page sender get `{ ok:false, error:"forbidden" }`.
- **Bad messages:** malformed or unknown messages get `bad_message`, and neither response is logged.
- **Content policy:** `GET_EFFECTIVE_POLICY` from a content script returns only the toggles, `gradeBand` and `isManaged`.
- **Tests:** U-12a, U-12b, U-12c, U-12e and U-12f pass and were removed from `tests/known-failures.json`. U-12d, U-13 and new U-13b (content-safe keys, full policy for pages, unknown type not logged) pass. The browser suite passes with content scripts on the reduced policy.

**Done when:** a `LOG_DIAGNOSTIC` with `code:"NOPE"` sent from the Options console returns `bad_message` and doesn't add a log entry, and the content script's policy object has no analytics fields.

---

### BP-14 — Inflated AI Mode / Aux counters (Low)

**Where:** `content.js:624-626` and `:637-639` count every newly hidden element per sweep. When Google re-renders, the same button is a new element and is counted again. Canary evidence: `aiModeUiHidden: 22` and `auxAiHidden: 22` over a handful of fixture pages.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Count at most 1 per category per page (like `overviewsHidden`), meaning "pages where X was hidden". | Comparable, explainable numbers for boards and parents. | Meaning changes (document it). |
| B. Count distinct elements per page using a stable key (tag + href/aria-label hash). | Closer to the original intent. | More code. Keys can still churn. |

**Recommendation:** **A.** Rename the UI labels to "Searches with AI Mode UI hidden" and "Searches with auxiliary AI hidden".

**To-do:**
- [x] Track `seenAiModePages` / `seenAuxPages` sets like `seenOverviewPages`.
- [x] Update labels in `options.html` (metric cards), the CSV headers' meaning in a comment, and the `docs/02` analytics description.

**2026-11-21, fixed in `src/` (Phase 3):**
- **Per-page category sets (`src/content/content.ts`, `src/content/dom-engine.ts`):** `seenOverviewPages`, `seenAiModePages`, and `seenAuxPages` (`SeenCategoryPages`) count each hidden category at most once per opaque page key.
- **UI & docs (`src/ui/options.html`, `src/ui/options.ts`, `docs/02-ARCHITECTURE.md`, `docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md`):** Renamed Options metric cards to **"Searches with AI Mode UI hidden"** and **"Searches with auxiliary AI hidden"**, documented the per-page meaning in `buildMetricsCsv()`, and updated architecture/runbook notes.
- **Tests:** `B-07` (3 reloads with multi-burst re-render churn → `{ overviewsHidden: 3, aiModeUiHidden: 3, auxAiHidden: 3 }`) passes, fails on Phase 2 `dist/` (`{ overviewsHidden: 3, aiModeUiHidden: 12, auxAiHidden: 21 }`), and was removed from `tests/known-failures.json`.

**Done when:** reloading the same results page 3 times increments each category by exactly 3, regardless of re-renders.

---

### BP-15 — Maintainability and release hygiene (Low)

**Where:** §1 facts: four `parsePolicy` copies, `ERROR_CATALOG`/constants copied, Code.gs only as a string, no tests, stale release zip, no project repo.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Keep `dist/` as the source (D1a) and add `scripts/check-shared-sync.mjs` (Node built-ins only). It extracts marked shared regions (`// <shared:policy>` … `// </shared:policy>`) from all bundles and fails if they differ. | No dependencies; catches drift. | Still four places to edit; the check just enforces it. |
| B. Rebuild `src/` + esbuild (D1b). | One copy; matches the docs. | Bigger change than this pass needs. |

**Recommendation:** ~~A~~ **B, per owner decision D1 (2026-11-20).** The A to-dos below are superseded by the Phase 0 rebuild in §5. Keep only the syntax check, the version bump and the "no store upload" rule.

**To-do (superseded by D1 = B except where noted):**
- [ ] Wrap every duplicated block (constants, `parsePolicy`, storage readers, error catalog, Code.gs allowlists) in `<shared:NAME>` markers in each file.
- [ ] Add `scripts/check-shared-sync.mjs` and a short `scripts/README.md` on how to run it.
- [ ] Add `scripts/syntax-check.mjs` that runs each `dist` JS file through Node's syntax check (copy ES-module files to `.mjs` in a temp dir first; `service-worker.js`, `popup.js` and `options.js` are modules, `content.js` is a classic script).
- [ ] Bump `manifest.json` `version` to `1.0.1` when all BPs land. **Don't** rebuild or upload the store zip without the owner's OK.
- [ ] (D3) `git init` only after the owner approves.

**Done when:** both scripts exit 0 on the fixed tree, and deliberately editing one copy of `parsePolicy` makes the sync check fail with the file name.

---

### BP-16 — Coverage the extension can't provide (Info, docs only)

These are by design and outside the extension's reach. They belong in `docs/04` so districts don't assume coverage they don't have:
- Incognito and Guest windows → admin should set `IncognitoModeAvailability` = disabled and `BrowserGuestModeEnabled` = false for student OUs (agent: confirm exact policy names in Google's Chrome Enterprise policy list).
- Other browsers, unmanaged profiles, personal devices → not covered.
- Country Google domains (`google.co.uk` etc.) → listed as a non-goal in `docs/01 §3.2`; say so in `docs/04`.
- Gemini app (`gemini.google.com`) and Gemini in Chrome → controlled by Workspace/Chrome admin settings, not this extension.
- Chrome's own address-bar AI Mode button → `AIModeSettings` (already documented).

**To-do:**
- [ ] Add a "What this extension does not cover" section to `docs/04` with the companion settings above. No code changes.

---

### BP-17 — Overlapping async policy loads finish out of order (Medium)

**Found:** CodeRabbit review of PR #3 (2026-11-21); carried over unchanged from the original `dist/`. Verified against `src/` 2026-11-21.

**Where:**
- `src/background/service-worker.ts` `syncRuntimeState()`: resolves policy, awaits the queued diagnostic writes, then queues `syncDynamicRules()`. Only the DNR update is serialized, not resolve + install. An older sync (e.g. `onStartup`) can still be awaiting its diagnostics while a newer managed-policy sync queues its rules. The older one then installs **stale** rules last. Example: an older `masterEnabled:false` result removes the rules a newer enabled policy just installed.
- `src/background/service-worker.ts` `SET_LOCAL_OVERRIDES`: `readLocalOverrides()` runs outside the storage queue and only `writeLocalOverrides()` is queued, so two quick toggle clicks can each merge into the same old object and one edit is lost.
- `src/content/content.ts` `chrome.storage.onChanged` → `loadEffectivePolicy()` → `applyEffectivePolicy()`, and `bootstrapContentGuard()`: no load sequence number. If two loads overlap and the older (disabled) one finishes last, the tab unhides everything and disconnects its observers until the next reload or storage change (fail-open).
- `src/ui/options.ts` storage-change refresh (`fetchDiagnosticSnapshot()` → `renderSnapshot()`): an older snapshot can replace the controls, counters and `currentSnapshot` after a newer one.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Generation counter per flow: bump a number when a load starts; apply a result only if its number is still the latest. In the service worker, also run resolve + install as **one** serialized operation (its own chain, not nested inside the storage queue, or it deadlocks on the queued diagnostic writes). Do the toggle read-merge-write as one queued op. | Small, local changes; the newest policy always wins. | One counter per flow to keep correct. |
| B. Debounce storage events. | Fewer overlapping loads. | Doesn't remove the race, only narrows it. |

**Recommendation:** **A.** Use the same sequence check for the content script's bootstrap and storage-change loads, so every policy source follows one rule (this touches BP-02's bootstrap code; do them together).

**To-do:**
- [x] Service worker: one serialized `syncRuntimeState` chain (resolve + diagnostics + DNR install), or a generation check that drops a stale install.
- [x] Service worker: `SET_LOCAL_OVERRIDES` read + sanitize + merge + write as one queued operation. Keep BP-01's lock check in front of it.
- [x] Content script: `policyLoadSeq` used by both bootstrap and `storage.onChanged`; apply only the latest result.
- [x] Options: refresh generation in the storage-change path; a lone refresh still renders normally.

**Done when:** U-17 (two overlapping syncs with the older one resolving last end with the newer policy's rules installed), U-18 (two concurrent `SET_LOCAL_OVERRIDES` keep both edits), U-20 (an older disabled content-script load finishing after a newer enabled load leaves the tab protected) and B-15 (Options keeps the newer of two overlapping snapshots) pass.

**Phase:** 1 (owner decision 2026-11-21).

**2026-11-21, fixed in `src/` (Phase 1):**
- **Service worker:** `syncRuntimeState()` runs each whole sync on its own chain, separate from the storage queue so it can't deadlock.
- **Toggle writes:** `SET_LOCAL_OVERRIDES` goes through a new `mergeLocalOverrides()`, which reads, merges and writes as one queued operation.
- **Content script:** bootstrap and `storage.onChanged` both use `loadAndApplyPolicy()`, which drops a result once a newer load has started.
- **Options:** every `refreshSnapshot()` call carries a generation number, and only the latest one renders.
- **Tests:** U-17, U-18, U-20 (new `tests/helpers/content-harness.mjs`, because a browser test can't control the order the worker's replies arrive in) and B-15 pass. All four fail on the build from before this change, so they test the races themselves.

---

### BP-18 — Unhiding doesn't fully restore the page (Low)

**Found:** CodeRabbit review of PR #3 (2026-11-21); carried over unchanged from the original `dist/`. Verified against `src/` 2026-11-21.

**Where:**
- `src/content/dom-engine.ts` `hideElement()`: saves the element's original inline `display` only when it is non-empty **and not `"none"`**. If Google had the element hidden inline (`display:none`), `restoreElementVisibility()` removes the property, and the element Google meant to hide becomes visible when a toggle is turned off.
- `src/content/static-guard.css` `[data-rmsg-hidden] { display:none !important … }` is global: it isn't gated by the matching `html[data-rmsg-hide-*]` policy attribute. Today the JS removes markers in the same step it removes the attribute (`applyEffectivePolicy` → `unhideCategoryElements`), so this only bites if a marker survives (a cloned node, a failed restore). It's defense in depth, not a live leak.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Save every non-empty original inline `display` value and priority, including `"none"`; keep removing the property when nothing was set. Gate the marker rule per category: `html[data-rmsg-hide-overviews="1"] [data-rmsg-hidden="overview"]` (and `aimode`, `aux`). | Restores exactly what was there; CSS and policy can't disagree. | Three marker rules instead of one. |
| B. Leave as is. | — | Toggling a category off can reveal elements Google hid. |

**Recommendation:** **A.**

**To-do:**
- [x] `hideElement()`: drop the `prevDisplay !== "none"` exclusion; `restoreElementVisibility()` already restores the saved value with its priority.
- [x] `static-guard.css`: replace the global `[data-rmsg-hidden]` rule with three policy-gated rules.

**Done when:** B-16 passes. It checks that an element with inline `display:none`, hidden and then unhidden by turning its toggle off, is still `display:none`. It also checks that a leftover marker with no inline style stops hiding once its category's policy attribute is off. (Corrected 2026-11-21: elements hidden by the engine also carry an inline `display:none !important`. The policy-off path removes that, not the CSS gate.)

**2026-11-21, fixed in `src/` (Phase 2):**
- **What changed:** `hideElement()` saves every non-empty original inline `display`, `none` included. The marker rule in `static-guard.css` is now three rules, one per category, each gated by its `html[data-rmsg-hide-*]` attribute.
- **Tests:** new B-16 (fixture `restore.html`) passes. On the old `dist/` it fails: unhiding revealed an Overview that Google had hidden inline.

**Proposed phase:** 2, with BP-08 (hiding correctness).

---

### BP-19 — `/ai?q=…` and `/aimode?q=…` drop the query (Low)

**Found:** CodeRabbit review of PR #3 (2026-11-21); carried over unchanged from the original `dist/`. Verified against `src/` 2026-11-21.

**Where:** `src/background/dnr-rules.ts` rule 111 redirects `^https://(www\.)?google\.com/(ai|aimode)(/|\?|$)` to the fixed URL `https://www.google.com/#rm_sg_aimode`, so `/aimode?q=fractions` lands on the homepage and the student has to retype the search. U-06 and L-02 currently **expect** this (`/ai` and `/aimode` → `/`), and `docs/04` describes it the same way, so changing it is a behavior change admins will see.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Redirect with a transform instead of a fixed URL: path `/search`, the existing AI Mode query transform (so `q` is kept, `udm=14` added when `forceWebOnlySearch` is on), fragment `#rm_sg_aimode`. Queryless `/ai` and `/aimode` still go to the homepage (a second rule, or a query-presence regex). | The student keeps their search; matches how `udm=50` is handled. | Two rules instead of one; U-06, L-02 and `docs/04` change. |
| B. Keep sending everything to the homepage. | Simplest; current documented behavior. | Small usability cost. |

**Recommendation:** **A**, owner to confirm (it changes documented behavior).

**Owner decision 2026-11-21: option A (keep the student's search).**

**To-do:**
- [x] Owner decision: A or B.
- [x] If A: split rule 111 (with query → `/search` + transform; without → homepage), update U-06's expectations, L-02 and `docs/04`.

**2026-11-21, fixed in `src/` (Phase 2):**
- **Rule 111 (priority 50):** matches `/ai` or `/aimode` (optionally followed by a sub-path) with a non-empty `q=`. It changes the path to `/search` and applies the same AI Mode query transform as rule 110: `q` and other params are kept, `udm` becomes 14 or is removed, and the session params are stripped. It also adds `#rm_sg_aimode`.
- **New rule 112 (priority 45):** keeps the old homepage redirect for queryless or empty-`q` URLs. `ALL_MANAGED_RULE_IDS` now includes 112.
- **Simulator:** the DNR simulator applies `transform.path`.
- **Tests:** new U-19 (six URLs, both Web-only settings, ≤2 hops), U-05, U-06 (`/aimode?q=x` → `/search?q=x&udm=14#rm_sg_aimode`), X-02, U-17 and B-03b all pass. B-03b confirms Chromium applies the path and query transform together.
- **`docs/04`:** the verification step now covers `/aimode?q=…`.

**Done when:** U-19 (`/aimode?q=fractions` → `/search?q=fractions…` with the `#rm_sg_aimode` marker, `/ai` → `/`, ≤2 hops) passes, if A is chosen.

**Proposed phase:** 2, with BP-05 (redirects).

---

## 4. Re-commenting standard (D2 = lean, resolved 2026-11-20)

`AGENTS.md` at the repo root is the living copy of this standard; if the two disagree, `AGENTS.md` wins. With D1 = B, comments are written in `src/` as each module is rebuilt (Phase 0) and kept current with every later change. R-01 then compares `src/` before and after any comment-only pass. **Comments only; behavior must not change in this step.** Diff each file and confirm only comment/whitespace changes.

1. **File header** (top of every JS/CSS file): what the file is, where it runs (service worker / content script on google.com / extension page), what it must never do (e.g. "never transmits page content"), and which other files share code with it (`<shared:…>` regions).
2. **Function doc block** above every function: one-sentence purpose, params, return value, failure behavior (fail-closed or fail-open, and why). Keep it short.
3. **Inline comments only for "why"**, not "what": RE2 has no lookahead, so priorities do the work; why `text/plain` for Apps Script; why fail-closed; when each Google selector was last confirmed on live Google.
4. **Delete** trailing restate-the-code comments (`// Return value`, `// Increment counter`) and every `// End …` closer. Delete the HTML per-line comments the same way; keep section comments.
5. **Mark fragile spots** with `// FRAGILE(google-dom, last verified YYYY-MM-DD):` so future selector work is easy to find with a search.
6. Keep comments truthful. If a comment describes behavior a BP fix changed, update it in the same change.

---

## 5. Recommended execution order

| Phase | Break points | Why this order |
|---|---|---|
| 0. Setup | **Rebuild `src/` (D1 = B) in three separate commits, in this order** (sequencing clarified 2026-11-20 after CodeRabbit review of PR #1):<br>**0a. Behavior-preserving rebuild (analytics and old name still in).** Split the `dist/` bundles into the modules named in `docs/03` §1 (`shared/defaults, errors, policy, selectors, storage`; `background/service-worker, dnr-rules, analytics`; `content/dom-engine, content`; `ui/popup, options, policy-generator-core`). Add `package.json`, `tsconfig.json`, `scripts/build.mjs` (esbuild → gitignored `build/`) and `scripts/promote.mjs` (`build/` → `dist/`). The Apps Script template stays an inline string in the options module exactly as today: **don't create `templates/apps-script/`**, because analytics is removed in 0b. Keep the original `dist/` as gitignored `baseline-dist/`. **Equivalence gate (0a only):** the rebuilt output must behave identically to `baseline-dist/`, analytics included. Compare code with comments and whitespace stripped where bundling allows. Run every U-test and the Playwright B smoke tests against **both** `baseline-dist/` and `build/`: results must be identical, **failures included**. U-tests that describe not-yet-fixed break points are expected to fail on both and don't block promotion; only a *difference* between the two builds blocks it. Then promote and commit.<br>**0b. Remove analytics (D6).** Separate commit. The equivalence gate doesn't apply to these removed behaviors, which are the only allowed differences from 0a: alarm scheduling and flushing; the `TRIGGER_TEST_FLUSH` message; the 4 analytics policy fields and their validation; `ERR_ANALYTICS_ENDPOINT_INVALID` / `ERR_ANALYTICS_FLUSH_FAILED`; pending-bucket and flush-status telemetry fields; the Options analytics status bar and Test Flush button; the generator's analytics section and Copy Code.gs button; the manifest's `alarms` permission and `script.google.com` / `script.googleusercontent.com` hosts. Every other test result must match 0a. S-03 applies from this commit on.<br>**0c. Rename (D7).** Separate commit; extension strings only (manifest `name`/`short_name`/`default_title`, popup, Options, CSS header). Tests must match 0b.<br>**Workflow for every later change:** edit `src/` → `npm run build` writes to `build/` → run S-, U- and B-tests against `build/` (load it unpacked) → `npm run promote` copies `build/` into `dist/` only when the **promotion rule** holds. `dist/` changes only through promote.<br>**Promotion rule (known failures):** at the end of 0a, record every failing test in `tests/known-failures.json` with the break point and phase that will fix it. Before any promotion, (1) every test assigned to the current phase and every test not on the list must pass, and (2) each listed test must fail exactly as recorded (a *changed* failure blocks promotion just like a new one). When a phase fixes a break point, remove its tests from the list in the same commit. The list must be empty after Phase 4. | Every later fix needs one source of truth and a test harness. Proving equivalence before removing anything means any behavior change in 0b/0c is deliberate and visible. |
| 1. Make protection hold | BP-01, BP-02, BP-06, BP-10, BP-17 (owner decision 2026-11-21). **Done 2026-11-21**: all their tests pass and `tests/known-failures.json` has `currentPhase: 1`. Still open: M-01, M-02 and M-05 on a managed device (BP-01). | Highest risk to students; small, contained changes. BP-17 shares code paths with BP-01/BP-02. |
| 2. Close bypasses and tampering | BP-05, BP-07, BP-08, BP-13, BP-18, BP-19 (BP-19 option A, owner decision 2026-11-21). **Done 2026-11-21**: all their tests pass and `tests/known-failures.json` has `currentPhase: 2`. Still open: M-05 (managed device) and L-06/L-07 (live Google). | Depends on BP-01's "is locked" decision. BP-18 rides with BP-08, BP-19 with BP-05. |
| 3. Performance and accuracy | BP-09, BP-14, BP-12 (N/A per D6). **Done 2026-11-21**: BP-09 and BP-14 fixed; BP-12 N/A per D6; `tests/known-failures.json` has `currentPhase: 3`. | Touch the same sweep/metrics paths, so do them together. |
| 4. Longevity | BP-03, BP-04, BP-11 (N/A per D6). **Done 2026-11-21**: BP-03 and BP-04 fixed; BP-11 N/A per D6; `tests/known-failures.json` has `currentPhase: 4` and empty `failures`. Still open: `L-04`/`L-05` with extension loaded on live Google and `M-*` on a managed device. | Need live Google strings (BP-03) and a schema change (BP-04/BP-11); do them in one schema update. |
| 5. Re-comment + docs | §4 standard, BP-16, doc updates for every BP above | Comment once, after the code is stable. |

**Verification for every phase:** load `dist/` unpacked in Chrome, run each BP's "Done when" check, run `scripts/check-shared-sync.mjs` and `scripts/syntax-check.mjs`. Managed-policy checks (BP-01, BP-07, BP-04) need a real managed profile or Chromebook in a test OU; the agent must report which checks it could not run, not mark them passed.

**Never, in any phase:** add permissions or host permissions (unless the owner approves a BP option that needs one), weaken `isUnsafeToHide`, send page text, URLs or queries anywhere, solve or bypass Google bot checks, or upload to the Chrome Web Store.

---

## 6. Test plan

Each test has an ID, what it proves, which break point it covers, and how it runs. **Auto** = scripted: S/U tests with `node --test`, B tests with Playwright (D8, resolved 2026-11-20). **Browser** = the unpacked extension in desktop Chrome against local mock pages or live Google. **Managed** = needs a real managed Chrome profile or Chromebook in a test OU. A test the agent can't run is reported as **NOT RUN**, never as passed.

**Feasibility note (verified 2026-11-20):** `dist/background/service-worker.js` has no `import`/`export`, so it loads in Node's `vm` with a stub `chrome` object, which exposes `parsePolicy`, `buildDynamicRules`, `buildSanitizedPayload`, `assertNoPiiPayload`, `flushAnalyticsIfDue` (takes an injected `fetchImpl`) and `handleRuntimeMessage`. A probe returned `source: "defaults", isManaged: false` for empty policy (the BP-01 baseline) and rule IDs `101,102,110,111,120,130`. `content.js` is one closed-off function wrapper and needs a DOM, so its tests are Browser tests.

### 6.1 Static checks (Auto, run after every change)

| ID | Test | Covers |
|---|---|---|
| S-01 | Every `dist` JS file passes Node's syntax check (module files checked as `.mjs` copies) | All |
| S-02a | **Pre-promotion reproducibility:** two consecutive `npm run build` runs from the same source produce byte-identical `build/` output. (Doesn't compare against `dist/`: changed source is supposed to produce different output.) | BP-15 |
| S-02b | **Post-promotion check:** after `npm run promote` (and on every commit that touches `src/` or `dist/`), a clean `npm run build` of the committed source equals the committed `dist/` byte for byte, proving `dist/` was promoted from that source and never hand-edited | BP-15 |
| S-03 | Manifest guard (from Phase 0b on, after D6): `permissions` is exactly `storage, declarativeNetRequestWithHostAccess`; `host_permissions` is exactly `https://www.google.com/*, https://google.com/*`; `minimum_chrome_version` is `"134"` (D4). During 0a the original list (plus `alarms` and the two `script.*` hosts) is expected. | All, D4, D6 |
| S-04 | Schema ↔ code: every `schema.json` property is handled in `parsePolicy`, and vice versa | BP-04 |
| S-05 | CSS guard: `shared.css` has the global `[hidden]:not([hidden="until-found"])` rule; `static-guard.css` has no selector list mixing `:has(` with other selectors | BP-06, BP-10 |
| S-06 | Error-code lists match everywhere: `ALL_ERROR_CODES`, `ERROR_CATALOG`, and the Options diagnostics rendering. From 0b on, neither `ERR_ANALYTICS_*` code appears in **live code or shipped output**: `src/`, `build/`, `dist/`, `schema.json`, `manifest.json`. Docs, `archive/` and test-plan text may still mention them as history. | BP-03, BP-04, BP-13, D6 |

### 6.2 Unit tests (Auto, `node --test`, service-worker logic via `vm`)

| ID | Test | Covers |
|---|---|---|
| U-01 (U-01a–d in the tests; 2026-11-21 also covers `sideload`, `other`, a missing install type and a failing `getSelf`) | Install-type × policy matrix: {admin, development, normal, unknown} × {no keys, valid, partly invalid}. Expect admin/unknown + no keys → locked strict defaults, `source:"admin-no-policy"`. Development/normal + no keys → unlocked. Any valid keys → managed. | BP-01 |
| U-02 | `SET_LOCAL_OVERRIDES` refused when locked; accepted on development/normal unmanaged | BP-01 |
| U-03 | Invalid managed values (string `"true"`, out-of-range interval, bad enum) fall back fail-closed and are listed in `invalidFields` | Regression |
| U-04 (`U-04b` added 2026-11-21) | `extraHideSelectors`: accepts valid string arrays and partial category objects; rejects non-arrays, unknown keys, non-strings, blank items, over-long strings (>300) and >20 items into `invalidFields`; ignored when unmanaged; generator JSON omits empty extras | BP-04 |
| U-05 | DNR rules for all 4 combinations of `blockAiModeNavigation` × `forceWebOnlySearch`, plus `masterEnabled:false` → `[]` | Regression |
| U-06 | Redirect simulation, with each rule's pattern run as a JS RegExp and its transform applied, until no rule matches. `?q=x&udm=50` → `udm=14` or no `udm`; `sourceid=chrome` + `udm=50` → `#rm_sg_omnibox`; `/ai` and `/aimode` with no query → `/` (with a query: `/search`, query kept, BP-19); `?q=x` → `udm=14`; `udm=2` and `tbm=nws` untouched; **every URL settles within 2 hops (no loops)** | Regression, BP-05 |
| U-07 | `cleanAiModeUrl()` (BP-05 JS copy) returns the same URL as the U-06 simulation for every test URL. (2026-11-21: tested through the real content bundle in the vm harness; non-AI-Mode URLs must not redirect. U-07b adds `popstate`/`pageshow`.) | BP-05 |
| U-08 | ~~Payload v2: allowlisted keys only; `buckets` capped at 14; extra/unknown keys or PII-shaped fields make `assertNoPiiPayload` reject~~ **Removed by D6** (analytics dropped). Restore with analytics; see `archive/analytics-v1/README.md`. | BP-11 |
| U-09 | ~~Flush with mock fetch: 3 pending days → exactly 1 POST; on `{status:"ok"}` the sent counts are subtracted, and counts that arrived during the request are kept~~ **Removed by D6** (analytics dropped). Restore with analytics; see `archive/analytics-v1/README.md`. | BP-11 |
| U-10 | ~~Flush failure paths (HTTP 500, non-JSON, `{status:"error"}`, timeout) → backoff grows 15m→30m→1h…, capped at 24h; `ERR_ANALYTICS_FLUSH_FAILED` logged~~ **Removed by D6** (analytics dropped). Restore with analytics; see `archive/analytics-v1/README.md`. | Regression |
| U-11 | ~~Alarm is created as repeating (`periodInMinutes` set); a thrown flush leaves the alarm in place; changing the interval recreates it, same interval doesn't~~ **Removed by D6** (analytics dropped). Restore with analytics; see `archive/analytics-v1/README.md`. | BP-12 |
| U-12 (split into U-12a–f in the tests, 2026-11-21, so each behavior is tracked on its own) | Message gating: privileged types (`SET_LOCAL_OVERRIDES`, `RESET_LOCAL_METRICS`, `GET_DIAGNOSTIC_SNAPSHOT`; `TRIGGER_TEST_FLUSH` no longer exists after D6) from a google.com tab sender are refused; from an extension-page sender, accepted; unknown `LOG_DIAGNOSTIC` code → `bad_message` with no log entry; missing `deltas` → `bad_message` | BP-13 |
| U-13 | Content-safe policy sent to content scripts has no `analyticsEndpointUrl` or `analyticsSharedToken` | BP-13 |
| U-14 (split into U-14a locked / U-14b unlocked in the tests, 2026-11-21) | `RESET_LOCAL_METRICS` refused when locked (with a reason), accepted on unlocked development/normal installs. (The former Test Flush rate-limit assertion was removed with analytics in D6.) | BP-07 |
| U-15 | Diagnostic log: same code+detail dedupes and counts; 51st distinct entry evicts the oldest | Regression |
| U-16 | ~~Code.gs in `vm` with mock `SpreadsheetApp`/`LockService`: `doPost` appends one row and never calls `getValues()`; token mismatch → `UNAUTHORIZED`; bad payload rejected; `rollup_()` totals match a fixed sample~~ **Removed by D6** (analytics dropped). Restore with analytics; see `archive/analytics-v1/README.md`. | BP-11 |
| U-17 | Two overlapping `syncRuntimeState` runs where the older resolves last → the newer policy's DNR rules are installed | BP-17 |
| U-18 | Two concurrent `SET_LOCAL_OVERRIDES` (different toggles) → both edits stored | BP-17 |
| U-19 | `/aimode?q=fractions` → `/search?q=fractions…#rm_sg_aimode`; `/ai` → `/`; ≤2 hops (option A chosen 2026-11-21) | BP-19 |
| U-20 | Content script (vm, controlled message timing): an older disabled policy load finishing after a newer enabled one is dropped; the tab stays protected | BP-17 |
| U-21 | Content script (vm, fake timers): burst mutations throttle to ≥150 ms, first/idle sweep runs on rAF, disabling `masterEnabled` cancels pending timer/rAF | BP-09 |
| U-22 | Content script (vm, fake timers): metric deltas batch across sweeps, flush once on `visibilitychange` (`hidden`) / `pagehide` (no double-send), and flush on the 10 s timer | BP-09 |
| U-23 | Content script + service worker (vm): `RESET_LOCAL_METRICS` discards pending pre-reset batches in open tabs and drops stale in-flight `INCREMENT_METRICS` via `resetEpoch` (`U-23b`: delayed/failed epoch reads never emit untagged batches, never cache `0`, and failed resets keep the stored epoch intact) | BP-09 |
| U-24 | UI language resolution & daily dedupe: `en`/`es` variants and blank `lang` stay quiet; unsupported languages (e.g. `fr`/`fr-CA`) emit `WARN_UNSUPPORTED_UI_LANGUAGE` with primary subtag only at most once per language per UTC day (`tests/unit/longevity.test.mjs`) | BP-03 |
| U-25 | Content script `extraHideSelectors` + leak detector: hides valid extras, isolates bad syntax into `ERR_SELECTOR_SYNTAX`, enforces `isUnsafeToHide()`, and logs `WARN_AI_SURFACE_VISIBLE` once per page per leaked category for EN and ES (`tests/unit/longevity.test.mjs`) | BP-04 |

### 6.3 Browser tests on local mock pages (Auto: Playwright)

Mock pages are saved HTML snippets copied from Google's markup: an AI Overview, the AI Mode nav tab and homepage button, "Dive deeper", Labs, Lens, follow-up, and organic results. Content scripts only run on google.com, so these run under Playwright (D8): Chromium launched with the built extension from `build/`, and route interception serving the mock pages at `https://www.google.com/...` addresses. No request reaches real Google.

| ID | Test | Covers |
|---|---|---|
| B-01 | First line of `content.js` sets all three `data-rmsg-hide-*` attributes before any await; with 6× CPU throttle, no AI Overview flash | BP-02 |
| B-02 | Policy with `hideAiOverviews:false` → Overview visible after load | BP-02 |
| B-03 | Each surface is hidden: Overview, AI Mode tab, homepage button, Dive deeper, Labs, Lens, follow-up; search box visible; ≥5 organic results visible | Regression |
| B-04 | Organic result linking to `example.com/.../aimode-review` stays visible | BP-08 |
| B-05 | Overview whose nearest `data-hveid` wrapper contains 1 organic result: only the Overview card hides; `ERR_SAFETY_GUARD_TRIPPED` if the only candidate is the wrapper (`B-05b`/`B-05c`: CSS guard deferral & late un-hide; `B-05d`: restored `aimode` wrapper releases inner button/anchor in the same sweep) | BP-08, BP-09 |
| B-06 | `history.pushState(…udm=50)` + a DOM mutation → page ends on the clean URL; `aiModeRedirects` +1 exactly. (B-06b, 2026-11-21: pushState alone, caught by the Navigation API.) | BP-05 |
| B-07 | Same page reloaded 3× with re-render churn → each category counter +3 exactly | BP-14 |
| B-08 | A single search on a churning results page (`churn.html`) produces ≤2 telemetry writes and flushes all counters on `pagehide` (`B-08b`: Options skips telemetry-only refreshes while Diagnostics is hidden) | BP-09 |
| B-09 | Performance profile on the churning mock page (`churn.html`): sweep time per second down ≥50% vs. the Phase 2 `dist` baseline (88.7% median reduction measured via CDP CPU profiler: 50.18 → 5.67 ms/s) | BP-09 |
| B-10 | Managed `extraHideSelectors` (service worker `chrome.storage.managed.get` stubbed) hides custom `overview`/`aimode`/`aux` surfaces, isolates an invalid selector into `ERR_SELECTOR_SYNTAX`, and refuses an unsafe selector via `ERR_SAFETY_GUARD_TRIPPED` | BP-04 |
| B-11 | Tier 1/2 matches stripped from the mock Overview → `WARN_AI_SURFACE_VISIBLE` logged once | BP-04 |
| B-12 | Options page (unmanaged): no "Locked" badges; Cancel Reset only after the first Reset click; Test Flush only when analytics is on; Staff card only after "Show Staff OU Preset"; tabs switch; Ctrl+F finds text in hidden tabs | BP-06 |
| B-13 (B-13b–d in the tests stub the worker's answer for the locked and unreachable cases; B-13d also checks the Options page) | Popup: unmanaged view on unpacked install; managed view when the service worker reports locked; managed view (not unmanaged) when the service worker is unreachable | BP-01 |
| B-14 | Policy generator: each band's JSON parses, uses `{"key":{"Value":…}}` wrappers, matches `schema.json` types, omits empty `extraHideSelectors`, validates textarea syntax on blur (`aria-invalid` + `aria-describedby`), and emits populated extras | Regression, BP-04 |
| B-15 | Options: two overlapping refreshes whose snapshots arrive in reverse order → the newer snapshot stays rendered. (The content-script half moved to U-20, 2026-11-21.) | BP-17 |
| B-16 | An element with inline `display:none` that is hidden and then unhidden by turning its toggle off stays `display:none`; removing a policy attribute unhides a marked element | BP-18 |
| B-17 | Spanish Google SERP (`serp-es.html` under `es-419` and `es-US`): hides Spanish AI Overview, AI Mode, Lens, follow-up, and PAA while keeping organic results and emitting zero warnings | BP-03 |
| B-18 | Unsupported UI language (`serp-fr.html` with `lang="fr"`): structural hiding still works and `WARN_UNSUPPORTED_UI_LANGUAGE` logs with `detail: "fr"` once per day across reloads | BP-03 |

### 6.4 Live Google tests (Browser, real google.com, manual)

Never retry through a CAPTCHA or "unusual traffic" page; record the test as **INCONCLUSIVE**.

| ID | Test | Covers |
|---|---|---|
| L-01 | English: "what is photosynthesis" → no Overview, no AI Mode tab, ≥5 organic results | Regression |
| L-02 | `?q=photosynthesis&udm=50` → clean results, query kept; `/ai` and `/aimode` with no query → homepage; `/aimode?q=photosynthesis` → clean results, query kept (BP-19, 2026-11-21) | Regression, BP-19 |
| L-03 | Images (`udm=2`) and News (`tbm=nws`) load unmodified with `forceWebOnlySearch` on | Regression |
| L-04 | `hl=es`: Overview and AI Mode tab hidden (also the moment to collect and confirm the Spanish strings) | BP-03 |
| L-05 | `hl=fr`: `WARN_UNSUPPORTED_UI_LANGUAGE` appears in IT Diagnostics | BP-03 |
| L-06 | Enter AI Mode from inside the page (AI Mode tab click with hiding temporarily off) → redirected | BP-05 |
| L-07 | Re-confirm every Tier 2 selector still matches; update its "last verified" date comment | BP-04 |

### 6.5 Managed-device tests (Managed, test OU, manual)

| ID | Test | Covers |
|---|---|---|
| M-01 | Force-installed, **no** extension policy → Options locked, popup "Managed by your school", strict defaults, `WARN_NO_MANAGED_POLICY` | BP-01 |
| M-02 | Force-installed, policy JSON Chrome rejects entirely (all wrong types) → same locked result as M-01; `chrome://policy` shows the errors | BP-01 |
| M-03 | Valid 6-8 preset → `forceWebOnlySearch` off (no `udm=14` rewrite); everything else on | Regression |
| M-04 | Change the OU policy (e.g. `masterEnabled:false`) and reload policies → DNR rules removed and open tabs unhidden without restart | Regression |
| M-05 | As a student: Reset disabled and refused by the service worker; `SET_LOCAL_OVERRIDES` sent from the console refused. (Test Flush no longer exists after D6.) | BP-01, BP-07 |
| M-06 | ~~Analytics to a scratch Sheet with the new Code.gs: rows land in `Raw`; hourly trigger rolls up; token mismatch rejected~~ **Removed by D6** (analytics dropped). Restore with analytics; see `archive/analytics-v1/README.md`. | BP-11 |
| M-07 | ~~Leave a device asleep past two flush intervals, wake it → flush happens without a browser restart~~ **Removed by D6** (analytics dropped). Restore with analytics; see `archive/analytics-v1/README.md`. | BP-12 |

### 6.6 Chrome-version tests (D4 = 134)

| ID | Test | Covers |
|---|---|---|
| O-01 | API floor check: every browser API and CSS feature the code uses is available in Chrome 134 (agent checks each against Chrome's docs or MDN compatibility tables; anything newer must be feature-detected or the minimum raised with owner approval) | D4 |
| O-02 | Install on Chrome 134 (or the oldest available build ≥134): the extension loads with no service worker errors and B-03 passes | D4 |

### 6.7 Re-comment safety check (Auto)

| ID | Test | Covers |
|---|---|---|
| R-01 | Strip all comments and whitespace from each file before and after the §4 re-comment pass; the remaining code must be identical (only comments changed) | §4 |
| R-02 | S-01 to S-06 and all U-tests still pass after re-commenting | §4 |
