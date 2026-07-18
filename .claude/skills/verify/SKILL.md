---
name: verify
description: Build, launch, and drive makegtd in a real browser to verify changes end to end.
---

# Verifying makegtd changes

No build step is needed for JS-only changes. If Tailwind classes changed,
run `npm run build:css` first and commit `css/styles.css`.

## Launch

```bash
python3 -m http.server 8080 --directory /path/to/makegtd   # run in background
```

## Drive (Playwright + preinstalled Chromium)

Install Playwright in a scratch dir (`npm install playwright`) and launch with
the preinstalled browser — do NOT run `npx playwright install`:

```js
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

Useful handles (mobile-ish viewport 420x820 renders everything):

- Routes: `#/hoy`, `#/entrada`, `#/procesar`, `#/siguientes`, `#/proyectos`,
  `#/proyectos/<id>`, `#/agenda`, `#/espera`, `#/algundia`, `#/referencia`, `#/revision`.
- Quick capture: click `#capture-fab`, fill `#capture-input`, press Enter
  (form stays open to chain captures), then Escape to close.
- Create project: on `#/proyectos`, fill `#project-input` and click the submit
  button. **It navigates to the project detail page**, where the name is in an
  `<input id="project-name">` (value attribute, not text — text locators fail).
- Clarify wizard buttons are `[data-action="pz-*"]`; view content is in `#view`;
  toasts in `#toast`.

## Gotchas

- All app state lives in IndexedDB (database `gtd`, store `state`, key
  `gtd:data`) AND in memory; the legacy `localStorage` key `gtd:data:v1` is a
  migration source/fallback. Clearing storage alone is not enough: changing
  `location.hash` in the same evaluate triggers a render that can re-save
  in-memory state. To reset, clear both storages (`indexedDB.deleteDatabase('gtd')`
  + `localStorage.clear()`) and `page.reload()` with no other interaction in
  between, or just use a fresh browser context.
- Boot is async (`GTD.store.init()`): after `page.goto` wait for `#view` to
  have content before evaluating anything against `GTD.*`.
- The Clarify wizard keeps module-level state (`step`, `itemId`) across hash
  navigation within a page session; it only resets per item or on page load.
- Bump `CACHE_VERSION` in `sw.js` for any precached asset change (all js/css/html).
