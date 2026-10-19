# Polaris

A personal task manager that helps you decide what to work on next. Polaris runs entirely in your browser: there are
no accounts, no server, and your tasks never leave your device.

## Features

- **Tasks:** create, edit, complete, reopen, duplicate and delete tasks. Each task can have notes, a due date,
  importance (high, normal or low), tags, and steps.
- **Focus view:** shows what needs attention now (overdue, due today, high-importance, due soon) using fixed,
  explained rules rather than a hidden score.
- **Tags:** the single way to group tasks. A task can have any number of tags, and an Untagged view shows tasks with
  none.
- **Search, filters and sorting:** search text across titles, notes, steps and tag names. Filter by status, due date,
  importance and tag, with visible filter chips and a one-click reset. Sort by recommended order, due date,
  importance, creation date or title.
- **Bulk actions:** complete, reopen, tag or delete several tasks at once.
- **Undo** for every change, from the toast, the header button, or Ctrl+Z.
- **Canvas and Gradescope:** with the optional Polaris Connector Chrome extension, assignments become tasks tagged by
  course, follow upstream changes you haven't overridden, and complete when you submit. Deleted assignments stay
  deleted.
- **Backup and restore:** export to a documented JSON file and restore from it, with a preview before anything is
  replaced.
- **Data safety:** repairs damaged data instead of discarding it, keeps a previous good copy, saves a recovery copy of
  anything it can't read, and never overwrites data from a newer version.
- **Accessibility:** keyboard operable, labelled for screen readers, visible focus, no meaning conveyed by colour alone,
  respects reduced-motion settings, and works at phone widths. The target is WCAG 2.2 AA.

Keyboard shortcuts: <kbd>/</kbd> search · <kbd>n</kbd> new task · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo ·
<kbd>Esc</kbd> close a dialog.

## Running locally

Requires **Node.js 22.12 or later** (developed on Node 24 LTS).

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (normally http://localhost:5173).

To build a production version, which is a static `dist/` folder you can host anywhere or open with a static server:

```bash
npm run build
```

```bash
npm run preview
```

## Tests

| Command             | What it checks                                                                        |
| ------------------- | ------------------------------------------------------------------------------------- |
| `npm test`          | Unit tests (Vitest): task rules, steps, Focus ordering, search/filter/sort, progress, storage, migrations, backup, store and undo |
| `npm run test:e2e`  | Browser tests (Playwright) on desktop Chrome and a Pixel 7 viewport, including axe-core accessibility scans |
| `npm run typecheck` | TypeScript in strict mode, covering both the app and the e2e tests                    |
| `npm run check`     | All of the above, plus a production build                                             |

The first time you run the e2e tests, install the browser with `npx playwright install chromium`.

## Project layout

```
src/domain/    data model, validation and every task rule (pure, framework-free)
src/storage/   storage file format, migrations, repair on load, backup and restore
src/state/     app store: persistence, undo history, cross-tab sync
src/ui/        Preact components
tests/unit/    Vitest tests
e2e/           Playwright tests
docs/          DESIGN.md (rules and tradeoffs), DATA_FORMAT.md (backup format)
```

## Privacy and dependencies

Polaris makes no network requests and has no analytics. The optional Polaris Connector extension reads Canvas and
Gradescope with your existing sign-in and passes assignments to the Polaris tab; nothing is sent anywhere else. Its only runtime dependency is
[Preact](https://preactjs.com). The development tools are Vite, TypeScript, Vitest, Playwright and axe-core.

## Known limitations

- **Data lives in this browser only.** Clearing site data for the page erases it. Export a backup regularly; it's
  also how you move tasks to another device.
- Undo history lasts until you reload the page or another tab changes the data.
- If two tabs edit at once, the last save wins. The other tab reloads to show the latest data.
- Due dates are calendar dates only; there are no due times.
- Steps are one level deep and have no dates of their own.
- Restore replaces all data; there's no merge.
- Accessibility is verified with automated axe-core checks and keyboard tests. It hasn't been tested by hand with a
  screen reader.

## Future work

Suggested next steps, roughly in order of value:

1. **Sync across devices.** This needs deletion tombstones, a conflict policy (for example, per-field last-writer-wins
   using `updatedAt`), offline queueing, and recovery from failed syncs. The data model already uses UUIDs and
   timestamps with this in mind.
2. Installable offline app (PWA manifest and service worker) and a reminder to back up regularly.
3. Recurring tasks and reminders.
4. A manual screen-reader pass with NVDA and VoiceOver.
