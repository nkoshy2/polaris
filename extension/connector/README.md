# Polaris Connector

A Chrome extension that adds your Canvas and Gradescope assignments to Polaris as tasks. It reads both sites with your
existing sign-in (no access token or password) and hands the assignments to the open Polaris tab. Nothing is sent
anywhere else.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder (`extension/connector`).
3. Sign in to [canvas.illinois.edu](https://canvas.illinois.edu) and [gradescope.com](https://www.gradescope.com) in
   the same Chrome profile.
4. Open Polaris ([nkoshy2.github.io/polaris](https://nkoshy2.github.io/polaris/) or a local `npm run dev` on port
   5173). Tabs that were already open need a reload.

Polaris syncs when it opens, every 30 minutes while Chrome is running, and when you click **Backup → Sync now**. The
Backup dialog shows the extension version, the last sync, any error, and deleted assignments that won't be added
again. If a source's latest sync failed (for example you were signed out of Gradescope), Polaris also shows a notice
under its header until that source syncs successfully again.

Each batch carries `fetchedAt`, the time it was fetched. The latest batch and status for each source are cached in
`chrome.storage.local` and sent to Polaris when it opens, so Polaris shows when the data was actually fetched rather
than the time it arrived.

Opening Polaris re-syncs only if the last sync started more than 5 minutes ago. Batches go to the most recently used
Polaris tab at each address (the published site and localhost keep separate data), and only to tabs where Polaris
itself has loaded.

After changing the extension's files, click the reload icon on its card in `chrome://extensions`.

## What it reads

- `GET /api/v1/planner/items` from two weeks ago to four months ahead: assignments, quizzes and graded discussions.
  Announcements and calendar events are skipped.
- `GET /api/v1/courses?enrollment_state=active`, for course codes used as tags ("AE 370").

An item counts as done when Canvas says it is submitted, graded or excused, or you marked it done in the Canvas
planner. "Graded" covers work handed in outside Canvas, such as an exam taken in class.

Gradescope has no public API, so the extension reads the pages you see when signed in:

- The dashboard (`/account`), for your courses. Only the newest term's courses are read.
- Each of those courses' assignment table (`/courses/<id>`), one course at a time. Assignments due from two weeks ago
  to four months ahead are kept. A score or "Submitted" counts as done; "No Submission" doesn't.

If Gradescope changes its page layout, sync stops with "Gradescope's … looks different than expected" in the Backup
dialog rather than adding wrong tasks. An assignment in both Canvas and Gradescope (same course, title and due date)
becomes one task; Canvas syncs first, so its title and link are used.

Polaris's sync rules are in `docs/DESIGN.md` under "Assignment sync".

## Files

| File            | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `background.js` | Timer, sync runs, cache in `chrome.storage.local`, delivery to Polaris  |
| `canvas.js`     | Canvas fetch and mapping (tested by `tests/unit/extension-canvas.test.ts`) |
| `gradescope.js` | Gradescope page parsing (tested by `tests/unit/extension-gradescope.test.ts`) |
| `content.js`    | Relays messages between the Polaris page and the service worker        |
