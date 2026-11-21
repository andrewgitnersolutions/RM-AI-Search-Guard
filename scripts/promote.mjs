/**
 * Promote script: replaces dist/ with the tested contents of build/.
 * Runs in Node on a developer machine only. This is the only supported way to change dist/
 * (AGENTS.md workflow: edit src/ → npm run build → run S/U/B tests on build/ → npm run promote).
 * It never builds, tests, uploads or publishes anything.
 */
import { cp, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
const DIST = path.join(ROOT, "dist");

/**
 * Copy build/ over dist/, removing files that no longer exist in build/.
 * Fails (non-zero exit) without touching dist/ if build/ is missing or has no manifest.
 * @returns {Promise<void>}
 */
async function main() {
  try {
    await stat(path.join(BUILD, "manifest.json"));
  } catch {
    throw new Error("build/manifest.json not found. Run `npm run build` and the tests first.");
  }
  for (const entry of await readdir(DIST).catch(() => [])) {
    await rm(path.join(DIST, entry), { recursive: true, force: true });
  }
  await cp(BUILD, DIST, { recursive: true });
  console.log("Promoted build/ to dist/");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
