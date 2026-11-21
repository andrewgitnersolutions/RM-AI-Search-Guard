# RaiseMark AI Search Guard

**Granular, Zero-PII, Zero-Cost Google Search AI Controls for K-12 School Districts**

> **Transparency & License Model:** Open-source under the **[MIT License](LICENSE)**. Every line of code is publicly inspectable so school district IT directors, privacy officers, and security teams can verify zero PII collection and zero unauthorized network traffic without vendor lock-in or third-party DPAs.

---

## What This Project Does

**RaiseMark AI Search Guard** is a Manifest V3 Chrome extension and Google Admin Console deployment kit that restores granular, grade-level control over Google Search AI features (`AI Overviews`, `AI Mode` web/search buttons & tabs, direct `udm=50` / `google.com/ai` navigations, optional `udm=14` classic Web-only search, and auxiliary AI/Labs/Lens surfaces) across K–2, 3–5, 6–8, and 9–12 Organizational Units (OUs) and Groups.

### Core Design Pillars
* **Hybrid Defense-in-Depth for Omnibox & Search:** Pairs Chrome's native `AIModeSettings = 1` enterprise policy (removes Omnibox & New Tab Page AI Mode buttons cleanly on Chrome/ChromeOS 138+) with network-level `declarativeNetRequest` silent redirects and zero-flash `document_start` DOM hiding—plus automatic `WARN_OMNIBOX_POLICY_MISSING` detection if an OU misses the native Chrome policy.
* **Strict Fail-Closed Defaults:** Ships with all 6 protections enabled by default (`masterEnabled`, `hideAiOverviews`, `hideAiModeUi`, `blockAiModeNavigation`, `forceWebOnlySearch`, `hideAuxiliaryAiFeatures`) until an admin explicitly loosens toggles per grade-band OU.
* **Zero PII & Absolute Least Privilege:** Strictly scoped to `google.com` (+ optional district-owned `script.google.com` analytics sink). Zero `tabs`, `webRequest`, `webNavigation`, `identity`, `history`, or `<all_urls>` permissions.
* **Zero Hosting Cost Forever:** Runs 100% locally in Chrome; optional district-wide aggregate analytics flush to a **district-owned Google Sheet + Google Apps Script Web App** inside the school district's own Google Workspace.
* **Zero District Maintenance Burden:** Multi-tier semantic/ARIA/URL selector engine bundled inside the extension, backed by an automated paired Control-vs-Treatment Playwright Canary suite (`npm run canary`) and a Phase 2 daily Antigravity self-healing workflow.

---

## Specification Suite Index

Read these documents in order before running the 1-shot MVP build:

| # | Document | Purpose |
| :--- | :--- | :--- |
| **1** | [`docs/01-PRD-AND-SCOPE.md`](docs/01-PRD-AND-SCOPE.md) | Research brief, K-12 pain points, personas, Phase 1 vs Phase 2 scope boundaries, compliance posture, and Acceptance Criteria (`AC-01`–`AC-18`). |
| **2** | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) | System architecture, Mermaid diagrams (Surface Ownership, Sequence, DNR Priority Engine, Policy Resolution, Zero-PII Analytics), security & privacy invariants. |
| **3** | [`docs/03-DEVELOPER-SPEC.md`](docs/03-DEVELOPER-SPEC.md) | Exact 1-shot implementation spec: directory tree, `manifest.json`, `schema.json`, TypeScript types, DNR rules, multi-tier selector engine, error catalog, UI specs, Apps Script template, build/test/canary scripts. |
| **4** | [`docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md`](docs/04-ADMIN-DEPLOYMENT-RUNBOOK.md) | Step-by-step Google Admin Console deployment guide (`AIModeSettings`, force-install, K–2 / 3–5 / 6–8 / 9–12 policy JSON presets, district Google Sheets analytics setup, troubleshooting). |
| **5** | [`docs/05-PHASE2-WATCHDOG-OPS-SPEC.md`](docs/05-PHASE2-WATCHDOG-OPS-SPEC.md) | Phase 2 daily local Antigravity Canary automation, interactive DOM repair (`chrome_devtools` MCP / `@playwright/mcp`), click-through video demo verification, CWS Draft upload & `andrew@raisemarkai.com` approval gate. |
| **6** | [`PRIVACY.md`](PRIVACY.md) | K-12 Privacy Policy (zero PII, local-first storage, optional district-owned analytics sink). |
| **7** | [`LICENSE`](LICENSE) | MIT License. |

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
