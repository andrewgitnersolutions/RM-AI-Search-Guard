# Tests

Test IDs follow `docs/07-BREAKPOINT-AUDIT-LOG.md` §6. Every test runs against one or more
built extension folders ("targets"), never against `src/` directly.

| Command | What runs |
|---|---|
| `npm run build` | Bundles `src/` into the gitignored `build/` |
| `npm test` | Static checks (S-xx) and unit tests (U-xx, X-xx) against `build/` |
| `npm run test:browser` | Playwright B tests against `build/` (mock Google pages, route interception) |
| `npm run test:gate` | Phase 0a gate: everything above against `baseline-dist/` **and** `build/`, plus G-01 |
| `npm run promote` | Copies `build/` into `dist/` (only when the promotion rule holds) |
| `npm run record-known-failures` | Re-records `tests/known-failures.json` from a run against `build/` |

## How the comparison works

`tests/helpers/equivalence.mjs` runs each test body once per target. Each target gets its own
pass/fail subtest, and with two or more targets an extra subtest asserts that all targets
produced identical results: same pass/fail, same failure message, same observed values.

### Promotion rule and `known-failures.json`

Tests for break points that aren't fixed yet pass `{ bp: "BP-xx" }` and are listed in
`tests/known-failures.json` (recorded at the end of Phase 0a) with the phase that fixes them
and their exact failure message. The rule from docs/07 §5 is enforced by the helper:

- a test not on the list must pass;
- a listed test must fail with exactly the recorded message; a different failure, or a pass,
  fails the run;
- a listed test whose phase is ≤ `currentPhase` must pass.

When a phase fixes a break point, remove its tests from the list in the same commit (or
re-record with `npm run record-known-failures -- --phase N` and review the diff). The list must
be empty after Phase 4.

## Environment variables

| Variable | Meaning |
|---|---|
| `RM_TARGETS` | Comma list of folders to test (default `build` when unset; set but empty is an error). The gate uses `baseline-dist,build`. |
| `RM_PRE_PROMOTE=1` | Skip S-02b (dist/ equals a clean build), which can only pass after `npm run promote`. |
| `RM_IGNORE_FIELDS` | Object keys dropped before comparing targets. Used only when comparing builds whose allowed differences are whole fields (Phase 0b: the D6 analytics fields). |
| `RM_ALLOWED_DIFF` | Test IDs whose cross-target difference is reported as TODO instead of failing; the newest target must still pass on its own. Every ID needs a reason in the commit message. |
| `RM_CHROMIUM_PATH` | A local Chromium / Chrome for Testing (≥ 134) for the B tests, if Playwright's own browser download isn't available. Branded Chrome can't load unpacked extensions. |

## What the tests never do

- Reach real Google or any other host. `tests/helpers/browser.mjs` fulfills every google.com
  request from `tests/browser/fixtures/` and aborts all other web requests. The fixtures are
  hand-written to match the selectors; they are not copies of live Google pages.
- Use real network for analytics. The service-worker harness (`tests/helpers/sw-harness.mjs`)
  injects `fetch` per test.

## Not automated (report as NOT RUN)

B-09 (performance profile), B-10 (needs managed policy), B-13 on a real managed profile
(B-13b–d cover the locked and worker-unreachable views by stubbing the worker's answer), the
churning-page half of B-08, all L (live Google), M (managed device) and O (Chrome-version) tests.
