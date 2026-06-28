# E2E Recorder v2 — User Guide

**Version 2.0.0 · Works on Firefox 109+ and Chrome/Edge 88+**

E2E Recorder v2 captures your browser interactions and converts them into production-ready automated test scripts for **Playwright**, **Cypress**, and **Selenium** — no AI, no cloud, no external dependencies.

---

## Table of Contents

1. [Installation](#1-installation)
2. [Quick Start](#2-quick-start)
3. [The Popup Interface](#3-the-popup-interface)
4. [Recording](#4-recording)
5. [Selectors and the Traffic-Light Overlay](#5-selectors-and-the-traffic-light-overlay)
6. [Editing Your Recording](#6-editing-your-recording)
7. [Selector Candidates](#7-selector-candidates)
8. [Assertions](#8-assertions)
9. [Step Replay](#9-step-replay)
10. [Exporting Test Code](#10-exporting-test-code)
11. [Multi-Tab Recording](#11-multi-tab-recording)
12. [The Logs Panel](#12-the-logs-panel)
13. [Supported Events](#13-supported-events)
14. [Keyboard Shortcuts](#14-keyboard-shortcuts)
15. [Known Limitations](#15-known-limitations)

---

## 1. Installation

### Firefox
1. Download or build the `.xpi` file (run `build.cmd` or `build.ps1` on Windows, `build.sh` on Linux/macOS).
2. Open `about:addons` → click the gear icon → **Install Add-on From File…**
3. Select `dist/e2e-recorder-v2.xpi`.

### Chrome / Edge
1. Download or build the `.zip` file (run `build_Chrome.cmd` or `build_Chrome.ps1` on Windows, `build_Chrome.sh` on Linux/macOS).
2. Unzip the file into any folder (e.g. `dist/chrome/`).
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the unzipped folder.

After installation the extension icon appears in your browser toolbar.

---

## 2. Quick Start

```
1. Navigate to the page you want to test
2. Click the E2E Recorder icon in the toolbar
3. Click  ● Record
4. Interact with the page normally (click, type, navigate…)
5. Click  ■ Stop
6. Choose a framework (Playwright TS, Cypress, etc.)
7. Click  Copy  or  Download
```

That's it. Paste the generated code into your test project and run it.

---

## 3. The Popup Interface

The popup has two main panels accessible via the tab bar at the top:

| Panel | Purpose |
|---|---|
| **Recorder** | Controls, event list, assertion cards, export section |
| **Logs** | Diagnostic messages from background, content script, and popup |

### Header area

| Element | Description |
|---|---|
| Status dot | Grey = idle · Red pulsing = recording · Different color = assertion mode |
| Tab counter | Shows how many browser tabs are part of the current session |
| Status text | Human-readable description of the current state |
| Event count | Total number of recorded steps |

### Recorder panel controls

| Button | Action |
|---|---|
| **● Record** | Start a new recording session (clears any previous session) |
| **■ Stop** | Stop the current recording |
| **✦ Assertion Mode** | Toggle assertion-capture mode (click elements to add checks) |
| **▶ Test** | Replay all recorded steps against the active tab |
| **Clear** | Delete all recorded events and reset the session |

---

## 4. Recording

1. Open the page you want to test in your browser.
2. Click the extension icon and press **● Record**.
3. Perform the actions you want to test:
   - Click buttons, links, and elements
   - Type into input fields and text areas
   - Select dropdown options
   - Drag and drop elements
   - Upload files
   - Navigate between pages
4. Press **■ Stop** when finished.

> **Tip:** You do not need to keep the popup open while recording. You can close it after pressing Record and reopen it to Stop.

### What gets recorded automatically

| Interaction | Notes |
|---|---|
| Click | Any element click |
| Fill (type) | Input/textarea text, debounced 400 ms — one event per typing burst |
| Key press | Enter, Tab, Escape, arrow keys, Ctrl/Cmd combinations |
| Hover | Only recorded when hovering causes a visible DOM change (tooltip, dropdown, etc.) |
| Scroll | Only recorded when scrolling loads new content (infinite scroll pattern) |
| Drag and drop | Source and target selectors (or coordinates for canvas targets) |
| File upload | File name captured; full path is replaced with a placeholder |
| Select option | Native `<select>` element changes |
| Navigate | Page loads, SPA route changes (history.pushState / popstate) |
| New tab | Detected automatically when a click opens a new tab |

### Sensitive data

Password fields and inputs whose `name` or `id` match patterns like `password`, `token`, `api_key`, or `cvv` are **automatically masked**. The recorded value is replaced with `ENV_SECRET_PARAM`. The real value is never stored anywhere.

---

## 5. Selectors and the Traffic-Light Overlay

While recording is active, a coloured outline appears around the element under your cursor:

| Colour | Meaning |
|---|---|
| 🟢 Green | High-quality selector (score ≥ 75) — `data-testid`, `id`, `aria-label` |
| 🟡 Amber | Medium-quality selector (score 40–74) — `role`, `name`, `placeholder`, visible text |
| 🔴 Red | Low-quality selector (score < 40) — positional, class-based, or unstable |

The selector engine prioritises attributes in this order:

```
data-testid / data-cy  →  id  →  aria-label  →  role  →  name
→  placeholder  →  visible text  →  class  →  tag  →  nth-child
```

Selectors containing numeric hashes, `css-`, `Mui`, `chakra-`, `ng-`, or `star-` patterns are penalised as unstable.

**Shadow DOM** elements are handled automatically using `>>>` piercing notation. **iframe** elements are tracked through a frame chain so that the generated code navigates into the correct frame before acting.

---

## 6. Editing Your Recording

After stopping, the event list shows all recorded steps. Each row displays:

- A colour-coded **type badge** (click, fill, nav, key, hover…)
- A **health dot** (green/amber/red) showing selector quality
- The **selector** or URL
- The **value** (for fill, keypress, selectOption)
- A **⚙ N** button if alternative selector candidates are available
- A **🗑 delete** button

### Delete a step
Click the 🗑 button on any row.

### Reorder steps
Drag any row by its **≡ handle** on the left to a new position.

### Edit a selector inline
Click on the selector text in any row. An input field appears with real-time validation:
- **Green border** — selector is valid and unique on the current page
- **Amber border** — selector matches more than one element
- **Red border** — selector matches nothing

Press **Enter** to confirm or **Escape** to cancel.

### Insert a new step
Click the **+** button that appears between rows (or before the first / after the last row). A form lets you choose an action type and fill in the required fields:

| Action | Fields |
|---|---|
| Navigate | URL |
| Click | CSS selector |
| Fill | CSS selector + text value |
| Key press | CSS selector (optional) + key name |
| Hover | CSS selector |
| Scroll | Container selector (blank = window) + scroll amount in px |
| Select option | `<select>` CSS selector + option value |
| Wait | Duration in milliseconds |

### Expand / Collapse all candidate panels
When any event has selector candidates, the toolbar shows **⊞ Expand all** and **⊟ Collapse all** buttons to open or close all candidate panels at once.

---

## 7. Selector Candidates

Every recorded click or interaction captures up to **6 alternative selectors** in addition to the primary one. To inspect them:

1. Click the **⚙ N** button on an event row (N = number of alternatives).
2. A panel appears below the row showing each candidate with its score.

For each candidate you can:

| Button | Action |
|---|---|
| **Test** | Validates the selector against the current page and shows how many elements it matches. Matching elements are briefly highlighted with a purple outline. |
| **Use** | Sets this selector as the active one for this event. |
| **✕** | Removes this candidate from the list permanently. |

**Test result indicators:**
- `✓ unique` — selector matches exactly one element (ideal)
- `~ N matches` — selector matches N elements (may be too broad)
- `✗ not found` — selector matches nothing on the current page

---

## 8. Assertions

Assertions are checks that your test verifies after an action. E2E Recorder suggests assertions automatically and lets you add them manually.

### Automatic assertion suggestions

After each click or fill, the extension observes the page for 800 ms. If it detects any of the following, a suggestion card appears below the triggering event:

| Change detected | Assertion type |
|---|---|
| URL changed | `URL equals "…"` |
| A toast, notification, or alert appeared | `Element visible: [selector]` |
| A modal dialog appeared | `Modal visible` |
| An element disappeared from the DOM | `Element hidden: [selector]` |

Each suggestion card shows **✓ Accept** and **✕ Discard** buttons:
- **Accept** — the assertion is included in the exported code
- **Discard** — the suggestion is removed

### Manual assertions (Assertion Mode)

1. Press **✦ Assertion Mode** (the button turns active/highlighted).
2. Click any element on the page — instead of recording a click event, a suggestion card is created for that element.
3. Press **✦ Assertion Mode** again to return to normal recording.

---

## 9. Step Replay

The **▶ Test** button replays all recorded steps against the currently active tab to verify that your selectors still work.

During replay each row shows a status indicator:

| Indicator | Meaning |
|---|---|
| `⟳` | Step is currently running |
| `✓` | Step passed — element found and action performed |
| `–` | Step skipped (navigate or close-tab events are handled differently) |
| `✗` | Step failed — selector not found on the page |

A failing row is scrolled into view automatically and highlighted in red. Hover over the `✗` indicator to see the error message.

> **Note:** Replay simulates DOM interactions. It is useful for verifying selector health, not for running a full end-to-end test with assertions.

---

## 10. Exporting Test Code

The **Export** section appears at the bottom of the popup after recording stops (and at least one event exists).

### Choose a framework

Click one of the framework tabs:

| Tab | Output file |
|---|---|
| **Playwright TS** | TypeScript (`.ts`) |
| **Playwright PY** | Python (`.py`) |
| **Cypress** | JavaScript (`.js`) |
| **Selenium** | JavaScript (`.js`) |

### Options

| Option | Description |
|---|---|
| **Page Object Model** | Wraps selectors in POM classes grouped by page domain. Downloads additional class files when enabled. |
| **Include a11y checks** | Adds accessibility assertions for visible elements. |

### Export actions

| Button | Action |
|---|---|
| **Copy** | Copies the generated code to the clipboard. A "Copied!" confirmation appears briefly. |
| **Download** | Saves the generated code as a file using the browser's native Save dialog. If POM is enabled, each page object class is downloaded as a separate file. |

### File names

| Framework | Test file | POM files (if enabled) |
|---|---|---|
| Playwright TS | `e2e-test-playwright-ts.ts` | `LoginPage.ts`, `DashboardPage.ts`, … |
| Playwright PY | `e2e-test-playwright-python.py` | `login_page.py`, … |
| Cypress | `e2e-test-cypress.js` | `LoginPage.js`, … |
| Selenium | `e2e-test-selenium.js` | `LoginPage.js`, … |

### File upload paths

If your recording includes a file upload step, the generated code contains a placeholder:

```
PLACEHOLDER_REPLACE_WITH_REAL_PATH/filename.pdf
```

Replace this with the actual absolute path to the file on the machine that will run the tests.

---

## 11. Multi-Tab Recording

E2E Recorder automatically tracks interactions that span multiple browser tabs.

When a recorded click opens a new tab (e.g. "Sign in with Google" OAuth pop-up, or a link with `target="_blank"`):

- The new tab is registered as part of the session
- The tab counter in the popup header increments
- Recording continues in both tabs simultaneously
- When the new tab is closed, a `closeContext` event is recorded

The generated code includes the correct context-switching logic for each framework:

| Framework | New-tab code |
|---|---|
| Playwright TS | `const [newPage] = await Promise.all([context.waitForEvent('page'), page.click("sel")]);` |
| Playwright PY | `with page.context.expect_page() as new_page_info:` |
| Cypress | Comment noting `cy.origin()` is required for cross-origin tabs |
| Selenium | Window handle switching code |

---

## 12. The Logs Panel

Click the **Logs** tab in the popup to open the diagnostic log viewer. An error badge (red number) appears on the tab when new errors arrive while the Recorder panel is active.

### Filters

| Filter | Options |
|---|---|
| **Level** | All · Error · Warn · Info · Debug |
| **Source** | All · background · content · popup |

The panel displays the last 200 entries matching the active filters, auto-scrolling to the newest entry.

### Log actions

| Button | Action |
|---|---|
| **Copy** | Copies all log entries (unfiltered) to the clipboard as plain text |
| **Clear** | Deletes all stored log entries |

Log entries show: `HH:MM:SS.mmm  [LEVEL]  [source]  message`

---

## 13. Supported Events

| Event type | Badge label | Captured data |
|---|---|---|
| `navigate` | `nav` | URL |
| `click` | `click` | Selector + up to 6 candidates |
| `fill` | `fill` | Selector + value (masked if sensitive) |
| `keypress` | `key` | Selector + key name + modifier flags |
| `hover` | `hover` | Selector (only when hover causes DOM change) |
| `scroll` | `scroll` | Selector (or window) + direction + amount |
| `dragAndDrop` | `drag` | Source selector + target selector + coordinates |
| `fileUpload` | `file` | Selector + file name placeholder |
| `selectOption` | `select` | Selector + selected value |
| `wait` | `wait` | Duration in ms (inserted manually) |
| `closeContext` | `close` | Tab ID (recorded when a secondary tab closes) |

---

## 14. Keyboard Shortcuts

There are no global keyboard shortcuts. All controls are accessed through the extension popup.

Inside the **inline selector editor** (when you click a selector to edit it):

| Key | Action |
|---|---|
| `Enter` | Confirm the new selector |
| `Escape` | Cancel — revert to the original selector |

---

## 15. Known Limitations

| Area | Limitation | Workaround |
|---|---|---|
| Cross-origin iframes | The traffic-light overlay is not shown inside cross-origin frames (browser security policy). Event capture still works. | None required — capture is unaffected. |
| File upload paths | The real absolute file path cannot be captured. | Replace the `PLACEHOLDER_REPLACE_WITH_REAL_PATH/…` token in the generated code. |
| Selenium + Shadow DOM | Selenium has no native shadow-piercing API. | Review the generated comment and adapt the script manually. |
| Cypress + multi-tab | Cypress does not support true multi-tab testing natively. | Use `cy.origin()` or split into two spec files. |
| Canvas drag targets | If the drop target is a `<canvas>`, only coordinates are captured. | Use the coordinate-based drag API of your target framework. |
| React controlled inputs | In some complex React components, simulated events during replay may not trigger state updates. | The `setNativeValue` helper handles most cases; manually adjust scripts for edge cases. |
| Chrome service worker | Chrome may terminate the background service worker mid-session. All recording state is in `browser.storage.local` and survives restarts, but multi-tab detection may miss tabs opened just after a restart. | Rare in practice; restart recording if multi-tab tracking seems broken. |
| Firefox XPI signing | A self-built XPI can only be loaded temporarily via `about:debugging`. | Use the Firefox Add-ons store (AMO) build for permanent installation. |

---

*E2E Recorder v2 — Open-source · No data leaves your browser · No AI · No cloud*
