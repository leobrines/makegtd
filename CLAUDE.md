# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Language policy

- **All code, comments, variable names, file names, commit messages, and pull requests must be written in English.**
- **All user-facing UI text must be written in Spanish** (the app targets Spanish-speaking users). The HTML document uses `lang="es"`.

## What this is

**makegtd** is an installable, offline-first PWA implementing the full GTD (Getting Things Done) workflow end to end: Capture → Clarify → Organize → Reflect → Engage. There is no backend and no framework: everything runs in the browser and persists to IndexedDB on the device.

## Canonical GTD sources — always consult before changing GTD behavior

The official David Allen Company PDFs live in `docs/gtd/` (see `docs/gtd/README.md` for
summaries and source URLs). **Any change that touches GTD behavior — statuses, views,
the Clarify wizard, the weekly review, lists, calendar/scheduling logic — must be
grounded in these documents. Consult them explicitly and cite the relevant document
(and rule) in the commit/PR description:**

- `docs/gtd/gtd-workflow-map.pdf` — the official workflow map: the five steps and the
  Clarify/Organize decision tree (actionable? → do/delegate/defer; not actionable? →
  trash/incubate/reference; multi-step → project).
- `docs/gtd/gtd-weekly-review-checklist.pdf` — the official GTD Weekly Review®
  checklist: 11 steps in 3 phases (Get Clear, Get Current, Get Creative). `js/review.js`
  must follow it.
- `docs/gtd/gtd-setup-guide-paper-sample.pdf` — the official Setup Guide sample: the
  canonical system sections (In, Calendar, Next Actions by context, Projects,
  Someday/Maybe, Reference…), the calendar rule (only day/time-specific actions go on
  the calendar), and the rule that every project needs at least one next action.

If a requested change contradicts these documents, flag the conflict instead of
silently implementing it.

## Stack

- Vanilla JavaScript (classic `<script>` tags, no bundler, no modules) + jQuery (vendored at `js/vendor/jquery.min.js` — never load it from a CDN).
- Tailwind CSS v3 compiled to a static stylesheet with the Tailwind CLI. The compiled `css/styles.css` **is committed** so the app runs as plain static files.
- IndexedDB for persistence: database `gtd`, object store `state`, a single versioned document (`version: 2`) written atomically under key `gtd:data`. The legacy `localStorage` key `gtd:data:v1` is migrated on first run and doubles as the fallback when IndexedDB is unavailable or a write fails (init picks whichever copy has the newer `savedAt`).
- PWA: `manifest.webmanifest` + `sw.js` (precache, cache-first). No asset may be loaded from the network at runtime.

## Commands

```bash
npm install            # once, installs tailwindcss (dev-only)
npm run build:css      # regenerate css/styles.css (required after changing any Tailwind classes)
npm run watch:css      # same, in watch mode
npm test               # unit tests for the sync merge engine and crypto layer (plain Node, no framework)
python3 -m http.server 8080   # serve locally (service workers need http://localhost, not file://)
```

## Architecture

Scripts share a single global namespace `GTD` and are loaded in this order (order matters):

1. `js/vendor/jquery.min.js`
2. `js/store.js` — persistence layer (IndexedDB, localStorage fallback): async `init()` required before any access, then synchronous in-memory state with atomic whole-state writes; CRUD for items/projects/contexts, JSON export/import, tombstones for permanent deletions.
3. `js/sync.js` — pure state-merge engine for multi-device sync: `GTD.sync.merge(docs)` resolves entities last-writer-wins by `updatedAt` and applies tombstones, deterministically and without I/O or clock reads. Unit-tested via `npm test` (`test/sync.test.js`, plain Node, no framework); run it after touching merge semantics.
4. `js/crypto.js` — end-to-end encryption for sync payloads: `GTD.crypto.encryptString/decryptString` (native WebCrypto, PBKDF2-SHA256 + AES-256-GCM, self-describing JSON envelope, passphrase never stored server-side). Unit-tested via `npm test` (`test/crypto.test.js`).
5. `js/drive.js` — opt-in Google Drive sync transport + orchestration: OAuth 2.0 implicit flow (full-page redirect to `accounts.google.com`, no external scripts — GIS is a CDN load and stays banned), encrypted per-device files (`gtd-device-<id>.json`) in the user's `appDataFolder` via the Drive REST v3 API, merge through `GTD.sync.merge`. Each user brings their own OAuth Client ID (the Settings view has the step-by-step guide). Device-local keys (`localStorage`: `gtd:device-id`, `gtd:sync:gdrive` — includes the passphrase, deliberately device-local — and `gtd:sync:last`; `sessionStorage`: token + OAuth state) are never part of the synced document. `app.js` must call `GTD.drive.handleRedirect()` at boot before the router reads `location.hash`. Pure helpers unit-tested via `npm test` (`test/drive.test.js`).
6. `js/model.js` — domain constants (item statuses, labels), factories, pure helpers (overdue/scheduled-today queries, projects without a next action, focus limit).
7. `js/views.js` — render functions for each view (jQuery-built DOM).
8. `js/process.js` — the Clarify wizard (GTD decision tree, one item and one decision at a time).
9. `js/review.js` — the guided weekly review wizard.
10. `js/app.js` — hash router (`#/hoy`, `#/entrada`, …), navigation shell, global quick-capture, service worker registration.

### Data model

A single `Item` entity flows through the whole GTD pipeline by changing `status`: `inbox | next | waiting | scheduled | someday | reference | done`. Projects are a separate entity; contexts are plain strings like `@casa`.

Sync-readiness invariants (preserve them in any change): every entity (item, project, horizon) carries an `updatedAt` timestamp that must be refreshed on **every** mutation — use the store CRUD functions, which stamp it automatically; stamp it manually if you must mutate state directly. Permanent deletions (emptying the trash, hard deletes) append `{id, type, deletedAt}` tombstones to `state.tombstones` so a future sync layer can propagate deletions instead of resurrecting stale copies.

## Conventions

- Bump `CACHE_VERSION` in `sw.js` whenever any precached asset changes, or users will keep the stale version.
- Keep `css/styles.css` in sync: if a change adds/removes Tailwind classes, run `npm run build:css` and commit the result.
- The hardware/browser back button (Android) must stay in sync with any in-app back
  navigation: in-view sub-navigation (wizard steps, multi-step flows) must push
  `history` entries and handle `popstate` so hardware back undoes exactly one step,
  same as the in-app "Volver atrás" button. See the history integration in
  `js/process.js` for the reference implementation.
- No new runtime dependencies. No CDN URLs anywhere. Two exceptions, both optional and user-initiated, neither loading any script/asset: (1) the "add to Google Calendar" buttons open an external `calendar.google.com/calendar/render?action=TEMPLATE` URL in a new tab; (2) the opt-in Drive sync navigates to `accounts.google.com` for OAuth and `fetch`es `www.googleapis.com`, and its setup guide links out to `console.cloud.google.com` pages — the app itself stays fully offline-functional when sync is off or unreachable.
- Dates are stored as ISO strings; day-level comparisons use local dates (`YYYY-MM-DD`), not UTC.

## UI/UX principles (minimalist, ADHD-friendly)

These are deliberate product constraints — preserve them in any change:

- **Zero-friction capture**: the floating “+” button and the `n` shortcut must always work from any view.
- **One decision at a time**: the Clarify wizard never shows the whole decision tree at once.
- **Focus limit**: at most 3 focus tasks per day in the “Hoy” view. Do not raise this limit.
- **Minimal noise**: neutral palette + a single accent color, system font stack, no decorative shadows/gradients/animations (only ≤150ms transitions), progressive disclosure (details collapsed by default).
- Large touch targets (≥44px), AA contrast, automatic dark mode via `prefers-color-scheme`.
- Calm empty states with a single call to action.
