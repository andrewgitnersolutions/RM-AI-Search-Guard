// S-01..S-06 (docs/07 §6.1): static checks on src/, the build targets and dist/.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { equivalent, plain } from "../helpers/equivalence.mjs";
import { loadServiceWorker } from "../helpers/sw-harness.mjs";
import { ROOT, TARGETS } from "../helpers/targets.mjs";

const MODULE_SCRIPTS = ["background/service-worker.js", "ui/popup.js", "ui/options.js"];
const CLASSIC_SCRIPTS = ["content/content.js"];

// S-03 expectations from Phase 0b on (D6 removed `alarms` and the two script.* hosts).
const EXPECTED_PERMISSIONS = ["storage", "declarativeNetRequestWithHostAccess"];
const EXPECTED_HOSTS = ["https://www.google.com/*", "https://google.com/*"];

/** List every file under a folder, relative and sorted. */
function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  }).sort();
}

/** Build into a fresh temp folder and return its path. */
function buildInto(label) {
  const out = mkdtempSync(path.join(tmpdir(), `rm-${label}-`));
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build.mjs"), "--out", out], { cwd: ROOT, stdio: "pipe" });
  return out;
}

/** Assert two folders hold the same files with the same bytes. */
function assertSameTree(a, b) {
  const fa = listFiles(a);
  assert.deepEqual(fa, listFiles(b), "file lists differ");
  for (const f of fa) assert.ok(readFileSync(path.join(a, f)).equals(readFileSync(path.join(b, f))), `${f} differs`);
}

const SYNTAX_TARGETS = TARGETS.some((t) => t.name === "dist") ? TARGETS : [...TARGETS, { name: "dist", dir: path.join(ROOT, "dist") }];
for (const target of SYNTAX_TARGETS) {
  test(`S-01 syntax check: every JS file in ${target.name}/ parses (modules as .mjs, content script as classic)`, () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "rm-s01-"));
    try {
      for (const [list, ext] of [[MODULE_SCRIPTS, ".mjs"], [CLASSIC_SCRIPTS, ".cjs"]]) {
        for (const rel of list) {
          const copy = path.join(tmp, rel.replace(/[\\/]/g, "_") + ext);
          copyFileSync(path.join(target.dir, rel), copy);
          const r = spawnSync(process.execPath, ["--check", copy], { encoding: "utf8" });
          assert.equal(r.status, 0, `${rel}: ${r.stderr}`);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test("S-01b typecheck: tsc --noEmit on src/ passes", () => {
  const r = spawnSync(path.join(ROOT, "node_modules/.bin/tsc"), ["--noEmit", "-p", "tsconfig.json"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("S-02a reproducibility: two builds of the same source are byte-identical", () => {
  const a = buildInto("s02a-1");
  const b = buildInto("s02a-2");
  try {
    assertSameTree(a, b);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("S-02b post-promotion: a clean build of the committed source equals dist/ byte for byte", { skip: process.env.RM_PRE_PROMOTE === "1" ? "RM_PRE_PROMOTE=1 (dist/ not promoted yet)" : false }, () => {
  const a = buildInto("s02b");
  try {
    assertSameTree(a, path.join(ROOT, "dist"));
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});

for (const [name, file] of [["src", path.join(ROOT, "src/manifest.json")], ...TARGETS.map((t) => [t.name, path.join(t.dir, "manifest.json")])]) {
  test(`S-03 manifest guard (${name}): exact permissions and hosts; minimum_chrome_version 134`, () => {
    const m = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(m.permissions, EXPECTED_PERMISSIONS);
    assert.deepEqual(m.host_permissions, EXPECTED_HOSTS);
    assert.equal(m.minimum_chrome_version, "134");
    assert.equal(m.manifest_version, 3);
    assert.deepEqual(m.content_scripts.map((c) => c.matches), [["https://www.google.com/*", "https://google.com/*"]]);
    // Why: connect-src 'self' and default-src 'none' lock Popup/Options offline; loosen connect-src if archive/analytics-v1/ ever fetches from an extension page.
    assert.equal(
      m.content_security_policy.extension_pages,
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
  });
}

equivalent("S-04", "schema ↔ parsePolicy: every schema property is validated by parsePolicy, and every policy field is in the schema", (target) => {
  const schema = JSON.parse(readFileSync(path.join(target.dir, "schema.json"), "utf8"));
  const sw = loadServiceWorker(target);
  const props = Object.keys(schema.properties);
  const notValidated = props.filter((key) => {
    const { policy } = plain(sw.ctx.parsePolicy({ [key]: { not: "valid" } }, null));
    return !policy.invalidFields.includes(key);
  });
  assert.deepEqual(notValidated, []);
  const META = ["source", "isManaged", "invalidFields", "evaluatedAt"];
  const fields = Object.keys(plain(sw.ctx.parsePolicy({ gradeBand: "K-2" }, null)).policy).filter((k) => !META.includes(k));
  assert.deepEqual(fields.filter((k) => !props.includes(k)), []);
  return { props, fields };
});

equivalent("S-05a", "CSS guard: shared.css has the global [hidden]:not([hidden=\"until-found\"]) rule", (target) => {
  const css = readFileSync(path.join(target.dir, "ui/shared.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // Short message on purpose: the comparison across builds must not depend on comment text.
  assert.ok(/\[hidden\]:not\(\[hidden="until-found"\]\)\s*\{[^}]*display:\s*none\s*!important/.test(css), "global [hidden] rule missing");
  return true;
}, { bp: "BP-06" });

equivalent("S-05b", "CSS guard: static-guard.css has no selector list mixing :has( with other selectors", (target) => {
  const css = readFileSync(path.join(target.dir, "content/static-guard.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const mixed = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].split(",")).filter((list) => list.length > 1 && list.some((s) => s.includes(":has(")));
  assert.equal(mixed.length, 0, `${mixed.length} mixed :has() selector list(s)`);
  return true;
}, { bp: "BP-10" });

equivalent("S-05c", "CSS guard: every :has() rule in static-guard.css excludes search inputs and organic results", (target) => {
  const css = readFileSync(path.join(target.dir, "content/static-guard.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const hasRules = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((sel) => sel.includes(":has("));
  assert.ok(hasRules.length > 0, "expected :has() rules in static-guard.css");
  for (const sel of hasRules) {
    assert.ok(sel.includes(':not(:has(textarea[name="q"]))'), `missing textarea[name="q"] guard: ${sel}`);
    assert.ok(sel.includes(':not(:has(input[name="q"]))'), `missing input[name="q"] guard: ${sel}`);
    assert.ok(sel.includes(":not(:has(a h3))"), `missing a h3 guard: ${sel}`);
  }
  return hasRules.length;
}, { bp: "BP-08" });

equivalent("S-06", "error codes: ALL_ERROR_CODES = ERROR_CATALOG keys; every code literal in the bundles is a catalog code", (target) => {
  const sw = loadServiceWorker(target);
  const codes = plain(sw.ctx.ALL_ERROR_CODES);
  assert.deepEqual([...codes].sort(), Object.keys(plain(sw.ctx.ERROR_CATALOG)).sort());
  for (const code of codes) assert.equal(sw.ctx.ERROR_CATALOG[code].code, code);
  const literals = {};
  for (const rel of [...MODULE_SCRIPTS, ...CLASSIC_SCRIPTS]) {
    const js = readFileSync(path.join(target.dir, rel), "utf8");
    literals[rel] = [...new Set(js.match(/\b(?:ERR|WARN)_[A-Z_]+\b/g) ?? [])].sort();
    for (const c of literals[rel]) assert.ok(codes.includes(c), `${rel} uses unknown code ${c}`);
  }
  return { codes, literals };
});

/** Every text file under a folder, relative path → contents. */
function readTree(dir) {
  return listFiles(dir).filter((f) => /\.(ts|js|json|html|css)$/.test(f)).map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);
}

const S06B_DIRS = [["src", path.join(ROOT, "src")], ...TARGETS.map((t) => [t.name, t.dir])];
if (process.env.RM_PRE_PROMOTE !== "1" && !TARGETS.some((t) => t.name === "dist")) S06B_DIRS.push(["dist", path.join(ROOT, "dist")]);
for (const [name, dir] of S06B_DIRS) {
  test(`S-06b no ERR_ANALYTICS_* code, analytics field or script.google host in ${name}/ (D6)`, () => {
    for (const [file, text] of readTree(dir)) {
      assert.doesNotMatch(text, /ERR_ANALYTICS_|analyticsEndpointUrl|analyticsSharedToken|script\.google(usercontent)?\.com|TRIGGER_TEST_FLUSH|chrome\.alarms/, `${name}/${file}`);
    }
  });
}

// S-07 (added in Phase 0c; not in docs/07): product name per D7 and the Chrome Web Store
// branding rule (no "Google" or "Chrome" in the title). Old names must not come back.
for (const [name, dir] of S06B_DIRS) {
  test(`S-07 product name (${name}/): manifest uses the D7 name; no "Search Guard" strings`, () => {
    const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.equal(m.name, "RaiseMark: AI Search Controls for K-12");
    assert.equal(m.short_name, "RaiseMark");
    assert.equal(m.action.default_title, m.name);
    assert.doesNotMatch(m.name, /google|chrome/i);
    for (const [file, text] of readTree(dir)) assert.doesNotMatch(text, /search[ -]guard/i, `${name}/${file}`);
  });
}
