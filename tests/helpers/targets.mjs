/**
 * Which built extension folders the tests run against.
 * Runs in: Node test runner only.
 *
 * RM_TARGETS is a comma list of folders relative to the repo root (default: "build").
 * With two or more targets, every equivalence test also checks that all targets give
 * identical results (the Phase 0 gate: RM_TARGETS=baseline-dist,build).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Resolve RM_TARGETS into target descriptors.
 * @returns {{ name: string, dir: string }[]} Targets; throws if the list is empty or a folder
 * is missing, so a typo can't silently shrink the comparison.
 */
export function getTargets() {
  const names = (process.env.RM_TARGETS ?? "build").split(",").map((s) => s.trim()).filter(Boolean);
  // A set-but-empty RM_TARGETS (e.g. " , ") would run every equivalence test with nothing to test.
  if (names.length === 0) throw new Error("RM_TARGETS names no target folders. Unset it to test build/.");
  return names.map((name) => {
    const dir = path.join(ROOT, name);
    if (!existsSync(path.join(dir, "manifest.json"))) {
      throw new Error(`Test target "${name}" has no manifest.json. Run \`npm run build\` first.`);
    }
    return { name, dir };
  });
}

export const TARGETS = getTargets();
