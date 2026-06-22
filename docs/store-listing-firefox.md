# Firefox Add-ons (AMO) — Submission Guide
## E2E Recorder v2

Reference: https://addons.mozilla.org/developers/addon/submit/

---

## STEP 1 · Distribution

- [x] **On this site (listed publicly on addons.mozilla.org)**
- [ ] Self-distribution (if you prefer to ship the XPI yourself outside AMO)

---

## STEP 2 · Upload

File to upload: `dist/e2e-recorder-v2.xpi`

Firefox requires a **source code package** for extensions with build steps or
minification. This extension has none — the source IS the XPI. When asked:

> "Does your add-on use any build tools, minifiers, or other tools that
> transform your source code?"

Answer: **No**. The XPI is built directly from human-readable source files with
no transpilation, bundling, or minification.

---

## STEP 3 · Details (copy-paste into the form)

### Name
```
E2E Recorder v2
```

### Summary  *(max 250 characters)*
```
Record browser interactions and instantly export them as Playwright (TS/Python), Cypress, or Selenium test scripts. Supports Shadow DOM, iframes, multi-tab flows, and a visual selector-quality inspector.
```

### Description  *(supports basic HTML)*

```html
<p><strong>E2E Recorder v2</strong> is a developer tool that captures your browser interactions and converts them into production-ready automated test scripts — with no AI, no cloud, and no external dependencies.</p>

<p><strong>Supported frameworks</strong></p>
<ul>
  <li>Playwright TypeScript</li>
  <li>Playwright Python</li>
  <li>Cypress (JavaScript)</li>
  <li>Selenium WebDriver (JavaScript)</li>
</ul>

<p><strong>Key features</strong></p>
<ul>
  <li>Intelligent selector engine with quality scoring (data-testid › id › aria-label › …)</li>
  <li>Visual traffic-light overlay: green/amber/red outline shows selector stability in real time while hovering</li>
  <li>Multi-candidate selectors per action: test each alternative against the live page and pick the best one</li>
  <li>Shadow DOM support (>>> piercing syntax)</li>
  <li>iframe support with full frame-chain tracking</li>
  <li>Multi-tab recording sessions (OAuth pop-ups, new windows)</li>
  <li>Captures: click, fill, keypress, hover, scroll, drag-and-drop, file upload, native/custom dropdowns</li>
  <li>Sensitive field masking: passwords and API keys are never stored</li>
  <li>Event editor: reorder, delete, or manually edit selectors before exporting</li>
  <li>Insert new steps between existing recorded steps</li>
  <li>Replay recorded steps against the live page with per-step pass/fail indicators</li>
  <li>Page Object Model export (optional toggle)</li>
  <li>Automatic assertion suggestions after significant DOM changes</li>
  <li>Built-in Logs panel for debugging extension behaviour</li>
</ul>

<p><strong>Privacy</strong></p>
<p>100% local. No data ever leaves your browser. No analytics, no telemetry, no external requests.</p>

<p><strong>Open source</strong></p>
<p>All source code is human-readable JavaScript with no minification or obfuscation.</p>
```

### Category
```
Developer Tools
```

### Tags  *(up to 20, comma-separated)*
```
testing, playwright, cypress, selenium, test recorder, e2e, automation, developer tools, QA, test generation, selector, shadow dom, iframe, multi-tab, page object model
```

### Homepage URL
```
https://github.com/YOUR_USERNAME/e2e-recorder-v2
```
*(Replace with your actual repository URL)*

### Support URL / Email
```
https://github.com/YOUR_USERNAME/e2e-recorder-v2/issues
```

### Privacy Policy URL
```
https://YOUR_USERNAME.github.io/e2e-recorder-v2/privacy-policy.html
```
*(Host docs/privacy-policy.html on GitHub Pages or any static host)*

---

## STEP 4 · Screenshots

AMO requires at least 1 screenshot (1280×800 or 640×400 px recommended).

Suggested screenshots to capture:
1. **Popup open while recording** — show the event list with green/amber/red health dots and the type badges (CLICK, FILL, HOVER…)
2. **Selector candidates panel** — show the ⚙ panel expanded with Test/Use/Discard buttons and match counts
3. **Export section** — show generated Playwright TypeScript code in the textarea
4. **Logs tab** — show the Logs panel with colour-coded entries
5. **Replay in progress** — show the ✓/✗ indicators on each row after clicking ▶ Test

---

## STEP 5 · Permission justifications

AMO will ask you to justify non-obvious permissions. Suggested answers:

| Permission | Justification to enter |
|---|---|
| `<all_urls>` | The extension must inject a content script into any website the user chooses to record tests for. Since developers test on arbitrary domains (internal staging servers, localhost, third-party SaaS), restricting to a fixed set of URLs would make the tool unusable. The content script is only active during an explicit recording session started by the user. |
| `tabs` | Required to detect when a user action (e.g. clicking "Sign in with Google") opens a new tab or pop-up window during a recording session, so the session can span multiple tabs and the generated test script includes the correct page-switching code. |
| `scripting` | Required to programmatically inject the content script for the replay/test feature, which validates selectors and simulates recorded steps against the live page. |
| `downloads` | Required to save generated test files (.spec.ts, .spec.js, .py) to the user's local filesystem when the user clicks the Download button. |

---

## STEP 6 · Source code submission

AMO requires source code for review. Zip the source:

```
# From the E2ERecorder folder:
zip -r e2e-recorder-v2-source.zip . \
  --exclude "dist/*" --exclude ".git/*" --exclude "node_modules/*"
```

On Windows (PowerShell):
```powershell
Compress-Archive -Path * -DestinationPath e2e-recorder-v2-source.zip `
  -CompressionLevel Optimal
```

Upload this zip when AMO asks for the source package.

Add a `BUILD.md` (or note in the submission form):
> "No build step required. The submitted XPI is created by build.ps1 / build.sh,
> which zips the source files as-is with no transpilation or minification.
> All JavaScript is plain ES2020+ with no external dependencies."

---

## STEP 7 · Review notes for Mozilla reviewer

*(Paste this in the "Notes to reviewer" field)*

```
This extension is a developer/QA tool for recording browser interactions and
exporting them as automated test scripts.

Key points for review:

1. HOST PERMISSIONS (<all_urls>): Required because developers test on arbitrary
   domains. The content script activates only when the user clicks Record.
   When idle, the script is present but performs no data access.

2. SENSITIVE DATA: Password fields and API key inputs are detected and masked
   before storage (replaced with ENV_SECRET_PARAM). The actual value is never
   written to browser.storage.local.

3. NO NETWORK REQUESTS: The extension makes zero outbound network calls.
   All processing is local. No analytics, no telemetry.

4. NO BUILD TOOLS: The XPI is a direct zip of the source files. What you see
   in the source package is exactly what runs in the browser.

5. REPLAY FEATURE: The ▶ Test button replays recorded steps using
   browser.tabs.sendMessage to the content script, which simulates DOM
   interactions (click, fill, etc.) on the live page. This is the only
   "scripting" the extension performs beyond passive capture.
```
