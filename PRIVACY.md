# Privacy Policy — RaiseMark AI Search Guard

**Effective Date:** November 20, 2026  
**Publisher:** RaiseMark AI  
**Contact:** andrew@raisemarkai.com

## Summary
RaiseMark AI Search Guard is designed from the ground up for K-12 student privacy compliance (**FERPA, COPPA, Illinois SOPPA, and NY Ed Law 2-d**). We collect **zero personally identifiable information (PII)** and **zero student search queries**. RaiseMark AI does not operate any central analytics server and never receives student or district browsing data.

## What Data Is Processed Locally
To perform its core function on `google.com`, the extension:
1. Reads school administrator settings pushed via Chrome Enterprise managed storage (`chrome.storage.managed`).
2. Inspects the visual layout of `google.com` pages strictly in-memory inside the student's browser to hide configured AI UI blocks. Page text and search queries are **never** stored, logged, or transmitted.
3. Maintains anonymous numeric counters locally on the device (`chrome.storage.local`), such as total AI Overviews hidden, AI Mode links redirected, and internal software error codes, along with local diagnostic messages to help school IT staff verify configuration.

## Optional District-Owned Analytics (Disabled by Default)
By default, **zero data ever leaves the device**. If a school district administrator explicitly enables `analyticsEnabled` and configures an `analyticsEndpointUrl` pointing to a **Google Apps Script Web App hosted inside the school district's own Google Workspace**, the extension periodically sends strictly anonymous daily aggregate counters:
- Schema version and extension version
- Configured Organizational Unit grade-band label (e.g., `K-2`, `3-5`, `6-8`, `9-12`)
- Calendar date bucket (`YYYY-MM-DD`, no finer timestamps)
- Aggregate integer counts of suppressed AI elements, redirected AI Mode navigations, and software error codes

This optional telemetry contains **no** student names, email addresses, Chrome profile IDs, device serial numbers, cookies, search terms, visited URLs, or third-party trackers. It is transmitted directly from the district's Chromebook to the district's own Google Workspace spreadsheet and is never received by RaiseMark AI or any third party.

## Third-Party Services & Data Sharing
RaiseMark AI Search Guard does not use third-party analytics SDKs, advertising networks, or external servers, and never sells or shares data with third parties.

## Data Retention & Deletion
Local anonymous counters remain in the browser's `chrome.storage.local` until cleared by IT staff via the Options → IT Diagnostics "Reset Local Counters" button or upon uninstalling the extension. Districts enabling the optional Google Sheets sink retain sole ownership and deletion control over their spreadsheet inside Google Workspace.

## Open-Source Verification
For complete transparency, the full source code of RaiseMark AI Search Guard is open source under the MIT License and publicly available for inspection by school district IT directors, security auditors, and privacy officers.

## Changes to This Policy
Material updates to this privacy policy will be published at this URL with a revised Effective Date.

## Contact
For K-12 privacy inquiries, security audits, or district deployment support, contact:  
**RaiseMark AI** — andrew@raisemarkai.com
