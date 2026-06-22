/**
 * AssertionEngine — observes DOM and URL changes after user events
 * to suggest meaningful assertions.
 * Runs in the content script context.
 */
const AssertionEngine = (() => {
  // Regex for toast/notification/alert/modal class name patterns
  const NOTIFICATION_PATTERN = /toast|notification|alert|snackbar|success|error/i;
  const OBSERVATION_DURATION_MS = 800;

  /**
   * Snapshot the set of currently visible element selectors for "before" state.
   * @returns {Set<string>}
   */
  function snapshotVisibleElements() {
    const snapshot = new Set();
    const elements = document.querySelectorAll('[role], [aria-live], [class]');
    for (const el of elements) {
      if (el.offsetParent !== null || el.getBoundingClientRect().width > 0) {
        const role = el.getAttribute('role');
        const cls = el.className && typeof el.className === 'string' ? el.className : '';
        if (role) snapshot.add(`role:${role}`);
        if (NOTIFICATION_PATTERN.test(cls)) snapshot.add(`class:${cls.split(' ')[0]}`);
      }
    }
    return snapshot;
  }

  /**
   * Find newly visible notification/alert/toast elements in addedNodes.
   * @param {NodeList} addedNodes
   * @returns {Element[]}
   */
  function findNotificationNodes(addedNodes) {
    const results = [];
    for (const node of addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const role = node.getAttribute && node.getAttribute('role');
      const cls = node.className && typeof node.className === 'string' ? node.className : '';
      if (role === 'alert' || role === 'status' || NOTIFICATION_PATTERN.test(cls)) {
        results.push(node);
      }
      // Check descendants
      if (node.querySelectorAll) {
        const inner = node.querySelectorAll('[role="alert"],[role="status"]');
        for (const el of inner) results.push(el);
        const innerCls = node.querySelectorAll('[class]');
        for (const el of innerCls) {
          const c = el.className && typeof el.className === 'string' ? el.className : '';
          if (NOTIFICATION_PATTERN.test(c)) results.push(el);
        }
      }
    }
    return results;
  }

  /**
   * Find newly visible modal/dialog elements in addedNodes.
   * @param {NodeList} addedNodes
   * @returns {Element[]}
   */
  function findModalNodes(addedNodes) {
    const results = [];
    for (const node of addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const role = node.getAttribute && node.getAttribute('role');
      const ariaModal = node.getAttribute && node.getAttribute('aria-modal');
      if (role === 'dialog' || ariaModal === 'true') {
        results.push(node);
      }
      if (node.querySelectorAll) {
        const inner = node.querySelectorAll('[role="dialog"],[aria-modal="true"]');
        for (const el of inner) results.push(el);
      }
    }
    return results;
  }

  /**
   * Observe DOM and URL changes after an event for up to 800ms,
   * then call callback with each detected assertion suggestion.
   *
   * @param {string} eventId - The ID of the triggering event.
   * @param {Function} callback - Called with each assertion suggestion object.
   */
  function observe(eventId, callback) {
    const initialUrl = window.location.href;
    const beforeSnapshot = snapshotVisibleElements();
    const removedElements = [];

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check for URL change (SPA navigation)
        const currentUrl = window.location.href;
        if (currentUrl !== initialUrl) {
          callback({
            type: 'urlChanged',
            afterEventId: eventId,
            expectedUrl: currentUrl,
            id: crypto.randomUUID(),
            accepted: null
          });
        }

        // Check for newly added notification/alert nodes
        if (mutation.addedNodes.length > 0) {
          const notifications = findNotificationNodes(mutation.addedNodes);
          for (const el of notifications) {
            const { selector } = SelectorEngine.getBestSelector(el);
            callback({
              type: 'elementVisible',
              afterEventId: eventId,
              selector,
              description: el.innerText ? el.innerText.trim().substring(0, 80) : '',
              id: crypto.randomUUID(),
              accepted: null
            });
          }

          // Check for modals
          const modals = findModalNodes(mutation.addedNodes);
          for (const el of modals) {
            const { selector } = SelectorEngine.getBestSelector(el);
            callback({
              type: 'modalVisible',
              afterEventId: eventId,
              selector,
              id: crypto.randomUUID(),
              accepted: null
            });
          }
        }

        // Check for removed elements (elementHidden)
        if (mutation.removedNodes.length > 0) {
          for (const node of mutation.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const role = node.getAttribute && node.getAttribute('role');
            const cls = node.className && typeof node.className === 'string' ? node.className : '';
            if (role === 'dialog' || role === 'alert' || NOTIFICATION_PATTERN.test(cls)) {
              removedElements.push(node);
            }
          }
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'aria-modal', 'style', 'class']
    });

    // Disconnect after observation window
    setTimeout(() => {
      observer.disconnect();

      // Emit elementHidden for any previously-visible elements that are now gone
      for (const el of removedElements) {
        // We can't call getBestSelector on a detached node reliably,
        // so use a best-effort approach
        const tag = el.tagName ? el.tagName.toLowerCase() : 'element';
        const role = el.getAttribute && el.getAttribute('role');
        const selector = role ? `[role="${role}"]` : tag;
        callback({
          type: 'elementHidden',
          afterEventId: eventId,
          selector,
          id: crypto.randomUUID(),
          accepted: null
        });
      }
    }, OBSERVATION_DURATION_MS);
  }

  /**
   * Check if an element has proper accessibility attributes.
   * If missing → call callback with an accessibilityWarning.
   *
   * @param {Element} element
   * @param {string} eventId
   * @param {Function} callback
   */
  function checkAccessibility(element, eventId, callback) {
    if (!element || !element.nodeType) return;

    const ariaLabel = element.getAttribute('aria-label');
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    const alt = element.getAttribute('alt');
    const innerText = element.innerText ? element.innerText.trim() : '';
    const title = element.getAttribute('title');
    const placeholder = element.getAttribute('placeholder');

    const hasAccessibleName = !!(ariaLabel || ariaLabelledBy || alt || innerText || title || placeholder);

    if (!hasAccessibleName) {
      const { selector } = SelectorEngine.getBestSelector(element);
      callback({
        type: 'accessibilityWarning',
        afterEventId: eventId,
        selector,
        message: `Element "${selector}" has no accessible name (missing aria-label, alt, innerText, or title).`,
        id: crypto.randomUUID(),
        accepted: null
      });
    }
  }

  return { observe, checkAccessibility };
})();
