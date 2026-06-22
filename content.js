/**
 * content.js — Injected into every tab and frame.
 * Captures user interactions and sends them to background.js.
 * SelectorEngine (from selectors.js) and StateStore (from state-store.js)
 * are loaded before this script by the manifest.
 */

// Chrome/Firefox compatibility shim (state-store.js already declares it, kept for safety)
if (typeof browser === 'undefined') { var browser = chrome; } // eslint-disable-line no-undef

(() => {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────────

  let isRecording = false;
  let isAssertionMode = false;

  // Per-element input debounce timers (Map<Element, timeoutId>)
  const inputDebounceMap = new Map();
  const DEBOUNCE_MS = 400;

  // Drag source element
  let dragSourceElement = null;
  let dragSourceSelector = null;

  // Hover timer + observer
  let hoverTimer = null;
  let hoverObserver = null;

  // Scroll observer
  let scrollObserver = null;
  let scrollObserverTimer = null;

  // Floating Alt+click picker
  let pickerDiv = null;

  // Masking regex for sensitive input values (passwords, credit cards, etc.)
  const SENSITIVE_PATTERN = /password|credit.?card|card.?number|cvv|ssn|social.?security/i;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_PATTERN = /^\+?[\d\s\-().]{7,}$/;

  // ─── Logger (relays to background so logs are persisted) ─────────────────────

  function sendLog(level, msg) {
    const text = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
    console[level] && console[level]('[E2ERecorder content]', text);
    browser.runtime.sendMessage({ type: 'LOG_ENTRY', level, source: 'content', msg: text }).catch(() => {});
  }

  // ─── Initialisation ──────────────────────────────────────────────────────────

  async function init() {
    // Read initial state from storage directly (avoids message round-trip)
    try {
      const state = await StateStore.get();
      isRecording = state.isRecording;
      isAssertionMode = state.isAssertionMode;
    } catch (e) {
      console.warn('[E2ERecorder] Could not read initial state:', e);
      sendLog('warn', `Init failed: ${e.message}`);
    }

    // Subscribe to storage changes for live updates
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.e2eRecorderState) return;
      const newState = changes.e2eRecorderState.newValue;
      if (!newState) return;
      isRecording = newState.isRecording;
      isAssertionMode = newState.isAssertionMode;
      updateTrafficLightMode();
    });

    // Listen for direct messages from background (e.g. selector validation relay)
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'VALIDATE_SELECTOR_IN_PAGE') {
        const result = SelectorEngine.getScore(message.selector);
        sendResponse(result);
        return true;
      }
      if (message.type === 'EXECUTE_STEP') {
        executeStep(message.event).then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      return false;
    });

    attachListeners();
    attachShadowDOMListeners(document.body || document.documentElement);
    sendInitialNavigate();
  }

  // ─── Step executor (used by replay) ─────────────────────────────────────────

  async function executeStep(event) {
    const { type, selector, value, key, ctrlKey, shiftKey, altKey, metaKey } = event;

    // Events without a DOM target
    if (type === 'navigate' || type === 'closeContext') return { ok: true, skipped: true };

    if (type === 'scroll') {
      // Best-effort: scroll the recorded container or window
      if (selector) {
        const el = document.querySelector(selector);
        if (el) el.scrollTop += (event.scrollY || 200);
        else window.scrollBy(0, event.scrollY || 200);
      } else {
        window.scrollBy(0, event.scrollY || 200);
      }
      return { ok: true };
    }

    if (!selector) return { ok: true, skipped: true };

    const el = document.querySelector(selector);
    if (!el) return { ok: false, error: `Selector not found: ${selector}` };

    switch (type) {
      case 'click':
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        break;

      case 'fill':
      case 'input': {
        el.focus();
        // Trigger React/Angular/Vue controlled input update
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (nativeInputSetter && nativeInputSetter.set) {
          nativeInputSetter.set.call(el, value || '');
        } else {
          el.value = value || '';
        }
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }

      case 'selectOption':
        el.value = value || '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;

      case 'keypress': {
        const keyOpts = { key: key || '', bubbles: true, ctrlKey: !!ctrlKey, shiftKey: !!shiftKey, altKey: !!altKey, metaKey: !!metaKey };
        el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        el.dispatchEvent(new KeyboardEvent('keyup',   keyOpts));
        break;
      }

      case 'hover':
        el.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        break;

      case 'dragAndDrop': {
        const target = event.targetSelector ? document.querySelector(event.targetSelector) : null;
        if (!target) return { ok: false, error: `Drop target not found: ${event.targetSelector}` };
        el.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
        target.dispatchEvent(new DragEvent('drop',  { bubbles: true }));
        el.dispatchEvent(new DragEvent('dragend',   { bubbles: true }));
        break;
      }

      case 'wait':
        await new Promise(r => setTimeout(r, event.duration || 1000));
        break;

      default:
        return { ok: true, skipped: true };
    }

    return { ok: true };
  }

  // ─── Initial navigate event ──────────────────────────────────────────────────

  function sendInitialNavigate() {
    // Only send from the top frame
    if (window !== window.top) return;

    // We send it; background checks if recording before persisting
    sendEvent({
      type: 'navigate',
      url: window.location.href,
      frameChain: [],
      timestamp: Date.now()
    });
  }

  // ─── Event sender ────────────────────────────────────────────────────────────

  /**
   * Send a recorded event to the background service worker.
   * @param {object} event
   */
  function sendEvent(event) {
    browser.runtime.sendMessage({
      type: 'RECORD_EVENT',
      event: {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...event
      }
    }).catch(() => {/* Extension may be reloading */});
  }

  /**
   * Send a suggested assertion to the background.
   * @param {object} assertion
   */
  function sendAssertion(assertion) {
    browser.runtime.sendMessage({
      type: 'ADD_ASSERTION',
      assertion: {
        id: crypto.randomUUID(),
        accepted: null,
        ...assertion
      }
    }).catch(() => {});
  }

  // ─── Selector helpers ────────────────────────────────────────────────────────

  function getBest(element) {
    return SelectorEngine.getBestSelector(element);
  }

  // Returns the best selector result plus all top-N candidates for the popup selector picker.
  function getBestWithCandidates(element) {
    const best = SelectorEngine.getBestSelector(element);
    const candidates = SelectorEngine.getCandidates(element);
    // Merge best into candidates list if not already there, keeping it first
    const allCandidates = candidates.some(c => c.selector === best.selector)
      ? candidates
      : [{ selector: best.selector, score: best.score, unique: true }, ...candidates];
    return { ...best, selectorCandidates: allCandidates.slice(0, 6) };
  }

  function maskSensitiveValue(element, value) {
    const type = (element.getAttribute('type') || '').toLowerCase();
    const name = (element.getAttribute('name') || '').toLowerCase();
    const label = (element.getAttribute('aria-label') || '').toLowerCase();
    if (type === 'password' || SENSITIVE_PATTERN.test(name) || SENSITIVE_PATTERN.test(label)) {
      return '***MASKED***';
    }
    return value;
  }

  // ─── Alt+click picker ────────────────────────────────────────────────────────

  function showSelectorPicker(element, x, y) {
    removePicker();
    const candidates = SelectorEngine.getCandidates(element);
    if (!candidates.length) return;

    pickerDiv = document.createElement('div');
    pickerDiv.id = '__e2e_recorder_picker__';
    Object.assign(pickerDiv.style, {
      position: 'fixed',
      top: `${y}px`,
      left: `${x}px`,
      zIndex: '999999',
      background: '#1e1e2e',
      border: '1px solid #7c3aed',
      borderRadius: '6px',
      padding: '8px',
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#e2e8f0',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      maxWidth: '360px',
      userSelect: 'none'
    });

    const title = document.createElement('div');
    title.textContent = 'Select a locator:';
    Object.assign(title.style, { color: '#a78bfa', marginBottom: '6px', fontWeight: 'bold' });
    pickerDiv.appendChild(title);

    for (const candidate of candidates) {
      const btn = document.createElement('div');
      btn.textContent = `${candidate.unique ? '✓' : '~'} [${candidate.score}] ${candidate.selector}`;
      Object.assign(btn.style, {
        padding: '4px 8px',
        marginBottom: '4px',
        borderRadius: '4px',
        cursor: 'pointer',
        background: candidate.unique ? '#22c55e22' : '#f59e0b22',
        border: `1px solid ${candidate.unique ? '#22c55e' : '#f59e0b'}`
      });
      btn.addEventListener('mouseover', () => { btn.style.background = '#7c3aed44'; });
      btn.addEventListener('mouseout', () => { btn.style.background = candidate.unique ? '#22c55e22' : '#f59e0b22'; });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        removePicker();
        sendEvent({
          type: 'click',
          selector: candidate.selector,
          frameChain: getBest(element).frameChain,
          timestamp: Date.now()
        });
      });
      pickerDiv.appendChild(btn);
    }

    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕ Cancel (Escape)';
    Object.assign(closeBtn.style, {
      padding: '4px 8px',
      marginTop: '4px',
      cursor: 'pointer',
      color: '#94a3b8',
      fontSize: '11px'
    });
    closeBtn.addEventListener('click', removePicker);
    pickerDiv.appendChild(closeBtn);

    document.body.appendChild(pickerDiv);
  }

  function removePicker() {
    if (pickerDiv) {
      pickerDiv.remove();
      pickerDiv = null;
    }
  }

  // ─── Event listeners ─────────────────────────────────────────────────────────

  function attachListeners() {
    // ── Click ──────────────────────────────────────────────────────────────────
    document.addEventListener('click', (e) => {
      if (!isRecording) return;
      const target = e.target;
      if (target.id === '__e2e_recorder_picker__' || target.closest('#__e2e_recorder_picker__')) return;

      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        showSelectorPicker(target, e.clientX + 10, e.clientY + 10);
        return;
      }

      if (isAssertionMode) {
        e.preventDefault();
        e.stopPropagation();
        const { selector, frameChain } = getBest(target);
        sendAssertion({
          type: 'elementVisible',
          afterEventId: null, // Linked to the last event in background
          selector,
          description: target.innerText ? target.innerText.trim().substring(0, 80) : ''
        });
        return;
      }

      removePicker();
      const { selector, frameChain, selectorCandidates } = getBestWithCandidates(target);
      sendEvent({ type: 'click', selector, frameChain, selectorCandidates });
    }, { capture: true });

    // ── Keydown (Escape closes picker; captures special keys) ──────────────────
    const SPECIAL_KEYS = new Set(['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { removePicker(); }
      if (!isRecording) return;

      const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
      if (!SPECIAL_KEYS.has(e.key) && !hasModifier) return;

      // Ignore Alt+key used for picker
      if (e.altKey && !e.ctrlKey && !e.metaKey) return;

      const target = e.target;
      const { selector, frameChain } = (target && target.tagName) ? getBest(target) : { selector: null, frameChain: [] };

      sendEvent({
        type: 'keypress',
        key: e.key,
        selector,
        frameChain,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey
      });
    }, { capture: true });

    // ── Input / change with debounce ───────────────────────────────────────────
    document.addEventListener('input', (e) => {
      if (!isRecording) return;
      const target = e.target;
      if (!target || !target.tagName) return;
      const tag = target.tagName.toLowerCase();
      if (tag === 'select') return; // handled separately

      if (inputDebounceMap.has(target)) clearTimeout(inputDebounceMap.get(target));
      const timer = setTimeout(() => {
        inputDebounceMap.delete(target);
        const { selector, frameChain, selectorCandidates } = getBestWithCandidates(target);
        const rawValue = target.value || '';
        const value = maskSensitiveValue(target, rawValue);
        sendEvent({ type: 'fill', selector, frameChain, value, selectorCandidates });
      }, DEBOUNCE_MS);
      inputDebounceMap.set(target, timer);
    }, { capture: true });

    // ── Native select change ───────────────────────────────────────────────────
    document.addEventListener('change', (e) => {
      if (!isRecording) return;
      const target = e.target;
      if (!target || target.tagName.toLowerCase() !== 'select') return;
      const { selector, frameChain, selectorCandidates } = getBestWithCandidates(target);
      sendEvent({ type: 'selectOption', selector, frameChain, value: target.value, selectorCandidates });
    }, { capture: true });

    // ── File input change ──────────────────────────────────────────────────────
    document.addEventListener('change', (e) => {
      if (!isRecording) return;
      const target = e.target;
      if (!target || target.tagName.toLowerCase() !== 'input') return;
      if ((target.getAttribute('type') || '').toLowerCase() !== 'file') return;
      const { selector, frameChain, selectorCandidates } = getBestWithCandidates(target);
      sendEvent({ type: 'fileUpload', selector, frameChain, selectorCandidates, filePath: '<!-- replace with actual file path -->' });
    }, { capture: true });

    // ── Drag and Drop ──────────────────────────────────────────────────────────
    document.addEventListener('dragstart', (e) => {
      if (!isRecording) return;
      dragSourceElement = e.target;
      const { selector } = getBest(e.target);
      dragSourceSelector = selector;
    }, { capture: true });

    document.addEventListener('drop', (e) => {
      if (!isRecording || !dragSourceSelector) return;
      const target = e.target;
      const { selector: targetSelector, frameChain } = getBest(target);
      sendEvent({
        type: 'dragAndDrop',
        sourceSelector: dragSourceSelector,
        targetSelector,
        frameChain
      });
      dragSourceElement = null;
      dragSourceSelector = null;
    }, { capture: true });

    // ── Deliberate hover ───────────────────────────────────────────────────────
    document.addEventListener('mouseover', (e) => {
      if (!isRecording) return;
      const target = e.target;
      if (!target || !target.tagName) return;
      // Ignore our own picker
      if (target.id === '__e2e_recorder_picker__' || target.closest?.('#__e2e_recorder_picker__')) return;

      if (hoverTimer) clearTimeout(hoverTimer);
      if (hoverObserver) hoverObserver.disconnect();

      let mutated = false;

      hoverObserver = new MutationObserver(() => { mutated = true; });
      hoverObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true
      });

      hoverTimer = setTimeout(() => {
        if (mutated) {
          const { selector, frameChain } = getBest(target);
          sendEvent({ type: 'hover', selector, frameChain });
        }
        if (hoverObserver) { hoverObserver.disconnect(); hoverObserver = null; }
      }, 600);
    }, { capture: false });

    document.addEventListener('mouseout', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (hoverObserver) { hoverObserver.disconnect(); hoverObserver = null; }
    }, { capture: false });

    // ── Traffic Light (coloured outline on mousemove) ──────────────────────────
    let lastMoveTime = 0;
    let currentOutlined = null;

    document.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastMoveTime < 50) return; // Throttle to 50ms
      lastMoveTime = now;

      if (!isRecording) {
        if (currentOutlined) { currentOutlined.style.outline = ''; currentOutlined = null; }
        return;
      }

      const target = e.target;
      if (!target || !target.tagName) return;
      if (target.id === '__e2e_recorder_picker__' || target.closest?.('#__e2e_recorder_picker__')) return;

      if (currentOutlined && currentOutlined !== target) {
        currentOutlined.style.outline = '';
        currentOutlined.style.outlineOffset = '';
      }

      const { score } = SelectorEngine.getScore(
        SelectorEngine.getBestSelector(target).selector
      );

      let color;
      if (score >= 70) color = '#22c55e'; // Green — stable
      else if (score >= 40) color = '#f59e0b'; // Amber — acceptable
      else color = '#ef4444'; // Red — unstable

      target.style.outline = `2px solid ${color}`;
      target.style.outlineOffset = '2px';
      currentOutlined = target;
    }, { capture: false, passive: true });

    document.addEventListener('mouseleave', () => {
      if (currentOutlined) {
        currentOutlined.style.outline = '';
        currentOutlined.style.outlineOffset = '';
        currentOutlined = null;
      }
    }, { capture: false });

    // ── Scroll with content-load detection ────────────────────────────────────
    attachScrollListener(window, null);

    // Also attach to visible scrollable containers
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const style = window.getComputedStyle(el);
      const overflow = style.overflow + style.overflowX + style.overflowY;
      if (overflow.includes('scroll') || overflow.includes('auto')) {
        attachScrollListener(el, el);
      }
    }

    // ── popstate / hashchange navigation ──────────────────────────────────────
    window.addEventListener('popstate', () => {
      if (!isRecording) return;
      sendEvent({ type: 'navigate', url: window.location.href, frameChain: [] });
    });

    window.addEventListener('hashchange', () => {
      if (!isRecording) return;
      sendEvent({ type: 'navigate', url: window.location.href, frameChain: [] });
    });
  }

  /**
   * Attach a scroll listener to a target element or window.
   * Only emits if new DOM content appears within 300ms of scroll,
   * or if the target is a non-window scrollable element.
   * @param {EventTarget} target
   * @param {Element|null} scrollableElement
   */
  function attachScrollListener(target, scrollableElement) {
    let scrollTimer = null;
    let scrollObserver = null;
    let newContentDetected = false;
    let lastScrollY = scrollableElement ? scrollableElement.scrollTop : window.scrollY;
    let lastScrollX = scrollableElement ? scrollableElement.scrollLeft : window.scrollX;

    target.addEventListener('scroll', (e) => {
      if (!isRecording) return;

      const currentY = scrollableElement ? scrollableElement.scrollTop : window.scrollY;
      const currentX = scrollableElement ? scrollableElement.scrollLeft : window.scrollX;
      const deltaY = currentY - lastScrollY;
      const deltaX = currentX - lastScrollX;
      lastScrollY = currentY;
      lastScrollX = currentX;

      if (scrollTimer) clearTimeout(scrollTimer);
      if (scrollObserver) scrollObserver.disconnect();
      newContentDetected = false;

      scrollObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes.length > 0) { newContentDetected = true; }
        }
      });
      scrollObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

      scrollTimer = setTimeout(() => {
        if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }

        // Emit if: a non-window scrollable or new content loaded
        const isNonWindowScroll = !!scrollableElement;
        if (isNonWindowScroll || newContentDetected) {
          const { selector, frameChain } = scrollableElement
            ? getBest(scrollableElement)
            : { selector: null, frameChain: [] };
          sendEvent({
            type: 'scroll',
            scrollableSelector: selector,
            frameChain,
            deltaX: Math.round(deltaX),
            deltaY: Math.round(deltaY)
          });
        }
      }, 300);
    }, { passive: true });
  }

  /**
   * Attach traffic-light and listeners to elements inside shadow roots.
   * @param {Element} root
   */
  function attachShadowDOMListeners(root) {
    if (!root) return;
    const shadowHosts = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of shadowHosts) {
      if (el.shadowRoot) {
        attachShadowClickListener(el.shadowRoot);
        attachShadowDOMListeners(el.shadowRoot);
      }
    }

    // Observe future shadow roots
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.shadowRoot) {
            attachShadowClickListener(node.shadowRoot);
            attachShadowDOMListeners(node.shadowRoot);
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  /**
   * Attach click listener inside a shadow root.
   * @param {ShadowRoot} shadowRoot
   */
  function attachShadowClickListener(shadowRoot) {
    shadowRoot.addEventListener('click', (e) => {
      if (!isRecording) return;
      if (isAssertionMode) {
        e.preventDefault();
        const { selector, frameChain } = getBest(e.target);
        sendAssertion({ type: 'elementVisible', afterEventId: null, selector });
        return;
      }
      const { selector, frameChain } = getBest(e.target);
      sendEvent({ type: 'click', selector, frameChain });
    }, { capture: true });
  }

  /**
   * Update traffic-light behaviour when recording state changes.
   */
  function updateTrafficLightMode() {
    // Handled inline by isRecording check in mousemove listener
  }

  // ─── Start ───────────────────────────────────────────────────────────────────
  init();

})();
