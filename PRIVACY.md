# E2E Recorder v2 — Privacy Policy

**Last updated: June 2026 | Version 2.0.0**

> **100% Local** — E2E Recorder v2 does **not** collect, transmit, sell, or share any personal data or browsing information with any third party. All data processed by this extension stays exclusively on your device.

---

## 1. Who we are

E2E Recorder v2 is an open-source browser extension. It is not operated by a company and does not have a backend server, analytics service, or any form of remote infrastructure.

---

## 2. What data the extension accesses

The extension injects a content script into web pages you visit **only while recording is active** (after you click the Record button). During recording it reads:

- The URL of the active tab (to generate `navigate` events)
- DOM attributes of elements you click, type into, or hover over (to compute CSS selectors)
- Text values you type into form fields (stored locally to generate test scripts)

When recording is **not active**, the content script is present in the page but does not read or transmit any data.

---

## 3. Where data is stored

All recorded data (events, selectors, generated test code, extension logs) is stored exclusively in `browser.storage.local`, which is a sandboxed area of your browser's local storage. It is never written to disk outside the browser profile and is never sent to any external server.

| Data type | Storage location | Leaves device? |
|---|---|---|
| Recorded events (clicks, fills, navigations) | browser.storage.local | Never |
| CSS selectors | browser.storage.local | Never |
| Typed text values (including masked passwords) | browser.storage.local | Never |
| Generated test code (Playwright, Cypress, Selenium) | browser.storage.local | Never |
| Extension debug logs | browser.storage.local | Never |
| Downloaded test files (via "Download" button) | Your local filesystem | Never |

---

## 4. Sensitive data handling

If a form field is detected as a password field (`type="password"`) or its name/id matches common patterns for sensitive credentials (e.g. `cvv`, `token`, `api_key`), the extension automatically replaces the typed value with the placeholder `ENV_SECRET_PARAM` and marks the event as masked. **The actual secret value is never stored.**

---

## 5. Permissions used and why

| Permission | Reason |
|---|---|
| `storage` | Store recording state in browser.storage.local |
| `activeTab` | Read the URL of the current tab when starting a recording |
| `tabs` | Detect when new tabs open during a multi-tab recording session |
| `scripting` | Inject the content script into pages when needed |
| `downloads` | Save generated test files to your local filesystem via the Download button |
| `<all_urls>` | The extension must be able to record interactions on any website the user chooses to test. Without this permission the extension cannot inject the capture script. |

---

## 6. Third-party services

The extension makes **no network requests of its own**. It does not load any external scripts, fonts, images, or analytics libraries. There are no third-party SDKs embedded in the extension.

---

## 7. Data retention and deletion

Recorded data persists in `browser.storage.local` until you:

- Click the **Clear** button in the extension popup (clears the current session)
- Uninstall the extension (the browser removes all associated storage automatically)

There is no automatic retention period; data is kept until you explicitly clear it.

---

## 8. Children

This extension is a developer tool and is not directed at children under 13. It does not knowingly collect information from children.

---

## 9. Changes to this policy

If a future version of the extension changes how data is handled, this page will be updated and the "Last updated" date will change. Significant changes will also be noted in the extension's changelog.

---

## 10. Contact

Questions about this privacy policy can be raised by opening an issue in the extension's public source code repository.

---

*E2E Recorder v2 — Open-source browser extension — No data ever leaves your device.*
