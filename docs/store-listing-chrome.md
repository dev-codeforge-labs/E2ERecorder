# Chrome Web Store — Submission Guide
## E2E Recorder v2

Reference: https://chrome.google.com/webstore/devconsole

---

## PREREQUISITES

- Google Developer account ($5 USD one-time registration fee)
- File to upload: `dist/e2e-recorder-v2-chrome.zip`
- Privacy policy hosted at a public URL (use docs/privacy-policy.html)

---

## STORE LISTING FIELDS

### Extension name  *(max 75 characters)*
```
E2E Recorder v2
```

### Short description  *(max 132 characters — appears in search results)*
```
Record browser interactions and export Playwright, Cypress or Selenium test scripts. Supports Shadow DOM, iframes & multi-tab flows.
```

### Detailed description  *(plain text only, no HTML)*

```
E2E Recorder v2 is a developer tool that captures your browser interactions and converts them into production-ready automated test scripts — with no AI, no cloud, and no external dependencies.

SUPPORTED FRAMEWORKS
• Playwright TypeScript
• Playwright Python
• Cypress (JavaScript)
• Selenium WebDriver (JavaScript)

KEY FEATURES

Smart selector engine
Scores every element using a priority table (data-testid › id › aria-label › role › name › placeholder › text › class › tag) and picks the most stable selector automatically. Shadow DOM (>>> piercing) and iframe frame-chain tracking are fully supported.

Visual selector inspector
While recording, a green/amber/red outline appears over hovered elements to show selector quality in real time — before you even click.

Multiple selector candidates
Each recorded action captures up to 6 alternative selectors. You can test each one against the live page, see how many elements it matches, and choose or discard them.

Comprehensive event capture
Clicks, text input (with 400ms debounce), special key presses, hover with DOM-change detection, relevant scroll, drag-and-drop, file upload, and native/custom dropdown selection.

Sensitive data masking
Password fields and inputs matching credential patterns (api_key, token, cvv…) are automatically masked. The real value is never stored.

Multi-tab recording
Detects when a recorded click opens a new tab or OAuth pop-up and continues recording across contexts. The generated script includes the correct page-switching code for each framework.

Event editor
After recording, reorder or delete steps, edit selectors inline with live uniqueness validation, insert new steps between existing ones, and review automatic assertion suggestions.

Step-by-step replay
Click ▶ Test to replay the recorded session against the live page. Each step shows ✓ (passed), ✗ (selector not found), or – (skipped) in real time.

Export options
Copy to clipboard or download as a file. Optional Page Object Model output. Optional accessibility assertion inclusion.

Built-in Logs panel
A dedicated Logs tab captures messages from background, content, and popup contexts with level and source filtering — useful for debugging recording issues.

PRIVACY
100% local. No data ever leaves your browser. No analytics, no telemetry, no external network requests of any kind.
```

### Category
```
Developer Tools
```

### Language
```
English
```

---

## STORE LISTING — GRAPHIC ASSETS

Chrome Web Store requires:

| Asset | Size | Notes |
|-------|------|-------|
| Extension icon | 128×128 px PNG | Use icons/icon-128.png |
| Screenshot (required, 1–5) | 1280×800 or 640×400 px | See suggestions below |
| Promotional tile (optional) | 440×280 px | Small banner shown in some placements |
| Marquee promo (optional) | 1400×560 px | Large featured banner |

Suggested screenshots:
1. **Recording in progress** — popup open, event list with colour-coded type badges and health dots
2. **Selector candidates panel** — ⚙ panel expanded showing Test/Use/Discard per candidate
3. **Generated Playwright TS code** — export section with code in the textarea
4. **Step replay results** — ✓/✗ indicators per row after clicking ▶ Test
5. **Logs tab** — colour-coded log entries from background/content/popup

---

## PRIVACY PRACTICES (Privacy tab in Developer Console)

Chrome requires you to declare data handling. Fill in as follows:

### Data collection
Select: **The extension does not collect or use any user data**

*(If the form forces you to select at least one category, select "Personal communications or user-generated content" and mark it as: collected → No)*

### Certify
Check: **This product does not collect or use user data**

### Privacy policy URL
```
https://YOUR_USERNAME.github.io/e2e-recorder-v2/privacy-policy.html
```

---

## PERMISSION JUSTIFICATIONS

Chrome Web Store has a dedicated field for each sensitive permission.
Copy-paste the following:

### `host_permissions: <all_urls>`

```
E2E Recorder must inject a content script into any website the developer
chooses to record tests for. Developers test on arbitrary domains: internal
staging servers (e.g. http://localhost:3000), corporate intranets, and
third-party SaaS products. Restricting to a fixed list of URLs would make
the tool unusable.

The content script becomes active ONLY after the user explicitly clicks the
Record button in the extension popup. While idle, the script is injected
but performs no DOM reads and sends no messages.

This is the same approach used by established tools such as Selenium IDE,
the Playwright Test Generator, and other browser-based test recorders, all
of which require <all_urls> for the same reason.
```

### `tabs`

```
Required to detect when a user action (e.g. clicking "Sign in with Google")
opens a new tab or pop-up window during a recording session. The extension
listens to browser.tabs.onCreated to register the new tab as part of the
current session so the generated test script includes the correct
context-switching code (e.g. context.waitForEvent('page') in Playwright).
```

### `scripting`

```
Required for the Replay feature: when the user clicks ▶ Test, the extension
sends EXECUTE_STEP messages to the content script in the active tab to
simulate each recorded step (click, fill, navigate…) and report pass/fail
per step. The scripting permission is also used to inject the content script
into tabs that were already open when the extension was installed.
```

### `downloads`

```
Required to save generated test files (.spec.ts, .spec.js, .py) to the
user's local filesystem when they click the Download button in the Export
section. The file is created client-side from the generated code string and
saved via browser.downloads.download() with saveAs: true, which shows the
native save dialog.
```

### `storage`

```
Used exclusively for browser.storage.local to persist the recording session
state (recorded events, selector candidates, logs) across service worker
restarts. No data is synced to the cloud (browser.storage.sync is not used).
```

---

## SUBMISSION CHECKLIST

- [ ] Developer account registered and verified at https://chrome.google.com/webstore/devconsole
- [ ] `dist/e2e-recorder-v2-chrome.zip` built with `build_Chrome.cmd`
- [ ] Privacy policy HTML hosted at a public URL
- [ ] At least 1 screenshot prepared (1280×800 px)
- [ ] All permission justifications filled in
- [ ] Short description is under 132 characters
- [ ] Privacy practices section completed

---

## REVIEW TIMELINE EXPECTATIONS

| Stage | Typical wait |
|-------|-------------|
| Initial automated review | Minutes |
| Manual review (triggered by <all_urls>) | 1–3 business weeks |
| Resubmission after rejection | 3–7 business days |
| Updates after initial approval | 1–3 business days |

**Tips to avoid rejection:**
- Do not use "Chrome" in the extension name (policy violation)
- Do not claim features the extension does not have
- The store listing description must match the actual functionality exactly
- If rejected, the rejection email will cite a specific policy; address only that point and resubmit

---

## NOTES FOR REVIEWER (enter in the "Additional information" field)

```
This extension is a developer/QA tool for recording browser interactions and
exporting them as automated test scripts for Playwright, Cypress, and Selenium.

PERMISSION NOTES:

<all_urls>: The content script activates only during an explicit recording
session (user clicks Record). When idle it is present but performs no reads
or network calls. This mirrors how Selenium IDE and other established test
recorders operate.

tabs: Used solely to track new tabs opened during multi-tab recording sessions
(e.g. OAuth pop-ups). No tab content is read.

scripting: Used for the step-replay feature to validate that recorded selectors
still match elements on the live page.

downloads: Used only when the user explicitly clicks the Download button to
save a generated test file to their local machine.

PRIVACY: The extension makes zero outbound network requests. All data is stored
in browser.storage.local and never transmitted. Passwords and credential fields
are masked before storage (replaced with ENV_SECRET_PARAM).

NO REMOTE CODE: All JavaScript is bundled in the extension package. No scripts
are loaded from external URLs.
```
