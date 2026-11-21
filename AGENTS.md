# AGENTS.md — RaiseMark AI Search Guard

Instructions for any coding agent (Claude Code, Antigravity/Gemini, Codex, Cursor, etc.) working in this repository. Read this file in full before changing anything, and keep following it for the whole session.

## What this project is

A Manifest V3 Chrome extension for K-12 school districts. It hides Google Search AI features (AI Overviews, AI Mode, Labs/Lens/follow-ups) and redirects AI Mode URLs, with settings pushed per Organizational Unit from the Google Admin Console (`chrome.storage.managed`, schema in `schema.json`). Students are the end users; school IT admins are the operators. Privacy promise: **zero student PII, no page content, queries or URLs ever leave the device.**

## Read first

1. `docs/07-BREAKPOINT-AUDIT-LOG.md`: open break points (BP-xx), owner decisions (D-x), execution order, and the test plan (§6). This is the current work plan.
2. `docs/02-ARCHITECTURE.md` and `docs/03-DEVELOPER-SPEC.md`: intended design. Where they disagree with the code or with docs/07, docs/07 wins.
3. `docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md`: what admins are told. If you change behavior, update this.

## Current state (update this section when it changes)

- **Phase 0 is done** (0a rebuild, 0b analytics removed, 0c rename; PR #3, 2026-11-21). The equivalence gate passed.
- **Phase 1 is done** (BP-01, BP-02, BP-06, BP-10, BP-17; PR #4, 2026-11-21).
- **Phase 2 is done** (BP-05, BP-07, BP-08, BP-13, BP-18, BP-19 option A; 2026-11-21). `tests/known-failures.json` has `currentPhase: 2`. Still open: M-01, M-02 and M-05 on a managed device (the owner has none yet), and L-06/L-07 on live Google. **Next: Phase 3** (docs/07 §5: BP-09, BP-14, BP-12).
- **`src/` is the source of truth and `dist/` is build output.** Never hand-edit `dist/`; change `src/` and rebuild. TypeScript runs with `strict: true`; `npm run typecheck` must pass.
- **Workflow (2026-11-20):** edit `src/` → `npm run build` (writes to the gitignored `build/`) → run the S/U/B tests against `build/` → `npm run promote` copies `build/` to `dist/`. Never write to `dist/` any other way.
- Open owner decisions: see the decisions table in docs/07 §2. Don't act on an unresolved decision; use its stated default only if the owner said to.

## Hard rules (never, unless the owner explicitly approves in chat)

- Don't add `permissions` or `host_permissions` to the manifest.
- Don't weaken the Organic Results Safety Guard (`isUnsafeToHide`) or lower its protections.
- Don't send page text, search queries, URLs, user or device identifiers, or precise timestamps anywhere. Analytics stays allowlisted aggregate counts only.
- No remote code, remote config or remote selector fetching.
- Don't solve, bypass or retry through Google CAPTCHA / "unusual traffic" pages; record the test as INCONCLUSIVE.
- Don't upload, publish or submit anything to the Chrome Web Store.
- Don't commit, push, create branches or open PRs unless the owner asks. The GitHub repo is **public**.
- The product name is **"RaiseMark: AI Search Controls for K-12"** (short name **"RaiseMark"**), decided 2026-11-20. Don't change it, and never put "Google" or "Chrome" in the title (Chrome Web Store branding rules). The license is standard MIT.
- Minimum Chrome is **134** (`minimum_chrome_version`, decided 2026-11-20). Don't use a browser API or CSS feature newer than 134 without feature-detecting it. Don't raise the minimum without owner approval: raising it silently cuts off updates for devices below the new floor.
- Supported Google UI languages for text matching: **English and Spanish** (decided 2026-11-20). Strings must be collected from live Google with `hl=xx`, never machine-translated, and each gets a `FRAGILE(…, last verified …)` date.
- `archive/` is reference only (e.g. `archive/analytics-v1/`, the district analytics removed 2026-11-20). Never edit, build, import or test from it. If asked to bring a feature back, follow that folder's `README.md` rebuild checklist and get owner approval first.
- Keep behavior fail-closed: when policy, storage or the browser state is uncertain, protection stays **on**.

## Commenting standard (owner decision D2 = lean, 2026-11-20)

Apply to every file you touch, in the same change as the code. Comments live in `src/`; esbuild output in `dist/` is unminified but uncommented.

1. **File header** at the top of every source file: what the file does, where it runs (service worker / content script on google.com / extension page / Apps Script), what it must never do, and which modules it shares code with.
2. **Function doc block** (JSDoc) above every function: one-sentence purpose, params, return value, and failure behavior (fail-closed or fail-open, and why). Keep it short.
3. **Inline comments only for "why"**, never for "what". Good: why DNR rules rely on priority (RE2 has no lookahead), why analytics posts `text/plain`, why something fails closed. Bad: `// Return value`, `// Increment counter`.
4. **No `// End …` closer comments** and no comments that restate the line.
5. **Mark Google-dependent code** (selectors, URL params like `udm=14`/`udm=50`, label text) with `// FRAGILE(google-dom, last verified YYYY-MM-DD): <what it matches>`. Update the date whenever you re-confirm it on live Google.
6. **Keep comments true.** If your change makes a comment wrong, fix it in the same change. A stale comment is a bug.
7. A comment-only change must not change behavior. Verify by comparing the code with comments and whitespace stripped (test R-01).

## Testing

- Test tools (D8, 2026-11-20): `node --test` runs the S and U tests; Playwright runs the B tests against `build/` with mock Google pages via route interception, never real Google. L and M tests are manual.
- The test plan is docs/07 §6. Run the static checks (S-xx) and unit tests (U-xx) after every change; run the browser/live/managed tests named in the "Done when" of the break point you're fixing.
- In Claude Code cloud sessions, run the B tests with `RM_CHROMIUM_PATH=/opt/pw-browsers/chromium` (the pinned Playwright's own browser isn't installed there).
- Report every test you couldn't run as **NOT RUN**, with the reason. Never mark an unrun test as passed.
- When you fix a break point, tick its to-dos in docs/07, add a dated line under it saying what changed and which tests passed, and update `docs/04` if admins or students will see different behavior.

## Repository facts

- Remote: `origin` → `https://github.com/andrewgitnersolutions/RM-AI-Search-Guard.git`, default branch `main` (public).
- `local-cws/` is gitignored and local-only (Chrome Web Store listing docs, screenshots, release zips). Never force-add or push it.
- `local-cws/release/*.zip` may be stale; never treat it as the current build.
- Public contact email for support, bug reports, and contributor access requests is `info@raisemarkai.com` (2026-11-21). Public GitHub issues/comments are restricted to collaborators, and `LICENSE` stays verbatim MIT while `README.md` holds the RaiseMark trademark reservation.

## Keeping this file useful (ask the owner)

This file is the project's memory between sessions. **Whenever something comes up during a session that future sessions should know, ask the owner whether to add it here.** Examples: a gotcha you hit, a convention the owner states, a decision they make, a recurring mistake, a new tool or command, a change to the current state.

- Ask in chat at the moment it comes up (or at the end of the task if you're mid-step), and show the exact wording you'd add and which section it goes in. For example: "Want me to add this to AGENTS.md under Hard rules: '…'?"
- Only edit this file after the owner says yes. Keep entries short and dated where a date matters.
- Don't ask about things already covered here or in docs/07, and don't ask more than once about the same item.
- When an owner decision in docs/07 §2 is resolved, ask whether to record it in the relevant section here.
