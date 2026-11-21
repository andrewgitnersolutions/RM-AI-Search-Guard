// G-01: Phase 0a code-equivalence gate (docs/07 §5). The rebuilt build/ must match the original
// dist/ snapshot in baseline-dist/ once comments and whitespace are stripped: JS via esbuild's
// whitespace-only minifier, CSS and HTML by removing comments and whitespace, JSON and icons
// byte for byte. Skipped when baseline-dist/ is absent (it is kept only until the gate passes).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { ROOT } from "../helpers/targets.mjs";

const BASELINE = path.join(ROOT, "baseline-dist");
const BUILD = path.join(ROOT, "build");
const skip = existsSync(BASELINE) ? false : "baseline-dist/ not present (gate already passed)";

/** List every file under a folder, relative and sorted. */
function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  }).sort();
}

/** Canonical form of a file for comparison, by type. */
function canonical(rel, buf) {
  const text = buf.toString("utf8");
  if (rel.endsWith(".js")) return transformSync(text, { loader: "js", minifyWhitespace: true }).code;
  if (rel.endsWith(".css")) return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
  if (rel.endsWith(".html")) return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, "");
  return buf.toString("base64");
}

test("G-01 build/ has exactly the files of baseline-dist/", { skip }, () => {
  assert.deepEqual(listFiles(BUILD), listFiles(BASELINE));
});

for (const rel of skip ? [] : listFiles(BASELINE)) {
  test(`G-01 ${rel}: identical to baseline-dist/ with comments and whitespace stripped`, () => {
    const a = canonical(rel, readFileSync(path.join(BASELINE, rel)));
    const b = canonical(rel, readFileSync(path.join(BUILD, rel)));
    if (a !== b) {
      let i = 0;
      while (a[i] === b[i]) i += 1;
      assert.fail(`first difference at ${i}:\n baseline: ${a.slice(Math.max(0, i - 60), i + 80)}\n build:    ${b.slice(Math.max(0, i - 60), i + 80)}`);
    }
  });
}
