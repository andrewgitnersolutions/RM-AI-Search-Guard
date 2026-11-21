/**
 * Build script: bundles src/ with esbuild and copies static files into the
 * gitignored staging folder build/. Runs in Node on a developer machine only;
 * it never writes to dist/ (scripts/promote.mjs does that after tests pass).
 *
 * Output must be reproducible (test S-02a): no timestamps, no absolute paths,
 * and a fixed esbuild version from package-lock.json.
 */
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
// `--out <dir>` builds elsewhere (test S-02a builds twice into temp folders and compares).
const outFlag = process.argv.indexOf("--out");
const OUT = outFlag > 0 ? path.resolve(process.argv[outFlag + 1]) : path.join(ROOT, "build");

/** Files copied byte for byte from src/ to build/ (paths relative to src/). */
const STATIC_FILES = [
  "manifest.json",
  "schema.json",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "content/static-guard.css",
  "ui/popup.html",
  "ui/options.html",
  "ui/shared.css",
];

/**
 * Shared esbuild options. Chrome 134 is the minimum (AGENTS.md, D4), so no
 * syntax is lowered below it. Comments in src/ are dropped from the output;
 * esbuild keeps only its own `// src/...` module markers.
 */
const COMMON = {
  bundle: true,
  target: "chrome134",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  logLevel: "warning",
  absWorkingDir: ROOT,
};

/**
 * Bundle every entry point and copy static files into a fresh build/ folder.
 * Fails (non-zero exit) on any esbuild error so a broken build is never promoted.
 * @returns {Promise<void>}
 */
async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Service worker, popup and options load as ES modules (manifest "type": "module", <script type="module">).
  await build({
    ...COMMON,
    format: "esm",
    entryPoints: {
      "background/service-worker": "src/background/service-worker.ts",
      "ui/popup": "src/ui/popup.ts",
      "ui/options": "src/ui/options.ts",
    },
    outdir: OUT,
  });
  // Content scripts are classic scripts, so wrap in an IIFE to keep names off Google's page scope.
  await build({
    ...COMMON,
    format: "iife",
    entryPoints: { "content/content": "src/content/content.ts" },
    outdir: OUT,
  });

  for (const rel of STATIC_FILES) {
    await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
    await cp(path.join(SRC, rel), path.join(OUT, rel));
  }
  console.log(`Built ${path.relative(ROOT, OUT) || "."}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
