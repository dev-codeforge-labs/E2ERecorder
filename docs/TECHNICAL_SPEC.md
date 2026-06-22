# E2E Recorder v2 — Technical Specification

**Version:** 2.0.0  
**Platforms:** Firefox 109+ (MV3, classic background scripts) · Chrome/Edge 88+ (MV3, service worker)  
**Language:** JavaScript ES2020+ (no transpilation, no bundler, no external runtime dependencies)  
**Last updated:** June 2026

---

## Table of Contents

1. [Design Principles](#1-design-principles)  
2. [Repository Layout](#2-repository-layout)  
3. [Extension Manifests](#3-extension-manifests)  
4. [System Architecture](#4-system-architecture)  
5. [State Model (`state-store.js`)](#5-state-model-state-storejs)  
6. [Background Orchestrator (`background.js`)](#6-background-orchestrator-backgroundjs)  
7. [Content Script (`content.js`)](#7-content-script-contentjs)  
8. [Selector Engine (`modules/selectors.js`)](#8-selector-engine-modulesselectorsjs)  
9. [Assertion Engine (`modules/assertion-engine.js`)](#9-assertion-engine-modulesassertion-enginejs)  
10. [Code Compilers (`modules/compilers.js`)](#10-code-compilers-modulescompilersjs)  
11. [Popup UI (`popup.html` / `popup.js`)](#11-popup-ui-popuphtml--popupjs)  
12. [Inter-Context Message Protocol](#12-inter-context-message-protocol)  
13. [Multi-Tab Session Lifecycle](#13-multi-tab-session-lifecycle)  
14. [Replay Engine](#14-replay-engine)  
15. [Logging Subsystem](#15-logging-subsystem)  
16. [Build System](#16-build-system)  
17. [Cross-Browser Compatibility Layer](#17-cross-browser-compatibility-layer)  
18. [Security Model](#18-security-model)  
19. [Performance Constraints](#19-performance-constraints)  
20. [Known Limitations](#20-known-limitations)  

---

## 1. Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Zero AI / Fully deterministic** | All selector scoring, DOM analysis, and code generation use fixed algorithms. No LLM calls, no remote inference. |
| **Storage as single source of truth** | All session state lives exclusively in `browser.storage.local`. The background service worker holds no in-memory state across invocations. |
| **Framework-agnostic event AST** | Captured interactions are stored in a neutral JSON format. Four independent compilers translate this AST into target framework code. |
| **Selector stability first** | The selector engine always prefers semantically stable attributes (`data-testid`, `id`, `aria-label`) over fragile positional or class-based selectors. |
| **Zero external dependencies** | No npm packages at runtime. No CDN. No fetch calls. Packaged as a self-contained ZIP/XPI. |
| **Chrome + Firefox from one codebase** | A single shim (`if (typeof browser === 'undefined') { var browser = chrome; }`) and two manifest files are the only differences between platforms. |

---

## 2. Repository Layout

```
E2ERecorder/
├── manifest.json              # Firefox MV3 manifest (classic background scripts)
├── manifest_chrome.json       # Chrome/Edge MV3 manifest (service_worker entry point)
├── background.js              # Background orchestrator — state writer, message router
├── content.js                 # Content script — DOM listener, selector evaluation
├── popup.html                 # Extension popup markup
├── popup.js                   # Popup controller — renderer, event wiring, export UI
├── popup.css                  # Popup styles
├── modules/
│   ├── state-store.js         # browser.storage.local abstraction (StateStore object)
│   ├── selectors.js           # SelectorEngine — scoring, Shadow DOM, iframe chains
│   ├── compilers.js           # Compilers — Playwright TS/PY, Cypress, Selenium
│   └── assertion-engine.js    # AssertionEngine — DOM-change heuristics
├── icons/
│   ├── icon-16.png            # RGB PNG (no alpha), 16×16
│   ├── icon-32.png            # RGB PNG (no alpha), 32×32
│   ├── icon-48.png            # RGB PNG (no alpha), 48×48
│   └── icon-128.png           # RGB PNG (no alpha), 128×128
├── docs/
│   ├── TECHNICAL_SPEC.md      # This document
│   ├── E2E_Recorder_v2_User_Manual.docx
│   ├── privacy-policy.html
│   ├── store-listing-firefox.md
│   ├── store-listing-chrome.md
│   └── PUBLISHING.md
├── dist/                      # Build output (not committed)
│   ├── e2e-recorder-v2.xpi
│   └── e2e-recorder-v2-chrome.zip
├── build.ps1 / build.cmd / build.sh         # Firefox package scripts
└── build_Chrome.ps1 / build_Chrome.cmd / build_Chrome.sh  # Chrome package scripts
```

---

## 3. Extension Manifests

### 3.1 Firefox (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "E2E Recorder v2",
  "version": "2.0.0",
  "permissions": ["storage", "activeTab", "scripting", "downloads", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "scripts": ["modules/state-store.js", "background.js"]
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png" }
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "all_frames": true,
    "js": ["modules/selectors.js", "modules/state-store.js", "content.js"],
    "run_at": "document_start"
  }],
  "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
  "browser_specific_settings": {
    "gecko": { "id": "e2e-recorder-v2@local", "strict_min_version": "109.0" }
  }
}
```

**Key design decisions:**

- `"background": { "scripts": [...] }` (classic script mode) — Firefox MV3 supports classic background pages. `state-store.js` is listed before `background.js` so `StateStore` is in scope when `background.js` executes. No `importScripts` call needed.
- `"all_frames": true` on the content script declaration — ensures `content.js` is injected into every `<iframe>`, including nested iframes, which is required for Shadow DOM and iframe event capture.
- `"run_at": "document_start"` — the content script attaches DOM listeners before any page JavaScript runs, preventing missed early events.
- `"host_permissions": ["<all_urls>"]` is a separate top-level key in MV3, not nested inside `"permissions"`.

### 3.2 Chrome / Edge (`manifest_chrome.json`)

```json
{
  "manifest_version": 3,
  "background": {
    "service_worker": "background.js",
    "type": "classic"
  }
}
```

All other keys are identical to the Firefox manifest. The Chrome build script replaces `manifest_chrome.json` with `manifest.json` inside the ZIP at package time.

**Key difference from Firefox:** Chrome requires a single `service_worker` entry point. Because `StateStore` is not in scope when the service worker starts, `background.js` detects this and calls `importScripts('modules/state-store.js')` at the top:

```js
if (typeof StateStore === 'undefined') {
  importScripts('modules/state-store.js');
}
```

### 3.3 Permission Rationale

| Permission | Required for |
|------------|-------------|
| `storage` | `browser.storage.local` — single source of truth for all session state |
| `activeTab` | Reading the current tab URL when the user starts recording |
| `scripting` | Injecting the content script programmatically for the replay feature |
| `downloads` | Saving generated test files to disk via `browser.downloads.download()` |
| `tabs` | Listening to `tabs.onCreated` / `tabs.onRemoved` for multi-tab session tracking |
| `<all_urls>` (host) | Content script injection into any domain the developer wants to test |

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser Tab(s)                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  content.js (all_frames: true)                          │   │
│  │  • DOM event listeners (click, input, keydown, …)       │   │
│  │  • SelectorEngine (selectors.js) — in-scope             │   │
│  │  • Traffic-light overlay (outline injection)            │   │
│  │  • EXECUTE_STEP handler for replay                      │   │
│  └──────────────────────┬──────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────────┘
                          │ browser.runtime.sendMessage
                          │ (RECORD_EVENT, LOG_ENTRY, ADD_ASSERTION, …)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  background.js (service worker / classic background page)       │
│                                                                 │
│  • handleMessage() — dispatches all incoming messages           │
│  • StateStore.get() → mutate → StateStore.set()  per message   │
│  • broadcast() — notifies popup + all content scripts          │
│  • tabs.onCreated / tabs.onRemoved — multi-tab tracking         │
│  • appendLog() — persists log entries to state.logs             │
│                          │                                      │
│                          ▼                                      │
│            browser.storage.local                                │
│            key: "e2eRecorderState"                              │
│            (single source of truth — see §5)                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ browser.runtime.sendMessage
                          │ (STATE_UPDATED, LOGS_UPDATED,
                          │  REPLAY_STARTED, REPLAY_STEP_RESULT, …)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  popup.js (extension popup)                                     │
│                                                                 │
│  • Listens for STATE_UPDATED → render()                        │
│  • Sends control messages (START_RECORDING, STOP_RECORDING, …)  │
│  • Selector candidate UI (Test / Use / Discard)                 │
│  • Insert-step forms                                            │
│  • Compilers (compilers.js) — in-scope                          │
│  • Export UI (Copy / Download)                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Data-flow invariant:** The background is the **only writer** to `storage.local`. Content scripts and the popup only send messages requesting mutations; they never write storage directly.

---

## 5. State Model (`state-store.js`)

### 5.1 `StateStore` Object

```js
const StateStore = {
  MAX_LOGS: 500,

  DEFAULT_STATE: {
    isRecording: false,        // boolean — whether capture is active
    isAssertionMode: false,    // boolean — Assertion Mode flag
    sessionId: null,           // string | null — crypto.randomUUID() per session
    initialUrl: '',            // string — URL when Record was clicked
    tabs: {},                  // Record<tabId, TabEntry> — registered session tabs
    events: [],                // RecordedEvent[] — ordered interaction list
    suggestedAssertions: [],   // AssertionSuggestion[] — auto-suggested assertions
    logs: []                   // LogEntry[] — diagnostic log ring buffer
  },

  async get()   { /* reads from storage.local */ },
  async set(s)  { /* writes to storage.local */ },
  async reset() { /* resets to DEFAULT_STATE with a new sessionId */ }
};
```

`StateStore` is loaded as a plain classic script (no ES modules). It exposes a single global `const StateStore` that is available in every context where the script is loaded: background, content scripts, and popup.

### 5.2 Full State Schema

```typescript
interface RecorderState {
  isRecording: boolean;
  isAssertionMode: boolean;
  sessionId: string | null;
  initialUrl: string;
  tabs: Record<string, TabEntry>;
  events: RecordedEvent[];
  suggestedAssertions: AssertionSuggestion[];
  logs: LogEntry[];
}

interface TabEntry {
  role: 'primary' | 'secondary';
  url?: string;
  openerTabId?: number;
}

interface RecordedEvent {
  id: string;            // crypto.randomUUID()
  type: EventType;       // see §5.3
  tabId: number;
  frameId: number;       // 0 = top frame
  frameChain: string[];  // [] = top frame; ["iframe[name='x']"] = one iframe deep
  timestamp: number;     // Date.now()
  manual?: boolean;      // true for manually inserted steps (INSERT_EVENT)

  // Type-specific fields:
  url?: string;          // navigate
  selector?: string;     // click, fill, keypress, hover, scroll, selectOption, …
  selectorCandidates?: SelectorCandidate[];
  value?: string;        // fill, selectOption
  masked?: boolean;      // fill — true when value replaced with ENV_SECRET_PARAM
  key?: string;          // keypress
  ctrlKey?: boolean;     // keypress modifiers
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  targetSelector?: string;   // dragAndDrop target
  targetX?: number;          // dragAndDrop coordinate fallback
  targetY?: number;
  filePath?: string;         // fileUpload placeholder
  direction?: string;        // scroll
  amount?: number;           // scroll px
  duration?: number;         // wait ms
  opensNewContext?: boolean; // click that opened a new tab
  newTabId?: number;
}

type EventType =
  | 'navigate' | 'click' | 'fill' | 'keypress'
  | 'hover' | 'scroll' | 'dragAndDrop' | 'fileUpload'
  | 'selectOption' | 'wait' | 'closeContext';

interface SelectorCandidate {
  selector: string;
  score: number;
  unique?: boolean;
}

interface AssertionSuggestion {
  id: string;
  afterEventId: string;
  type: 'urlChanged' | 'elementVisible' | 'elementHidden' | 'modalVisible';
  selector?: string;
  expectedUrl?: string;
  expectedText?: string;
  accepted: boolean | null;  // null = pending, true = accepted, false = discarded
}

interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: 'background' | 'content' | 'popup' | 'unknown';
  msg: string;
}
```

### 5.3 Storage Mutation Pattern

Every state mutation in `background.js` follows the same read–modify–write–broadcast sequence:

```js
const state = await StateStore.get();
// … modify state …
await StateStore.set(state);
await broadcast({ type: 'STATE_UPDATED', state });
```

This guarantees that: (a) the service worker is never working from stale in-memory state, and (b) every consumer (popup, content scripts) immediately receives the new state.

---

## 6. Background Orchestrator (`background.js`)

### 6.1 Initialization

On first load (or after Chrome terminates and restarts the service worker), `background.js`:

1. Runs the Chrome shim: `if (typeof browser === 'undefined') { var browser = chrome; }`.
2. Conditionally imports the state store: `if (typeof StateStore === 'undefined') { importScripts('modules/state-store.js'); }`.
3. Defines `tabContextMap = {}` — an ephemeral (non-persisted) map of `tabId → openerTabId`, used only during the browser session.
4. Registers `browser.runtime.onMessage.addListener(...)` and tab lifecycle listeners.

### 6.2 Message Dispatch

All messages arrive at `handleMessage(message, sender)` via the `onMessage` listener. The listener returns `true` (async response pattern) so `sendResponse` can be called after the async `handleMessage` resolves.

```js
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true; // keep channel open for async response
});
```

### 6.3 Handled Message Types

| Message type | Description |
|---|---|
| `RECORD_EVENT` | Appends a captured interaction to `state.events`. Attaches `tabId` from `sender.tab` and `frameId` from `sender.frameId`. |
| `START_RECORDING` | Calls `StateStore.reset()`, sets `isRecording = true`, registers the caller's tab as `primary`, emits an initial `navigate` event. |
| `STOP_RECORDING` | Sets `isRecording = false`, `isAssertionMode = false`. |
| `TOGGLE_ASSERTION_MODE` | Flips `state.isAssertionMode`. |
| `GET_STATE` | Returns current state to caller without mutation. |
| `DELETE_EVENT` | Filters `state.events` by `eventId`. |
| `REORDER_EVENTS` | Replaces `state.events` with the caller-supplied ordered array. |
| `INSERT_EVENT` | Splices a new event at `afterIndex + 1` with a fresh `crypto.randomUUID()` and `manual: true`. |
| `UPDATE_EVENT_SELECTOR` | Updates `event.selector` for the given `eventId`. |
| `DISCARD_SELECTOR_CANDIDATE` | Removes a candidate from `event.selectorCandidates` by selector string. |
| `ACCEPT_ASSERTION` | Sets `assertion.accepted = true`. |
| `DISCARD_ASSERTION` | Sets `assertion.accepted = false`. |
| `ADD_ASSERTION` | Appends a new `AssertionSuggestion` to `state.suggestedAssertions`. |
| `CLEAR_SESSION` | Calls `StateStore.reset()`. |
| `LOG_ENTRY` | Calls `appendLog(level, source, msg)`. |
| `CLEAR_LOGS` | Sets `state.logs = []`. |
| `VALIDATE_SELECTOR` | Relays `VALIDATE_SELECTOR_IN_PAGE` to the specified `tabId` and returns the result. |
| `DOWNLOAD_FILE` | Creates a `Blob`, obtains an object URL, calls `browser.downloads.download({ saveAs: true })`. |
| `REPLAY_EVENTS` | Starts the replay loop (see §14). Returns immediately; progress sent as separate messages. |

### 6.4 `broadcast()` Helper

```js
async function broadcast(message) {
  // 1. Notify popup (and any extension page)
  await browser.runtime.sendMessage(message).catch(() => {});

  // 2. Notify all content scripts across all tabs
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    await browser.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}
```

All `catch(() => {})` calls are intentional — the popup may be closed, and any given tab may not have the content script (e.g., `chrome://` pages). Errors are silently discarded.

### 6.5 Tab Lifecycle Listeners

```js
browser.tabs.onCreated.addListener(async (tab) => {
  const state = await StateStore.get();
  if (!state.isRecording) return;
  if (tab.openerTabId && state.tabs[tab.openerTabId]) {
    // Find the most recent click from the opener tab and flag it
    const lastClick = [...state.events].reverse()
      .find(e => e.tabId === tab.openerTabId && e.type === 'click');
    if (lastClick) { lastClick.opensNewContext = true; lastClick.newTabId = tab.id; }
    // Register new tab as secondary
    state.tabs[tab.id] = { role: 'secondary', openerTabId: tab.openerTabId };
    tabContextMap[tab.id] = tab.openerTabId;
    await StateStore.set(state);
    await broadcast({ type: 'STATE_UPDATED', state });
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const state = await StateStore.get();
  if (!state.isRecording || !state.tabs[tabId]) return;
  state.events.push({ id: crypto.randomUUID(), type: 'closeContext', tabId, frameId: 0, frameChain: [], timestamp: Date.now() });
  delete state.tabs[tabId];
  delete tabContextMap[tabId];
  await StateStore.set(state);
  await broadcast({ type: 'STATE_UPDATED', state });
});
```

---

## 7. Content Script (`content.js`)

### 7.1 Injection Context

- Injected into **every frame** of every page matching `<all_urls>` at `document_start`.
- `modules/selectors.js` and `modules/state-store.js` are loaded before `content.js`, so `SelectorEngine` and `StateStore` are in scope.
- The script is wrapped in an IIFE to avoid polluting the page's global scope; the browser shim (`var browser = chrome`) is placed outside the IIFE to ensure `browser` is available as a global.

### 7.2 State Sync

On initialisation the content script:

1. Sends `GET_STATE` to the background and caches `isRecording` and `isAssertionMode`.
2. Subscribes to `browser.storage.onChanged` to detect state changes without relying solely on messages.
3. Subscribes to `browser.runtime.onMessage` to receive `STATE_UPDATED` messages from the background.

### 7.3 DOM Event Listeners

All listeners use `capture: true` to intercept events before page scripts can stop propagation.

#### Click

```js
document.addEventListener('click', (e) => {
  if (!isRecording) return;
  if (isAssertionMode) { handleAssertionClick(e); e.preventDefault(); return; }
  const { selector, score, frameChain, selectorCandidates } = getBestWithCandidates(e.target);
  sendEvent({ type: 'click', selector, score, frameChain, selectorCandidates });
}, { capture: true });
```

`getBestWithCandidates(element)` calls `SelectorEngine.getBestSelector()` for the primary selector and `SelectorEngine.getCandidates()` for up to 6 alternatives.

#### Fill (input with 400 ms debounce)

```js
const debounceTimers = new WeakMap();

document.addEventListener('input', (e) => {
  if (!isRecording) return;
  const el = e.target;
  if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return;

  clearTimeout(debounceTimers.get(el));
  debounceTimers.set(el, setTimeout(() => {
    const raw = el.value;
    const isSensitive = el.type === 'password' ||
      /(password|passwd|cvv|secret|token|api[_-]?key)/i.test(el.id + el.name);
    sendEvent({
      type: 'fill',
      selector: SelectorEngine.getBestSelector(el).selector,
      value: isSensitive ? 'ENV_SECRET_PARAM' : raw,
      masked: isSensitive
    });
  }, 400));
}, { capture: true });
```

#### Keypress (non-printable keys)

```js
const TRACKED_KEYS = new Set(['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);

document.addEventListener('keydown', (e) => {
  if (!isRecording) return;
  if (!TRACKED_KEYS.has(e.key) && !(e.ctrlKey || e.metaKey)) return;
  sendEvent({
    type: 'keypress',
    selector: e.target !== document.body ? SelectorEngine.getBestSelector(e.target).selector : null,
    key: e.key,
    ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
  });
}, { capture: true });
```

#### Hover (deliberate — 600 ms dwell + DOM change)

```js
let hoverTimer = null, hoverElement = null, hoverObserver = null;

document.addEventListener('mouseover', (e) => {
  if (!isRecording) return;
  clearTimeout(hoverTimer);
  hoverElement = e.target;
  hoverTimer = setTimeout(() => {
    // Attach MutationObserver scoped to nearest positioned ancestor or body
    const container = findPositionedAncestor(hoverElement) || document.body;
    let changed = false;
    hoverObserver = new MutationObserver(() => { changed = true; });
    hoverObserver.observe(container, { childList: true, subtree: true, attributes: true });
    setTimeout(() => {
      hoverObserver.disconnect();
      if (changed) {
        sendEvent({ type: 'hover', selector: SelectorEngine.getBestSelector(hoverElement).selector });
      }
    }, 200);
  }, 600);
}, { capture: true });
```

#### Scroll (meaningful only)

Scroll events are recorded only when:
- The scroll target is **not** `window` / `document.documentElement`, **or**
- A `MutationObserver` detects new nodes within 300 ms of the scroll (infinite-scroll pattern).

#### Drag and Drop

```js
let dragSourceEl = null;
document.addEventListener('dragstart', (e) => { dragSourceEl = e.target; }, { capture: true });
document.addEventListener('drop', (e) => {
  if (!isRecording || !dragSourceEl) return;
  const sourceResult = SelectorEngine.getBestSelector(dragSourceEl);
  const targetResult = SelectorEngine.getBestSelector(e.target);
  sendEvent({
    type: 'dragAndDrop',
    selector: sourceResult.selector,
    targetSelector: targetResult.selector,
    targetX: e.clientX, targetY: e.clientY  // coordinate fallback
  });
  dragSourceEl = null;
}, { capture: true });
```

#### File Upload

```js
document.addEventListener('change', (e) => {
  if (!isRecording) return;
  if (e.target.type !== 'file') return;
  const file = e.target.files[0];
  sendEvent({
    type: 'fileUpload',
    selector: SelectorEngine.getBestSelector(e.target).selector,
    filePath: file ? `PLACEHOLDER_REPLACE_WITH_REAL_PATH/${file.name}` : ''
  });
}, { capture: true });
```

#### Native Select

```js
document.addEventListener('change', (e) => {
  if (!isRecording || e.target.tagName !== 'SELECT') return;
  sendEvent({
    type: 'selectOption',
    selector: SelectorEngine.getBestSelector(e.target).selector,
    value: e.target.value
  });
}, { capture: true });
```

#### SPA Navigation

```js
const originalPushState = history.pushState;
history.pushState = function (...args) {
  originalPushState.apply(this, args);
  if (isRecording) sendEvent({ type: 'navigate', url: location.href });
};
window.addEventListener('popstate', () => {
  if (isRecording) sendEvent({ type: 'navigate', url: location.href });
});
```

### 7.4 Traffic-Light Overlay

While `isRecording` is true, a throttled `mousemove` handler evaluates the element under the cursor every 50 ms:

```js
let lastOverlayEl = null;
const THROTTLE_MS = 50;
let lastThrottle = 0;

document.addEventListener('mousemove', (e) => {
  if (!isRecording) return;
  const now = Date.now();
  if (now - lastThrottle < THROTTLE_MS) return;
  lastThrottle = now;

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === lastOverlayEl) return;

  if (lastOverlayEl) lastOverlayEl.style.outline = '';
  lastOverlayEl = el;

  const { score } = SelectorEngine.getBestSelector(el);
  const color = score >= 75 ? 'rgba(46,204,113,0.8)'  // green
              : score >= 40 ? 'rgba(241,196,15,0.8)'   // amber
                            : 'rgba(231,76,60,0.8)';   // red
  el.style.outline = `3px solid ${color}`;
}, { passive: true });
```

Overlay is cleaned up on `mouseleave` or when recording stops.

### 7.5 `VALIDATE_SELECTOR_IN_PAGE` Handler

Receives a relay from the popup via the background:

```js
case 'VALIDATE_SELECTOR_IN_PAGE': {
  const result = SelectorEngine.getScore(message.selector);
  // Highlight matched elements briefly
  if (result.count > 0) {
    const elements = SelectorEngine.scopedQuerySelectorAll(message.selector, document);
    elements.forEach(el => { el.style.outline = '3px solid #7c3aed'; });
    setTimeout(() => elements.forEach(el => { el.style.outline = ''; }), 1500);
  }
  return result;
}
```

### 7.6 `EXECUTE_STEP` Handler (Replay)

```js
case 'EXECUTE_STEP': {
  return await executeStep(message.event);
}

async function executeStep(event) {
  if (event.type === 'navigate' || event.type === 'closeContext') return { ok: true, skipped: true };

  if (event.type === 'wait') {
    await new Promise(r => setTimeout(r, event.duration || 1000));
    return { ok: true };
  }

  if (event.type === 'scroll') {
    // ... window or element scroll
    return { ok: true };
  }

  if (!event.selector) return { ok: true, skipped: true };

  const el = document.querySelector(event.selector);
  if (!el) return { ok: false, error: `Selector not found: ${event.selector}` };

  el.scrollIntoView({ block: 'center', behavior: 'instant' });

  switch (event.type) {
    case 'click':       el.click(); break;
    case 'fill':        setNativeValue(el, event.value); break;  // uses native input setter
    case 'selectOption': el.value = event.value; el.dispatchEvent(new Event('change', { bubbles: true })); break;
    case 'keypress':    el.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, bubbles: true })); break;
    case 'hover':       el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); break;
    default:            return { ok: true, skipped: true };
  }
  return { ok: true };
}
```

`setNativeValue` uses the React-compatible native input setter trick to trigger controlled component state updates:

```js
function setNativeValue(el, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
```

---

## 8. Selector Engine (`modules/selectors.js`)

The engine is wrapped in an IIFE and exposed as the global `const SelectorEngine`. It is loaded in both content scripts and (if needed) background context.

### 8.1 Scoring Algorithm

`buildCandidates(element, root)` generates all candidate selectors for an element and returns them as `{selector, score}` pairs:

| Priority | Attribute | Base score | Penalty condition | Penalty |
|----------|-----------|-----------|-------------------|---------|
| 1 | `data-testid` | 100 | — | — |
| 2 | `data-cy` | 100 | — | — |
| 3 | Static `id` | 85 | Matches `UNSTABLE_PATTERN` | −50 |
| 4 | `aria-label` | 75 | — | — |
| 5 | `role` attribute | 72 | — | — |
| 6 | `name` attribute | 70 | — | — |
| 7 | `placeholder` | 65 | — | — |
| 8 | Visible text (`innerText`, ≤ 50 chars, no long number runs) | 60 | — | — |
| 9 | First CSS class | 30 | Matches `UNSTABLE_PATTERN` | −50 |
| 10 | Tag name only | 10 | — | — |
| 11 | `nth-child` positional | 5 | — | — |

`UNSTABLE_PATTERN = /(\d{3,}|css-|Mui|chakra-|ng-|star-)/i`

### 8.2 Uniqueness and Ancestor Climbing

`buildBestSelectorForRoot(el, root)` iterates candidates from highest score to lowest:

1. If `scopedQuerySelectorAll(selector, root).length === 1` → return selector.
2. If count > 1 → climb up to 5 ancestors looking for a stable scoping parent (`id` or `data-testid`). If a scoped selector like `#login-form [name="email"]` is unique → return it.
3. After all candidates fail → call `buildPositionalSelector(el, root)` as guaranteed fallback.

This ensures the algorithm **always returns a non-null selector**.

### 8.3 `scopedQuerySelectorAll(selector, root)`

A recursive function that:
1. Queries `root.querySelectorAll(selector)` and accumulates results.
2. Iterates every element with `querySelectorAll('*')` and recurses into any `element.shadowRoot`.

This allows selectors to be evaluated across the full shadow tree without needing native shadow-piercing support.

### 8.4 Shadow DOM Chain (`buildShadowSelector`)

When an element's `getRootNode()` returns a `ShadowRoot`, the engine builds a `>>>` chain:

```
host-selector >>> inner-selector
```

For nested shadow roots, each level adds another `>>>` segment. The result is stored verbatim in `event.selector` and each compiler translates the `>>>` notation to its own shadow-piercing syntax:

| Framework | Translation |
|-----------|-------------|
| Playwright | Native `>>>` supported in `page.locator('host >>> button')` |
| Cypress | `.shadow()` chained command (plugin required) |
| Selenium | `driver.executeScript("return arguments[0].shadowRoot", host).querySelector(inner)` |
| Playwright Python | Same as TypeScript — `>>>` natively supported |

### 8.5 Iframe Chain (`getFrameChain`)

Each content script instance calls `getFrameChain()` on initialisation:

```js
function getFrameChain() {
  const chain = [];
  let win = window;
  while (win !== win.top) {
    const frameEl = win.frameElement;
    if (!frameEl) break;
    chain.unshift(buildBestSelectorForRoot(frameEl, frameEl.ownerDocument));
    win = win.parent;
  }
  return chain;  // e.g. ["iframe[name='stripe-checkout']"]
}
```

The `frameChain` array is attached to every event emitted from within an iframe.

### 8.6 `getBestWithCandidates(element)` (called from `content.js`)

Returns both the primary selector and up to 6 alternatives:

```js
function getBestWithCandidates(element) {
  const primary = SelectorEngine.getBestSelector(element);
  const candidates = buildCandidates(element, document);
  candidates.sort((a, b) => b.score - a.score);

  const seen = new Set([primary.selector]);
  const alternatives = [];
  for (const c of candidates) {
    if (seen.has(c.selector)) continue;
    seen.add(c.selector);
    const count = scopedQuerySelectorAll(c.selector, document).length;
    if (count >= 1) {
      alternatives.push({ ...c, unique: count === 1 });
    }
    if (alternatives.length >= 6) break;
  }
  return { ...primary, selectorCandidates: alternatives };
}
```

### 8.7 `getScore(selector)` — Real-time Validation

Used by the popup's inline selector editor to compute live health indicators:

```js
getScore(selector) {
  const matches = scopedQuerySelectorAll(selector, document);
  const count = matches.length;
  // Heuristic score from selector text characteristics
  let score = scoreFromSelectorText(selector);
  if (!unique && count > 1) score = Math.floor(score * 0.5);
  if (UNSTABLE_PATTERN.test(selector)) score -= 50;
  return { valid: true, unique: count === 1, count, score: Math.max(0, score) };
}
```

---

## 9. Assertion Engine (`modules/assertion-engine.js`)

### 9.1 Trigger Points

After each `click` or `fill` event is emitted, `content.js` activates a short observation window (800 ms) during which a `MutationObserver` watches `document.body` for significant DOM changes.

### 9.2 Detection Heuristics

| Change detected | Suggestion type | Selector / data captured |
|---|---|---|
| `window.location.href` changed | `urlChanged` | New URL |
| Node with `role="alert"`, `role="status"`, or class matching `/toast\|notification\|alert\|snackbar\|success\|error/i` appears | `elementVisible` | Best selector for the new node; `innerText` |
| Element with `role="dialog"` or `aria-modal="true"` appears | `modalVisible` | Selector for the dialog |
| Element that existed before the action is no longer in the DOM | `elementHidden` | Selector for the removed element |

### 9.3 Suggestion Lifecycle

```
content.js detects change
  → sends ADD_ASSERTION { type, selector, expectedUrl, … } to background
    → background appends to state.suggestedAssertions (accepted: null)
      → broadcast STATE_UPDATED
        → popup renders suggestion card with Accept / Discard buttons
          → user clicks Accept → ACCEPT_ASSERTION → accepted: true
          → user clicks Discard → DISCARD_ASSERTION → accepted: false
```

Only assertions with `accepted === true` are included in the final compiled output.

---

## 10. Code Compilers (`modules/compilers.js`)

`Compilers` is an IIFE-wrapped object loaded in the popup context. It exposes four compiler functions and a Page Object Model generator.

### 10.1 Compiler Input

All compilers receive the same input object:

```js
{
  events: RecordedEvent[],
  tabs: Record<string, TabEntry>,
  suggestedAssertions: AssertionSuggestion[],  // only accepted ones passed in
  includePOM: boolean,
  includeA11y: boolean
}
```

### 10.2 Event-to-Code Mapping

The following table shows the output for each event type across all four frameworks.

#### Navigate

| Framework | Generated code |
|---|---|
| Playwright TS | `await page.goto("url");` |
| Playwright PY | `page.goto("url")` |
| Cypress | `cy.visit("url");` |
| Selenium | `await driver.get("url");` |

#### Click

| Framework | Generated code |
|---|---|
| Playwright TS | `await page.click("sel");` |
| Playwright PY | `page.click("sel")` |
| Cypress | `cy.get("sel").click();` |
| Selenium | `await driver.findElement(By.css("sel")).click();` |

#### Fill

| Framework | Generated code |
|---|---|
| Playwright TS | `await page.fill("sel", "value");` |
| Playwright PY | `page.fill("sel", "value")` |
| Cypress | `cy.get("sel").clear().type("value");` |
| Selenium | `await driver.findElement(By.css("sel")).sendKeys("value");` |

#### Keypress

| Framework | Generated code |
|---|---|
| Playwright TS | `await page.keyboard.press("Enter");` |
| Playwright PY | `page.keyboard.press("Enter")` |
| Cypress | `cy.get("sel").type("{enter}");` |
| Selenium | `await driver.findElement(By.css("sel")).sendKeys(Keys.RETURN);` |

#### Hover

| Framework | Generated code |
|---|---|
| Playwright TS | `await page.hover("sel");` |
| Playwright PY | `page.hover("sel")` |
| Cypress | `cy.get("sel").trigger("mouseover");` |
| Selenium | `await new Actions(driver).moveToElement(el).perform();` |

#### Drag and Drop

| Framework | Generated code |
|---|---|
| Playwright TS | `await page.dragAndDrop("src", "tgt");` |
| Playwright PY | `page.drag_and_drop("src", "tgt")` |
| Cypress | `cy.get("src").drag("tgt");` |
| Selenium | `await new Actions(driver).dragAndDrop(src, tgt).perform();` |

#### Select Option

| Framework | Generated code |
|---|---|
| Playwright TS | `await page.selectOption("sel", "value");` |
| Playwright PY | `page.select_option("sel", "value")` |
| Cypress | `cy.get("sel").select("value");` |
| Selenium | `await new Select(el).selectByValue("value");` |

#### New Tab (click with `opensNewContext: true`)

| Framework | Generated code |
|---|---|
| Playwright TS | `const [newPage] = await Promise.all([context.waitForEvent('page'), page.click("sel")]);` |
| Playwright PY | `with page.context.expect_page() as new_page_info: page.click("sel")` |
| Cypress | `cy.get("sel").click(); // NOTE: multi-tab limited in Cypress — see cy.origin()` |
| Selenium | `await driver.findElement(By.css("sel")).click(); const [handle] = newHandles;` |

### 10.3 Shadow DOM Selector Translation

When `event.selector` contains `>>>`:

```js
function translateShadowSelector(sel, framework) {
  if (!sel.includes('>>>')) return sel;
  const parts = sel.split(' >>> ');
  if (framework === 'playwright-ts' || framework === 'playwright-python') return sel;
  if (framework === 'cypress') {
    return parts.map((p, i) => i === 0 ? `cy.get('${p}').shadow()` : `.find('${p}')`).join('');
  }
  if (framework === 'selenium') {
    return `// Shadow DOM: manual traversal required\n// ${sel}`;
  }
}
```

### 10.4 Page Object Model Generation

When `includePOM` is true, consecutive events sharing the same URL domain are grouped into "pages". For each page, a class is generated:

```typescript
// Playwright TypeScript example
export class LoginPage {
  constructor(private page: Page) {}

  get usernameInput() { return this.page.locator('[name="username"]'); }
  get submitButton()  { return this.page.locator('[data-testid="login-submit"]'); }

  async fillUsername(value: string) { await this.usernameInput.fill(value); }
  async clickSubmit()               { await this.submitButton.click(); }
}
```

The test file then imports and uses these classes.

### 10.5 Assertion Code Generation

| Assertion type | Playwright TS | Playwright PY | Cypress | Selenium |
|---|---|---|---|---|
| `urlChanged` | `await expect(page).toHaveURL("url");` | `expect(page).to_have_url("url")` | `cy.url().should("eq", "url");` | `await driver.wait(until.urlIs("url"));` |
| `elementVisible` | `await expect(page.locator("sel")).toBeVisible();` | `expect(page.locator("sel")).to_be_visible()` | `cy.get("sel").should("be.visible");` | `await driver.wait(until.elementIsVisible(el));` |
| `elementHidden` | `await expect(page.locator("sel")).toBeHidden();` | `expect(page.locator("sel")).to_be_hidden()` | `cy.get("sel").should("not.exist");` | `await driver.wait(until.stalenessOf(el));` |
| `modalVisible` | `await expect(page.locator("[role=dialog]")).toBeVisible();` | `expect(page.locator("[role=dialog]")).to_be_visible()` | `cy.get("[role=dialog]").should("be.visible");` | `await driver.wait(until.elementIsVisible(dialog));` |

---

## 11. Popup UI (`popup.html` / `popup.js`)

### 11.1 HTML Structure

```
popup.html
├── #popup-root
│   ├── .popup-header         — title, status dot, tab counter
│   ├── .tab-bar              — [Recorder] [Logs ●N]
│   │
│   ├── #tab-recorder (active by default)
│   │   ├── .control-section  — Record / Stop / Assertion Mode buttons
│   │   ├── .editor-toolbar   — ⊞ Expand all  ⊟ Collapse all
│   │   ├── #event-list       — rendered event rows + insert zones
│   │   ├── .assertion-cards  — auto-suggestion cards
│   │   └── .export-section   — framework tabs, options, textarea, Copy/Download
│   │
│   └── #tab-logs
│       ├── .log-controls     — Level ▾  Source ▾  [Copy] [Clear]
│       └── #log-list         — scrollable log entry rows
```

### 11.2 Rendering Pipeline

```
STATE_UPDATED received (or popup opens)
  → recorderState = message.state
  → if (suppressNextStateRender) { suppressNextStateRender = false; return; }
  → render()
    → renderHeader()      — update status dot, tab counter
    → renderEventList()   — rebuild #event-list DOM
    → renderAssertions()  — rebuild suggestion cards
    → renderExport()      — re-run active compiler, update textarea
    → updateEditorToolbar() — show/hide ⊞/⊟ based on candidate presence
```

### 11.3 `suppressNextStateRender` Flag

When the popup performs a local DOM mutation (e.g., after clicking **Use** on a selector candidate), it sets `suppressNextStateRender = true` immediately before sending `UPDATE_EVENT_SELECTOR` to the background. The next `STATE_UPDATED` message from the background skips `render()` and clears the flag. This prevents a full re-render from destroying in-progress UI state (open candidate panels, edit fields).

### 11.4 Event Row Rendering

```js
function buildEventRow(event, index) {
  const row = createElement('div', 'event-row');
  row.dataset.id = event.id;
  // Type badge, health dot, selector text, value, replay status
  // Delete button → DELETE_EVENT
  // Drag handle → ondragstart / ondrop → REORDER_EVENTS
  // Selector click → editable span → UPDATE_EVENT_SELECTOR
  // ⚙ button → toggles candidates panel below the row
  return row;
}
```

### 11.5 Insert Zones

Between every pair of rows (and before the first and after the last), a thin `.insert-zone` div is rendered:

```js
function buildInsertZone(afterIndex) {
  const zone = createElement('div', 'insert-zone');
  const btn = createElement('button', 'insert-btn', '+');
  btn.addEventListener('click', () => {
    // Replace zone with inline form
    zone.replaceWith(buildInsertForm(afterIndex));
  });
  zone.appendChild(btn);
  return zone;
}
```

The insert form submits `INSERT_EVENT` with `afterIndex` and the form fields.

### 11.6 Candidates Panel

```js
function buildCandidatesPanel(event) {
  const panel = createElement('div', 'candidates-panel');
  for (const cand of event.selectorCandidates) {
    const row = buildCandidateRow(event, cand);
    panel.appendChild(row);
  }
  return panel;
}

function buildCandidateRow(event, cand) {
  // Score dot (green/amber/red)
  // Selector text
  // [Test] → VALIDATE_SELECTOR → show count badge
  // [Use]  → suppressNextStateRender = true → UPDATE_EVENT_SELECTOR → patch DOM directly
  // [Discard] → DISCARD_SELECTOR_CANDIDATE
}
```

### 11.7 Replay Status Display

```js
function clearReplayStatus() {
  document.querySelectorAll('.replay-status').forEach(el => {
    el.textContent = '';
    el.className = 'replay-status';
  });
}

function setReplayStatus(eventId, status, error) {
  const row = document.querySelector(`.event-row[data-id="${eventId}"]`);
  if (!row) return;
  const span = row.querySelector('.replay-status');
  const icons = { ok: '✓', fail: '✗', running: '⟳', skip: '–' };
  span.textContent = icons[status] || '';
  span.className = `replay-status replay-status-${status}`;
  if (status === 'fail') row.classList.add('replay-fail');
  if (error) row.title = error;
}
```

### 11.8 Log Panel

```js
function renderLogs(logs) {
  const levelFilter  = document.getElementById('log-level-filter').value;  // ALL/info/warn/error/debug
  const sourceFilter = document.getElementById('log-source-filter').value; // ALL/background/content/popup

  const filtered = logs.filter(l =>
    (levelFilter  === 'ALL' || l.level  === levelFilter) &&
    (sourceFilter === 'ALL' || l.source === sourceFilter)
  );

  logList.innerHTML = '';
  filtered.slice(-200).forEach(l => {  // display last 200 after filter
    const el = createElement('div', `log-entry log-${l.level}`);
    el.textContent = `[${new Date(l.ts).toISOString().slice(11,23)}] [${l.source}] ${l.msg}`;
    logList.appendChild(el);
  });
  logList.scrollTop = logList.scrollHeight;
}
```

---

## 12. Inter-Context Message Protocol

### 12.1 Message Direction Map

```
Content script → Background:
  RECORD_EVENT, LOG_ENTRY, ADD_ASSERTION

Popup → Background:
  START_RECORDING, STOP_RECORDING, TOGGLE_ASSERTION_MODE, GET_STATE
  DELETE_EVENT, REORDER_EVENTS, INSERT_EVENT
  UPDATE_EVENT_SELECTOR, DISCARD_SELECTOR_CANDIDATE
  ACCEPT_ASSERTION, DISCARD_ASSERTION, CLEAR_SESSION
  LOG_ENTRY, CLEAR_LOGS
  VALIDATE_SELECTOR (relay → content script)
  DOWNLOAD_FILE
  REPLAY_EVENTS

Background → Popup (broadcast):
  STATE_UPDATED, LOGS_UPDATED
  REPLAY_STARTED, REPLAY_STEP_RESULT, REPLAY_FINISHED

Background → Content scripts (broadcast):
  STATE_UPDATED (so content scripts update isRecording / isAssertionMode)
```

### 12.2 Message Schema Details

```typescript
// RECORD_EVENT (content → background)
{ type: 'RECORD_EVENT', event: Partial<RecordedEvent> }

// STATE_UPDATED (background → all)
{ type: 'STATE_UPDATED', state: RecorderState }

// REPLAY_STEP_RESULT (background → popup)
{ type: 'REPLAY_STEP_RESULT', eventId: string, status: 'ok'|'fail'|'running'|'skip', error?: string }

// VALIDATE_SELECTOR (popup → background, relayed to content)
{ type: 'VALIDATE_SELECTOR', selector: string, tabId: number }
// → Response: { ok: boolean, result: { valid, unique, count, score } }

// INSERT_EVENT (popup → background)
{ type: 'INSERT_EVENT', event: Partial<RecordedEvent>, afterIndex: number | null }

// DOWNLOAD_FILE (popup → background)
{ type: 'DOWNLOAD_FILE', filename: string, content: string, mimeType: string }
```

---

## 13. Multi-Tab Session Lifecycle

```
User clicks Record in tab #4
  background: StateStore.reset() → state.tabs[4] = {role:'primary'} → isRecording = true
  background: emits navigate event for initialUrl

User action opens a new tab (#7) via window.open or target="_blank"
  background: tabs.onCreated fires (tab.openerTabId === 4, state.tabs[4] exists)
  background: finds most recent click event in tab 4 → sets opensNewContext = true, newTabId = 7
  background: state.tabs[7] = { role: 'secondary', openerTabId: 4 }
  background: tabContextMap[7] = 4
  content.js in tab 7: initialises, detects isRecording = true, starts capturing

User closes tab #7
  background: tabs.onRemoved fires
  background: emits closeContext event with tabId: 7
  background: delete state.tabs[7]
  recording continues in tab #4

User clicks Stop Recording
  background: isRecording = false → broadcast

Compiler receives events from both tabs:
  → Detects opensNewContext = true on click event in tab 4
  → Wraps next action in new-page-wait code
  → Detects closeContext event → wraps subsequent actions back in original page context
```

---

## 14. Replay Engine

### 14.1 Flow

```
popup: REPLAY_EVENTS message → background
background:
  1. Sends REPLAY_STARTED → popup clears all status indicators, disables ▶ button
  2. Queries active tab → tabId
  3. Starts async loop (returns { ok: true } immediately to popup)
     For each event:
       a. Sends REPLAY_STEP_RESULT(id, 'running')
       b. If navigate: browser.tabs.update(url) → waits for 'complete' status (5 s timeout) → +600 ms settle → REPLAY_STEP_RESULT(id, 'ok')
       c. If closeContext: REPLAY_STEP_RESULT(id, 'skip')
       d. Else: browser.tabs.sendMessage(tabId, EXECUTE_STEP) → await response → REPLAY_STEP_RESULT(id, ok/fail)
       e. 350 ms delay between non-navigate steps
  4. Sends REPLAY_FINISHED → popup re-enables ▶ button
```

### 14.2 `EXECUTE_STEP` in Content Script

The content script's `executeStep(event)` function:

1. Returns `{ ok: true, skipped: true }` for `navigate` and `closeContext` (handled by the background).
2. For `wait`: `await new Promise(r => setTimeout(r, event.duration || 1000))`.
3. For all other types: `document.querySelector(event.selector)` → if null, `{ ok: false, error: 'Selector not found: …' }` → otherwise performs the DOM action and returns `{ ok: true }`.

---

## 15. Logging Subsystem

### 15.1 Log Producers

| Context | Mechanism | `source` field |
|---|---|---|
| `background.js` | `bgLog(level, msg)` → `appendLog()` | `'background'` |
| `content.js` | `sendLog(level, msg)` → `LOG_ENTRY` message | `'content'` |
| `popup.js` | `popupLog(level, msg)` → `LOG_ENTRY` message | `'popup'` |

### 15.2 Storage

`appendLog` reads state, pushes the log entry, trims to `MAX_LOGS = 500` (ring buffer, keeps newest), writes state, and broadcasts `LOGS_UPDATED` with the new `logs` array.

### 15.3 Popup Display

The Logs panel renders the last 200 entries after applying level and source filters. The error badge on the Logs tab counts `ERROR`-level entries accumulated since the last time the panel was open.

---

## 16. Build System

### 16.1 Firefox (`build.ps1`)

1. Reads all source files into an in-memory `ZipArchive` using `System.IO.Compression`.
2. Every entry name uses **forward slashes** (mandatory — Firefox rejects backslash paths in XPIs).
3. Uses a timestamped temp file (`e2e-recorder-v2.YYYYMMDD-HHmmss.tmp.xpi`) to avoid locking issues if Firefox has the previous XPI loaded.
4. Old `.tmp.xpi` files are cleaned up on each run.
5. Renames temp file to `dist/e2e-recorder-v2.xpi`.

### 16.2 Chrome (`build_Chrome.ps1`)

Identical logic, with two differences:

1. Packs `manifest_chrome.json` as `manifest.json` inside the ZIP (original filename excluded).
2. Output: `dist/e2e-recorder-v2-chrome.zip`.

### 16.3 Shell Scripts (`build.sh` / `build_Chrome.sh`)

Python-based fallback for macOS and Linux using the `zipfile` standard library. Identical entry list and forward-slash enforcement.

### 16.4 `.cmd` Wrappers

`build.cmd` and `build_Chrome.cmd` are thin wrappers that call the corresponding `.ps1` with `powershell -ExecutionPolicy Bypass -File`.

---

## 17. Cross-Browser Compatibility Layer

### 17.1 API Shim

Every JavaScript file that calls browser APIs begins with:

```js
if (typeof browser === 'undefined') { var browser = chrome; }
```

This must appear **outside** any IIFE so that `browser` is a `var` in the global scope and accessible throughout the file.

### 17.2 Background Context Differences

| | Firefox | Chrome |
|--|---------|--------|
| Background type | Classic page (`"scripts": [...]`) | Service worker (`"service_worker": "..."`) |
| Module loading | Files declared in order; `StateStore` in scope before `background.js` | Single entry point; must call `importScripts('modules/state-store.js')` |
| Lifetime | Persistent (not unloaded) | Can be terminated and restarted by Chrome |
| `importScripts` | Not needed | Required for dependencies |
| `crypto.randomUUID()` | Available | Available |

### 17.3 State Persistence During Service Worker Restart (Chrome)

Because Chrome can terminate the service worker at any time, no state is stored in variables inside `background.js`. Every message handler reads fresh state from `storage.local` before acting. The ephemeral `tabContextMap` is the only exception — it is intentionally not persisted because it is only needed within a browser session and cannot be meaningfully restored after a service worker restart.

---

## 18. Security Model

### 18.1 Data Isolation

- All recorded data lives in `browser.storage.local`, which is sandboxed to the extension's origin. No other website or extension can read it.
- The extension makes **zero** outbound network requests. No telemetry, no analytics, no external script loading.
- Content scripts are isolated from page scripts via the browser's content script sandbox. The page cannot access `StateStore`, `SelectorEngine`, or any extension-internal variable.

### 18.2 Sensitive Data Masking

Password fields and inputs matching `/(password|passwd|cvv|secret|token|api[_-]?key)/i` have their value replaced with `ENV_SECRET_PARAM` before the event is sent to the background. The actual value is never written to `storage.local`.

### 18.3 Content Security Policy

The extension does not declare an explicit `content_security_policy` in the manifest, so the MV3 default applies:

```
script-src 'self'; object-src 'self';
```

No `eval`, no inline scripts in HTML (`popup.html` only references external `.js` files), no remote scripts.

### 18.4 Host Permissions

`<all_urls>` is required because the developer may test on any domain (localhost, staging, third-party SaaS). The content script is **passive** when `isRecording === false` — it is present but attaches no listeners that read DOM data.

---

## 19. Performance Constraints

| Constraint | Value | Rationale |
|---|---|---|
| Mouse-move throttle | 50 ms | Prevents selector computation on every pixel movement |
| Fill debounce | 400 ms | Emits one `fill` event per typing burst |
| Hover dwell threshold | 600 ms | Avoids capturing accidental hovers |
| Hover DOM observation window | 200 ms | Short MutationObserver window limits performance impact |
| Assertion observation window | 800 ms | Long enough to catch delayed DOM reactions (toasts, redirects) |
| Scroll correlation window | 300 ms | Links scroll events to subsequent content loads |
| `MAX_LOGS` ring buffer | 500 entries | Bounds `storage.local` growth |
| Replay inter-step delay | 350 ms | Gives the page time to react between simulated actions |
| Navigate settle delay | 600 ms | Lets the content script initialise after page load |
| Navigate timeout | 5 000 ms | Safety timeout for tabs.onUpdated listener |
| Ancestor climb limit | 5 levels | Prevents infinite loop in degenerate DOM structures |
| Candidate selectors per event | 6 | Balance between choice and UI noise |

---

## 20. Known Limitations

| Area | Limitation | Workaround |
|---|---|---|
| Cross-origin iframes | Traffic-light overlay cannot be shown inside cross-origin frames (browser security). Event capture still works. | None; document as expected behaviour. |
| File upload paths | The real absolute file path cannot be captured. A `PLACEHOLDER_REPLACE_WITH_REAL_PATH/<name>` token is used. | Replace the placeholder manually in the generated script. |
| Selenium + Shadow DOM | Selenium has no native shadow-piercing API. Generated code uses `executeScript` with a comment. | Review and adapt the generated Selenium script manually. |
| Cypress + multi-tab | Cypress does not support true multi-tab recording. A `cy.origin()` suggestion is included in comments. | Use `cy.origin()` or split into two specs. |
| Canvas / WebGL drag targets | If the drop target is a `<canvas>`, only coordinates are captured, not a selector. | Use the coordinate-based drag API of the target framework. |
| Service worker restart (Chrome) | Chrome may terminate the service worker mid-session. All state is in `storage.local` so it survives; the ephemeral `tabContextMap` is lost. | Multi-tab detection may miss tabs opened after a SW restart within the same session. |
| Firefox XPI signing | Production XPI distribution on Firefox requires AMO review or a Developer Edition build. | Load temporarily via `about:debugging` or publish through AMO. |
| `has-text()` in Cypress | Playwright's `:has-text()` pseudo-class is stripped when compiling for Cypress. | The compiler replaces it with a `cy.contains()` call where possible. |
| React-controlled inputs | Standard `.click()` may not trigger React state updates. | The `setNativeValue` helper uses the React native input setter; complex components may still need manual adjustment. |
