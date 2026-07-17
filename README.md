# makeGTD

An installable, offline-first PWA implementing the full [Getting Things Done®](https://gettingthingsdone.com/) workflow end to end — Capture → Clarify → Organize → Reflect → Engage — with a minimalist, ADHD-friendly Spanish UI.

No backend, no framework: vanilla JavaScript + jQuery, Tailwind CSS compiled to a static stylesheet, and IndexedDB for persistence. Everything runs in the browser and works fully offline once installed.

## Features

- **Hoy** — overdue and due-today items, plus a daily focus list deliberately capped at 3 tasks.
- **Bandeja de entrada** — zero-friction capture: floating "+" button and the `n` shortcut from any view, with chained captures.
- **Procesar** — a guided Clarify wizard that follows the official GTD workflow map one question at a time: delete / incubate (someday, optionally with a tickler date) / reference; single-step vs. project (desired outcome + first action); 2-minute rule / delegate / schedule / next action, with optional linking to an existing project.
- **Próximas acciones** — filterable by context (`@casa`, `@llamadas`, …).
- **Agenda** — everything with a date: overdue, today, and upcoming.
- **Proyectos** — with an alert whenever an active project has no next action.
- **A la espera**, **Algún día / Tal vez**, **Referencia**.
- **Revisión semanal** — a guided wizard mirroring the official [GTD Weekly Review® checklist](https://gettingthingsdone.com/wp-content/uploads/2016/04/GTD-WeeklyReview.pdf): 11 steps in 3 phases (Get Clear, Get Current, Get Creative).
- **Ajustes** — manage contexts, JSON export/import backup, wipe data.

## Add to Google Calendar

Scheduled items offer an optional "add to Google Calendar" button: in the scheduling step of the Clarify wizard (when the calendar entry is created) and, for items already scheduled in the app, in the Agenda list and the item editor. It opens Google Calendar's event template URL pre-filled with the task's title, date, and notes — no API, no account linking, no data leaves the device unless you click it.

Scheduled items can optionally carry a time (`HH:MM`). Without one the Google Calendar link creates an all-day event; with one it creates a one-hour timed event.

URL format based on the excellent [add-event-to-calendar-docs](https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs):

```
https://calendar.google.com/calendar/render?action=TEMPLATE&text=TITLE&dates=YYYYMMDD/YYYYMMDD&details=NOTES
```

## Development

```bash
npm install                    # once, installs tailwindcss (dev-only)
npm run build:css              # regenerate css/styles.css after changing Tailwind classes
python3 -m http.server 8080    # serve locally (service workers need http://localhost)
```

Then open `http://localhost:8080`. The compiled `css/styles.css` is committed, so the app also runs as plain static files without any build step.

## Notes

- All data stays on the device, in IndexedDB (a single versioned document written atomically; data from older versions stored in `localStorage` is migrated automatically). The app requests persistent storage so the browser does not evict it. Use Ajustes → Exportar for backups.
- Bump `CACHE_VERSION` in `sw.js` whenever a precached asset changes.
- Code, comments, and commits are in English; all user-facing UI text is in Spanish (see `CLAUDE.md`).
