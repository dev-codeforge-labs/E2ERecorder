/**
 * background.js — Service worker for E2E Recorder v2.
 * Handles all state mutations and coordinates between popup and content scripts.
 * Uses StateStore (from state-store.js) as the single source of truth.
 *
 * Firefox MV3: loaded as a classic script via "scripts": [...] array — StateStore
 *              is already in scope from state-store.js loaded before this file.
 * Chrome MV3:  loaded as the sole service_worker entry point — must importScripts
 *              state-store.js itself (Chrome supports importScripts in classic SW).
 */

// Chrome/Firefox compatibility shim — must come before any browser.* call
if (typeof browser === 'undefined') { var browser = chrome; } // eslint-disable-line no-undef

// Chrome loads this as the sole entry point, so import dependencies explicitly
if (typeof StateStore === 'undefined') {
  importScripts('modules/state-store.js');
}

// Ephemeral map for tracking which tab opened which new tab (tabId → openerTabId).
// This is intentionally NOT persisted — it is only needed within the lifecycle of a browser session.
const tabContextMap = {};

// ─── Internal logger ──────────────────────────────────────────────────────────

async function appendLog(level, source, msg) {
  try {
    const state = await StateStore.get();
    if (!state.logs) state.logs = [];
    state.logs.push({ ts: Date.now(), level, source, msg: String(msg) });
    if (state.logs.length > StateStore.MAX_LOGS) {
      state.logs = state.logs.slice(-StateStore.MAX_LOGS);
    }
    await StateStore.set(state);
    browser.runtime.sendMessage({ type: 'LOGS_UPDATED', logs: state.logs }).catch(() => {});
  } catch (e) {
    console.error('[E2ERecorder] appendLog failed:', e);
  }
}

function bgLog(level, msg) {
  const text = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
  console[level] && console[level]('[E2ERecorder bg]', text);
  appendLog(level, 'background', text);
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

/**
 * Broadcast a message to all extension contexts (popup, content scripts).
 * @param {object} message
 */
async function broadcast(message) {
  // Notify popup (and any other extension pages)
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // Popup may not be open — ignore
  }

  // Notify all content scripts
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, message);
      } catch {
        // Tab may not have content script — ignore
      }
    }
  } catch {
    // Ignore query errors
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('[E2ERecorder background] Error handling message:', message.type, err);
    sendResponse({ error: err.message });
  });
  // Return true to indicate async response
  return true;
});

/**
 * Main message dispatch.
 * @param {object} message
 * @param {browser.runtime.MessageSender} sender
 * @returns {Promise<any>}
 */
async function handleMessage(message, sender) {
  switch (message.type) {

    // ── Record a new interaction event ──
    case 'RECORD_EVENT': {
      const state = await StateStore.get();
      if (!state.isRecording) return { ok: false, reason: 'Not recording' };

      const event = {
        ...message.event,
        id: message.event.id || crypto.randomUUID(),
        tabId: sender.tab ? sender.tab.id : message.event.tabId,
        frameId: sender.frameId || 0,
        timestamp: message.event.timestamp || Date.now()
      };

      state.events.push(event);
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      bgLog('info', `Event: [${event.type}] ${event.selector || event.url || event.key || ''} tab=${event.tabId} frame=${event.frameId}`);
      return { ok: true };
    }

    // ── Append a log entry (from any context: content, popup) ──
    case 'LOG_ENTRY': {
      const { level = 'info', source = 'unknown', msg = '' } = message;
      await appendLog(level, source, msg);
      return { ok: true };
    }

    // ── Clear all log entries ──
    case 'CLEAR_LOGS': {
      const state = await StateStore.get();
      state.logs = [];
      await StateStore.set(state);
      browser.runtime.sendMessage({ type: 'LOGS_UPDATED', logs: [] }).catch(() => {});
      return { ok: true };
    }

    // ── Start a new recording session ──
    case 'START_RECORDING': {
      await StateStore.reset();
      const state = await StateStore.get();
      state.isRecording = true;
      state.initialUrl = message.initialUrl || '';

      const tabId = sender.tab ? sender.tab.id : message.tabId;
      if (tabId) {
        state.tabs[tabId] = { role: 'primary', url: message.initialUrl || '' };
      }

      // Emit initial navigate event
      if (message.initialUrl) {
        state.events.push({
          id: crypto.randomUUID(),
          type: 'navigate',
          url: message.initialUrl,
          tabId,
          frameId: 0,
          frameChain: [],
          timestamp: Date.now()
        });
      }

      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      bgLog('info', `Recording started: ${message.initialUrl || '(no url)'} tab=${tabId}`);
      return { ok: true };
    }

    // ── Stop the current recording session ──
    case 'STOP_RECORDING': {
      const state = await StateStore.get();
      state.isRecording = false;
      state.isAssertionMode = false;
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      bgLog('info', `Recording stopped. Total events: ${state.events.length}`);
      return { ok: true };
    }

    // ── Toggle assertion capture mode ──
    case 'TOGGLE_ASSERTION_MODE': {
      const state = await StateStore.get();
      state.isAssertionMode = !state.isAssertionMode;
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Return the current state to caller ──
    case 'GET_STATE': {
      const state = await StateStore.get();
      return { ok: true, state };
    }

    // ── Delete an event by id ──
    case 'DELETE_EVENT': {
      const state = await StateStore.get();
      state.events = state.events.filter(e => e.id !== message.eventId);
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Reorder events array ──
    case 'REORDER_EVENTS': {
      const state = await StateStore.get();
      // message.events is the new ordered array of event objects
      state.events = message.events;
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Insert a manually-authored event at a specific index ──
    case 'INSERT_EVENT': {
      const state = await StateStore.get();
      const event = {
        ...message.event,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        manual: true
      };
      const idx = (message.afterIndex != null) ? message.afterIndex + 1 : state.events.length;
      state.events.splice(idx, 0, event);
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      bgLog('info', `Manual event inserted at index ${idx}: ${event.type}`);
      return { ok: true };
    }

    // ── Update the selector for a specific event ──
    case 'UPDATE_EVENT_SELECTOR': {
      const state = await StateStore.get();
      const ev = state.events.find(e => e.id === message.eventId);
      if (ev) {
        ev.selector = message.selector;
      }
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Accept a suggested assertion ──
    case 'ACCEPT_ASSERTION': {
      const state = await StateStore.get();
      const assertion = state.suggestedAssertions.find(a => a.id === message.assertionId);
      if (assertion) assertion.accepted = true;
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Discard a suggested assertion ──
    case 'DISCARD_ASSERTION': {
      const state = await StateStore.get();
      const assertion = state.suggestedAssertions.find(a => a.id === message.assertionId);
      if (assertion) assertion.accepted = false;
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Add a new suggested assertion (from content script assertion mode click) ──
    case 'ADD_ASSERTION': {
      const state = await StateStore.get();
      const assertion = {
        ...message.assertion,
        id: message.assertion.id || crypto.randomUUID(),
        accepted: null
      };
      state.suggestedAssertions.push(assertion);
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Clear session and reset to defaults ──
    case 'CLEAR_SESSION': {
      await StateStore.reset();
      const state = await StateStore.get();
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Discard one candidate selector from an event ──
    case 'DISCARD_SELECTOR_CANDIDATE': {
      const state = await StateStore.get();
      const ev = state.events.find(e => e.id === message.eventId);
      if (ev && ev.selectorCandidates) {
        ev.selectorCandidates = ev.selectorCandidates.filter(c => c.selector !== message.selector);
      }
      await StateStore.set(state);
      await broadcast({ type: 'STATE_UPDATED', state });
      return { ok: true };
    }

    // ── Validate a selector in a specific tab (relay to content script) ──
    case 'VALIDATE_SELECTOR': {
      const tabId = message.tabId;
      try {
        const response = await browser.tabs.sendMessage(tabId, {
          type: 'VALIDATE_SELECTOR_IN_PAGE',
          selector: message.selector
        });
        return { ok: true, result: response };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Download generated code as a file ──
    case 'DOWNLOAD_FILE': {
      try {
        const { filename, content, mimeType } = message;
        const blob = new Blob([content], { type: mimeType || 'text/plain' });
        const url = URL.createObjectURL(blob);
        await browser.downloads.download({
          url,
          filename: filename || 'e2e-test.txt',
          saveAs: true
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Replay events step by step, reporting progress to popup ──
    case 'REPLAY_EVENTS': {
      const state = await StateStore.get();
      if (!state.events.length) return { ok: false, reason: 'No events to replay' };

      const sendProgress = (eventId, status, error) => {
        browser.runtime.sendMessage({ type: 'REPLAY_STEP_RESULT', eventId, status, error }).catch(() => {});
      };

      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      let tabId = tabs[0]?.id;
      if (!tabId) return { ok: false, reason: 'No active tab' };

      // Signal start so popup can clear previous results
      browser.runtime.sendMessage({ type: 'REPLAY_STARTED' }).catch(() => {});

      // Run steps asynchronously so we return immediately and let the popup keep listening
      (async () => {
        for (const event of state.events) {
          sendProgress(event.id, 'running');

          try {
            if (event.type === 'navigate') {
              await browser.tabs.update(tabId, { url: event.url });
              // Wait for page to be ready before continuing
              await new Promise(resolve => {
                const onUpdated = (tid, info) => {
                  if (tid === tabId && info.status === 'complete') {
                    browser.tabs.onUpdated.removeListener(onUpdated);
                    resolve();
                  }
                };
                browser.tabs.onUpdated.addListener(onUpdated);
                setTimeout(resolve, 5000); // safety timeout
              });
              await new Promise(r => setTimeout(r, 600)); // let content script init
              sendProgress(event.id, 'ok');

            } else if (event.type === 'closeContext') {
              sendProgress(event.id, 'skip');

            } else {
              const resp = await browser.tabs.sendMessage(tabId, { type: 'EXECUTE_STEP', event }).catch(err => ({ ok: false, error: err.message }));
              if (resp && resp.ok) {
                sendProgress(event.id, resp.skipped ? 'skip' : 'ok');
              } else {
                sendProgress(event.id, 'fail', resp && resp.error);
              }
              await new Promise(r => setTimeout(r, 350));
            }
          } catch (err) {
            sendProgress(event.id, 'fail', err.message);
          }
        }
        browser.runtime.sendMessage({ type: 'REPLAY_FINISHED' }).catch(() => {});
        bgLog('info', 'Replay finished');
      })();

      return { ok: true };
    }

    default:
      return { ok: false, reason: `Unknown message type: ${message.type}` };
  }
}

// ─── Tab lifecycle listeners ──────────────────────────────────────────────────

browser.tabs.onCreated.addListener(async (tab) => {
  const state = await StateStore.get();
  if (!state.isRecording) return;

  const openerTabId = tab.openerTabId;
  if (openerTabId && state.tabs[openerTabId]) {
    // The opener tab's last click event opened a new context
    // Flag the most recent click event from that tab
    const lastClick = [...state.events]
      .reverse()
      .find(e => e.tabId === openerTabId && e.type === 'click');

    if (lastClick) {
      lastClick.opensNewContext = true;
      lastClick.newTabId = tab.id;
    }

    // Register new tab as secondary
    state.tabs[tab.id] = { role: 'secondary', openerTabId };
    tabContextMap[tab.id] = openerTabId;

    await StateStore.set(state);
    await broadcast({ type: 'STATE_UPDATED', state });
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const state = await StateStore.get();
  if (!state.isRecording) return;
  if (!state.tabs[tabId]) return;

  // Emit a closeContext event for the removed tab
  state.events.push({
    id: crypto.randomUUID(),
    type: 'closeContext',
    tabId,
    frameId: 0,
    frameChain: [],
    timestamp: Date.now()
  });

  delete state.tabs[tabId];
  delete tabContextMap[tabId];

  await StateStore.set(state);
  await broadcast({ type: 'STATE_UPDATED', state });
});
