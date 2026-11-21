/**
 * Diagnostic code catalog (ERR_* / WARN_*) with IT remediation text, plus log-entry helpers.
 * Runs in: service worker and options page.
 * Must never: put page text, URLs, queries or identifiers into an entry's detail.
 * Shared with: shared/storage.ts (diagnostic log), background/service-worker.ts, ui/options.ts.
 */

export const ALL_ERROR_CODES = [
  "ERR_POLICY_INVALID",
  "ERR_DNR_SYNC_FAILED",
  "ERR_SELECTOR_SYNTAX",
  "ERR_SAFETY_GUARD_TRIPPED",
  "ERR_STORAGE_FAILURE",
  "WARN_NO_MANAGED_POLICY",
  "WARN_OMNIBOX_POLICY_MISSING"
];

export const ERROR_CATALOG = {
  ERR_POLICY_INVALID: {
    code: "ERR_POLICY_INVALID",
    severity: "error",
    title: "Invalid Managed Policy Configuration",
    remediationTemplate: "One or more fields in your Google Admin Console 'Policy for extensions' JSON are invalid (fields: {detail}). Invalid boolean toggles fell back to locked-down ON. Regenerate valid JSON in the Admin Policy Generator tab and re-save under Devices > Chrome > Apps & extensions."
  },
  ERR_DNR_SYNC_FAILED: {
    code: "ERR_DNR_SYNC_FAILED",
    severity: "error",
    title: "Dynamic Redirect Rule Sync Failed",
    remediationTemplate: "Chrome rejected a dynamic redirect rule update ({detail}). Reload the extension or verify Chrome version is 120+. If persistent, copy diagnostics and report to RaiseMark Support."
  },
  ERR_SELECTOR_SYNTAX: {
    code: "ERR_SELECTOR_SYNTAX",
    severity: "error",
    title: "DOM Selector Validation Error",
    remediationTemplate: "A bundled DOM selector failed browser validation ({detail}). Other detection tiers remain active. Update to the latest RaiseMark AI Search Guard release."
  },
  ERR_SAFETY_GUARD_TRIPPED: {
    code: "ERR_SAFETY_GUARD_TRIPPED",
    severity: "error",
    title: "Organic Results Safety Guard Tripped",
    remediationTemplate: "Safety Guard prevented hiding core Google Search results ({detail}). Google likely changed its page structure. Check for an extension update."
  },
  ERR_STORAGE_FAILURE: {
    code: "ERR_STORAGE_FAILURE",
    severity: "error",
    title: "Extension Storage Read/Write Error",
    remediationTemplate: "Browser extension storage error ({detail}). Check Chrome profile disk quota or reload the browser."
  },
  WARN_NO_MANAGED_POLICY: {
    code: "WARN_NO_MANAGED_POLICY",
    severity: "warning",
    title: "No Google Admin Console Policy Detected",
    remediationTemplate: "No Google Admin Console policy detected. Strict Maximum Lockdown defaults are active (or local test toggles on unmanaged devices). To configure by grade level, paste JSON from the Admin Policy Generator into Devices > Chrome > Apps & extensions > Policy for extensions."
  },
  WARN_OMNIBOX_POLICY_MISSING: {
    code: "WARN_OMNIBOX_POLICY_MISSING",
    severity: "warning",
    title: "Chrome Native Omnibox AI Mode Policy Not Configured",
    remediationTemplate: "An AI Mode click arrived from Chrome's native Omnibox or New Tab Page and was silently blocked. To remove the native browser button itself, set AIModeSettings = 'Do not allow' (1) under Devices > Chrome > Settings > Users & browsers for this grade OU (Chrome/ChromeOS 138+)."
  }
};

/**
 * Fill a catalog remediation template with a cleaned detail string.
 * @param code - Catalog code; must exist in ERROR_CATALOG or this throws.
 * @param detail - Free-text detail; whitespace is collapsed and it is cut to 240 chars.
 * @returns Remediation text for IT.
 */
export function formatRemediation(code, detail) {
  const entry = ERROR_CATALOG[code];
  const sanitizedDetail = typeof detail === "string" && detail.trim().length > 0 ? detail.trim().replace(/\s+/g, " ").slice(0, 240) : "unspecified";
  return entry.remediationTemplate.replace("{detail}", sanitizedDetail);
}

/**
 * Return the UTC date bucket (YYYY-MM-DD) for a time.
 * @param now - Time to bucket; defaults to now.
 * @returns Date string. Day-level only, so no precise timestamp is ever stored or sent.
 */
export function getTodayDateBucket(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Build a new diagnostic log entry with count 1.
 * @param code - Catalog code; an unknown code throws (callers must pass catalog codes).
 * @param detail - Detail text (cleaned and capped at 240 chars).
 * @param dateBucket - Date bucket; defaults to today.
 * @returns The entry.
 */
export function createDiagnosticEntry(code, detail, dateBucket) {
  const catalogEntry = ERROR_CATALOG[code];
  const date = dateBucket ?? getTodayDateBucket();
  const cleanDetail = detail.trim().replace(/\s+/g, " ").slice(0, 240);
  return {
    code,
    severity: catalogEntry.severity,
    title: catalogEntry.title,
    detail: cleanDetail,
    remediation: formatRemediation(code, cleanDetail),
    count: 1,
    firstSeenDate: date,
    lastSeenDate: date
  };
}
