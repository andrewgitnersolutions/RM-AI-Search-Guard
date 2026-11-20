# Archive: District Analytics v1 (removed 2026-11-20)

**Reference only.** Nothing in `archive/` is built, shipped, imported or tested. Don't edit these files. If analytics comes back, build it fresh in `src/` using this folder as the guide.

## Why it was removed

Owner decision D6 (see `docs/07-BREAKPOINT-AUDIT-LOG.md` §2), 2026-11-20:
- **Anyone could write to the district's Sheet.** The Apps Script endpoint had to accept requests from "Anyone", and the shared token sits in the extension policy, which any student can read at `chrome://policy`. An extension can't hold a secret, so the endpoint can't tell real reports from fake ones.
- **The only real fix conflicts with the privacy promise.** Restricting the script to "Anyone within the district" would make every report arrive tied to a student's Google account. That breaks "no identity ever leaves the device".
- **The cost was high for a nice-to-have:** about 30% of the background code, the `alarms` permission plus two network host permissions, and two open bugs (BP-11 scaling, BP-12 alarm chain).

What stayed in the product: local counters on each device, the IT Diagnostics tab and the CSV export.

## Where the complete original lives

- **Git tag `analytics-v1-archive`** → commit `989c95a`, the last commit with analytics fully wired in. Everything below was extracted from it.
- To see any original file whole: `git show analytics-v1-archive:dist/background/service-worker.js` (likewise `dist/ui/options.js`, `dist/ui/options.html`, `dist/schema.json`, `dist/manifest.json`, `docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md`, `PRIVACY.md`).
- If the tag hasn't been pushed to GitHub yet, it exists only in the local clone. The commit itself is on GitHub, so `git show 989c95a:<path>` works from any clone.

## What's in this folder

| File | Contents |
|---|---|
| `service-worker-analytics.js` | The whole analytics module, verbatim: payload builder, zero-PII gate, backoff, alarm scheduling, flush with per-bucket delta subtraction |
| `touchpoints-service-worker.js` | 14 smaller pieces from elsewhere in the service worker (constants, error codes, policy validation, telemetry fields, alarm modes, message handler, listeners), each labeled with original line numbers |
| `touchpoints-options.js` | 9 pieces from the Options page and policy generator (analytics fieldset, validation, Test Flush, status rendering, diagnostic-bundle fields, Code.gs copy button) |
| `touchpoints-options.html` | The analytics status bar markup |
| `Code.gs` | The Apps Script sink, extracted from the string embedded in `options.js` (it never existed as its own file) |
| `schema-fragment.json` | The 4 managed-policy properties: `analyticsEnabled`, `analyticsEndpointUrl`, `analyticsSharedToken`, `analyticsFlushIntervalMinutes` |
| `manifest-fragment.json` | Permissions that existed only for analytics: `alarms`, `https://script.google.com/*`, `https://script.googleusercontent.com/*` |
| `docs-fragments.md` | Runbook Step 4, the PRIVACY.md analytics section, the architecture §5 data-flow diagram, and the developer-spec §8.2 flush rules |

## How it worked (v1)

1. Content scripts reported counts (Overviews hidden, AI Mode UI hidden, redirects, Omnibox fallbacks, aux AI hidden) to the service worker. It kept lifetime totals plus **pending daily buckets** (`pendingMetricsByDate`) and pending error-code counts.
2. When `analyticsEnabled` was true and `analyticsEndpointUrl` matched `^https://script\.google\.com/macros/s/[A-Za-z0-9_-]{10,}/exec$`, a one-shot `chrome.alarms` alarm fired every `analyticsFlushIntervalMinutes` (default 240) plus 0–30 min of jitter.
3. The flush built **one POST per pending day**: `{schemaVersion:1, extensionVersion, token?, gradeBand, dateBucket, metrics, errors}`. A strict key allowlist plus `assertNoPiiPayload` ran before any network call. It POSTed as `text/plain` (avoids a CORS preflight to Apps Script) with a 15 s timeout, and required `{status:"ok"}` back.
4. On success it subtracted exactly the sent counts, so events arriving mid-request weren't lost. On failure it backed off exponentially: 15 min doubling, capped at 24 h.
5. `Code.gs` validated the same allowlist, took the script lock, scanned the whole Sheet to upsert one row per (date, grade band, version), and returned JSON.

## Known problems to fix before it ever returns

- **Trust:** anyone with the URL can write. Needs an explicit design decision; see "If it comes back" below.
- **Scale (BP-11):** every request locks the script and reads every row. That fails at district size.
- **Alarm chain (BP-12):** a one-shot alarm re-armed only on the success path. An exception or a killed worker stops flushing until the next browser start.
- **Tampering (BP-07):** students could press "Reset Local Counters" (which wiped pending buckets) or spam "Test Flush Now" (which bypassed backoff).
- **Counter inflation (BP-14):** AI Mode and aux counts went up on every Google re-render.

## If it comes back: agreed redesign (option A from D6 discussion)

- **Payload v2:** one POST per flush carrying all pending days (`buckets: [{dateBucket, metrics}]`, capped at 14), same allowlist discipline.
- **Append-only sink:** `doPost` validates and appends one row to a `Raw` sheet (no scan, minimal lock). A time-driven trigger hourly rolls `Raw` into `Daily_Rollup` / `Error_Summary`. Ship an `installTrigger()` helper.
- **Repeating alarm** (`periodInMinutes`) with jitter only on the first fire, plus an "ensure the alarm exists" check on every worker wake.
- **Default interval 720 min.** Manual test flush rate-limited (once per 15 min) and Reset disabled on managed devices, enforced in the service worker.
- **Trust model:** decide explicitly between (a) anonymous with a documented "numbers may be spammed" caveat, and (b) district-sign-in-restricted script, which attaches student identity to each request. Option (b) requires updating PRIVACY.md and the store listing's data disclosures. Get owner approval either way.

## Rebuild checklist for an agent

Adding analytics back **adds permissions**, which `AGENTS.md` forbids without owner approval. Get it in chat first.

- [ ] Owner approval for: the permissions in `manifest-fragment.json`, the trust model, and the privacy-policy change.
- [ ] Recreate `src/background/analytics.ts` from `service-worker-analytics.js`, applying the redesign above. Comment it per `AGENTS.md`.
- [ ] Re-add the policy fields from `schema-fragment.json` to `schema.json` and `parsePolicy` (fail closed: invalid → analytics off).
- [ ] Re-add `ERR_ANALYTICS_ENDPOINT_INVALID` and `ERR_ANALYTICS_FLUSH_FAILED` to every error-code list (static test S-06).
- [ ] Restore telemetry fields for pending buckets and flush status (see `touchpoints-service-worker.js`).
- [ ] Re-wire lifecycle and alarm listeners and the `TRIGGER_TEST_FLUSH` message, gated to extension pages (BP-13).
- [ ] Restore the Options status bar and Test Flush button (`touchpoints-options.*`), and the generator's analytics fieldset.
- [ ] Create `templates/apps-script/Code.gs` from `Code.gs` with the append-only + rollup redesign. Generate the copy embedded in Options from it at build time.
- [ ] Restore the docs from `docs-fragments.md`: runbook Step 4 (add trigger setup and the token caveat), the PRIVACY.md analytics section, architecture §5, developer spec §8.2, PRD AC-15/AC-16, store listing permission rows.
- [ ] Restore and pass the tests that were removed with it: U-08 to U-11 and U-16, M-06 and M-07 (definitions in `docs/07` §6, marked "removed by D6").
