/**
 * StateStore — abstraction over browser.storage.local.
 * Works in both content scripts and background.js contexts.
 * Content scripts should NOT mutate state directly; they send messages
 * to background.js which is the single writer.
 */

// Chrome/Firefox compatibility shim
if (typeof browser === 'undefined') { var browser = chrome; } // eslint-disable-line no-undef
const StateStore = {
  MAX_LOGS: 500,

  DEFAULT_STATE: {
    isRecording: false,
    isAssertionMode: false,
    sessionId: null,
    initialUrl: '',
    tabs: {},
    events: [],
    suggestedAssertions: [],
    logs: []
  },

  /**
   * Read the current recorder state from storage.
   * @returns {Promise<object>} The current state object.
   */
  async get() {
    const result = await browser.storage.local.get('e2eRecorderState');
    return result.e2eRecorderState || { ...this.DEFAULT_STATE };
  },

  /**
   * Persist the given state object to storage.
   * @param {object} state
   * @returns {Promise<void>}
   */
  async set(state) {
    await browser.storage.local.set({ e2eRecorderState: state });
  },

  /**
   * Reset to a fresh session with a new sessionId.
   * @returns {Promise<void>}
   */
  async reset() {
    await this.set({
      ...this.DEFAULT_STATE,
      sessionId: crypto.randomUUID()
    });
  }
};
