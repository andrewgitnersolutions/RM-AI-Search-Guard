/**
 * Runs one test body against every target and, with 2+ targets, asserts identical results.
 * Runs in: Node test runner only.
 *
 * Each body returns an "observation" (plain JSON) and may throw on a failed expectation.
 * Per target, a subtest applies the promotion rule (docs/07 §5) using tests/known-failures.json:
 * - a test not on the list must pass;
 * - a listed test must fail with exactly the recorded message (a changed failure, or a pass,
 *   fails the run: update the list in the same commit that fixes the break point);
 * - a listed test whose phase is <= the list's currentPhase must pass.
 * With 2+ targets, a further subtest asserts all targets gave identical results.
 *
 * RM_RECORD_KNOWN_FAILURES=<file.jsonl> records failures instead of enforcing the list
 * (see tests/record-known-failures.mjs).
 *
 * RM_IGNORE_FIELDS (comma list) drops those object keys from observations before comparing.
 * RM_ALLOWED_DIFF (comma list of test IDs) reports a cross-build difference as TODO instead of
 * failing. Both exist only for comparing builds with a documented allowed difference
 * (Phase 0b vs 0a: the D6 analytics removal). Every allowed ID must be justified in the commit.
 */
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ROOT, TARGETS } from "./targets.mjs";

const KNOWN = JSON.parse(readFileSync(path.join(ROOT, "tests/known-failures.json"), "utf8"));
const RECORD = process.env.RM_RECORD_KNOWN_FAILURES || "";

const IGNORE = new Set((process.env.RM_IGNORE_FIELDS || "").split(",").map((s) => s.trim()).filter(Boolean));
const ALLOWED_DIFF = new Set((process.env.RM_ALLOWED_DIFF || "").split(",").map((s) => s.trim()).filter(Boolean));

/**
 * Deep-copy through JSON (strips vm-realm prototypes) and drop ignored keys.
 * @param {unknown} value - Observation.
 * @returns {unknown} Comparable plain value.
 */
export function plain(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (key, v) => (IGNORE.has(key) ? undefined : v)));
}

/**
 * Run fn against one target and capture its outcome without throwing.
 * @param {Function} fn - Test body.
 * @param {{ name: string, dir: string }} target - Build folder.
 * @returns {Promise<{ status: string, message: string | null, observation: unknown, error?: unknown }>}
 */
async function capture(fn, target) {
  try {
    const observation = plain(await fn(target));
    return { status: "pass", message: null, observation };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { status: "fail", message, observation: null, error };
  }
}

/**
 * Register an equivalence test.
 * @param {string} id - Test ID from docs/07 §6 (e.g. "U-05").
 * @param {string} title - What it proves.
 * @param {(target: { name: string, dir: string }) => Promise<unknown> | unknown} fn - Body.
 * @param {{ bp?: string }} [opts] - bp: open break point this test covers (recorded in the list).
 */
export function equivalent(id, title, fn, opts = {}) {
  test(`${id} ${title}`, async (t) => {
    const results = [];
    for (const target of TARGETS) results.push(await capture(fn, target));
    const known = KNOWN.failures[id];
    const mustPass = !known || known.phase <= KNOWN.currentPhase;
    for (let i = 0; i < TARGETS.length; i += 1) {
      const r = results[i];
      if (RECORD) {
        if (r.status === "fail" && i === TARGETS.length - 1) appendFileSync(RECORD, JSON.stringify({ id, bp: opts.bp ?? null, message: r.message }) + "\n");
        continue;
      }
      // For an allowed difference only the newest (last) target is held to the list.
      const olderAllowed = ALLOWED_DIFF.has(id) && i < TARGETS.length - 1;
      const label = mustPass ? `[${TARGETS[i].name}]` : `[${TARGETS[i].name}] known failure (${known.bp}, phase ${known.phase})`;
      await t.test(label, olderAllowed ? { todo: "older build; allowed difference" } : {}, () => {
        if (mustPass) {
          if (r.status === "fail") throw r.error;
          return;
        }
        assert.ok(r.status === "fail", `${id} now passes: remove it from tests/known-failures.json in this commit`);
        assert.equal(r.message, known.message, `${id} fails differently from the recorded known failure`);
      });
    }
    if (TARGETS.length > 1) {
      const allowed = ALLOWED_DIFF.has(id) ? { todo: "allowed difference (RM_ALLOWED_DIFF)" } : {};
      await t.test(`identical across ${TARGETS.map((x) => x.name).join(" / ")}`, allowed, () => {
        const strip = ({ status, message, observation }) => ({ status, message, observation });
        for (let i = 1; i < results.length; i += 1) assert.deepEqual(strip(results[i]), strip(results[0]));
      });
    }
  });
}
