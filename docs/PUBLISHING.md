# Publishing E2E Recorder v2

## Documents in this folder

| File | Purpose |
|------|---------|
| `privacy-policy.html` | Ready-to-host privacy policy page (required by both stores) |
| `store-listing-firefox.md` | Step-by-step guide + all copy for Firefox AMO submission |
| `store-listing-chrome.md` | Step-by-step guide + all copy for Chrome Web Store submission |

---

## Quick checklist before submitting anywhere

1. **Host the privacy policy**
   Upload `docs/privacy-policy.html` to a public URL. The simplest option:
   - Push the repo to GitHub
   - Enable GitHub Pages on the `main` branch (`/docs` folder)
   - URL will be: `https://YOUR_USERNAME.github.io/YOUR_REPO/privacy-policy.html`
   - Update all `YOUR_USERNAME` placeholders in both store listing files

2. **Build the packages**
   ```
   # Firefox
   build.cmd

   # Chrome
   build_Chrome.cmd
   ```
   Outputs: `dist/e2e-recorder-v2.xpi` and `dist/e2e-recorder-v2-chrome.zip`

3. **Prepare screenshots** (neither store accepts submissions without at least one)
   Minimum 1280×800 px. Suggested shots listed in each store guide.

4. **Submit**
   - Firefox AMO: https://addons.mozilla.org/developers/addon/submit/
   - Chrome Web Store: https://chrome.google.com/webstore/devconsole

---

## Key differences between the two stores

| | Firefox AMO | Chrome Web Store |
|--|-------------|-----------------|
| Upload format | `.xpi` | `.zip` |
| One-time fee | Free | $5 USD |
| Source code required | Yes (zip of source) | No (but may be requested) |
| Build instructions required | Yes | No |
| Review time (first submission) | 1–7 days | 1–3 weeks |
| `<all_urls>` scrutiny | Moderate | High (manual review guaranteed) |
| Privacy policy required | Yes | Yes |
| HTML in description | Yes (limited tags) | No (plain text only) |
