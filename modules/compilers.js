/**
 * Compilers — generates test code from recorded events.
 * Supports Playwright TypeScript, Playwright Python, Cypress, and Selenium.
 * Runs in the popup context (has full extension API access).
 */
const Compilers = (() => {

  // ─── Utility helpers ────────────────────────────────────────────────────────

  /**
   * Indent every line of a block of code by n spaces.
   * @param {string} code
   * @param {number} n
   * @returns {string}
   */
  function indent(code, n = 2) {
    const pad = ' '.repeat(n);
    return code.split('\n').map(l => pad + l).join('\n');
  }

  /**
   * Escape a string for use as a double-quoted string literal.
   * @param {string} str
   * @returns {string}
   */
  function esc(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * Escape a string for use as a Python single-quoted string literal.
   * @param {string} str
   * @returns {string}
   */
  function escPy(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }

  /**
   * Convert a Playwright/CSS selector to a Cypress-compatible locator.
   * Handles :has-text() pseudo-class.
   * @param {string} sel
   * @returns {string}
   */
  function toCypressLocator(sel) {
    // :has-text("...") → use cy.contains() approach (handled separately)
    return sel.replace(/:has-text\("([^"]+)"\)/g, '');
  }

  /**
   * Convert special key names to framework-specific formats.
   * @param {string} key
   * @param {'playwright-ts'|'playwright-python'|'cypress'|'selenium'} framework
   * @returns {string}
   */
  function formatKey(key, framework) {
    const playwrightMap = {
      Enter: 'Enter', Tab: 'Tab', Escape: 'Escape',
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight'
    };
    const cypressMap = {
      Enter: '{enter}', Tab: '{tab}', Escape: '{esc}',
      ArrowUp: '{upArrow}', ArrowDown: '{downArrow}',
      ArrowLeft: '{leftArrow}', ArrowRight: '{rightArrow}'
    };
    const seleniumMap = {
      Enter: 'Keys.RETURN', Tab: 'Keys.TAB', Escape: 'Keys.ESCAPE',
      ArrowUp: 'Keys.UP', ArrowDown: 'Keys.DOWN',
      ArrowLeft: 'Keys.LEFT', ArrowRight: 'Keys.RIGHT'
    };

    if (framework === 'playwright-ts') return playwrightMap[key] || key;
    if (framework === 'playwright-python') return playwrightMap[key] || key;
    if (framework === 'cypress') return cypressMap[key] || `{${key.toLowerCase()}}`;
    if (framework === 'selenium') return seleniumMap[key] || `Keys.${key.toUpperCase()}`;
    return key;
  }

  /**
   * Build a modifier-key combo string for Playwright.
   * @param {object} event
   * @returns {string}
   */
  function playwrightKeyCombo(event) {
    const mods = [];
    if (event.ctrlKey) mods.push('Control');
    if (event.shiftKey) mods.push('Shift');
    if (event.altKey) mods.push('Alt');
    if (event.metaKey) mods.push('Meta');
    mods.push(event.key);
    return mods.join('+');
  }

  /**
   * Build a Selenium By locator from a CSS selector string.
   * @param {string} selector
   * @returns {string}
   */
  function seleniumBy(selector) {
    if (selector.startsWith('#')) return `By.ID("${esc(selector.slice(1))}")`;
    if (selector.startsWith('.')) return `By.CLASS_NAME("${esc(selector.slice(1))}")`;
    if (selector.startsWith('//') || selector.startsWith('(//')) return `By.XPATH("${esc(selector)}")`;
    return `By.CSS_SELECTOR("${esc(selector)}")`;
  }

  /**
   * Check if a selector refers to shadow DOM (contains ">>>").
   * @param {string} selector
   * @returns {boolean}
   */
  function isShadowSelector(selector) {
    return selector.includes(' >>> ');
  }

  /**
   * Check if an event has a non-empty frame chain (is inside an iframe).
   * @param {object} event
   * @returns {boolean}
   */
  function isInFrame(event) {
    return Array.isArray(event.frameChain) && event.frameChain.length > 0;
  }

  // ─── Assertion code generators ──────────────────────────────────────────────

  function assertionToPlaywrightTS(assertion, pageVar = 'page') {
    switch (assertion.type) {
      case 'urlChanged':
        return `await expect(${pageVar}).toHaveURL("${esc(assertion.expectedUrl)}");`;
      case 'elementVisible':
        return `await expect(${pageVar}.locator("${esc(assertion.selector)}")).toBeVisible();`;
      case 'elementHidden':
        return `await expect(${pageVar}.locator("${esc(assertion.selector)}")).toBeHidden();`;
      case 'modalVisible':
        return `await expect(${pageVar}.locator('[role="dialog"]')).toBeVisible();`;
      case 'accessibilityWarning':
        return `// TODO: Accessibility warning — ${assertion.message}`;
      default:
        return `// Unknown assertion type: ${assertion.type}`;
    }
  }

  function assertionToPlaywrightPython(assertion, pageVar = 'page') {
    switch (assertion.type) {
      case 'urlChanged':
        return `expect(${pageVar}).to_have_url("${escPy(assertion.expectedUrl)}")`;
      case 'elementVisible':
        return `expect(${pageVar}.locator("${escPy(assertion.selector)}")).to_be_visible()`;
      case 'elementHidden':
        return `expect(${pageVar}.locator("${escPy(assertion.selector)}")).to_be_hidden()`;
      case 'modalVisible':
        return `expect(${pageVar}.locator('[role="dialog"]')).to_be_visible()`;
      case 'accessibilityWarning':
        return `# TODO: Accessibility warning — ${assertion.message}`;
      default:
        return `# Unknown assertion type: ${assertion.type}`;
    }
  }

  function assertionToCypress(assertion) {
    switch (assertion.type) {
      case 'urlChanged':
        return `cy.url().should('include', "${esc(assertion.expectedUrl)}");`;
      case 'elementVisible':
        return `cy.get("${esc(assertion.selector)}").should('be.visible');`;
      case 'elementHidden':
        return `cy.get("${esc(assertion.selector)}").should('not.be.visible');`;
      case 'modalVisible':
        return `cy.get('[role="dialog"]').should('be.visible');`;
      case 'accessibilityWarning':
        return `// TODO: Accessibility warning — ${assertion.message}`;
      default:
        return `// Unknown assertion type: ${assertion.type}`;
    }
  }

  function assertionToSelenium(assertion) {
    switch (assertion.type) {
      case 'urlChanged':
        return `driver.wait(until.urlContains("${esc(assertion.expectedUrl)}"), 5000);`;
      case 'elementVisible':
        return `driver.wait(until.elementIsVisible(driver.findElement(${seleniumBy(assertion.selector)})), 5000);`;
      case 'elementHidden':
        return `driver.wait(until.elementIsNotVisible(driver.findElement(${seleniumBy(assertion.selector)})), 5000);`;
      case 'modalVisible':
        return `driver.wait(until.elementIsVisible(driver.findElement(By.CSS_SELECTOR('[role="dialog"]'))), 5000);`;
      case 'accessibilityWarning':
        return `// TODO: Accessibility warning — ${assertion.message}`;
      default:
        return `// Unknown assertion type: ${assertion.type}`;
    }
  }

  // ─── Playwright TypeScript compiler ─────────────────────────────────────────

  function compilePlaywrightTS(events, assertions, options) {
    const lines = [];
    const acceptedAssertions = assertions.filter(a => a.accepted === true);
    let currentTabId = null;
    let currentPageVar = 'page';
    let pageVarCounter = 1;
    const pageVars = {}; // tabId → variable name

    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push('');
    lines.push(`test('recorded session', async ({ page, context }) => {`);

    for (const event of events) {
      const sel = event.selector || '';
      const inFrame = isInFrame(event);
      const inShadow = isShadowSelector(sel);

      // ── Tab context switch ──
      if (event.tabId && event.tabId !== currentTabId) {
        if (pageVars[event.tabId]) {
          currentPageVar = pageVars[event.tabId];
        } else {
          currentPageVar = 'page';
          pageVars[event.tabId] = currentPageVar;
        }
        currentTabId = event.tabId;
      }

      const pv = currentPageVar;

      // ── Frame locator ──
      let framePrefix = '';
      let frameVar = pv;
      if (inFrame) {
        const chainParts = event.frameChain.map(fs => `.frameLocator("${esc(fs)}")`).join('');
        frameVar = `${pv}${chainParts}`;
        framePrefix = `const frame = ${frameVar};\n  `;
      }

      const locatorTarget = inFrame ? 'frame' : pv;

      // ── Event type ──
      switch (event.type) {
        case 'navigate':
          lines.push(`  await ${pv}.goto("${esc(event.url)}");`);
          break;

        case 'click':
          if (event.opensNewContext) {
            lines.push(`  const [newPage${pageVarCounter}] = await Promise.all([`);
            lines.push(`    context.waitForEvent('page'),`);
            lines.push(`    ${locatorTarget}.locator("${esc(sel)}").click(),`);
            lines.push(`  ]);`);
            lines.push(`  const page${pageVarCounter} = newPage${pageVarCounter};`);
            const newTabId = event.newTabId || `tab_${pageVarCounter}`;
            pageVars[newTabId] = `page${pageVarCounter}`;
            pageVarCounter++;
          } else if (inShadow) {
            lines.push(`  await ${locatorTarget}.locator("${esc(sel)}").click(); // Shadow DOM`);
          } else if (inFrame) {
            lines.push(`  ${framePrefix}await frame.locator("${esc(sel)}").click();`);
          } else {
            lines.push(`  await ${pv}.locator("${esc(sel)}").click();`);
          }
          break;

        case 'fill':
          if (inFrame) {
            lines.push(`  ${framePrefix}await frame.locator("${esc(sel)}").fill("${esc(event.value)}");`);
          } else {
            lines.push(`  await ${pv}.locator("${esc(sel)}").fill("${esc(event.value)}");`);
          }
          break;

        case 'keypress': {
          const combo = playwrightKeyCombo(event);
          if (event.selector) {
            lines.push(`  await ${pv}.locator("${esc(event.selector)}").press("${combo}");`);
          } else {
            lines.push(`  await ${pv}.keyboard.press("${combo}");`);
          }
          break;
        }

        case 'hover':
          if (inFrame) {
            lines.push(`  ${framePrefix}await frame.locator("${esc(sel)}").hover();`);
          } else {
            lines.push(`  await ${pv}.locator("${esc(sel)}").hover();`);
          }
          break;

        case 'scroll':
          if (event.scrollableSelector) {
            lines.push(`  await ${pv}.locator("${esc(event.scrollableSelector)}").evaluate(el => el.scrollBy(${event.deltaX || 0}, ${event.deltaY || 0}));`);
          } else {
            lines.push(`  await ${pv}.evaluate(() => window.scrollBy(${event.deltaX || 0}, ${event.deltaY || 0}));`);
          }
          break;

        case 'selectOption':
          if (inFrame) {
            lines.push(`  ${framePrefix}await frame.locator("${esc(sel)}").selectOption("${esc(event.value)}");`);
          } else {
            lines.push(`  await ${pv}.locator("${esc(sel)}").selectOption("${esc(event.value)}");`);
          }
          break;

        case 'dragAndDrop':
          lines.push(`  await ${pv}.dragAndDrop("${esc(event.sourceSelector)}", "${esc(event.targetSelector)}");`);
          break;

        case 'fileUpload':
          lines.push(`  // TODO: Replace 'path/to/file' with the actual file path`);
          lines.push(`  await ${pv}.locator("${esc(sel)}").setInputFiles('path/to/file');`);
          break;

        case 'closeContext':
          lines.push(`  // Tab closed — switching back to primary page`);
          currentPageVar = 'page';
          currentTabId = null;
          break;

        default:
          lines.push(`  // Unknown event type: ${event.type}`);
      }

      // Emit accepted assertions tied to this event
      const eventAssertions = acceptedAssertions.filter(a => a.afterEventId === event.id);
      for (const assertion of eventAssertions) {
        lines.push(`  ${assertionToPlaywrightTS(assertion, pv)}`);
      }
    }

    lines.push(`});`);
    return lines.join('\n');
  }

  // ─── Playwright Python compiler ──────────────────────────────────────────────

  function compilePlaywrightPython(events, assertions, options) {
    const lines = [];
    const acceptedAssertions = assertions.filter(a => a.accepted === true);
    let currentTabId = null;
    let currentPageVar = 'page';
    let pageVarCounter = 1;
    const pageVars = {};

    lines.push(`import re`);
    lines.push(`from playwright.sync_api import Page, expect`);
    lines.push('');
    lines.push(`def test_recorded_session(page: Page) -> None:`);

    for (const event of events) {
      const sel = event.selector || '';
      const inFrame = isInFrame(event);

      if (event.tabId && event.tabId !== currentTabId) {
        if (pageVars[event.tabId]) {
          currentPageVar = pageVars[event.tabId];
        } else {
          currentPageVar = 'page';
          pageVars[event.tabId] = currentPageVar;
        }
        currentTabId = event.tabId;
      }

      const pv = currentPageVar;
      let frameRef = pv;
      if (inFrame) {
        const chain = event.frameChain.map(fs => `.frame_locator("${escPy(fs)}")`).join('');
        frameRef = `${pv}${chain}`;
      }

      switch (event.type) {
        case 'navigate':
          lines.push(`    ${pv}.goto("${escPy(event.url)}")`);
          break;

        case 'click':
          if (event.opensNewContext) {
            lines.push(`    with page.context.expect_page() as new_page_info:`);
            lines.push(`        ${frameRef}.locator("${escPy(sel)}").click()`);
            lines.push(`    page${pageVarCounter} = new_page_info.value`);
            const newTabId = event.newTabId || `tab_${pageVarCounter}`;
            pageVars[newTabId] = `page${pageVarCounter}`;
            pageVarCounter++;
          } else {
            lines.push(`    ${frameRef}.locator("${escPy(sel)}").click()`);
          }
          break;

        case 'fill':
          lines.push(`    ${frameRef}.locator("${escPy(sel)}").fill("${escPy(event.value)}")`);
          break;

        case 'keypress': {
          const combo = playwrightKeyCombo(event);
          if (event.selector) {
            lines.push(`    ${pv}.locator("${escPy(event.selector)}").press("${combo}")`);
          } else {
            lines.push(`    ${pv}.keyboard.press("${combo}")`);
          }
          break;
        }

        case 'hover':
          lines.push(`    ${frameRef}.locator("${escPy(sel)}").hover()`);
          break;

        case 'scroll':
          if (event.scrollableSelector) {
            lines.push(`    ${pv}.locator("${escPy(event.scrollableSelector)}").evaluate("el => el.scrollBy(${event.deltaX || 0}, ${event.deltaY || 0})")`);
          } else {
            lines.push(`    ${pv}.evaluate("() => window.scrollBy(${event.deltaX || 0}, ${event.deltaY || 0})")`);
          }
          break;

        case 'selectOption':
          lines.push(`    ${frameRef}.locator("${escPy(sel)}").select_option("${escPy(event.value)}")`);
          break;

        case 'dragAndDrop':
          lines.push(`    ${pv}.drag_and_drop("${escPy(event.sourceSelector)}", "${escPy(event.targetSelector)}")`);
          break;

        case 'fileUpload':
          lines.push(`    # TODO: Replace 'path/to/file' with the actual file path`);
          lines.push(`    ${pv}.locator("${escPy(sel)}").set_input_files('path/to/file')`);
          break;

        case 'closeContext':
          lines.push(`    # Tab closed — switching back to primary page`);
          currentPageVar = 'page';
          currentTabId = null;
          break;

        default:
          lines.push(`    # Unknown event type: ${event.type}`);
      }

      const eventAssertions = acceptedAssertions.filter(a => a.afterEventId === event.id);
      for (const assertion of eventAssertions) {
        lines.push(`    ${assertionToPlaywrightPython(assertion, pv)}`);
      }
    }

    return lines.join('\n');
  }

  // ─── Cypress compiler ────────────────────────────────────────────────────────

  function compileCypress(events, assertions, options) {
    const lines = [];
    const acceptedAssertions = assertions.filter(a => a.accepted === true);

    lines.push(`describe('Recorded Session', () => {`);
    lines.push(`  it('should complete the recorded flow', () => {`);

    for (const event of events) {
      const sel = toCypressLocator(event.selector || '');
      const inFrame = isInFrame(event);
      const inShadow = isShadowSelector(event.selector || '');

      // Frame wrapper helper
      const wrapInFrame = (innerCode) => {
        if (!inFrame) return innerCode;
        const outerSel = event.frameChain[0];
        return `cy.get("${esc(outerSel)}").its('0.contentDocument.body').then(cy.wrap).within(() => {\n      ${innerCode}\n    });`;
      };

      switch (event.type) {
        case 'navigate':
          lines.push(`    cy.visit("${esc(event.url)}");`);
          break;

        case 'click':
          if (event.opensNewContext) {
            lines.push(`    // WARNING: Multi-tab not fully supported in Cypress.`);
            lines.push(`    // Stub: intercept new window or use cy.stub(window, 'open')`);
            lines.push(`    cy.get("${esc(sel)}").click();`);
          } else if (inShadow) {
            const parts = (event.selector || '').split(' >>> ');
            let chain = `cy.get("${esc(parts[0])}")`;
            for (let i = 1; i < parts.length; i++) {
              chain += `.shadow().find("${esc(parts[i])}")`;
            }
            lines.push(`    ${chain}.click(); // Shadow DOM`);
          } else if (inFrame) {
            lines.push(`    ${wrapInFrame(`cy.get("${esc(sel)}").click();`)}`);
          } else {
            lines.push(`    cy.get("${esc(sel)}").click();`);
          }
          break;

        case 'fill':
          if (inFrame) {
            lines.push(`    ${wrapInFrame(`cy.get("${esc(sel)}").clear().type("${esc(event.value)}");`)}`);
          } else {
            lines.push(`    cy.get("${esc(sel)}").clear().type("${esc(event.value)}");`);
          }
          break;

        case 'keypress': {
          const key = formatKey(event.key, 'cypress');
          const mods = [];
          if (event.ctrlKey) mods.push('ctrl');
          if (event.shiftKey) mods.push('shift');
          if (event.altKey) mods.push('alt');
          if (event.metaKey) mods.push('meta');
          const modStr = mods.length > 0 ? `{ ${mods.map(m => `${m}: true`).join(', ')} }` : '';
          if (event.selector) {
            lines.push(`    cy.get("${esc(event.selector)}").type("${key}"${modStr ? `, ${modStr}` : ''});`);
          } else {
            lines.push(`    cy.get('body').type("${key}"${modStr ? `, ${modStr}` : ''});`);
          }
          break;
        }

        case 'hover':
          lines.push(`    cy.get("${esc(sel)}").trigger('mouseover');`);
          break;

        case 'scroll':
          if (event.scrollableSelector) {
            lines.push(`    cy.get("${esc(event.scrollableSelector)}").scrollTo(${event.deltaX || 0}, ${event.deltaY || 0});`);
          } else {
            lines.push(`    cy.scrollTo(${event.deltaX || 0}, ${event.deltaY || 0});`);
          }
          break;

        case 'selectOption':
          lines.push(`    cy.get("${esc(sel)}").select("${esc(event.value)}");`);
          break;

        case 'dragAndDrop':
          lines.push(`    // cy-drag requires @4tw/cypress-drag-drop plugin`);
          lines.push(`    cy.get("${esc(event.sourceSelector)}").drag("${esc(event.targetSelector)}");`);
          break;

        case 'fileUpload':
          lines.push(`    // TODO: Replace 'path/to/file' with the actual fixture path`);
          lines.push(`    cy.get("${esc(sel)}").selectFile('cypress/fixtures/file');`);
          break;

        case 'closeContext':
          lines.push(`    // Tab closed — Cypress does not support multi-tab; continuing in original context`);
          break;

        default:
          lines.push(`    // Unknown event type: ${event.type}`);
      }

      const eventAssertions = acceptedAssertions.filter(a => a.afterEventId === event.id);
      for (const assertion of eventAssertions) {
        lines.push(`    ${assertionToCypress(assertion)}`);
      }
    }

    lines.push(`  });`);
    lines.push(`});`);
    return lines.join('\n');
  }

  // ─── Selenium compiler ───────────────────────────────────────────────────────

  function compileSelenium(events, assertions, options) {
    const lines = [];
    const acceptedAssertions = assertions.filter(a => a.accepted === true);
    let insideFrame = false;

    lines.push(`const { Builder, By, Key, until, Select } = require('selenium-webdriver');`);
    lines.push('');
    lines.push(`(async function recordedSession() {`);
    lines.push(`  const driver = await new Builder().forBrowser('firefox').build();`);
    lines.push(`  try {`);

    for (const event of events) {
      const sel = event.selector || '';
      const inFrame = isInFrame(event);
      const inShadow = isShadowSelector(sel);

      // Switch to frame if needed
      if (inFrame && !insideFrame) {
        const frameSel = event.frameChain[0];
        lines.push(`    await driver.switchTo().frame(driver.findElement(${seleniumBy(frameSel)}));`);
        insideFrame = true;
      } else if (!inFrame && insideFrame) {
        lines.push(`    await driver.switchTo().defaultContent();`);
        insideFrame = false;
      }

      switch (event.type) {
        case 'navigate':
          lines.push(`    await driver.get("${esc(event.url)}");`);
          break;

        case 'click':
          if (event.opensNewContext) {
            lines.push(`    const handlesBefore = await driver.getAllWindowHandles();`);
            lines.push(`    await driver.findElement(${seleniumBy(sel)}).click();`);
            lines.push(`    await driver.wait(async () => (await driver.getAllWindowHandles()).length > handlesBefore.length, 5000);`);
            lines.push(`    const handlesAfter = await driver.getAllWindowHandles();`);
            lines.push(`    const newHandle = handlesAfter.find(h => !handlesBefore.includes(h));`);
            lines.push(`    await driver.switchTo().window(newHandle);`);
          } else if (inShadow) {
            const parts = sel.split(' >>> ');
            lines.push(`    // Shadow DOM — using executeScript`);
            lines.push(`    await driver.executeScript(\`arguments[0].shadowRoot.querySelector('${escPy(parts[parts.length - 1])}').click()\`, await driver.findElement(${seleniumBy(parts[0])}));`);
          } else {
            lines.push(`    await driver.findElement(${seleniumBy(sel)}).click();`);
          }
          break;

        case 'fill':
          lines.push(`    await driver.findElement(${seleniumBy(sel)}).clear();`);
          lines.push(`    await driver.findElement(${seleniumBy(sel)}).sendKeys("${esc(event.value)}");`);
          break;

        case 'keypress': {
          const key = formatKey(event.key, 'selenium');
          if (event.selector) {
            lines.push(`    await driver.findElement(${seleniumBy(event.selector)}).sendKeys(${key});`);
          } else {
            lines.push(`    await driver.actions().sendKeys(${key}).perform();`);
          }
          break;
        }

        case 'hover':
          lines.push(`    await driver.actions().moveToElement(driver.findElement(${seleniumBy(sel)})).perform();`);
          break;

        case 'scroll':
          if (event.scrollableSelector) {
            lines.push(`    await driver.executeScript("arguments[0].scrollBy(${event.deltaX || 0}, ${event.deltaY || 0})", await driver.findElement(${seleniumBy(event.scrollableSelector)}));`);
          } else {
            lines.push(`    await driver.executeScript("window.scrollBy(${event.deltaX || 0}, ${event.deltaY || 0})");`);
          }
          break;

        case 'selectOption': {
          lines.push(`    const selectEl = await driver.findElement(${seleniumBy(sel)});`);
          lines.push(`    const select = new Select(selectEl);`);
          lines.push(`    await select.selectByValue("${esc(event.value)}");`);
          break;
        }

        case 'dragAndDrop':
          lines.push(`    await driver.actions().dragAndDrop(`);
          lines.push(`      driver.findElement(${seleniumBy(event.sourceSelector)}),`);
          lines.push(`      driver.findElement(${seleniumBy(event.targetSelector)})`);
          lines.push(`    ).perform();`);
          break;

        case 'fileUpload':
          lines.push(`    // TODO: Replace 'path/to/file' with the actual file path`);
          lines.push(`    await driver.findElement(${seleniumBy(sel)}).sendKeys('path/to/file');`);
          break;

        case 'closeContext':
          lines.push(`    // Tab closed — switching to first window handle`);
          lines.push(`    const allHandles = await driver.getAllWindowHandles();`);
          lines.push(`    await driver.switchTo().window(allHandles[0]);`);
          insideFrame = false;
          break;

        default:
          lines.push(`    // Unknown event type: ${event.type}`);
      }

      const eventAssertions = acceptedAssertions.filter(a => a.afterEventId === event.id);
      for (const assertion of eventAssertions) {
        lines.push(`    ${assertionToSelenium(assertion)}`);
      }
    }

    if (insideFrame) {
      lines.push(`    await driver.switchTo().defaultContent();`);
    }

    lines.push(`  } finally {`);
    lines.push(`    await driver.quit();`);
    lines.push(`  }`);
    lines.push(`})();`);
    return lines.join('\n');
  }

  // ─── Page Object Model generator ────────────────────────────────────────────

  /**
   * Group events by URL origin (hostname).
   * @param {object[]} events
   * @returns {Map<string, object[]>}
   */
  function groupByPage(events) {
    const map = new Map();
    for (const event of events) {
      let key = 'UnknownPage';
      if (event.url) {
        try {
          const u = new URL(event.url);
          key = u.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        } catch { /* ignore */ }
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    return map;
  }

  /**
   * Generate Page Object Model classes for Playwright TypeScript.
   * @param {object} state
   * @returns {Map<string, string>} filename → code
   */
  function generatePageObjectsPlaywrightTS(state) {
    const { events, suggestedAssertions } = state;
    const pages = groupByPage(events);
    const files = new Map();

    for (const [pageName, pageEvents] of pages) {
      const className = `${pageName.charAt(0).toUpperCase()}${pageName.slice(1)}Page`;
      const lines = [];
      lines.push(`import { Page, Locator } from '@playwright/test';`);
      lines.push('');
      lines.push(`export class ${className} {`);
      lines.push(`  readonly page: Page;`);

      const selectors = new Set();
      for (const ev of pageEvents) {
        if (ev.selector) selectors.add(ev.selector);
      }

      const propNames = {};
      for (const sel of selectors) {
        const propName = selectorToPropName(sel);
        propNames[sel] = propName;
        lines.push(`  readonly ${propName}: Locator;`);
      }

      lines.push('');
      lines.push(`  constructor(page: Page) {`);
      lines.push(`    this.page = page;`);
      for (const sel of selectors) {
        lines.push(`    this.${propNames[sel]} = page.locator("${esc(sel)}");`);
      }
      lines.push(`  }`);
      lines.push('');

      // Generate action methods per event
      const methodsSeen = new Set();
      for (const ev of pageEvents) {
        const methodName = eventToMethodName(ev);
        if (methodsSeen.has(methodName)) continue;
        methodsSeen.add(methodName);

        switch (ev.type) {
          case 'navigate':
            lines.push(`  async navigate() {`);
            lines.push(`    await this.page.goto("${esc(ev.url)}");`);
            lines.push(`  }`);
            break;
          case 'click':
            if (ev.selector) {
              lines.push(`  async ${methodName}() {`);
              lines.push(`    await this.${propNames[ev.selector] || `page.locator("${esc(ev.selector)}")`}.click();`);
              lines.push(`  }`);
            }
            break;
          case 'fill':
            if (ev.selector) {
              lines.push(`  async ${methodName}(value: string) {`);
              lines.push(`    await this.${propNames[ev.selector] || `page.locator("${esc(ev.selector)}")`}.fill(value);`);
              lines.push(`  }`);
            }
            break;
          default:
            break;
        }
        lines.push('');
      }

      lines.push(`}`);
      files.set(`${pageName.toLowerCase()}.page.ts`, lines.join('\n'));
    }

    return files;
  }

  /**
   * Convert a CSS selector to a camelCase property name.
   * @param {string} sel
   * @returns {string}
   */
  function selectorToPropName(sel) {
    const raw = sel
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
    return raw || 'element';
  }

  /**
   * Convert an event to a camelCase method name.
   * @param {object} ev
   * @returns {string}
   */
  function eventToMethodName(ev) {
    const base = ev.type || 'action';
    const sel = ev.selector ? selectorToPropName(ev.selector) : '';
    const combined = `${base}${sel.charAt(0).toUpperCase()}${sel.slice(1)}`;
    return combined.replace(/[^a-zA-Z0-9]/g, '').replace(/^[0-9]/, '_$&') || `${base}Action`;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    /**
     * Compile recorded events into a test script.
     * @param {'playwright-ts'|'playwright-python'|'cypress'|'selenium'} framework
     * @param {object} state - The full recorder state.
     * @param {{pageObjectModel?: boolean, includeA11y?: boolean}} options
     * @returns {string} Generated test code.
     */
    compile(framework, state, options = {}) {
      const events = (state.events || []).slice().sort((a, b) => a.timestamp - b.timestamp);
      const assertions = state.suggestedAssertions || [];

      switch (framework) {
        case 'playwright-ts':
          return compilePlaywrightTS(events, assertions, options);
        case 'playwright-python':
          return compilePlaywrightPython(events, assertions, options);
        case 'cypress':
          return compileCypress(events, assertions, options);
        case 'selenium':
          return compileSelenium(events, assertions, options);
        default:
          return `// Unknown framework: ${framework}`;
      }
    },

    /**
     * Generate Page Object Model files.
     * @param {'playwright-ts'|'playwright-python'|'cypress'|'selenium'} framework
     * @param {object} state
     * @returns {Map<string, string>} filename → code
     */
    generatePageObjects(framework, state) {
      switch (framework) {
        case 'playwright-ts':
          return generatePageObjectsPlaywrightTS(state);
        default:
          const m = new Map();
          m.set('page-objects.txt', `// POM generation for ${framework} not yet implemented`);
          return m;
      }
    }
  };
})();
