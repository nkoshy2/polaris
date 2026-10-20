# Polaris design notes

This document records the product rules and the non-obvious technical decisions.
The rules here are implemented in `src/domain/` and covered by `tests/unit/`.

## Platform and architecture

Polaris is a local-first web app: static files, no server, no accounts, and no network requests.

| Layer        | Location        | Responsibility                                                |
| ------------ | --------------- | ------------------------------------------------------------- |
| Domain       | `src/domain/`   | Data model, validation, every task rule. Pure functions only. |
| Storage      | `src/storage/`  | File format, migrations, repair-on-load, backup/restore.      |
| State        | `src/state/`    | Holds current data, persists each change, undo history.       |
| Presentation | `src/ui/`       | Preact components. No business rules.                          |

**Why these choices**

- **Preact + Vite + TypeScript.** The UI has lots of interdependent state (filters, selection, dialogs, toasts). A
  small component library (Preact, ~4 KB) avoids hand-written DOM syncing bugs without React's weight. Vite needs no
  plugin: TypeScript's JSX settings point JSX at Preact.
- **localStorage, not IndexedDB.** It is synchronous, which keeps the save path simple and atomic per key. It has room
  for well over 10,000 typical tasks (about 5 MB per origin). The `Repository` class is the only code that touches
  storage, so moving to IndexedDB later only means swapping that one class.
- **Snapshot undo.** Every change records the previous `AppData`, and undo restores it. Data is immutable, so a
  snapshot is a cheap reference, not a copy. History is capped at 50 entries and is not persisted.

## Organisation: tags only

Tags are the only way to group tasks. A task has zero or more tags, and "Untagged" shows tasks with none. There are
no separate projects, lists or folders, so there are never two overlapping ways to do the same thing.
"Moving" a task between tags means editing its tags; nothing else about the task changes.

Deleting a tag removes it from every task. The tasks themselves are never deleted, and the action can be undone.
Tag names are unique, ignoring case.

## Importance, urgency, due date, status

These are separate concepts and are never mixed together:

| Concept    | Source                         | Values                                   |
| ---------- | ------------------------------ | ---------------------------------------- |
| Importance | Set by the user                | high, normal (default), low              |
| Due date   | Set by the user, optional      | a local calendar date (`YYYY-MM-DD`)     |
| Urgency    | **Derived** from due + today   | overdue, today, soon (1–7 days), later, none |
| Status     | Set by the user                | open, or completed (`completedAt` set)   |

Completed tasks have no urgency: a finished task is never shown as overdue.

## Focus (the recommended list)

Focus uses fixed tiers instead of a score. An open task appears in the **first** tier it matches:

1. Overdue
2. Due today
3. High importance, due within 7 days
4. High importance (any other date, or none)
5. Due within 7 days

Open tasks that match no tier are not shown in Focus; they are always in All tasks. Inside a tier, tasks are ordered
by earliest due date (tasks with no date last), then higher importance, then oldest created. The same ordering is the
"Recommended" sort in All tasks. The app explains these rules under "How Focus decides what to show".

## Steps (subtasks)

Steps are one level deep and belong to a single task. They are deliberately not tasks: they have no due date,
importance or tags of their own.

The invariant is that **a completed task never has open steps.** It is enforced by these rules:

- Completing a task marks all of its steps done.
- Unchecking a step of a completed task reopens the task.
- Adding an open step to a completed task reopens it.
- Finishing every step does **not** complete the task; the user decides when it's done.
- Reopening a task leaves its steps as they were.
- Deleting a task deletes its steps. This can be undone.
- Duplicating a task copies its steps, all unchecked, with new IDs.

## Progress rules

- Totals count **tasks only**. A task with 10 steps counts as one task.
- A task counts as completed only when the task itself is completed, however many of its steps are done.
- Step progress is shown per task as "X of Y steps".
- Percentages are `floor(completed / total × 100)`, so 100% only ever means everything is done. With no tasks, no
  percentage is shown.
- Each overview count on Focus (Overdue, Due today, Due in the next 7 days) equals the number of tasks in the list it
  links to. A unit test checks this.
- "Completed in the last 7 days" counts tasks whose completion falls on today or one of the six days before, in local
  time.

## Assignment sync

Canvas and Gradescope assignments can become tasks. Polaris itself still makes no network requests. The optional
Polaris Connector Chrome extension reads assignments using the user's existing sign-in on those sites (UIUC does not
allow personal access tokens) and hands them to the Polaris tab. The merge rules live in `src/domain/sync.ts`:

| Upstream                                   | Polaris                                                              |
| ------------------------------------------ | -------------------------------------------------------------------- |
| New assignment                             | An open task, importance normal, tagged with its course              |
| Title or deadline changed                  | Updated, unless the user edited that field since the last sync       |
| Submitted                                  | The task is completed (with its steps), once per submission          |
| Missing from a complete fetch              | `removedAt` is set; the task is never deleted                        |
| An assignment the user deleted             | Never re-created, nor its other-source copy; listed in `dismissedSources` until allowed again |
| Same assignment in Canvas and Gradescope   | One task; the second source is linked as an alias                    |

- **Course tags.** The tag is "DEPT number" when the course name contains one, so Canvas's
  "Fall 2026-AE 312-Compressible Flow-Section A" and Gradescope's "ae_312_120268_262662" both become "AE 312". An
  existing tag with that name (ignoring case) is reused. A user who removes the tag from a task keeps it removed.
- **Due dates.** Upstream deadlines are exact times, and the due date is their local calendar date. A deadline in the
  first hour of a day (12:00–12:59 AM) counts as the evening before, the day the work has to be done. The exact
  deadline is kept in `source.dueAt`.
- **User edits win.** `source.syncedTitle` and `source.syncedDue` hold the last upstream values. A task field that
  differs from them was edited by the user and is left alone; the others keep following upstream.
- **Submission.** `source.submittedKeys` lists which linked sources currently report a submission. The task is
  completed when that list goes from empty to non-empty, so a submitted task the user reopens stays open until it is
  unsubmitted and submitted again. Reopening is never done by sync.
- **Duplicates.** A Gradescope assignment links to a Canvas task (and vice versa) when the course tag, the title
  (ignoring case, spaces and punctuation) and the due date match. The first source to report the assignment owns
  its title, due date and link; the alias only reports submission.
- **Deleted assignments.** Deleting a synced task adds its keys to `dismissedSources`, along with its tag names,
  synced title and synced due date. An assignment from the other source that matches an entry the way duplicates
  are linked is dismissed too, and its key joins the entry, so deleting a Canvas task also keeps its Gradescope copy
  away even if the two were never linked. Entries saved before these fields existed match by key only.
- **Stale editor saves.** The editor keeps the values it opened with. On save, a title or due date the user didn't
  change in the form keeps the task's current value, so a sync that arrived while the editor was open isn't
  overwritten and then mistaken for a user edit.
- **Gradescope keys.** A Gradescope row is keyed by its assignment ID, taken from the name cell or, failing that,
  any `data-assignment-id` or link to the course's assignment in the row. Rows with no ID anywhere (usually closed
  or not yet open, with no submission) fall back to course plus title, so renaming one upstream creates a new task
  and flags the old one (see the extension's README).
- **Removed upstream.** A batch can say which deadline window it fetched completely. Only linked tasks with a
  deadline inside that window can be flagged, so a narrower fetch never flags assignments outside it.
- **Undo.** Each sync is one undo step. A sync that changes nothing records no step.
- **Extension messages.** The extension's content script and the page use `window.postMessage` on the page's own
  origin (protocol in `src/state/connector.ts`). Polaris accepts only messages from its own window and origin, and
  validates every batch with `parseSyncBatch`. Sync status is kept in memory and shown under Backup.
- **Sync times.** The extension stamps each batch with `fetchedAt`, the time it was fetched. When Polaris loads, the
  extension replays its cached batches, which can be hours old, so the status shows `fetchedAt` (never later than
  now) rather than the time the batch arrived. A batch without it counts as fetched now. A status older than the one
  already shown is ignored: on load the cached failure arrives before the cached batch from the sync before it, and
  the failure must win.
- **Failures are visible.** While any source's latest status is a failure (for example "Not signed in to
  Gradescope."), a notice under the header says so in words, with the extension's message and an *Open Backup*
  button. It is `role="status"`, so it doesn't interrupt, and it disappears when that source next syncs successfully.
  A signed-out source otherwise fails silently and new assignments would be missed.
- **Copies.** Duplicating a synced task makes an ordinary, unlinked task.

## Data safety

- **Validation** runs on every create and edit (`src/domain/validation.ts`) and again when data is loaded or imported
  (`src/storage/schema.ts`). Assignments from the extension are validated by `parseSyncBatch`, and only `https`
  links are kept.
- **Repair, don't discard.** When loading, any record that is recognisably an object is kept, and broken fields are
  replaced with safe defaults. An over-long title is moved into the notes. Every repair is listed for the user, and
  the untouched original is saved as a *recovery copy*, which can be downloaded from Backup.
- **Previous copy.** Each save first copies the last good data to `polaris.previous`. If the current data can't be
  read (for example after a truncated write), Polaris loads the previous copy and says so.
- **Newer formats.** If the stored data was written by a newer schema version, Polaris goes read-only rather than
  risk overwriting it.
- **Failed saves** leave your changes on screen and show a persistent banner with *Try saving again* and *Export
  backup*.
- **Other tabs.** Changes saved in another tab are loaded through the `storage` event. The last write wins, and undo
  history is reset.
- **Destructive actions:** deleting one task asks first and can be undone. Bulk delete, tag delete and restoring a
  backup all ask first and can be undone. Undo stays available in the header and with Ctrl+Z, so it doesn't depend on
  the toast still being visible.

## Accessibility

The target is WCAG 2.2 AA:

- Native elements are used throughout (`<dialog>`, `<button>`, labelled form controls), so behaviour stays predictable.
- Focus is managed explicitly. Dialogs return focus to whatever opened them. When a completed task leaves the list,
  focus moves to a neighbouring row or the heading.
- Live regions announce messages: `role=status` for results and notifications, `role=alert` for errors.
- Meaning is never carried by colour alone: overdue, importance and completion are always shown as text, with icons
  as a supplement.
- Reduced motion is respected. Toasts slide in rather than fade, so their text never drops below the contrast minimum.
- Automated checks: axe-core runs on every view and dialog in both the desktop and mobile layouts (`e2e/a11y.spec.ts`).

## Multi-device readiness

The current version is single-device, with export and import for moving data. To keep future sync possible without a
migration, IDs are random UUIDs and every record has `createdAt` and `updatedAt`. Sync would still need deletion
tombstones and a conflict policy; see Future work in the README.
