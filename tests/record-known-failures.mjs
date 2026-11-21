/**
 * Records tests/known-failures.json (docs/07 §5 promotion rule).
 * Runs in: Node on a developer machine. Runs the S, U and B tests in recording mode, then
 * writes every failing equivalence test with its break point, the phase that will fix it and
 * its exact failure message. Run it only at the end of 0a, or after a phase fixes a BP;
 * review the diff before committing, because the list is what promotion is checked against.
 *
 * Usage: node tests/record-known-failures.mjs [--phase N]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT } from "./helpers/targets.mjs";

// docs/07 §5: which phase fixes each break point.
const PHASE_OF_BP = { "BP-01": 1, "BP-02": 1, "BP-06": 1, "BP-10": 1, "BP-05": 2, "BP-07": 2, "BP-08": 2, "BP-13": 2, "BP-09": 3, "BP-14": 3, "BP-12": 3, "BP-03": 4, "BP-04": 4, "BP-11": 4 };

const phaseFlag = process.argv.indexOf("--phase");
const currentPhase = phaseFlag > 0 ? Number(process.argv[phaseFlag + 1]) : 0;
const tmp = mkdtempSync(path.join(tmpdir(), "rm-kf-"));
const out = path.join(tmp, "failures.jsonl");
const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "tests/static/*.test.mjs", "tests/unit/*.test.mjs", "tests/browser/*.test.mjs"], {
  cwd: ROOT,
  env: { ...process.env, RM_RECORD_KNOWN_FAILURES: out, RM_PRE_PROMOTE: "1" },
  stdio: "inherit",
});
if (r.status !== 0) console.warn("Note: the recording run had failures outside equivalence tests; check them before using this list.");
const failures = {};
for (const line of existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean) : []) {
  const { id, bp, message } = JSON.parse(line);
  if (!bp || !PHASE_OF_BP[bp]) throw new Error(`${id} fails but names no open break point: fix it or give it a bp before recording`);
  failures[id] = { bp, phase: PHASE_OF_BP[bp], message };
}
const sorted = Object.fromEntries(Object.entries(failures).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(path.join(ROOT, "tests/known-failures.json"), JSON.stringify({ currentPhase, failures: sorted }, null, 2) + "\n");
rmSync(tmp, { recursive: true, force: true });
console.log(`Recorded ${Object.keys(sorted).length} known failures (currentPhase ${currentPhase}).`);
