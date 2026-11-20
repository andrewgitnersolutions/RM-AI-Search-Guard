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
| D1 | How to edit code with no `src/` | (a) Edit `dist/` directly and keep the 4 shared copies in sync with a check script. (b) Rebuild a `src/` + esbuild pipeline per the spec so shared code exists once. | **(a)** for this pass: smallest change, nothing new to install. Revisit (b) before Phase 2 automation. |
| D2 | Comment standard for the re-comment | (a) Keep per-line comments. (b) File header + doc block per function + inline "why" comments only; delete `// End …` closers. | **(b)**. See §4. |
| D3 | Give the project its own git repo | `git init` in this folder (separate from the home-directory repo) vs. leave as is | **Resolved: yes (done 2026-11-20).** |
| D4 | Minimum Chrome version | Set `minimum_chrome_version` (blocks install on older devices) vs. leave unset and degrade gracefully | **Leave unset, degrade gracefully** (BP-10). Older Chromebooks then get partial protection instead of none. |
| D5 | Languages to support in text matching | English only / English + Spanish / English + top district languages | **English + Spanish now**, with a diagnostic for any other UI language (BP-03). |
| D6 | Analytics payload change | Keep schema v1 / move to v2 (one POST per device per flush) | **v2.** Nothing is deployed yet (store status "Draft"), so there are no districts to break. |
| D7 | Product name | Manifest/README/popup/options say "RaiseMark AI Search Guard"; `docs/01–04`, `local-cws/06`, store screenshots and the stale zip say "RaiseMark Search Guard for K-12". (License part: **resolved, standard MIT**.) | **Owner resolves.** Agent leaves names alone until decided. |
| D8 | Test harness | (a) Zero-dependency: Node's built-in `node:test` for logic, plus manual browser checks. (b) Add Playwright as a dev dependency to automate the browser checks against mock Google pages, like the original canary. | **(a) now**; adopt (b) if D1 becomes "rebuild `src/`" (npm is in play then anyway). |

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
| BP-10 | Medium | CSS | One `:has()` selector invalidates the whole AI Mode CSS block on older Chrome |
| BP-11 | Medium | Analytics | Apps Script sink won't scale to a district (full-sheet scan under a global lock per POST) |
| BP-12 | Medium | Analytics | Flush alarm chain dies permanently if a flush throws or the worker is killed mid-flush |
| BP-13 | Low | Messaging | Messages aren't shape- or sender-checked; malformed input produces misleading errors; secrets sent to content scripts |
| BP-14 | Low | Metrics | AI Mode / Aux counters inflate on every Google re-render |
| BP-15 | Low | Maintainability | Four copies of shared logic, no tests, stale release zip, no project repo |
| BP-16 | Info | Coverage | Surfaces the extension can't cover (Incognito, Guest, other browsers, ccTLDs, Gemini app): admin runbook gaps |

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

**To-do:**
- [ ] Add `resolveInstallType()` in the service worker: `await chrome.management.getSelf()` → `installType`. Catch errors and treat failure as `"unknown"`, which must lock (fail closed).
- [ ] Extend `parsePolicy(managedRaw, localRaw, now, installType)`. If `installType` is `"admin"` (or `"unknown"`) and there are no managed keys, return strict defaults with `isManaged: true`, `source: "admin-no-policy"`, and push `WARN_NO_MANAGED_POLICY`. Update all 4 copies (or the shared module per D1).
- [ ] Add `"admin-no-policy"` wherever `source` is rendered (`options.js:1205-1223` banner; diagnostic bundle) with copy along the lines of: "Force-installed by your school, no grade-band policy yet. Maximum protection is active."
- [ ] `SET_LOCAL_OVERRIDES` (`service-worker.js:1133`): reject unless policy is unmanaged **and** installType is `"normal"` or `"development"`.
- [ ] Popup (`popup.js:251`): stop parsing managed storage itself. Ask the service worker for the effective policy (with installType), and fall back to the **managed/locked** view if the worker is unreachable, not the unmanaged view.
- [ ] Options: when locked, disable switches and the grade-band select (existing code does this off `isManaged`; confirm it now covers `admin-no-policy`).
- [ ] Ignore any stale `rmsg_local_overrides` when locked (already true via the managed branch; add an explicit guard and comment).

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

**To-do:**
- [ ] At the very top of the content-script IIFE (before `handleRedirectHashTelemetry()`), set `data-rmsg-hide-overviews/aimode/aux="1"` on `document.documentElement`, guarded for a null `documentElement`.
- [ ] Keep `applyPolicyAttributes` as the step that removes attributes per policy, including when `masterEnabled === false`.
- [ ] If the policy can't be resolved at all (worker and storage both fail), keep the attributes on and log `ERR_STORAGE_FAILURE`.
- [ ] Comment the fail-closed rationale at the top of the file.

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

**Recommendation:** **A (English + Spanish, per D5) + D.** Keep C as Tier 1 as today.

**To-do:**
- [ ] Restructure `SELECTORS.tier1.*` text lists into `{ en: [...], es: [...] }` maps. Resolve the active set from `document.documentElement.lang` (prefix match, e.g. `es-419` → `es`), always also including `en`.
- [ ] **Collect the Spanish strings from live Google** (`hl=es`) for the AI Overview heading, AI Mode tab/button, "Dive deeper in AI Mode", Search Labs, Lens, and "Ask a follow up". Don't guess translations. Record the source date in a comment beside each string.
- [ ] Move the language-specific `aria-label` CSS rules out of `static-guard.css` into the JS engine (CSS can't switch on language cleanly), or add `:lang(es)` variants.
- [ ] Add diagnostic code `WARN_UNSUPPORTED_UI_LANGUAGE` (catalog entry plus remediation in every copy of `ALL_ERROR_CODES`/`ERROR_CATALOG`, the Apps Script allowlist, and the payload validator). Log it once per language per day when `lang` isn't supported.

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
- [ ] `schema.json`: add `extraHideSelectors` as an object with `overview`, `aimode` and `aux` keys, each an array of strings, with `maxItems` 20 and `maxLength` 300 per string.
- [ ] `parsePolicy`: validate (array of strings, bounded). Invalid → ignore and add to `invalidFields`. Pass through only on managed policy.
- [ ] Content engine: append validated extras to each category's candidate collection. They go through `safeQueryAll` (syntax errors → `ERR_SELECTOR_SYNTAX`) and `isUnsafeToHide` like everything else.
- [ ] Policy generator (`options.js` `mountPolicyGenerator`): optional advanced textarea per category, emitted only when non-empty.
- [ ] Leak detector: after `sweepDom`, scan `h1, h2, [role="heading"], [role="tab"], button` for the active-language AI labels that are visible (`checkVisibility()` or an offsetParent check) and not inside `[data-rmsg-hidden]`. Log `WARN_AI_SURFACE_VISIBLE` once per page (detail is the category only, no text or URL). Add the code to every allowlist (see BP-03 to-do 4).
- [ ] Add a comment by every Tier 2 selector giving the date it was last confirmed on live Google.

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
- [ ] Add `cleanAiModeUrl(url, policy)` (pure function) in the content script, mirroring `createAiModeQueryTransform` and rule 111 (`/ai`, `/aimode` → `https://www.google.com/`). Add a comment that it must match `buildDynamicRules`.
- [ ] Track `lastHref`. In `runSweepNow`, on `popstate`, and on `pageshow`: if `blockAiModeNavigation && masterEnabled` and the URL is an AI Mode URL → `location.replace(clean + "#rm_sg_aimode")`, which reuses the existing telemetry path.
- [ ] If `window.navigation` exists, add a `navigate` listener doing the same check before commit (verify it fires in the isolated world; drop it if not).

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
- [ ] Add the rule in `@layer reset`.
- [ ] Re-check every element that uses `hidden`: the 6 lock badges, Test Flush, Cancel Reset, field errors, the Staff card, the AIModeSettings reminders and the tab panels (must still switch, and Ctrl+F `beforematch` must still work).

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
- [ ] Service worker: refuse `RESET_LOCAL_METRICS` when locked. Return `{ ok:false, reason:"locked" }`.
- [ ] Service worker: store `lastManualFlushAtMs` in telemetry state and refuse `TRIGGER_TEST_FLUSH` within 15 minutes, returning the time remaining.
- [ ] Options: disable Reset with explanatory text when locked; show the rate-limit message.
- [ ] Keep Reset fully available in unmanaged/development mode.

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
- [ ] Replace the broad href selectors in **both** `static-guard.css` and `SELECTORS.tier1.aiModeUi.directSelectors` and the extra selector at `content.js:535`.
- [ ] Remove `"[data-hveid]"` from `containerAncestors`. Add a `maxAncestorDepth` constant (8) to `findOverviewHeadingContainer`.
- [ ] Make the threshold per category: `overview: 1`, others `3`. Pass the category into `isUnsafeToHide`.
- [ ] Keep `ERR_SAFETY_GUARD_TRIPPED` reporting as is.

**Done when:** a fixture with an organic result linking to `https://example.com/blog/aimode-review` still shows it, and a fixture where the AI Overview's nearest `data-hveid` wrapper also holds one organic result hides only the Overview card.

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
- [ ] Add throttling around `scheduleSweep`. Comment the timing rationale.
- [ ] Look up the search input once per sweep and pass it into `isUnsafeToHide`.
- [ ] Replace the all-pairs `topLevelCandidates` filter with a single pass (sort in document order, skip any candidate contained in the last kept one).
- [ ] Accumulate `deltas` in a module-level object and flush via `INCREMENT_METRICS` on `pagehide`, on `visibilitychange` to hidden, and on a 10 s timer.
- [ ] Options: in the storage listener, skip `refreshSnapshot()` for `local` changes that only touch `rmsg_telemetry` while the Diagnostics panel is hidden.

**Done when:** on a recorded results page, a DevTools Performance profile shows sweep time per second reduced by at least 50% versus baseline, and a single search causes ≤ 2 telemetry writes.

---

### BP-10 — `:has()` invalidates the whole AI Mode CSS block on older Chrome (Medium)

**Where:** `dist/content/static-guard.css:24`. `div[role="listitem"]:has(a[href*="udm=50"])` is in the **same selector list** as the other five AI Mode selectors. CSS drops an entire rule if any selector in its list is unsupported, so on browsers without `:has()` **all** static AI Mode hiding disappears. The manifest has no `minimum_chrome_version`.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Move the `:has()` selector into its own rule block; leave the manifest without a minimum version (D4). | Older devices keep 5 of 6 AI Mode CSS selectors plus all JS hiding and DNR. | Nothing significant. |
| B. Set `minimum_chrome_version` to the newest feature used. | Clear support contract. | Older Chromebooks (past their update cutoff) can't install the extension at all and end up with **zero** protection. |

**Recommendation:** **A** (per D4). Document the minimum *fully supported* version in `docs/04` instead.

**To-do:**
- [ ] Split line 24 into a separate rule with the same declarations.
- [ ] Audit every other selector list for features newer than the baseline (`[attr i]` flag is fine). Note any you find with a comment.
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
- [ ] Extract the `Code.gs` string to a real file `templates/apps-script/Code.gs`. Keep the embedded copy generated or synced, and add it to the sync check (BP-15).
- [ ] Rewrite `doPost` as validate → `appendRow` to `Raw`. Add `rollup_()` plus an `installTrigger()` helper the admin runs once.
- [ ] Payload `schemaVersion: 2`: `{ schemaVersion, extensionVersion, token?, gradeBand, buckets: [{ dateBucket, metrics }], errors }`. Update `ALLOWED_PAYLOAD_KEYS`, `buildSanitizedPayload`, `assertNoPiiPayload` (cap `buckets` at 14 entries) and the Code.gs validator. Keep the strict allowlist.
- [ ] Client: one POST per flush; subtract only what was sent (current logic, per bucket).
- [ ] Default interval: 720 (schema description, `DEFAULT_ANALYTICS_POLICY` in all copies, generator default, docs).
- [ ] Update `docs/04` Step 4 (trigger install step; token caveat).

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
- [ ] Change `scheduleAnalyticsAlarm` to repeating. Store the configured interval in the alarm name or telemetry state so it's recreated only when the interval changes.
- [ ] `onAlarm`: no rescheduling; wrap the flush in try/catch only.
- [ ] Top level: `void ensureAnalyticsAlarm()` (resolve policy → create or clear as needed).

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
- [ ] Add `isFromExtensionPage(sender)` and `isFromContentScript(sender)` helpers. Gate the privileged types.
- [ ] Add `validateMessage(message)` per type. On failure return `{ ok:false, error:"bad_message" }` **without** logging `ERR_STORAGE_FAILURE`.
- [ ] Add `toContentPolicy(policy)` returning only the 6 toggles, `gradeBand`, `isManaged`, and `blockAiModeNavigation`/`forceWebOnlySearch` (needed by BP-05). Use it for messages from content scripts.
- [ ] Content-script fallback path (`content.js:785-789`): unchanged. It reads managed storage directly and never transmits anything.

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
- [ ] Track `seenAiModePages` / `seenAuxPages` sets like `seenOverviewPages`.
- [ ] Update labels in `options.html` (metric cards), the CSV headers' meaning in a comment, and the `docs/02` analytics description.

**Done when:** reloading the same results page 3 times increments each category by exactly 3, regardless of re-renders.

---

### BP-15 — Maintainability and release hygiene (Low)

**Where:** §1 facts: four `parsePolicy` copies, `ERROR_CATALOG`/constants copied, Code.gs only as a string, no tests, stale release zip, no project repo.

**Options:**

| Option | Strengths | Drawbacks |
|---|---|---|
| A. Keep `dist/` as the source (D1a) and add `scripts/check-shared-sync.mjs` (Node built-ins only). It extracts marked shared regions (`// <shared:policy>` … `// </shared:policy>`) from all bundles and fails if they differ. | No dependencies; catches drift. | Still four places to edit; the check just enforces it. |
| B. Rebuild `src/` + esbuild (D1b). | One copy; matches the docs. | Bigger change than this pass needs. |

**Recommendation:** **A** for this pass.

**To-do:**
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

## 4. Re-commenting standard (D2 default)

Apply after the fixes, file by file. **Comments only; behavior must not change in this step.** Diff each file and confirm only comment/whitespace changes.

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
| 0. Setup | BP-15 (shared markers + check scripts); baseline commit of the untouched tree (owner OK needed) | Every later fix touches duplicated code; the sync check keeps the four copies honest. |
| 1. Make protection hold | BP-01, BP-02, BP-06, BP-10 | Highest risk to students; small, contained changes. |
| 2. Close bypasses and tampering | BP-05, BP-07, BP-08, BP-13 | Depends on BP-01's "is locked" decision. |
| 3. Performance and accuracy | BP-09, BP-14, BP-12 | Touch the same sweep/metrics paths, so do them together. |
| 4. Longevity | BP-03, BP-04, BP-11 | Need live Google strings (BP-03) and a schema change (BP-04/BP-11); do them in one schema update. |
| 5. Re-comment + docs | §4 standard, BP-16, doc updates for every BP above | Comment once, after the code is stable. |

**Verification for every phase:** load `dist/` unpacked in Chrome, run each BP's "Done when" check, run `scripts/check-shared-sync.mjs` and `scripts/syntax-check.mjs`. Managed-policy checks (BP-01, BP-07, BP-04) need a real managed profile or Chromebook in a test OU; the agent must report which checks it could not run, not mark them passed.

**Never, in any phase:** add permissions or host permissions (unless the owner approves a BP option that needs one), weaken `isUnsafeToHide`, send page text, URLs or queries anywhere, solve or bypass Google bot checks, or upload to the Chrome Web Store.

---

## 6. Test plan

Each test has an ID, what it proves, which break point it covers, and how it runs. **Auto** = scripted and runnable with `node` alone (D8a). **Browser** = the unpacked extension in desktop Chrome against local mock pages or live Google. **Managed** = needs a real managed Chrome profile or Chromebook in a test OU. A test the agent can't run is reported as **NOT RUN**, never as passed.

**Feasibility note (verified 2026-11-20):** `dist/background/service-worker.js` has no `import`/`export`, so it loads in Node's `vm` with a stub `chrome` object, which exposes `parsePolicy`, `buildDynamicRules`, `buildSanitizedPayload`, `assertNoPiiPayload`, `flushAnalyticsIfDue` (takes an injected `fetchImpl`) and `handleRuntimeMessage`. A probe returned `source: "defaults", isManaged: false` for empty policy (the BP-01 baseline) and rule IDs `101,102,110,111,120,130`. `content.js` is one closed-off function wrapper and needs a DOM, so its tests are Browser tests.

### 6.1 Static checks (Auto, run after every change)

| ID | Test | Covers |
|---|---|---|
| S-01 | Every `dist` JS file passes Node's syntax check (module files checked as `.mjs` copies) | All |
| S-02 | `check-shared-sync`: every `<shared:…>` region is identical across bundles; the embedded Code.gs matches `templates/apps-script/Code.gs` | BP-15, BP-11 |
| S-03 | Manifest guard: `permissions` is exactly `storage, declarativeNetRequestWithHostAccess, alarms`; `host_permissions` unchanged; no `minimum_chrome_version` (per D4) | All, BP-10 |
| S-04 | Schema ↔ code: every `schema.json` property is handled in `parsePolicy`, and vice versa | BP-04 |
| S-05 | CSS guard: `shared.css` has the global `[hidden]:not([hidden="until-found"])` rule; `static-guard.css` has no selector list mixing `:has(` with other selectors | BP-06, BP-10 |
| S-06 | Error-code allowlists match everywhere: `ALL_ERROR_CODES` (all bundles), `ERROR_CATALOG`, the payload validator, and Code.gs `ALLOWED_ERROR_CODES` | BP-03, BP-04, BP-13 |

### 6.2 Unit tests (Auto, `node --test`, service-worker logic via `vm`)

| ID | Test | Covers |
|---|---|---|
| U-01 | Install-type × policy matrix: {admin, development, normal, unknown} × {no keys, valid, partly invalid}. Expect admin/unknown + no keys → locked strict defaults, `source:"admin-no-policy"`. Development/normal + no keys → unlocked. Any valid keys → managed. | BP-01 |
| U-02 | `SET_LOCAL_OVERRIDES` refused when locked; accepted on development/normal unmanaged | BP-01 |
| U-03 | Invalid managed values (string `"true"`, out-of-range interval, bad enum) fall back fail-closed and are listed in `invalidFields` | Regression |
| U-04 | `extraHideSelectors`: accepts valid string arrays; rejects non-arrays, over-long strings and >20 items into `invalidFields`; ignored when unmanaged | BP-04 |
| U-05 | DNR rules for all 4 combinations of `blockAiModeNavigation` × `forceWebOnlySearch`, plus `masterEnabled:false` → `[]` | Regression |
| U-06 | Redirect simulation, with each rule's pattern run as a JS RegExp and its transform applied, until no rule matches. `?q=x&udm=50` → `udm=14` or no `udm`; `sourceid=chrome` + `udm=50` → `#rm_sg_omnibox`; `/ai` and `/aimode` → `/`; `?q=x` → `udm=14`; `udm=2` and `tbm=nws` untouched; **every URL settles within 2 hops (no loops)** | Regression, BP-05 |
| U-07 | `cleanAiModeUrl()` (BP-05 JS copy) returns the same URL as the U-06 simulation for every test URL | BP-05 |
| U-08 | Payload v2: allowlisted keys only; `buckets` capped at 14; extra/unknown keys or PII-shaped fields make `assertNoPiiPayload` reject | BP-11 |
| U-09 | Flush with mock fetch: 3 pending days → exactly 1 POST; on `{status:"ok"}` the sent counts are subtracted, and counts that arrived during the request are kept | BP-11 |
| U-10 | Flush failure paths (HTTP 500, non-JSON, `{status:"error"}`, timeout) → backoff grows 15m→30m→1h…, capped at 24h; `ERR_ANALYTICS_FLUSH_FAILED` logged | Regression |
| U-11 | Alarm is created as repeating (`periodInMinutes` set); a thrown flush leaves the alarm in place; changing the interval recreates it, same interval doesn't | BP-12 |
| U-12 | Message gating: privileged types from a google.com tab sender are refused; from an extension-page sender, accepted; unknown `LOG_DIAGNOSTIC` code → `bad_message` with no log entry; missing `deltas` → `bad_message` | BP-13 |
| U-13 | Content-safe policy sent to content scripts has no `analyticsEndpointUrl` or `analyticsSharedToken` | BP-13 |
| U-14 | `RESET_LOCAL_METRICS` refused when locked; second `TRIGGER_TEST_FLUSH` within 15 min refused with time remaining | BP-07 |
| U-15 | Diagnostic log: same code+detail dedupes and counts; 51st distinct entry evicts the oldest | Regression |
| U-16 | Code.gs in `vm` with mock `SpreadsheetApp`/`LockService`: `doPost` appends one row and never calls `getValues()`; token mismatch → `UNAUTHORIZED`; bad payload rejected; `rollup_()` totals match a fixed sample | BP-11 |

### 6.3 Browser tests on local mock pages (Browser)

Mock pages are saved HTML snippets copied from Google's markup: an AI Overview, the AI Mode nav tab and homepage button, "Dive deeper", Labs, Lens, follow-up, and organic results. Content scripts only run on google.com, so these need either Playwright route interception (D8b) or a manual DevTools Local Overrides setup on `https://www.google.com/search?...`.

| ID | Test | Covers |
|---|---|---|
| B-01 | First line of `content.js` sets all three `data-rmsg-hide-*` attributes before any await; with 6× CPU throttle, no AI Overview flash | BP-02 |
| B-02 | Policy with `hideAiOverviews:false` → Overview visible after load | BP-02 |
| B-03 | Each surface is hidden: Overview, AI Mode tab, homepage button, Dive deeper, Labs, Lens, follow-up; search box visible; ≥5 organic results visible | Regression |
| B-04 | Organic result linking to `example.com/.../aimode-review` stays visible | BP-08 |
| B-05 | Overview whose nearest `data-hveid` wrapper contains 1 organic result: only the Overview card hides; `ERR_SAFETY_GUARD_TRIPPED` if the only candidate is the wrapper | BP-08 |
| B-06 | `history.pushState(…udm=50)` + a DOM mutation → page ends on the clean URL; `aiModeRedirects` +1 exactly | BP-05 |
| B-07 | Same page reloaded 3× with re-render churn → each category counter +3 exactly | BP-14 |
| B-08 | A single search produces ≤2 telemetry writes (count via a `chrome.storage.onChanged` logger in the service worker console) | BP-09 |
| B-09 | Performance profile on the churning mock page: sweep time per second down ≥50% vs. the current `dist` baseline (record the baseline first) | BP-09 |
| B-10 | `extraHideSelectors` hides `div.test-ai`; an invalid selector logs `ERR_SELECTOR_SYNTAX` and other hiding still works | BP-04 |
| B-11 | Tier 1/2 selectors stripped from the mock Overview → `WARN_AI_SURFACE_VISIBLE` logged once | BP-04 |
| B-12 | Options page (unmanaged): no "Locked" badges; Cancel Reset only after the first Reset click; Test Flush only when analytics is on; Staff card only after "Show Staff OU Preset"; tabs switch; Ctrl+F finds text in hidden tabs | BP-06 |
| B-13 | Popup: unmanaged view on unpacked install; managed view when the service worker reports locked; managed view (not unmanaged) when the service worker is unreachable | BP-01 |
| B-14 | Policy generator: each band's JSON parses, uses `{"key":{"Value":…}}` wrappers, and matches `schema.json` types; `extraHideSelectors` only emitted when filled | Regression, BP-04 |

### 6.4 Live Google tests (Browser, real google.com, manual)

Never retry through a CAPTCHA or "unusual traffic" page; record the test as **INCONCLUSIVE**.

| ID | Test | Covers |
|---|---|---|
| L-01 | English: "what is photosynthesis" → no Overview, no AI Mode tab, ≥5 organic results | Regression |
| L-02 | `?q=photosynthesis&udm=50` → clean results, query kept; `/ai` and `/aimode` → homepage | Regression |
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
| M-05 | As a student: Reset disabled; Test Flush rate-limited; `SET_LOCAL_OVERRIDES` sent from the console refused | BP-01, BP-07 |
| M-06 | Analytics to a scratch Sheet with the new Code.gs: rows land in `Raw`; hourly trigger rolls up; token mismatch rejected | BP-11 |
| M-07 | Leave a device asleep past two flush intervals, wake it → flush happens without a browser restart | BP-12 |

### 6.6 Old-browser test (Browser)

| ID | Test | Covers |
|---|---|---|
| O-01 | In a Chrome build without `:has()` support (or with it disabled, if that's possible), `button.plR5qb` and `a[href*="udm=50"]` are still hidden by CSS alone. If no such build is available, mark it NOT RUN and rely on S-05. | BP-10 |

### 6.7 Re-comment safety check (Auto)

| ID | Test | Covers |
|---|---|---|
| R-01 | Strip all comments and whitespace from each file before and after the §4 re-comment pass; the remaining code must be identical (only comments changed) | §4 |
| R-02 | S-01 to S-06 and all U-tests still pass after re-commenting | §4 |
