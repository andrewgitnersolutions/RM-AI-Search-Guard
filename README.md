# RaiseMark: AI Search Controls for K-12

**Granular, Zero-PII, Zero-Cost Google Search AI Controls for K-12 School Districts**

> **Transparency & License Model:** Open-source under the **[MIT License](LICENSE)**. Every line of code is publicly inspectable so school district IT directors, privacy officers, and security teams can verify zero PII collection and zero external network traffic without vendor lock-in or third-party DPAs.

---

## What This Project Does

**RaiseMark: AI Search Controls for K-12** is a Manifest V3 Chrome extension and Google Admin Console deployment kit that restores granular, grade-level control over Google Search AI features (`AI Overviews`, `AI Mode` web/search buttons & tabs, direct `udm=50` / `google.com/ai` navigations, optional `udm=14` classic Web-only search, and auxiliary AI/Labs/Lens surfaces) across K–2, 3–5, 6–8, and 9–12 Organizational Units (OUs) and Groups.

### Core Design Pillars
* **Hybrid Defense-in-Depth for Omnibox & Search:** Pairs Chrome's native `AIModeSettings = 1` enterprise policy (removes Omnibox & New Tab Page AI Mode buttons cleanly on Chrome/ChromeOS 138+) with network-level `declarativeNetRequest` silent redirects (keeping the student's search query on `/aimode?q=…` and catching in-page single-page-app switches into AI Mode) and zero-flash `document_start` fail-closed DOM hiding—plus automatic `WARN_OMNIBOX_POLICY_MISSING` detection if an OU misses the native Chrome policy.
* **Strict Fail-Closed Defaults & Managed Lock:** Ships with all 6 protections enabled by default (`masterEnabled`, `hideAiOverviews`, `hideAiModeUi`, `blockAiModeNavigation`, `forceWebOnlySearch`, `hideAuxiliaryAiFeatures`). Force-installed devices stay strictly locked even before an OU policy JSON is pushed (`admin-no-policy`), local counter resets are blocked on managed devices, and minimum browser support is **Chrome / ChromeOS 134+** (full two-layer coverage on **138+**).
* **Zero PII & Absolute Least Privilege:** Strictly scoped to `https://www.google.com/*` and `https://google.com/*` with only `storage` and `declarativeNetRequestWithHostAccess` permissions. Zero external network requests, zero analytics servers, and zero `tabs`, `webRequest`, `webNavigation`, `identity`, `history`, or `<all_urls>` permissions.
* **Zero Hosting Cost Forever:** Runs 100% locally in Chrome with no backend servers, subscriptions, or external telemetry dependencies.
* **Zero District Maintenance Burden:** Multi-tier English + Spanish (`en*` / `es*`) semantic/ARIA/URL selector engine bundled inside the extension, with optional Admin Console `extraHideSelectors` hotfix overrides, visible-surface leak & unsupported-language diagnostics (`WARN_AI_SURFACE_VISIBLE`, `WARN_UNSUPPORTED_UI_LANGUAGE`), and automated static, unit, and Playwright browser test suites (`npm test` and `npm run test:browser`).

---

## Documentation Index

| # | Document | Purpose |
| :--- | :--- | :--- |
| **1** | [`docs/01-PRD-AND-SCOPE.md`](docs/01-PRD-AND-SCOPE.md) | Research brief, K-12 pain points, personas, scope boundaries, compliance posture, and Acceptance Criteria. |
| **2** | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) | System architecture, Mermaid diagrams (Surface Ownership, Sequence, DNR Priority Engine, Policy Resolution), security & privacy invariants. |
| **3** | [`docs/03-DEVELOPER-SPEC.md`](docs/03-DEVELOPER-SPEC.md) | Implementation spec: directory tree, `manifest.json`, `schema.json`, TypeScript types, DNR rules, multi-tier selector engine, error catalog, UI specs, and build/test scripts. |
| **4** | [`docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md`](docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md) | Step-by-step Google Admin Console deployment guide (`AIModeSettings`, force-install, K–2 / 3–5 / 6–8 / 9–12 policy JSON presets, troubleshooting). |
| **5** | [`docs/05-PHASE2-WATCHDOG-OPS-SPEC.md`](docs/05-PHASE2-WATCHDOG-OPS-SPEC.md) | Automated Canary & DOM maintenance workflow specification. |
| **6** | [`docs/07-BREAKPOINT-AUDIT-LOG.md`](docs/07-BREAKPOINT-AUDIT-LOG.md) | Active engineering roadmap, breakpoint audit log (`BP-01`–`BP-19`), owner decisions, and verification test matrix. |
| **7** | [`PRIVACY.md`](PRIVACY.md) | K-12 Privacy Policy (zero PII, 100% local-only processing, zero external network transmissions). |
| **8** | [`LICENSE`](LICENSE) | MIT License. |

---

## Contributing, Issues & Support

To keep this repository focused and free of spam for K-12 school districts, public comments, issues, and pull requests are restricted to approved contributors.

* **Report a Bug or Google DOM Change:** Email **[info@raisemarkai.com](mailto:info@raisemarkai.com)**
* **School District IT Deployment Questions:** Email **[info@raisemarkai.com](mailto:info@raisemarkai.com)**
* **Request Contributor Access:** If you would like to contribute code, selector updates, or translations, email **[info@raisemarkai.com](mailto:info@raisemarkai.com)** with your GitHub username and a brief description of your proposed contribution.

---

## License & Trademark Notice

### Source Code License (MIT)
The source code in this repository is licensed under the **[MIT License](LICENSE)** (`Copyright (c) 2026 RaiseMark AI`).

### Trademark & Brand Reservation
The MIT License applies solely to the source code and grants no trademark rights. **"RaiseMark"**, **"RaiseMark AI"**, **"RaiseMark: AI Search Controls for K-12"**, **"RaiseMark AI Search Guard"**, and the RaiseMark logos and extension icons are trademarks of **RaiseMark AI**.

You are free to fork, modify, and redistribute the source code under the terms of the MIT License, provided that you:
1. **Remove all RaiseMark branding, product names, and logos/icons** from any modified or redistributed builds.
2. **Do not publish or distribute** any fork, clone, or modified version under the "RaiseMark" name or branding on the Chrome Web Store or any other extension marketplace.

### Scope, Best-Effort UI Control & Non-Affiliation Disclaimer
* **Pedagogical UI Control (Not a Content Filter):** This extension is an instructional pacing and UI preference tool designed to help school districts manage generative AI features on Google Search by grade band. It is **not** a CIPA content filter, web filter, or child-safety monitoring system. Because Google Search HTML and URL parameters are controlled by Google LLC and may change at any time without notice, UI hiding and redirection are provided on a best-effort, `"AS IS"` basis under the [MIT License](LICENSE).
* **Non-Affiliation:** RaiseMark AI is an independent organization. This project is not affiliated with, endorsed by, or sponsored by Google LLC. Google, Google Search, Google Chrome, and ChromeOS are trademarks of Google LLC.
