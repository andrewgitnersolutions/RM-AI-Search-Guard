# 02 — System Architecture & Security Design

**Product:** RaiseMark Search Guard for K-12  
**Architecture Style:** Hybrid Defense-in-Depth (Chrome Enterprise Native Policy + MV3 Extension Network & DOM Layers + Zero-PII District BYOS Analytics)

---

## 1. High-Level Component & Surface Ownership Architecture

Chrome enforces a strict security boundary between **native browser UI** (Omnibox, `chrome://newtab`) and **web origins** (`https://www.google.com/*`). RaiseMark Search Guard resolves this cleanly by uniting Google Admin Console's native `AIModeSettings` policy with the extension's two runtime layers:

```mermaid
flowchart TB
    subgraph GAC["Google Admin Console (Per Grade-Band OU: K-2, 3-5, 6-8, 9-12)"]
        direction LR
        NAT["Native Chrome Policy\nAIModeSettings = 1\n(Chrome/ChromeOS 138+)"]
        MAN["Policy for Extensions\nJSON via schema.json\n(6 toggles + gradeBand + optional sink)"]
    end

    subgraph BROWSER["Managed Student Chromebook / Chrome Browser"]
        direction TB
        OMNI["Chrome Native UI\nOmnibox & chrome://newtab\nAI Mode Entry Buttons"]
        
        subgraph EXT["RaiseMark Search Guard (MV3 Extension)"]
            direction TB
            SW["Service Worker\n(Ephemeral, Zero RAM State)\n- Policy Resolver & Validator\n- Dynamic DNR Rule Builder\n- Alarm-Driven Analytics Flusher"]
            STOR_M[("chrome.storage.managed\n(Read-Only Admin Policy)")]
            STOR_L[("chrome.storage.local\n(Anonymous Counters,\nError Ring Buffer,\nUnmanaged Test State)")]
            DNR["Chrome declarativeNetRequest\n(C++ Network Stack)\nPriorities: 55 -> 50 -> 40 -> 30"]
            CS["Content Script + Static CSS\n(document_start on google.com)\n- Hash Telemetry Reader\n- Multi-Tier Selector Engine\n- Organic Results Safety Guard"]
            POP["popup.html\n(Strict 1-Line Notice\nwhen Managed)"]
            OPT["options.html\n- Status / Local Sandbox\n- IT Diagnostics & Errors\n- 4-Band Policy Generator"]
        end
    end

    subgraph DIST["District-Owned Google Workspace ($0 Cost, Optional)"]
        GAS["Google Apps Script Web App\n(Code.gs + LockService)"]
        SHEET[("District Google Sheet\nDaily Grade-Band Aggregates")]
    end

    NAT -->|"Hides Native Buttons"| OMNI
    MAN -->|"Synced by Chrome"| STOR_M
    STOR_M --> SW
    SW <--> STOR_L
    SW -->|"updateDynamicRules()"| DNR
    OMNI -.->|"Fallback if <138 or Policy Missing"| DNR
    DNR -->|"Silent Query-Preserving Redirect\n+ #rm_sg_aimode / #rm_sg_omnibox"| CS
    CS -->|"INCREMENT_METRIC / LOG_ERROR"| SW
    STOR_L --> OPT
    STOR_M --> POP
    STOR_M --> OPT
    SW -.->|"Optional Periodic Batch POST\n(text/plain, Zero PII)"| GAS
    GAS --> SHEET
```

---

## 2. End-to-End Request & DOM Interception Sequence

```mermaid
sequenceDiagram
    autonumber
    participant Student
    participant Chrome as Chrome Omnibox / Network (DNR)
    participant Google as google.com Server
    participant CS as Content Script (document_start)
    participant SW as Service Worker

    Note over Student,SW: Case A: Student clicks Omnibox AI Mode (when AIModeSettings missed) OR visits ?udm=50
    Student->>Chrome: Navigate to google.com/search?q=photosynthesis&udm=50&sourceid=chrome
    Chrome->>Chrome: DNR Priority 55 matches (sourceid=chrome + udm=50)
    Chrome->>Chrome: Strip udm/aep/arv (or set udm=14) + set client fragment #rm_sg_omnibox
    Note right of Chrome: Fragment #rm_sg_omnibox is NEVER sent to Google servers
    Chrome->>Google: GET /search?q=photosynthesis(&udm=14)
    Google-->>CS: HTML Stream Starts (document_start)
    CS->>CS: Read location.hash (#rm_sg_omnibox) & strip via history.replaceState()
    CS->>SW: sendMessage(RECORD_REDIRECT, { source: "omnibox" })
    SW->>SW: Increment aiModeRedirects & omniboxFallbackRedirects + Log WARN_OMNIBOX_POLICY_MISSING

    Note over Student,SW: Case B: Standard Google Search Page Render
    CS->>SW: Read effective policy (managed -> local -> strict defaults)
    CS->>CS: Set html[data-rmsg-hide-overviews="1"] etc. (activates static-guard.css pre-paint)
    Google-->>CS: DOM nodes stream & hydrate asynchronously
    CS->>CS: MutationObserver -> rAF batch -> Tier 1 Semantic + Tier 2 Structural matching
    CS->>CS: Organic Safety Guard checks candidate container (< 3 organic h3 links)
    CS->>CS: Hide matched containers (idempotent via data-rmsg-hidden="1")
    CS->>SW: sendMessage(INCREMENT_METRICS, { overviewsHidden, aiModeUiHidden, auxAiHidden })
```

---

## 3. Declarative Net Request (DNR) Priority & Loop-Freedom Architecture

Chrome's `declarativeNetRequest` uses Google's **RE2** regex engine (which intentionally forbids negative lookaheads `(?!...)` to prevent catastrophic backtracking). To guarantee **zero redirect loops** while supporting BOTH `blockAiModeNavigation` and optional `forceWebOnlySearch` (`udm=14`) without breaking Google Images (`udm=2`), Videos (`udm=7`), Shopping (`udm=28`), or News (`tbm=nws`), dynamic rules are structured into **4 strict priority tiers**:

```mermaid
flowchart TD
    REQ["Main-Frame Navigation to google.com"] --> P55{"Priority 55 (Rules 101-102)\nblockAiModeNavigation=true AND\nudm=50 + (sourceid=chrome OR aep=)?"}
    P55 -->|"Yes"| ACT55["REDIRECT\nStrip aep/arv/mstk/csuir\nforceWebOnly ? udm=14 : remove udm\nSet fragment #rm_sg_omnibox"]
    P55 -->|"No"| P50A{"Priority 50 (Rule 110)\nblockAiModeNavigation=true AND\nudm=50?"}
    P50A -->|"Yes"| ACT50A["REDIRECT\nStrip aep/arv/mstk/csuir\nforceWebOnly ? udm=14 : remove udm\nSet fragment #rm_sg_aimode"]
    P50A -->|"No"| P50B{"Priority 50 (Rule 111)\nblockAiModeNavigation=true AND\npath /ai or /aimode?"}
    P50B -->|"Yes"| ACT50B["REDIRECT\nhttps://www.google.com/#rm_sg_aimode"]
    P50B -->|"No"| P40{"Priority 40 (Rule 120)\nforceWebOnlySearch=true AND\nURL already has udm= or tbm=?"}
    P40 -->|"Yes"| ACT40["ALLOW (Terminal)\nPreserves udm=14 (stops loop),\nudm=2 Images, udm=7 Videos,\ntbm=nws News, tbm=bks Books"]
    P40 -->|"No"| P30{"Priority 30 (Rule 130)\nforceWebOnlySearch=true AND\n/search?...q=?"}
    P30 -->|"Yes"| ACT30["REDIRECT\naddOrReplaceParams: udm=14"]
    P30 -->|"No"| PASS["Allow Normal Request"]
```

### Formal Loop-Freedom Proof
1. Any redirect emitted by **Priority 55 or 50** removes `udm=50` (either removing `udm` completely or replacing it with `udm=14`). Therefore, on the redirected request, Rules `101`, `102`, `110`, and `111` **cannot match again**.
2. If `forceWebOnlySearch === true`, the redirected request has `udm=14` (or `/search?q=...` gets `udm=14` from Priority 30). On the subsequent load, **Priority 40 (`allow`)** matches `udm=` and terminates rule evaluation before Priority 30.
3. Therefore, every URL converges in **at most 1 redirect hop** (2 hops only in the theoretical edge case where an admin enables `blockAiModeNavigation=true`, `forceWebOnlySearch=false`, and the user visits `/ai` -> `/` which doesn't match `/search`). Zero infinite loops are mathematically possible.

---

## 4. Policy Resolution & Fail-Closed State Machine

```mermaid
flowchart LR
    START["Load Policy\n(SW Startup / storage.onChanged / Tab Load)"] --> READ_M["Read chrome.storage.managed"]
    READ_M --> HAS_M{"Any managed keys\npresent?"}
    HAS_M -->|"Yes"| VALID{"Validate against\nPolicy Schema"}
    VALID -->|"All Valid"| USE_M["Source = 'managed'\nApply Admin Toggles\n(Popup = Strict 1-Line Managed)"]
    VALID -->|"Partial / Invalid Keys"| MERGE_SAFE["Source = 'managed-degraded'\nValid keys kept;\nInvalid/missing booleans -> TRUE (Lockdown)\nLog ERR_POLICY_INVALID"]
    HAS_M -->|"No"| READ_L["Read chrome.storage.local\n(Unmanaged Admin Testing Mode)"]
    READ_L --> HAS_L{"Local test overrides\nsaved?"}
    HAS_L -->|"Yes"| USE_L["Source = 'local-unmanaged'\nApply Local Toggles\nLog WARN_NO_MANAGED_POLICY"]
    HAS_L -->|"No"| USE_DEF["Source = 'defaults'\nApply Strict Maximum Lockdown\n(All 6 Toggles = TRUE)\nLog WARN_NO_MANAGED_POLICY"]
```

### Critical Security Invariant (Anti-Tampering)
When `chrome.storage.managed` contains **any** policy object pushed by Google Admin Console:
* `chrome.storage.local` toggle overrides are **completely ignored** at runtime.
* `popup.html` renders **strictly** the locked 1-line *"Managed by your school"* view.
* `options.html` renders all feature toggles as `disabled` read-only indicators.
* Students have zero mechanism in Chrome UI (when force-installed) or extension UI to weaken protections.

---

## 5. Zero-PII, Zero-Cost District Analytics Data Flow

```mermaid
flowchart LR
    subgraph CHROMEBOOK["Student Chromebook (1 of N)"]
        EV["Suppression / Redirect / Error Event"] --> AGG["chrome.storage.local\nDaily Bucket Map:\nmetricsByDate['YYYY-MM-DD']\nerrorsByCode['ERR_*']"]
        ALARM["chrome.alarms\n(Interval + Random 0-30m Jitter)"] --> CHECK{"analyticsEnabled=true AND\nValid Apps Script URL AND\nPending Counts > 0?"}
        AGG --> CHECK
        CHECK -->|"No"| IDLE["Stay Local-Only\n(Zero Network Traffic)"]
        CHECK -->|"Yes"| POST["fetch(url, POST)\nContent-Type: text/plain;charset=utf-8\nredirect: 'follow'\nPayload: Strictly Allowlisted Counts"]
        POST -->|"HTTP 200 & {status:'ok'}"| CLEAR["Subtract Flushed Delta\nUpdate lastFlushSuccessAt"]
        POST -->|"Failure / 429 / 5xx"| BACKOFF["Keep Pending Counts\nExponential Backoff\nLog ERR_ANALYTICS_FLUSH_FAILED"]
    end

    subgraph DISTRICT["District Google Workspace ($0)"]
        POST --> GAS["Apps Script doPost(e)\n1. Validate sharedToken\n2. LockService.getScriptLock()\n3. Reject unexpected/PII keys\n4. Upsert daily gradeBand row"]
        GAS --> SHEET[("Google Sheet\nTab 1: Daily_Rollup\nTab 2: Error_Summary\nTab 3: Dashboard Charts")]
    end
```

### Privacy & Thundering-Herd Safeguards
1. **Strict Payload Schema Whitelist:** No student email, no username, no browser fingerprint, no device ID, no IP stored in Sheets, no search query strings, no exact event timestamps—only `dateBucket` (`YYYY-MM-DD`), `gradeBand`, `extensionVersion`, and integer counters.
2. **Endpoint Allowlist Regex:** Service worker refuses to POST to any URL that does not strictly match `^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$`, logging `ERR_ANALYTICS_ENDPOINT_INVALID`.
3. **Thundering-Herd Protection:** A 10,000-Chromebook district booting at 8:00 AM would overwhelm Apps Script's ~30 concurrent execution ceiling if synced simultaneously. Our scheduler adds **uniform random jitter (0–30 minutes)** on every alarm cycle, caps retries with exponential backoff (up to 24h), and uses `LockService.getScriptLock().waitLock(15000)` in `Code.gs`.
4. **Atomic Delta Accounting:** When flushing, the service worker snapshots the pending counters (`snapshot`), sends `snapshot`, and upon HTTP 200 subtracts `snapshot` from current `chrome.storage.local` totals (never blindly zeroing, so events occurring during the HTTP round-trip are never lost!).

---

## 6. Permission Minimization Matrix

| Manifest Field | Exact Value | Why Required (Least-Privilege Justification) |
| :--- | :--- | :--- |
| `permissions` | `"storage"` | Read Admin Console policies (`chrome.storage.managed`) and store anonymous local counters & diagnostic error logs (`chrome.storage.local`). |
| `permissions` | `"declarativeNetRequestWithHostAccess"` | Dynamically enable/disable silent redirects for `udm=50`, `google.com/ai`, and optional `udm=14` based on the active grade-band policy. |
| `permissions` | `"alarms"` | Schedule jittered periodic background flushes to the optional district-owned Google Apps Script webhook without violating MV3 ephemeral service worker rules. |
| `host_permissions` | `"https://www.google.com/*"`, `"https://google.com/*"` | Required for `declarativeNetRequest` redirects and content-script DOM suppression strictly on U.S. Google Search. |
| `host_permissions` | `"https://script.google.com/*"`, `"https://script.googleusercontent.com/*"` | Required ONLY to allow background service-worker POSTs (and 302 redirects) when a district administrator explicitly configures an Apps Script analytics webhook URL in managed policy. Never contacted unless configured. |
| **Explicitly Omitted** | `tabs`, `webRequest`, `webNavigation`, `identity`, `cookies`, `history`, `scripting`, `<all_urls>` | **Not needed.** Fragment handoff (`#rm_sg_*`) + content scripts + `storage.managed` eliminate every sensitive permission. |
