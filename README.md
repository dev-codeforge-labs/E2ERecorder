# E2E Recorder v2

A Firefox browser extension that records user interactions on any website and exports them as ready-to-run test scripts for Playwright (TypeScript or Python), Cypress, or Selenium WebDriver.

---

## Features

- **One-click recording** — captures clicks, fills, keypresses, hovers, scrolls, drag-and-drop, file uploads, and native select changes.
- **Smart selectors** — scores and ranks locators by stability (data-testid > id > aria-label > role > …). Colour-coded traffic-light outline shows selector quality in real time.
- **Shadow DOM support** — builds `host >>> inner` chains for elements inside shadow roots.
- **iframe support** — tracks `frameLocator` chains for elements inside nested iframes.
- **Multi-tab tracking** — detects new tabs opened by clicks and emits `Promise.all` / `expect_page` patterns.
- **Assertion engine** — watches for URL changes, toasts, alerts, modals, and disappearing elements after each action and suggests assertions.
- **Inline selector editor** — click any selector in the event list to edit it; real-time uniqueness validation via the active tab.
- **Alt+click picker** — hold Alt and click any element to see the top 3 ranked locators and choose one.
- **Drag-to-reorder** — HTML5 drag handles on every event row.
- **Parameterization hints** — detected email addresses and phone numbers can be extracted as named variables.
- **Export formats** — Playwright TS, Playwright Python, Cypress, Selenium JS.
- **Page Object Model** — optional POM generation groups locators by page hostname.

---

## Installation (Firefox — Temporary Add-on)

1. Open Firefox and navigate to `about:debugging`.
2. Click **This Firefox** in the left sidebar.
3. Click **Load Temporary Add-on…**.
4. Browse to the `E2ERecorder` folder and select `manifest.json`.
5. The extension icon (red **R**) appears in the toolbar.

> **Note:** Temporary add-ons are removed when Firefox restarts. To persist the extension, sign and distribute it via [addons.mozilla.org](https://addons.mozilla.org) (AMO) or use a self-signed XPI.

---

## Usage Guide

### Starting a recording

1. Navigate to the page you want to test.
2. Click the **E2E Recorder** toolbar icon to open the popup.
3. Click **⏺ Record**. The status dot turns red and blinks.
4. Interact with the page normally — every click, fill, keypress, etc. is captured.
5. Click **⏹ Stop** when done.

### Traffic-light outlines

While recording, hovering over any element shows a coloured outline:

| Colour | Meaning |
|--------|---------|
| Green  | Stable selector (score ≥ 70) — safe to use |
| Amber  | Acceptable but fragile (score 40–69) |
| Red    | Unstable — positional or hashed class name |

### Alt+click selector picker

Hold **Alt** and click any element to open a floating picker listing the top 3 candidate selectors with their stability scores. Click one to record it instead of the auto-chosen selector.

### Assertion mode

1. Click **✓ Assert** to enable assertion mode (status dot turns amber).
2. Click any element — instead of recording a click, the extension suggests a `toBeVisible` assertion for that element.
3. After each recorded action the Assertion Engine also auto-suggests URL-change, toast, modal, and disappearance assertions.
4. Accept (✓) or discard (✕) each suggestion in the event list.

### Editing selectors

Click any selector text in the event list to edit it inline. The field validates the selector against the active tab in real time:

- **Green border** — valid, uniquely matches one element.
- **Amber border** — valid but matches multiple elements.
- **Red border** — invalid CSS selector syntax.

Press **Enter** to commit or **Escape** to cancel.

### Exporting tests

1. In the **Export** panel choose a framework tab: **PW-TS**, **PW-PY**, **Cypress**, or **Selenium**.
2. Optionally enable **Page Object Model** (generates a class per page) and/or **Include A11y** (adds accessibility warning comments).
3. Click **⎘ Copy** to copy to clipboard, or **⬇ Download** to save the file(s).

### Clearing a session

Click **✕ Clear** to discard all events and start fresh.

---

## Known Limitations

1. **Temporary installation only.** Firefox removes unsigned extensions on restart. The extension must be re-loaded via `about:debugging` each session, or packaged and signed for persistent use.

2. **Cross-origin iframes are not fully supported.** The content script cannot access the DOM of cross-origin iframes due to browser security policy. Events inside cross-origin iframes are not captured, and no `frameLocator` chain is generated for them.

3. **Multi-tab Cypress export is a stub.** Cypress does not support multi-tab testing natively. The exporter emits a warning comment and a `cy.stub(window, 'open')` pattern, but the user must implement the actual multi-tab strategy manually.

4. **File upload paths are placeholders.** When a `<input type="file">` change is captured, the recorded `filePath` is a placeholder comment. The user must replace it with the real path or fixture name in the exported code.

5. **Shadow DOM in Selenium requires JS execution.** Selenium WebDriver does not natively support shadow-DOM CSS selectors. The exporter wraps shadow-DOM interactions in `driver.executeScript(...)` calls, which may break if the shadow root is closed-mode.

6. **Replay is navigation-only.** The **▶ Test** button replays the session by navigating the active tab to the recorded initial URL. Full step-by-step DOM replay inside the extension is not implemented — use the exported test script with the target framework's runner for full replay.

---

## Project Structure

```
E2ERecorder/
├── manifest.json              MV3 manifest
├── background.js              Service worker — state mutations, tab lifecycle
├── content.js                 Injected into every tab/frame — event capture
├── popup.html                 Extension popup UI
├── popup.css                  Dark-theme styles
├── popup.js                   Popup logic — rendering, controls, export
├── modules/
│   ├── state-store.js         browser.storage.local abstraction
│   ├── selectors.js           Scoring selector engine (DOM access)
│   ├── compilers.js           Code generation for all frameworks
│   └── assertion-engine.js    Post-event DOM/URL observer
└── icons/
    ├── icon-32.svg
    └── icon-48.svg
```

---

## Architecture Notes

- **Single writer principle:** only `background.js` mutates the persisted state. Content scripts send `RECORD_EVENT` / `ADD_ASSERTION` messages; background writes and broadcasts `STATE_UPDATED`.
- **No external dependencies:** pure vanilla JavaScript, no npm, no bundler required.
- **Shadow DOM:** detected via `getRootNode() instanceof ShadowRoot`; selectors use the `host >>> inner` delimiter understood by Playwright natively.
- **Selector scoring:** `data-testid`/`data-cy` = 100 → `id` = 85 → `aria-label` = 75 → `role` = 72 → `name` = 70 → `placeholder` = 65 → `innerText` = 60 → first class = 30 → tag = 10 → nth-child = 5. Patterns matching `/(\d{3,}|css-|Mui|chakra-|ng-|star-)/i` incur a −50 penalty. Non-unique selectors are halved.
