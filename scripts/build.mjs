/**
 * Build script: bundles src/ with esbuild and copies static files into the
 * gitignored staging folder build/. Runs in Node on a developer machine only;
 * it never writes to dist/ (scripts/promote.mjs does that after tests pass).
 *
 * Output must be reproducible (test S-02a): no timestamps, no absolute paths,
 * and a fixed esbuild version from package-lock.json.
 */
import { build } from "esbuild";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
// `--out <dir>` builds elsewhere (test S-02a builds twice into temp folders and compares).
const outFlag = process.argv.indexOf("--out");
const outArg = outFlag > 0 ? process.argv[outFlag + 1] : undefined;
if (outFlag > 0 && !outArg) {
  console.error("--out needs a folder");
  process.exit(1);
}
const OUT = outArg ? path.resolve(outArg) : path.join(ROOT, "build");

/**
 * Resolve symlinks in the part of a path that exists, so a symlinked temp folder (macOS
 * /var -> /private/var) or a link into the repo can't slip past refuseOut().
 * @param {string} p - Absolute path, which may not exist yet.
 * @returns {string} Absolute path with its existing prefix resolved.
 */
function realish(p) {
  let head = p;
  const tail = [];
  while (!existsSync(head)) {
    tail.unshift(path.basename(head));
    const parent = path.dirname(head);
    if (parent === head) break;
    head = parent;
  }
  return path.join(realpathSync(head), ...tail);
}

/**
 * Whether child is parent itself or lies inside it.
 * @param {string} child - Absolute path.
 * @param {string} parent - Absolute path.
 * @returns {boolean}
 */
function within(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Refuse any output folder other than the repo's build/ or a folder under the OS temp
 * directory. main() deletes OUT recursively, so a typo such as `--out .` or `--out src` would
 * otherwise wipe the working tree, src/ or dist/. Fails closed: anything not allowed is refused.
 * @param {string} out - Resolved output folder.
 * @returns {string | null} Why it is refused, or null if it is allowed.
 */
function refuseOut(out) {
  const real = realish(out);
  const root = realish(ROOT);
  const tmp = realish(tmpdir());
  if (within(root, real)) return "it is the repository root or contains it";
  if (within(real, root)) return real === path.join(root, "build") ? null : "only build/ may be used inside the repository";
  if (within(real, tmp) && real !== tmp) return null;
  return "outside the repository only a folder under the OS temp directory may be used";
}

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
 * Fails (non-zero exit) on any esbuild error, or before deleting anything if OUT is refused,
 * so a broken build is never promoted.
 * @returns {Promise<void>}
 */
async function main() {
  const refused = refuseOut(OUT);
  if (refused) throw new Error(`Refusing to build into ${OUT}: ${refused}.`);
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
