/**
 * popup.js — UI logic for E2E Recorder v2 popup.
 * Depends on: modules/compilers.js (loaded via script tag in popup.html).
 * Communicates with background.js via browser.runtime.sendMessage.
 */

// Chrome/Firefox compatibility shim
if (typeof browser === 'undefined') { var browser = chrome; } // eslint-disable-line no-undef

(() => {
  'use strict';

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const mainTabs      = document.querySelectorAll('.main-tab');
  const panelRecorder = document.getElementById('panel-recorder');
  const panelLogs     = document.getElementById('panel-logs');
  const logCountBadge = document.getElementById('log-count-badge');
  const logList       = document.getElementById('log-list');
  const logEmpty      = document.getElementById('log-empty');
  const logLevelFilter  = document.getElementById('log-level-filter');
  const logSourceFilter = document.getElementById('log-source-filter');
  const btnCopyLogs   = document.getElementById('btn-copy-logs');
  const btnClearLogs  = document.getElementById('btn-clear-logs');

  const statusDot     = document.getElementById('status-dot');
  const tabBadge      = document.getElementById('tab-badge');
  const btnRecord     = document.getElementById('btn-record');
  const btnStop       = document.getElementById('btn-stop');
  const btnAssertion  = document.getElementById('btn-assertion');
  const btnTest       = document.getElementById('btn-test');
  const btnClear      = document.getElementById('btn-clear');
  const editorToolbar = document.getElementById('editor-toolbar');
  const btnExpandAll  = document.getElementById('btn-expand-all');
  const btnCollapseAll = document.getElementById('btn-collapse-all');
  const statusText    = document.getElementById('status-text');
  const eventCountEl  = document.getElementById('event-count');
  const eventList     = document.getElementById('event-list');
  const emptyState    = document.getElementById('empty-state');
  const exportSection = document.getElementById('export-section');
  const codeOutput    = document.getElementById('code-output');
  const btnCopy       = document.getElementById('btn-copy');
  const btnDownload   = document.getElementById('btn-download');
  const copyConfirm   = document.getElementById('copy-confirm');
  const togglePom     = document.getElementById('toggle-pom');
  const toggleA11y    = document.getElementById('toggle-a11y');
  const fwTabs        = document.querySelectorAll('.fw-tab');

  // ─── Local state ───────────────────────────────────────────────────────────
  let recorderState   = null;
  let activeFramework = 'playwright-ts';
  let dragSrcIndex    = null;
  let allLogs         = [];        // Full log array (unfiltered)
  let activePanel     = 'panel-recorder';
  let newErrorCount   = 0;         // Unseen errors for badge
  let suppressNextStateRender = false; // Set before local-only mutations to avoid full re-render

  // ─── Initialisation ────────────────────────────────────────────────────────

  async function init() {
    const resp = await sendMsg({ type: 'GET_STATE' });
    if (resp && resp.state) {
      recorderState = resp.state;
      render();
    }

    // Seed logs from persisted state
    if (resp && resp.state && resp.state.logs) {
      allLogs = resp.state.logs;
      renderLogs();
    }

    // Listen for live updates from background
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_UPDATED' && message.state) {
        recorderState = message.state;
        if (suppressNextStateRender) {
          suppressNextStateRender = false;
        } else {
          render();
        }
      }
      if (message.type === 'REPLAY_STARTED') {
        clearReplayStatus();
        btnTest.disabled = true;
        btnTest.textContent = '⟳ Running…';
      }
      if (message.type === 'REPLAY_STEP_RESULT') {
        setReplayStatus(message.eventId, message.status, message.error);
      }
      if (message.type === 'REPLAY_FINISHED') {
        btnTest.disabled = false;
        btnTest.textContent = '▶ Test';
      }
      if (message.type === 'LOGS_UPDATED') {
        allLogs = message.logs || [];
        renderLogs();
        // Show badge with error count when logs panel is not active
        if (activePanel !== 'panel-logs') {
          const errors = allLogs.filter(l => l.level === 'error').length;
          if (errors > 0) {
            logCountBadge.textContent = errors;
            logCountBadge.style.display = '';
          }
        }
      }
    });

    bindControls();
    bindLogControls();
  }

  // ─── Message helper ────────────────────────────────────────────────────────

  function sendMsg(message) {
    return browser.runtime.sendMessage(message).catch(err => {
      console.error('[E2ERecorder popup] sendMsg error:', err);
      return null;
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  function render() {
    if (!recorderState) return;
    const { isRecording, isAssertionMode, events, suggestedAssertions, tabs } = recorderState;

    // Status dot
    statusDot.className = 'status-dot';
    if (isRecording) statusDot.classList.add('recording');
    else if (isAssertionMode) statusDot.classList.add('assertion-mode');

    // Tab badge
    const tabCount = Object.keys(tabs || {}).length;
    tabBadge.textContent = `${tabCount} tab${tabCount !== 1 ? 's' : ''}`;

    // Record / Stop buttons
    btnRecord.style.display = isRecording ? 'none' : '';
    btnStop.style.display   = isRecording ? '' : 'none';

    // Assertion mode button highlight
    btnAssertion.classList.toggle('active', isAssertionMode);

    // Status text
    if (isRecording && isAssertionMode) {
      statusText.textContent = 'Assertion mode — click elements to add checks';
    } else if (isRecording) {
      statusText.textContent = `Recording… (${events.length} event${events.length !== 1 ? 's' : ''})`;
    } else {
      statusText.textContent = events.length > 0
        ? `Stopped — ${events.length} event${events.length !== 1 ? 's' : ''} captured`
        : 'Idle — open a page and click Record';
    }

    // Event count badge
    eventCountEl.textContent = `${events.length} event${events.length !== 1 ? 's' : ''}`;

    // Event list
    renderEventList(events, suggestedAssertions || []);

    // Editor toolbar (expand/collapse all) — visible only when there are candidate rows
    const hasCandidates = (events || []).some(e => e.selectorCandidates && e.selectorCandidates.length > 0);
    editorToolbar.style.display = hasCandidates ? '' : 'none';

    // Export section
    if (!isRecording && events.length > 0) {
      exportSection.style.display = '';
      recompileCode();
    } else {
      exportSection.style.display = isRecording ? 'none' : '';
    }
  }

  // ─── Event list rendering ──────────────────────────────────────────────────

  function renderEventList(events, assertions) {
    // Clear existing rows
    const existing = eventList.querySelectorAll('.event-row, .assertion-card, .param-hint, .insert-zone, .insert-form');
    for (const el of existing) el.remove();

    if (events.length === 0) {
      emptyState.style.display = '';
      return;
    }
    emptyState.style.display = 'none';

    // Leading insert zone (before first event)
    eventList.appendChild(buildInsertZone(-1));

    events.forEach((event, index) => {
      // ── Event row ──────────────────────────────────────────────────────────
      const row = buildEventRow(event, index);
      eventList.appendChild(row);

      // Parameterization hint for fill events with email/phone
      if (event.type === 'fill' && event.value) {
        const hint = buildParamHint(event);
        if (hint) eventList.appendChild(hint);
      }

      // ── Assertion cards tied to this event ─────────────────────────────────
      const eventAssertions = assertions.filter(a => a.afterEventId === event.id);
      for (const assertion of eventAssertions) {
        eventList.appendChild(buildAssertionCard(assertion));
      }

      // ── Insert zone after each row ─────────────────────────────────────────
      eventList.appendChild(buildInsertZone(index));
    });

    // Unlinked assertions (afterEventId === null — from assertion mode clicks)
    const unlinked = assertions.filter(a => a.afterEventId === null);
    for (const assertion of unlinked) {
      eventList.appendChild(buildAssertionCard(assertion));
    }
  }

  /**
   * Build a draggable event row element.
   */
  function buildEventRow(event, index) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.eventId = event.id;
    row.dataset.index = index;
    row.draggable = true;

    // ── Drag handle ──
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '≡';
    handle.title = 'Drag to reorder';

    // ── Type badge ──
    const typeBadge = document.createElement('span');
    typeBadge.className = `event-type ${eventTypeClass(event.type)}`;
    typeBadge.textContent = eventTypeLabel(event.type);

    // ── Health dot ──
    const healthDot = document.createElement('span');
    healthDot.className = 'health-dot';
    if (event.selector) {
      const { score } = SelectorEngine_getScoreSafe(event.selector);
      healthDot.classList.add(score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red');
      healthDot.title = `Score: ${score}`;
    }

    // ── Selector span (click to edit) ──
    const selectorEl = document.createElement('span');
    selectorEl.className = 'event-selector';
    selectorEl.textContent = event.selector || event.url || event.key || (event.type === 'wait' ? `${event.duration || 0} ms` : '');
    selectorEl.title = event.selector || '';
    selectorEl.addEventListener('click', () => startInlineEdit(event, selectorEl, healthDot, row));

    // ── Value ──
    const valueEl = document.createElement('span');
    valueEl.className = 'event-value';
    if (event.type === 'fill') valueEl.textContent = event.value || '';
    if (event.type === 'keypress') valueEl.textContent = event.key || '';
    if (event.type === 'selectOption') valueEl.textContent = event.value || '';
    valueEl.title = valueEl.textContent;

    // ── Candidates toggle button ──
    const candidates = event.selectorCandidates || [];
    const candBtn = document.createElement('button');
    candBtn.className = 'btn-candidates';
    candBtn.title = `${candidates.length} selector candidate(s) — click to inspect`;
    candBtn.textContent = `⚙ ${candidates.length}`;
    candBtn.style.display = candidates.length > 0 ? '' : 'none';
    candBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = row.nextElementSibling;
      if (existing && existing.classList.contains('candidates-panel')) {
        existing.remove();
        candBtn.classList.remove('active');
      } else {
        const panel = buildCandidatesPanel(event);
        row.parentNode.insertBefore(panel, row.nextSibling);
        candBtn.classList.add('active');
      }
    });

    // ── Delete button ──
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete this event';
    delBtn.addEventListener('click', () => {
      sendMsg({ type: 'DELETE_EVENT', eventId: event.id });
    });

    row.appendChild(handle);
    row.appendChild(typeBadge);
    row.appendChild(healthDot);
    row.appendChild(selectorEl);
    row.appendChild(valueEl);
    row.appendChild(candBtn);
    row.appendChild(delBtn);

    // ── Drag and drop for reordering ──
    row.addEventListener('dragstart', (e) => {
      dragSrcIndex = index;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.event-row').forEach(r => r.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const targetIndex = index;
      if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

      const events = recorderState.events.slice();
      const [moved] = events.splice(dragSrcIndex, 1);
      events.splice(targetIndex, 0, moved);
      sendMsg({ type: 'REORDER_EVENTS', events });
      dragSrcIndex = null;
    });

    return row;
  }

  /**
   * Start inline selector editing on a row.
   */
  function startInlineEdit(event, selectorEl, healthDot, row) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'selector-input';
    input.value = event.selector || '';

    selectorEl.replaceWith(input);
    input.focus();
    input.select();

    // Real-time validation feedback
    let validationTimer = null;
    input.addEventListener('input', () => {
      if (validationTimer) clearTimeout(validationTimer);
      validationTimer = setTimeout(async () => {
        const sel = input.value.trim();
        if (!sel) return;
        // Ask background to relay selector validation to the active content script
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) return;
        const resp = await sendMsg({
          type: 'VALIDATE_SELECTOR',
          tabId: tabs[0].id,
          selector: sel
        });
        if (resp && resp.ok && resp.result) {
          const { valid, unique, score } = resp.result;
          input.className = 'selector-input';
          if (!valid) {
            input.classList.add('invalid');
            healthDot.className = 'health-dot red';
          } else if (!unique) {
            input.classList.add('warn');
            healthDot.className = 'health-dot amber';
          } else {
            input.classList.add('valid');
            healthDot.className = `health-dot ${score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red'}`;
          }
        }
      }, 300);
    });

    const commit = () => {
      const newSelector = input.value.trim();
      if (newSelector && newSelector !== event.selector) {
        sendMsg({ type: 'UPDATE_EVENT_SELECTOR', eventId: event.id, selector: newSelector });
      }
      // Restore span
      const span = document.createElement('span');
      span.className = 'event-selector';
      span.textContent = newSelector || event.selector || '';
      span.title = span.textContent;
      span.addEventListener('click', () => startInlineEdit(event, span, healthDot, row));
      input.replaceWith(span);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = event.selector || ''; input.blur(); }
    });
  }

  /**
   * Build a parameterization hint row for email/phone values.
   */
  function buildParamHint(event) {
    const val = event.value || '';
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    const isPhone = /^\+?[\d\s\-().]{7,}$/.test(val) && /\d{5,}/.test(val);
    if (!isEmail && !isPhone) return null;

    const hint = document.createElement('div');
    hint.className = 'param-hint';
    hint.textContent = isEmail ? '📧 Detected email address.' : '📱 Detected phone number.';

    const extractBtn = document.createElement('button');
    extractBtn.className = 'btn-extract';
    extractBtn.textContent = 'Extract as variable';
    extractBtn.addEventListener('click', () => {
      const varName = isEmail ? 'userEmail' : 'userPhone';
      // Update value to use a placeholder variable name comment
      sendMsg({
        type: 'UPDATE_EVENT_SELECTOR',
        eventId: event.id,
        selector: event.selector // Keep selector, just notify user
      });
      hint.textContent = `✓ Use variable: ${varName} = "${val}"`;
      extractBtn.remove();
    });

    hint.appendChild(extractBtn);
    return hint;
  }

  /**
   * Build an assertion card element.
   */
  function buildAssertionCard(assertion) {
    const card = document.createElement('div');
    card.className = `assertion-card ${assertionStatusClass(assertion.accepted)}`;
    card.dataset.assertionId = assertion.id;

    const typeBadge = document.createElement('span');
    typeBadge.className = 'assertion-type';
    typeBadge.textContent = formatAssertionType(assertion.type);

    const details = document.createElement('span');
    details.className = 'assertion-details';
    details.textContent = assertionDetails(assertion);
    details.title = details.textContent;

    const actions = document.createElement('div');
    actions.className = 'assertion-actions';

    if (assertion.accepted === null) {
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'btn-accept';
      acceptBtn.textContent = '✓';
      acceptBtn.title = 'Accept — include in exported code';
      acceptBtn.addEventListener('click', () => {
        sendMsg({ type: 'ACCEPT_ASSERTION', assertionId: assertion.id });
      });

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn-reject';
      rejectBtn.textContent = '✕';
      rejectBtn.title = 'Discard this assertion';
      rejectBtn.addEventListener('click', () => {
        sendMsg({ type: 'DISCARD_ASSERTION', assertionId: assertion.id });
      });

      actions.appendChild(acceptBtn);
      actions.appendChild(rejectBtn);
    }

    card.appendChild(typeBadge);
    card.appendChild(details);
    card.appendChild(actions);
    return card;
  }

  // ─── Insert-between helpers ───────────────────────────────────────────────

  function buildInsertZone(afterIndex) {
    const zone = document.createElement('div');
    zone.className = 'insert-zone';
    zone.dataset.afterIndex = afterIndex;

    const btn = document.createElement('button');
    btn.className = 'insert-btn';
    btn.title = afterIndex < 0 ? 'Insert action at the beginning' : 'Insert action after this step';
    btn.textContent = '+';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close any other open forms
      eventList.querySelectorAll('.insert-form').forEach(f => f.remove());
      eventList.querySelectorAll('.insert-zone').forEach(z => z.style.opacity = '');

      const form = buildInsertForm(afterIndex);
      zone.insertAdjacentElement('afterend', form);
      zone.style.opacity = '1';
      form.querySelector('select, input')?.focus();
    });

    zone.appendChild(btn);
    return zone;
  }

  function buildInsertForm(afterIndex) {
    const form = document.createElement('div');
    form.className = 'insert-form';

    // ── Type selector ──
    const typeRow = document.createElement('div');
    typeRow.className = 'insert-form-row';
    const typeLabel = document.createElement('span');
    typeLabel.className = 'insert-form-label';
    typeLabel.textContent = 'Action';
    const typeSelect = document.createElement('select');
    [
      ['navigate',     'Navigate (go to URL)'],
      ['click',        'Click'],
      ['fill',         'Fill (type text)'],
      ['keypress',     'Key press'],
      ['hover',        'Hover'],
      ['scroll',       'Scroll'],
      ['selectOption', 'Select option'],
      ['wait',         'Wait (ms)'],
    ].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      typeSelect.appendChild(opt);
    });
    typeRow.append(typeLabel, typeSelect);
    form.appendChild(typeRow);

    // ── Dynamic fields ──
    const fieldsContainer = document.createElement('div');
    fieldsContainer.style.display = 'contents';
    form.appendChild(fieldsContainer);

    function makeRow(labelText, input) {
      const row = document.createElement('div');
      row.className = 'insert-form-row';
      const lbl = document.createElement('span');
      lbl.className = 'insert-form-label';
      lbl.textContent = labelText;
      row.append(lbl, input);
      return row;
    }

    function makeInput(type = 'text', placeholder = '') {
      const inp = document.createElement('input');
      inp.type = type; inp.placeholder = placeholder;
      return inp;
    }

    function rebuildFields() {
      fieldsContainer.innerHTML = '';
      const t = typeSelect.value;
      if (t === 'navigate') {
        fieldsContainer.appendChild(makeRow('URL', makeInput('url', 'https://...')));
      } else if (t === 'click' || t === 'hover') {
        fieldsContainer.appendChild(makeRow('Selector', makeInput('text', 'CSS selector')));
      } else if (t === 'fill') {
        fieldsContainer.appendChild(makeRow('Selector', makeInput('text', 'CSS selector')));
        fieldsContainer.appendChild(makeRow('Value', makeInput('text', 'Text to type')));
      } else if (t === 'keypress') {
        fieldsContainer.appendChild(makeRow('Selector', makeInput('text', 'CSS selector (optional)')));
        fieldsContainer.appendChild(makeRow('Key', makeInput('text', 'Enter, Tab, Escape…')));
      } else if (t === 'selectOption') {
        fieldsContainer.appendChild(makeRow('Selector', makeInput('text', '<select> CSS selector')));
        fieldsContainer.appendChild(makeRow('Value', makeInput('text', 'Option value')));
      } else if (t === 'wait') {
        fieldsContainer.appendChild(makeRow('ms', makeInput('text', '1000')));
      } else if (t === 'scroll') {
        fieldsContainer.appendChild(makeRow('Selector', makeInput('text', 'Container (blank = window)')));
        fieldsContainer.appendChild(makeRow('scrollY', makeInput('text', '300')));
      }
    }

    typeSelect.addEventListener('change', rebuildFields);
    rebuildFields();

    // ── Actions ──
    const actionsRow = document.createElement('div');
    actionsRow.className = 'insert-form-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      form.remove();
      eventList.querySelectorAll('.insert-zone').forEach(z => z.style.opacity = '');
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary btn-sm';
    confirmBtn.textContent = '+ Add step';
    confirmBtn.type = 'button';
    confirmBtn.addEventListener('click', () => {
      const t = typeSelect.value;
      const inputs = fieldsContainer.querySelectorAll('input');
      const vals = [...inputs].map(i => i.value.trim());

      let event = { type: t };
      if (t === 'navigate')     event = { type: 'navigate', url: vals[0] };
      else if (t === 'click')   event = { type: 'click', selector: vals[0] };
      else if (t === 'hover')   event = { type: 'hover',  selector: vals[0] };
      else if (t === 'fill')    event = { type: 'fill',   selector: vals[0], value: vals[1] };
      else if (t === 'keypress') event = { type: 'keypress', selector: vals[0], key: vals[1] };
      else if (t === 'selectOption') event = { type: 'selectOption', selector: vals[0], value: vals[1] };
      else if (t === 'wait')    event = { type: 'wait',   duration: parseInt(vals[0]) || 1000 };
      else if (t === 'scroll')  event = { type: 'scroll', selector: vals[0] || null, scrollY: parseInt(vals[1]) || 300 };

      // Basic validation
      if ((t === 'navigate' && !event.url) ||
          (['click','hover','fill','keypress','selectOption'].includes(t) && !event.selector)) {
        confirmBtn.textContent = 'Fill required fields';
        setTimeout(() => { confirmBtn.textContent = '+ Add step'; }, 1500);
        return;
      }

      sendMsg({ type: 'INSERT_EVENT', afterIndex, event });
      form.remove();
    });

    actionsRow.append(cancelBtn, confirmBtn);
    form.appendChild(actionsRow);
    return form;
  }

  // ─── Replay status helpers ────────────────────────────────────────────────

  function clearReplayStatus() {
    eventList.querySelectorAll('.replay-status').forEach(el => el.remove());
    eventList.querySelectorAll('.event-row').forEach(row => {
      row.classList.remove('replay-ok', 'replay-fail', 'replay-running', 'replay-skip');
    });
  }

  function setReplayStatus(eventId, status, error) {
    const row = eventList.querySelector(`[data-event-id="${eventId}"]`);
    if (!row) return;

    row.classList.remove('replay-ok', 'replay-fail', 'replay-running', 'replay-skip');
    row.classList.add(`replay-${status}`);

    let indicator = row.querySelector('.replay-status');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'replay-status';
      // Insert as the last child of the row (after delete btn)
      row.appendChild(indicator);
    }

    const icons = { ok: '✓', fail: '✗', running: '⟳', skip: '–' };
    indicator.textContent = icons[status] || '?';
    indicator.className = `replay-status replay-status-${status}`;
    indicator.title = error ? `Error: ${error}` : status;

    // Scroll the failing row into view
    if (status === 'fail') row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ─── Selector candidates panel ─────────────────────────────────────────────

  function buildCandidatesPanel(event) {
    const panel = document.createElement('div');
    panel.className = 'candidates-panel';

    const header = document.createElement('div');
    header.className = 'candidates-header';
    header.innerHTML = '<span>Selector candidates</span><span class="candidates-hint">Test each one against the active tab, then choose which to use.</span>';
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'candidates-list';

    const candidates = (event.selectorCandidates || []).slice();

    function renderCandidates() {
      list.innerHTML = '';
      if (candidates.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'candidates-empty';
        empty.textContent = 'No alternative candidates.';
        list.appendChild(empty);
        return;
      }

      for (const cand of candidates) {
        const row = document.createElement('div');
        row.className = `candidate-row ${event.selector === cand.selector ? 'candidate-active' : ''}`;
        row.dataset.selector = cand.selector;

        // Score indicator
        const scoreDot = document.createElement('span');
        const s = cand.score || 0;
        scoreDot.className = `cand-score-dot ${s >= 70 ? 'green' : s >= 40 ? 'amber' : 'red'}`;
        scoreDot.title = `Score: ${s}`;

        // Score number
        const scoreNum = document.createElement('span');
        scoreNum.className = 'cand-score-num';
        scoreNum.textContent = s;

        // Selector text
        const selText = document.createElement('span');
        selText.className = 'cand-selector';
        selText.textContent = cand.selector;
        selText.title = cand.selector;

        // Test result placeholder
        const testResult = document.createElement('span');
        testResult.className = 'cand-test-result';
        if (cand.tested) {
          testResult.textContent = cand.matchCount === 1 ? '✓ unique' : cand.matchCount === 0 ? '✗ not found' : `~ ${cand.matchCount} matches`;
          testResult.className = `cand-test-result ${cand.matchCount === 1 ? 'ok' : cand.matchCount === 0 ? 'fail' : 'warn'}`;
        }

        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'cand-actions';

        // Test button
        const testBtn = document.createElement('button');
        testBtn.className = 'btn btn-ghost btn-sm cand-btn-test';
        testBtn.textContent = 'Test';
        testBtn.title = 'Validate this selector against the active tab';
        testBtn.addEventListener('click', async () => {
          testBtn.textContent = '...';
          testBtn.disabled = true;
          try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            if (!tabs.length) throw new Error('No active tab');
            const resp = await sendMsg({ type: 'VALIDATE_SELECTOR', tabId: tabs[0].id, selector: cand.selector });
            if (resp && resp.ok && resp.result) {
              cand.tested = true;
              cand.matchCount = resp.result.count;
              renderCandidates();
            } else {
              testResult.textContent = 'Error';
              testResult.className = 'cand-test-result fail';
            }
          } catch {
            testResult.textContent = 'Error';
            testResult.className = 'cand-test-result fail';
          } finally {
            testBtn.textContent = 'Test';
            testBtn.disabled = false;
          }
        });

        // Use button (only when not already active)
        const useBtn = document.createElement('button');
        useBtn.className = 'btn btn-secondary btn-sm';
        useBtn.textContent = event.selector === cand.selector ? 'In use' : 'Use';
        useBtn.disabled = event.selector === cand.selector;
        useBtn.title = 'Set this selector as the active one for this event';
        useBtn.addEventListener('click', () => {
          suppressNextStateRender = true;
          sendMsg({ type: 'UPDATE_EVENT_SELECTOR', eventId: event.id, selector: cand.selector });
          event.selector = cand.selector;
          // Update the selector span in the parent row without a full re-render
          const parentRow = panel.previousElementSibling;
          if (parentRow) {
            const selectorSpan = parentRow.querySelector('.event-selector');
            if (selectorSpan) selectorSpan.textContent = cand.selector;
          }
          renderCandidates();
        });

        // Discard button
        const discardBtn = document.createElement('button');
        discardBtn.className = 'btn btn-ghost btn-sm cand-btn-discard';
        discardBtn.textContent = '✕';
        discardBtn.title = 'Remove this candidate from the list';
        discardBtn.addEventListener('click', () => {
          const idx = candidates.indexOf(cand);
          if (idx !== -1) candidates.splice(idx, 1);
          suppressNextStateRender = true;
          sendMsg({ type: 'DISCARD_SELECTOR_CANDIDATE', eventId: event.id, selector: cand.selector });
          renderCandidates();
        });

        actions.appendChild(testBtn);
        actions.appendChild(useBtn);
        actions.appendChild(discardBtn);

        row.appendChild(scoreDot);
        row.appendChild(scoreNum);
        row.appendChild(selText);
        row.appendChild(testResult);
        row.appendChild(actions);
        list.appendChild(row);
      }
    }

    renderCandidates();
    panel.appendChild(list);
    return panel;
  }

  // ─── Code compilation ──────────────────────────────────────────────────────

  function recompileCode() {
    if (!recorderState) return;
    if (!recorderState.events || recorderState.events.length === 0) {
      codeOutput.value = '// No events recorded yet.';
      return;
    }

    const options = {
      pageObjectModel: togglePom.checked,
      includeA11y: toggleA11y.checked
    };

    try {
      const code = Compilers.compile(activeFramework, recorderState, options);
      codeOutput.value = code;
    } catch (err) {
      codeOutput.value = `// Compilation error: ${err.message}`;
    }
  }

  // ─── Controls binding ──────────────────────────────────────────────────────

  function bindControls() {
    // Record
    btnRecord.addEventListener('click', async () => {
      clearReplayStatus();
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      await sendMsg({
        type: 'START_RECORDING',
        initialUrl: tab ? tab.url : '',
        tabId: tab ? tab.id : null
      });
    });

    // Stop
    btnStop.addEventListener('click', () => {
      sendMsg({ type: 'STOP_RECORDING' });
    });

    // Expand / Collapse all candidate panels
    btnExpandAll.addEventListener('click', () => {
      eventList.querySelectorAll('.btn-candidates').forEach(btn => {
        const row = btn.closest('.event-row');
        if (!row) return;
        const existing = row.nextElementSibling;
        if (existing && existing.classList.contains('candidates-panel')) return; // already open
        btn.click();
      });
    });

    btnCollapseAll.addEventListener('click', () => {
      eventList.querySelectorAll('.btn-candidates.active').forEach(btn => {
        btn.click();
      });
    });

    // Assertion mode
    btnAssertion.addEventListener('click', () => {
      sendMsg({ type: 'TOGGLE_ASSERTION_MODE' });
    });

    // Test replay
    btnTest.addEventListener('click', () => {
      sendMsg({ type: 'REPLAY_EVENTS' });
    });

    // Clear session
    btnClear.addEventListener('click', () => {
      if (confirm('Clear all recorded events? This cannot be undone.')) {
        sendMsg({ type: 'CLEAR_SESSION' });
      }
    });

    // Framework tabs
    for (const tab of fwTabs) {
      tab.addEventListener('click', () => {
        for (const t of fwTabs) t.classList.remove('active');
        tab.classList.add('active');
        activeFramework = tab.dataset.fw;
        recompileCode();
      });
    }

    // POM / A11y toggles
    togglePom.addEventListener('change', recompileCode);
    toggleA11y.addEventListener('change', recompileCode);

    // Copy code
    btnCopy.addEventListener('click', async () => {
      const text = codeOutput.value;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        copyConfirm.style.display = 'inline';
        setTimeout(() => { copyConfirm.style.display = 'none'; }, 2000);
      } catch {
        // Fallback: select all
        codeOutput.select();
        document.execCommand('copy');
      }
    });

    // Download code
    btnDownload.addEventListener('click', async () => {
      const text = codeOutput.value;
      if (!text) return;

      const ext = frameworkExtension(activeFramework);
      const filename = `e2e-test-${activeFramework}.${ext}`;
      const mimeType = ext === 'ts' || ext === 'js'
        ? 'text/javascript'
        : ext === 'py'
          ? 'text/x-python'
          : 'text/plain';

      await sendMsg({ type: 'DOWNLOAD_FILE', filename, content: text, mimeType });

      // If POM is enabled, also download page object files
      if (togglePom.checked && recorderState) {
        try {
          const pomFiles = Compilers.generatePageObjects(activeFramework, recorderState);
          for (const [pomFilename, pomCode] of pomFiles) {
            await sendMsg({
              type: 'DOWNLOAD_FILE',
              filename: pomFilename,
              content: pomCode,
              mimeType
            });
          }
        } catch (err) {
          console.warn('[E2ERecorder] POM download failed:', err);
        }
      }
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function SelectorEngine_getScoreSafe(selector) {
    // SelectorEngine is not available in popup context (it's a content script module).
    // Provide a heuristic score inline.
    if (!selector) return { score: 0 };
    let score = 0;
    if (selector.includes('data-testid') || selector.includes('data-cy')) score = 100;
    else if (selector.startsWith('#')) score = 85;
    else if (selector.includes('aria-label')) score = 75;
    else if (selector.includes('role=')) score = 72;
    else if (selector.includes('name=')) score = 70;
    else if (selector.includes('placeholder=')) score = 65;
    else if (selector.startsWith('.')) score = 30;
    else if (selector.includes('nth-child')) score = 5;
    else score = 10;
    return { score };
  }

  function eventTypeClass(type) {
    const map = {
      click: 'click', fill: 'fill', navigate: 'navigate',
      keypress: 'keypress', hover: 'hover', scroll: 'scroll',
      selectOption: 'select', dragAndDrop: 'drag', fileUpload: 'file',
      closeContext: 'other', wait: 'other'
    };
    return map[type] || 'other';
  }

  function eventTypeLabel(type) {
    const map = {
      click: 'click', fill: 'fill', navigate: 'nav',
      keypress: 'key', hover: 'hover', scroll: 'scroll',
      selectOption: 'select', dragAndDrop: 'drag', fileUpload: 'file',
      closeContext: 'close', wait: 'wait'
    };
    return map[type] || type;
  }

  function assertionStatusClass(accepted) {
    if (accepted === true)  return 'accepted';
    if (accepted === false) return 'rejected';
    return 'pending';
  }

  function formatAssertionType(type) {
    const map = {
      urlChanged: 'URL', elementVisible: 'visible', elementHidden: 'hidden',
      modalVisible: 'modal', accessibilityWarning: 'a11y'
    };
    return map[type] || type;
  }

  function assertionDetails(assertion) {
    switch (assertion.type) {
      case 'urlChanged':      return assertion.expectedUrl || '';
      case 'elementVisible':  return assertion.selector || assertion.description || '';
      case 'elementHidden':   return assertion.selector || '';
      case 'modalVisible':    return assertion.selector || '[role="dialog"]';
      case 'accessibilityWarning': return assertion.message || assertion.selector || '';
      default:                return assertion.selector || '';
    }
  }

  function frameworkExtension(fw) {
    if (fw === 'playwright-ts') return 'ts';
    if (fw === 'playwright-python') return 'py';
    if (fw === 'cypress') return 'js';
    if (fw === 'selenium') return 'js';
    return 'txt';
  }

  // ─── Main tab switching ────────────────────────────────────────────────────

  function switchPanel(panelId) {
    activePanel = panelId;
    mainTabs.forEach(t => t.classList.toggle('active', t.dataset.panel === panelId));
    panelRecorder.style.display = panelId === 'panel-recorder' ? '' : 'none';
    panelLogs.style.display     = panelId === 'panel-logs'     ? '' : 'none';
    if (panelId === 'panel-logs') {
      logCountBadge.style.display = 'none';   // Clear badge when user opens the tab
      renderLogs();
    }
  }

  // ─── Log rendering ─────────────────────────────────────────────────────────

  function renderLogs() {
    const levelFilter  = logLevelFilter  ? logLevelFilter.value  : 'all';
    const sourceFilter = logSourceFilter ? logSourceFilter.value : 'all';

    const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };
    const minLevel = LEVEL_ORDER[levelFilter] !== undefined ? LEVEL_ORDER[levelFilter] : 99;

    const filtered = allLogs.filter(entry => {
      const lvl = LEVEL_ORDER[entry.level] !== undefined ? LEVEL_ORDER[entry.level] : 2;
      if (lvl > minLevel) return false;
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
      return true;
    });

    // Remove existing entries
    logList.querySelectorAll('.log-entry').forEach(el => el.remove());

    if (filtered.length === 0) {
      logEmpty.style.display = '';
      return;
    }
    logEmpty.style.display = 'none';

    const frag = document.createDocumentFragment();
    for (const entry of filtered) {
      const row = document.createElement('div');
      row.className = `log-entry level-${entry.level || 'info'}`;

      const ts = document.createElement('span');
      ts.className = 'log-ts';
      ts.textContent = formatLogTs(entry.ts);

      const level = document.createElement('span');
      level.className = `log-level ${entry.level || 'info'}`;
      level.textContent = (entry.level || 'inf').substring(0, 3).toUpperCase();

      const source = document.createElement('span');
      source.className = `log-source ${sourceClass(entry.source)}`;
      source.textContent = entry.source || '?';
      source.title = entry.source || '';

      const msg = document.createElement('span');
      msg.className = 'log-msg';
      msg.textContent = entry.msg || '';

      row.appendChild(ts);
      row.appendChild(level);
      row.appendChild(source);
      row.appendChild(msg);
      frag.appendChild(row);
    }

    logList.appendChild(frag);
    // Auto-scroll to bottom
    logList.scrollTop = logList.scrollHeight;
  }

  function formatLogTs(ts) {
    if (!ts) return '--:--:--';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  function sourceClass(source) {
    if (source === 'background') return 'bg';
    if (source === 'content')    return 'ct';
    if (source === 'popup')      return 'pu';
    return '';
  }

  // ─── Log controls binding ──────────────────────────────────────────────────

  function bindLogControls() {
    // Tab switching
    mainTabs.forEach(tab => {
      tab.addEventListener('click', () => switchPanel(tab.dataset.panel));
    });

    // Filters
    if (logLevelFilter)  logLevelFilter.addEventListener('change', renderLogs);
    if (logSourceFilter) logSourceFilter.addEventListener('change', renderLogs);

    // Copy logs
    if (btnCopyLogs) {
      btnCopyLogs.addEventListener('click', async () => {
        const text = allLogs.map(e =>
          `${formatLogTs(e.ts)} [${(e.level||'info').toUpperCase()}] [${e.source||'?'}] ${e.msg}`
        ).join('\n');
        try {
          await navigator.clipboard.writeText(text);
          btnCopyLogs.textContent = 'Copied!';
          setTimeout(() => { btnCopyLogs.textContent = 'Copy'; }, 1800);
        } catch {
          /* ignore */
        }
      });
    }

    // Clear logs
    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => {
        sendMsg({ type: 'CLEAR_LOGS' });
        allLogs = [];
        renderLogs();
      });
    }

    // Popup itself logs to background on load
    sendMsg({ type: 'LOG_ENTRY', level: 'info', source: 'popup', msg: 'Popup opened' }).catch(() => {});
  }

  // ─── Start ─────────────────────────────────────────────────────────────────
  init();

})();
