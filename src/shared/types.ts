/**
 * Shared TypeScript types for policy, telemetry and diagnostics.
 * Runs in: nowhere. This file holds only types, so esbuild emits nothing for it; import it
 * with `import type`.
 * Must never: hold runtime values. Anything here is erased at build time.
 * Shared with: every module under src/.
 */

import type { ALL_ERROR_CODES, ERROR_CATALOG } from "./errors";
import type { FEATURE_TOGGLE_KEYS, METRIC_KEYS, VALID_GRADE_BANDS } from "./defaults";

/** One of the six boolean protection toggles. */
export type ToggleKey = (typeof FEATURE_TOGGLE_KEYS)[number];

/** All six protection toggles. */
export type Toggles = Record<ToggleKey, boolean>;

/** A grade band from the schema, or "Unassigned". */
export type GradeBand = (typeof VALID_GRADE_BANDS)[number];

/** One aggregate counter name. */
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Aggregate counters (non-negative integers). */
export type Metrics = Record<MetricKey, number>;

/** A diagnostic catalog code. */
export type ErrorCode = (typeof ALL_ERROR_CODES)[number];

/** Catalog entry for one diagnostic code. */
export type CatalogEntry = (typeof ERROR_CATALOG)[ErrorCode];

/** Where the effective policy came from. */
export type PolicySource = "defaults" | "local-unmanaged" | "managed" | "managed-degraded";

/** The effective policy every bundle acts on. */
export interface EffectivePolicy extends Toggles {
  gradeBand: GradeBand;
  source: PolicySource;
  isManaged: boolean;
  invalidFields: string[];
  evaluatedAt: string;
}

/** A diagnostic produced while resolving policy, before it is logged. */
export interface PolicyError {
  code: ErrorCode;
  detail: string;
}

/** One entry in the stored diagnostic log. */
export interface DiagnosticEntry {
  code: ErrorCode;
  severity: string;
  title: string;
  detail: string;
  remediation: string;
  count: number;
  firstSeenDate: string;
  lastSeenDate: string;
}

/** Everything stored under STORAGE_KEYS.TELEMETRY. */
export interface TelemetryState {
  lifetimeMetrics: Metrics;
  diagnosticLog: DiagnosticEntry[];
}

/** Untrusted object read from storage or received in a message. */
export type RawRecord = Record<string, unknown>;

/** What GET_DIAGNOSTIC_SNAPSHOT returns to the Options page. */
export interface DiagnosticSnapshot {
  policy: EffectivePolicy;
  telemetry: TelemetryState;
  activeRuleCount: number;
  extensionVersion: string;
  generatedAtDate: string;
}
