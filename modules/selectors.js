/**
 * SelectorEngine — scoring-based CSS selector generator.
 * Runs in content script context with full DOM access.
 * Supports Shadow DOM and iframe chains.
 */
const SelectorEngine = (() => {
  // Regex for unstable id/class name patterns (numeric hashes, CSS-in-JS, framework prefixes)
  const UNSTABLE_PATTERN = /(\d{3,}|css-|Mui|chakra-|ng-|star-)/i;

  /**
   * Query selector that pierces shadowRoot boundaries.
   * @param {string} selector
   * @param {Document|ShadowRoot|Element} root
   * @returns {Element[]}
   */
  function scopedQuerySelectorAll(selector, root = document) {
    const results = [];

    function search(node, sel) {
      try {
        const found = node.querySelectorAll(sel);
        results.push(...found);
      } catch (e) {
        // Invalid selector for this subtree — skip
      }
      // Recurse into shadow roots
      const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) {
          search(el.shadowRoot, sel);
        }
      }
    }

    search(root, selector);
    return results;
  }

  /**
   * Get CSS nth-child position of element among its siblings.
   * @param {Element} el
   * @returns {number}
   */
  function getNthChild(el) {
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  /**
   * Check if a selector uniquely identifies an element within the root.
   * @param {string} selector
   * @param {Document|ShadowRoot} root
   * @returns {boolean}
   */
  function isUnique(selector, root = document) {
    try {
      return scopedQuerySelectorAll(selector, root).length === 1;
    } catch {
      return false;
    }
  }

  /**
   * Escape a string for use as a CSS attribute value.
   * @param {string} str
   * @returns {string}
   */
  function cssEscape(str) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(str);
    return str.replace(/[^\w-]/g, c => `\\${c}`);
  }

  /**
   * Build candidate selectors from element attributes, sorted by score.
   * Returns array of {selector, score} objects.
   * @param {Element} el
   * @param {Document|ShadowRoot} root
   * @returns {Array<{selector:string, score:number}>}
   */
  function buildCandidates(el, root = document) {
    const tag = el.tagName.toLowerCase();
    const candidates = [];

    // data-testid (score 100)
    const testId = el.getAttribute('data-testid');
    if (testId) candidates.push({ selector: `[data-testid="${cssEscape(testId)}"]`, score: 100 });

    // data-cy (score 100)
    const dataCy = el.getAttribute('data-cy');
    if (dataCy) candidates.push({ selector: `[data-cy="${cssEscape(dataCy)}"]`, score: 100 });

    // Static id (score 85, penalized if unstable)
    const id = el.id;
    if (id) {
      const penalty = UNSTABLE_PATTERN.test(id) ? 50 : 0;
      candidates.push({ selector: `#${cssEscape(id)}`, score: 85 - penalty });
    }

    // aria-label (score 75)
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) candidates.push({ selector: `[aria-label="${cssEscape(ariaLabel)}"]`, score: 75 });

    // role (score 72)
    const role = el.getAttribute('role');
    if (role) candidates.push({ selector: `${tag}[role="${cssEscape(role)}"]`, score: 72 });

    // name attribute (score 70)
    const name = el.getAttribute('name');
    if (name) candidates.push({ selector: `${tag}[name="${cssEscape(name)}"]`, score: 70 });

    // placeholder (score 65)
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) candidates.push({ selector: `${tag}[placeholder="${cssEscape(placeholder)}"]`, score: 65 });

    // innerText (score 60, only short stable text)
    const text = el.innerText ? el.innerText.trim().substring(0, 50) : '';
    if (text && text.length < 50 && !text.match(/\d{5,}/)) {
      candidates.push({ selector: `${tag}:has-text("${text.replace(/"/g, '\\"')}")`, score: 60 });
    }

    // First CSS class (score 30, penalized if unstable)
    if (el.classList && el.classList.length > 0) {
      const cls = el.classList[0];
      const penalty = UNSTABLE_PATTERN.test(cls) ? 50 : 0;
      candidates.push({ selector: `.${cssEscape(cls)}`, score: 30 - penalty });
    }

    // Tag name only (score 10)
    candidates.push({ selector: tag, score: 10 });

    // nth-child positional fallback (score 5)
    const nth = getNthChild(el);
    const parentTag = el.parentElement ? el.parentElement.tagName.toLowerCase() : '';
    if (parentTag) {
      candidates.push({
        selector: `${parentTag} > ${tag}:nth-child(${nth})`,
        score: 5
      });
    }

    return candidates;
  }

  /**
   * Build a positional fallback selector using stable ancestor chain.
   * @param {Element} el
   * @param {Document|ShadowRoot} root
   * @returns {string}
   */
  function buildPositionalSelector(el, root = document) {
    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current !== root && depth < 10) {
      const tag = current.tagName.toLowerCase();
      const nth = getNthChild(current);
      const id = current.id;

      if (id && !UNSTABLE_PATTERN.test(id)) {
        parts.unshift(`#${cssEscape(id)}`);
        break;
      }

      parts.unshift(`${tag}:nth-child(${nth})`);
      current = current.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  /**
   * Detect if element is inside a shadow root and build the host chain.
   * @param {Element} el
   * @returns {{shadowHost: Element|null, innerEl: Element}}
   */
  function detectShadowRoot(el) {
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      return { shadowHost: rootNode.host, innerEl: el };
    }
    return { shadowHost: null, innerEl: el };
  }

  /**
   * Build a "host-selector >>> inner-selector" chain for shadow DOM elements.
   * @param {Element} el
   * @returns {string|null} Combined selector or null if not in shadow DOM.
   */
  function buildShadowSelector(el) {
    const parts = [];
    let current = el;

    while (true) {
      const rootNode = current.getRootNode();
      if (!(rootNode instanceof ShadowRoot)) break;

      const host = rootNode.host;
      const innerSel = buildBestSelectorForRoot(current, rootNode);
      parts.unshift(innerSel);

      const hostSel = buildBestSelectorForRoot(host, host.getRootNode() instanceof ShadowRoot ? host.getRootNode() : document);
      parts.unshift(hostSel);

      current = host;
    }

    return parts.length >= 2 ? parts.join(' >>> ') : null;
  }

  /**
   * Get the best selector for an element within a specific root.
   * Does NOT handle shadow DOM chains — use buildShadowSelector for that.
   * @param {Element} el
   * @param {Document|ShadowRoot} root
   * @returns {string}
   */
  function buildBestSelectorForRoot(el, root = document) {
    const candidates = buildCandidates(el, root);
    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      if (candidate.score <= 0) continue;
      const matches = scopedQuerySelectorAll(candidate.selector, root);
      if (matches.length === 1) return candidate.selector;

      if (matches.length > 1) {
        // Try climbing up to 5 ancestors to find a stable scoping ancestor
        let ancestor = el.parentElement;
        for (let i = 0; i < 5 && ancestor && ancestor !== root; i++) {
          if (ancestor.id && !UNSTABLE_PATTERN.test(ancestor.id)) {
            const scoped = `#${cssEscape(ancestor.id)} ${candidate.selector}`;
            if (scopedQuerySelectorAll(scoped, root).length === 1) return scoped;
          }
          const testId = ancestor.getAttribute('data-testid');
          if (testId) {
            const scoped = `[data-testid="${cssEscape(testId)}"] ${candidate.selector}`;
            if (scopedQuerySelectorAll(scoped, root).length === 1) return scoped;
          }
          ancestor = ancestor.parentElement;
        }
      }
    }

    // Final fallback: positional selector
    return buildPositionalSelector(el, root);
  }

  /**
   * Get the iframe chain from the current frame to the top frame.
   * Since content scripts cannot directly access parent frame DOM,
   * we build the chain using window.frameElement.
   * @returns {string[]} Array of iframe selectors from top to current frame.
   */
  function getFrameChain() {
    const chain = [];
    let win = window;

    while (win !== win.top) {
      const frameEl = win.frameElement;
      if (!frameEl) break;
      try {
        const parentDoc = frameEl.ownerDocument;
        const sel = buildBestSelectorForRoot(frameEl, parentDoc);
        chain.unshift(sel);
      } catch {
        chain.unshift('iframe');
      }
      win = win.parent;
    }

    return chain;
  }

  return {
    scopedQuerySelectorAll,

    /**
     * Get the single best selector for an element.
     * @param {Element} element
     * @param {Document|ShadowRoot} context
     * @returns {{selector: string, score: number, frameChain: string[]}}
     */
    getBestSelector(element, context = document) {
      const frameChain = getFrameChain();

      // Check for shadow DOM
      const shadowSel = buildShadowSelector(element);
      if (shadowSel) {
        return { selector: shadowSel, score: 70, frameChain };
      }

      const root = element.getRootNode() instanceof ShadowRoot
        ? element.getRootNode()
        : (context || document);

      const selector = buildBestSelectorForRoot(element, root);
      const candidates = buildCandidates(element, root);
      candidates.sort((a, b) => b.score - a.score);
      const score = candidates.length > 0 ? candidates[0].score : 5;

      return { selector, score, frameChain };
    },

    /**
     * Get top 3 scored candidates for an element (used in Alt+click picker).
     * @param {Element} element
     * @returns {Array<{selector: string, score: number}>}
     */
    getCandidates(element) {
      const root = element.getRootNode() instanceof ShadowRoot
        ? element.getRootNode()
        : document;

      const candidates = buildCandidates(element, root);
      candidates.sort((a, b) => b.score - a.score);

      // Filter to unique, valid selectors and return top 3
      const seen = new Set();
      const result = [];
      for (const c of candidates) {
        if (seen.has(c.selector)) continue;
        seen.add(c.selector);
        const matches = scopedQuerySelectorAll(c.selector, root);
        if (matches.length >= 1) {
          result.push({ ...c, unique: matches.length === 1 });
        }
        if (result.length >= 3) break;
      }
      return result;
    },

    /**
     * Recompute score for a given selector string against the current DOM.
     * Used for real-time validation in popup editor.
     * @param {string} selector
     * @returns {{valid: boolean, unique: boolean, count: number, score: number}}
     */
    getScore(selector) {
      try {
        const matches = scopedQuerySelectorAll(selector, document);
        const count = matches.length;
        const unique = count === 1;

        // Heuristic score based on selector characteristics
        let score = 0;
        if (selector.includes('data-testid')) score = 100;
        else if (selector.includes('data-cy')) score = 100;
        else if (selector.startsWith('#')) score = 85;
        else if (selector.includes('aria-label')) score = 75;
        else if (selector.includes('role=')) score = 72;
        else if (selector.includes('name=')) score = 70;
        else if (selector.includes('placeholder=')) score = 65;
        else if (selector.startsWith('.')) score = 30;
        else if (selector.includes('nth-child')) score = 5;
        else score = 10;

        if (!unique && count > 1) score = Math.floor(score * 0.5);
        if (UNSTABLE_PATTERN.test(selector)) score -= 50;

        return { valid: true, unique, count, score: Math.max(0, score) };
      } catch {
        return { valid: false, unique: false, count: 0, score: 0 };
      }
    }
  };
})();
