# Polaris Connector

A Chrome extension that adds your Canvas assignments to Polaris as tasks. It reads Canvas with your existing sign-in
(no access token or password) and hands the assignments to the open Polaris tab. Nothing is sent anywhere else.
Gradescope support comes next.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder (`extension/connector`).
3. Sign in to [canvas.illinois.edu](https://canvas.illinois.edu) in the same Chrome profile.
4. Open Polaris ([nkoshy2.github.io/polaris](https://nkoshy2.github.io/polaris/) or a local `npm run dev` on port
   5173). Tabs that were already open need a reload.

Polaris syncs when it opens, every 30 minutes while Chrome is running, and when you click **Backup → Sync now**. The
Backup dialog shows the extension version, the last sync, any error, and deleted assignments that won't be added
again.

After changing the extension's files, click the reload icon on its card in `chrome://extensions`.

## What it reads

- `GET /api/v1/planner/items` from two weeks ago to four months ahead: assignments, quizzes and graded discussions.
  Announcements and calendar events are skipped.
- `GET /api/v1/courses?enrollment_state=active`, for course codes used as tags ("AE 370").

An item counts as done when Canvas says it is submitted, graded or excused, or you marked it done in the Canvas
planner. "Graded" covers work handed in outside Canvas, such as an exam taken in class. Work handed in only on
Gradescope shows as not submitted in Canvas until Gradescope sync is added.

Polaris's sync rules are in `docs/DESIGN.md` under "Assignment sync".

## Files

| File            | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `background.js` | Timer, sync runs, cache in `chrome.storage.local`, delivery to Polaris  |
| `canvas.js`     | Canvas fetch and mapping (tested by `tests/unit/extension-canvas.test.ts`) |
| `content.js`    | Relays messages between the Polaris page and the service worker        |
