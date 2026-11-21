# Privacy Policy — RaiseMark: AI Search Controls for K-12

**Effective Date:** November 21, 2026  
**Publisher:** RaiseMark AI  
**Contact:** info@raisemarkai.com

## Summary
**RaiseMark: AI Search Controls for K-12** is designed from the ground up for K-12 student privacy compliance (**FERPA, COPPA, Illinois SOPPA, and NY Ed Law 2-d**). The extension collects **zero personally identifiable information (PII)**, **zero student search queries**, and **makes zero external network requests**. No data ever leaves the student's device.

## What Data Is Processed Locally
To perform its core function on `google.com`, the extension:
1. Reads school administrator settings pushed via Chrome Enterprise managed storage (`chrome.storage.managed`).
2. Inspects the visual layout of `google.com` pages strictly in-memory inside the student's browser to hide configured AI UI blocks and redirect AI Mode URLs locally via `declarativeNetRequest`. Page text, URLs, and search queries are **never** stored, logged, or transmitted.
3. Maintains anonymous numeric counters locally on the device (`chrome.storage.local`), such as total AI Overviews hidden, AI Mode links redirected, and internal software error codes, along with local diagnostic messages (recording only minimal non-PII details—for example, a primary UI language subtag like `fr` for `WARN_UNSUPPORTED_UI_LANGUAGE`, or a category label like `overview`/`aimode` for `WARN_AI_SURFACE_VISIBLE`, never page text, queries, or URLs) to help school IT staff verify configuration on the device.

## No Telemetry or External Network Traffic
**Zero data ever leaves the device.** The extension does not contain any analytics beacons, remote logging, or external webhook endpoints, and its `host_permissions` are strictly limited to `https://www.google.com/*` and `https://google.com/*`. RaiseMark AI does not operate any telemetry server and never receives student or district browsing data.

## Third-Party Services & Data Sharing
RaiseMark: AI Search Controls for K-12 does not use third-party analytics SDKs, advertising networks, or external servers, and never collects, sells, or shares data with third parties.

## Data Retention & Deletion
Local anonymous diagnostic counters remain strictly inside the browser's local storage (`chrome.storage.local`) on the device. On managed/force-installed devices, **"Reset Local Counters"** is locked so students cannot tamper with local metrics (counters are removed when the extension is uninstalled or the browser profile is cleared); on unmanaged IT test installs, IT staff can clear them at any time via **Options → IT Diagnostics → "Reset Local Counters"**.

## Open-Source Verification
For complete transparency, the full source code of RaiseMark: AI Search Controls for K-12 is open source under the MIT License and publicly available for inspection by school district IT directors, security auditors, and privacy officers.

## Changes to This Policy
Material updates to this privacy policy will be published in this file with a revised Effective Date.

## Contact
For K-12 privacy inquiries, security audits, or district deployment support, contact:  
**RaiseMark AI** — info@raisemarkai.com
