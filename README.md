# E2E Recorder v2

A browser extension for **Firefox** and **Chrome** that records user interactions on any website and exports them as ready-to-run automated test scripts.

[![Firefox](https://img.shields.io/badge/Firefox-140%2B-orange?logo=firefox)](https://addons.mozilla.org)
[![Chrome](https://img.shields.io/badge/Chrome-88%2B-blue?logo=googlechrome)](https://chrome.google.com/webstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple)](LICENSE)

---

## Supported export frameworks

| Framework | Language | File extension |
|-----------|----------|---------------|
| Playwright | TypeScript | `.spec.ts` |
| Playwright | Python | `.spec.py` |
| Cypress | JavaScript | `.spec.js` |
| Selenium WebDriver | JavaScript | `.js` |

---

## Features

### Recording
- **One-click recording** — captures clicks, text input, keypresses, hover, scroll, drag-and-drop, file upload, and native `<select>` changes.
- **400 ms debounce on fill** — groups rapid keystrokes into a single `fill` event per field.
- **Sensitive data masking** — password fields and inputs matching credential patterns (`api_key`, `token`, `cvv`…) are automatically replaced with `ENV_SECRET_PARAM`. The real value is never stored.
- **Multi-tab tracking** — detects new tabs opened by clicks (OAuth pop-ups, `target="_blank"`) and emits the correct new-page-wait code for each framework.
- **SPA navigation** — listens to `pushState` / `popstate` / hash changes in addition to full page loads.

### Selector engine
- **Stability scoring** — ranks every possible locator and picks the most stable one automatically:

  | Attribute | Score |
  |-----------|------:|
  | `data-testid` / `data-cy` | 100 |
  | Static `id` | 85 |
  | `aria-label` | 75 |
  | `role` | 72 |
  | `name` | 70 |
  | `placeholder` | 65 |
  | Visible text | 60 |
  | First CSS class | 30 |
  | Tag name | 10 |
  | `nth-child` (fallback) | 5 |

  Dynamic IDs/classes (≥ 3 consecutive digits, `css-`, `Mui`, `chakra-`, `ng-`) receive a −50 penalty.

- **Traffic-light overlay** — while recording, a coloured outline on the hovered element shows selector quality in real time (green ≥ 75 · amber 40–74 · red < 40).
- **Shadow DOM** — builds `host >>> inner` chains for elements inside shadow roots.
- **Iframe chains** — attaches the full `frameChain` array to events inside nested frames.

### Selector candidates panel
Each recorded action captures up to **6 alternative selectors**. Expand the ⚙ panel on any event row to:
- **Test** a candidate against the live page — see how many elements it matches and highlight them.
- **Use** a candidate to replace the active selector.
- **Discard** a candidate to remove it permanently.

Use **⊞ Expand all** / **⊟ Collapse all** in the editor toolbar to manage all panels at once.

### Event editor
- **Delete** any step with the 🗑 button.
- **Reorder** steps by dragging the ☰ handle.
- **Edit selectors inline** — click any selector text to edit it; real-time uniqueness validation against the active tab (green = unique, amber = multiple matches, red = not found).
- **Insert new steps** between existing events — hover between rows to reveal the ➕ zone and fill in the inline form (supported types: `navigate`, `click`, `fill`, `keypress`, `hover`, `scroll`, `selectOption`, `wait`).

### Assertion engine
After each recorded action the extension watches for significant DOM changes and auto-suggests assertions:

| Trigger | Suggested assertion |
|---------|---------------------|
| URL changed | `toHaveURL` |
| Toast / alert / snackbar appeared | `toBeVisible` |
| Modal (`role="dialog"`) appeared | `toBeVisible` |
| Element disappeared | `toBeHidden` |

Accept (✓) or discard (✗) each suggestion — only accepted ones appear in the exported code.

### Replay
Click **▶ Test** to replay the full recorded session against the live page. Each step shows a real-time status indicator:

| Symbol | Meaning |
|--------|---------|
| ✓ | Step passed |
| ✗ | Selector not found or action failed |
| ⟳ | Step currently executing |
| – | Step skipped (e.g. `navigate`, `closeContext`) |

Failed rows are highlighted in red. Fix the selector and re-run without re-recording.

### Export options
- **Page Object Model** — generates a separate class file per page/view alongside the test script.
- **Copy to clipboard** or **download** as a file (ZIP if POM is enabled and multiple files are generated).

### Logs panel
A dedicated **Logs** tab in the popup captures diagnostic messages from all three extension contexts (background, content script, popup) with level (`INFO` / `WARN` / `ERROR` / `DEBUG`) and source filtering. Useful for troubleshooting recording issues without opening DevTools.

---

## Installation

### Firefox (from XPI)

1. Run the build script to produce the XPI:
   ```
   build.cmd          # Windows
   ./build.sh         # macOS / Linux
   ```
   Output: `dist/e2e-recorder-v2.xpi`

2. Open Firefox → `about:addons` → gear icon ⚙ → **Install Add-on From File…**
3. Select `dist/e2e-recorder-v2.xpi` and confirm.

> **Temporary load (development):** Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on…** → select `manifest.json`. The extension is removed on restart.

**Minimum version:** Firefox 140+

---

### Chrome / Edge (unpacked)

1. Run the Chrome build script:
   ```
   build_Chrome.cmd   # Windows
   ./build_Chrome.sh  # macOS / Linux
   ```
   Output: `dist/e2e-recorder-v2-chrome.zip`

2. Unzip the file into an empty folder (e.g. `dist/chrome-unpacked/`).
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the unzipped folder.

**Minimum version:** Chrome / Edge 88+

---

## Build scripts

| Script | Platform | Output |
|--------|----------|--------|
| `build.cmd` / `build.ps1` | Windows | `dist/e2e-recorder-v2.xpi` |
| `build.sh` | macOS / Linux | `dist/e2e-recorder-v2.xpi` |
| `build_Chrome.cmd` / `build_Chrome.ps1` | Windows | `dist/e2e-recorder-v2-chrome.zip` |
| `build_Chrome.sh` | macOS / Linux | `dist/e2e-recorder-v2-chrome.zip` |

No build tools, transpilers, or package managers are required. The scripts zip the source files as-is.

---

## Usage

### 1 · Start recording

1. Navigate to the page you want to test.
2. Click the **E2E Recorder** toolbar icon.
3. Click **⏺ Record** — the status dot turns red and blinks.
4. Interact with the page (click, type, navigate…).
5. Click **⏹ Stop Recording** when done.

### 2 · Review and edit

- Open the **⚙ Selectors** panel on any row to test alternative selectors.
- Click a selector text to edit it inline.
- Hover between rows and click **➕** to insert a manual step.
- Accept or discard assertion suggestions below the relevant events.

### 3 · Replay (optional)

Click **▶ Test** to run the session against the live page and verify all selectors still work before exporting.

### 4 · Export

1. Choose a framework tab: **PW-TS** · **PW-PY** · **Cypress** · **Selenium**.
2. Optionally enable **Page Object Model**.
3. Click **⎘ Copy** or **⬇ Download**.

---

## Project structure

```
E2ERecorder/
├── manifest.json              Firefox MV3 manifest
├── manifest_chrome.json       Chrome / Edge MV3 manifest
├── background.js              Background orchestrator — state writer, message router
├── content.js                 Content script — DOM listeners, selector engine, replay
├── popup.html                 Extension popup markup
├── popup.css                  Popup styles
├── popup.js                   Popup controller — rendering, event wiring, export UI
├── modules/
│   ├── state-store.js         browser.storage.local abstraction (StateStore)
│   ├── selectors.js           SelectorEngine — scoring, Shadow DOM, iframe chains
│   ├── compilers.js           Code generators for all four frameworks
│   └── assertion-engine.js    Post-event DOM/URL observer and suggestion engine
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── docs/
│   ├── TECHNICAL_SPEC.md      Full technical specification
│   ├── E2E_Recorder_v2_User_Manual.docx
│   ├── privacy-policy.html    Hosted privacy policy
│   ├── store-listing-firefox.md
│   ├── store-listing-chrome.md
│   └── PUBLISHING.md
├── build.ps1 / build.cmd / build.sh
└── build_Chrome.ps1 / build_Chrome.cmd / build_Chrome.sh
```

---

## Architecture

```
Content script (all tabs/frames)
        │  RECORD_EVENT, LOG_ENTRY, ADD_ASSERTION
        ▼
Background (service worker / classic page)
        │  read → mutate → write → broadcast STATE_UPDATED
        ▼
browser.storage.local  ←── single source of truth
        │
        ▼
Popup UI  ←── re-renders on every STATE_UPDATED
```

**Key invariants:**
- Only `background.js` writes to `storage.local`. Content scripts and the popup send messages requesting mutations; they never write directly.
- No in-memory state in the background — every handler reads fresh state from storage before acting. This survives service-worker restarts (Chrome) and accidental browser closure.
- The Chrome/Firefox API shim (`if (typeof browser === 'undefined') { var browser = chrome; }`) is the only platform-specific code; it appears at the top of every JS file.

---

## Known limitations

| Area | Limitation |
|------|-----------|
| Cross-origin iframes | The traffic-light overlay cannot appear inside cross-origin frames (browser security). Event capture still works because the content script is injected directly into the frame. |
| File upload paths | The absolute file path cannot be captured (browser security). A `PLACEHOLDER_REPLACE_WITH_REAL_PATH/<filename>` token is generated; replace it with the real fixture path. |
| Selenium + Shadow DOM | Selenium has no native shadow-piercing API. Generated code uses `executeScript` with an explanatory comment. |
| Cypress + multi-tab | Cypress has limited multi-tab support. The generated script includes a `cy.origin()` suggestion and a warning comment. |
| Canvas / WebGL drag targets | If the drag target is a `<canvas>`, only screen coordinates are captured — no CSS selector. |
| Firefox minimum version | `data_collection_permissions` requires Firefox 140+ (desktop) and 142+ (Android). |

---

## Privacy

**100% local. No data ever leaves your device.**

- Zero outbound network requests — no analytics, no telemetry, no external scripts.
- All recorded data is stored exclusively in `browser.storage.local` (sandboxed to the extension).
- Password fields and credential inputs are masked before storage and never written in plain text.
- Uninstalling the extension removes all associated storage automatically.

Full policy: [`docs/privacy-policy.html`](docs/privacy-policy.html)

---

## License

MIT — see [LICENSE](LICENSE).
