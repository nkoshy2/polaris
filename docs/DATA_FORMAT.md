# Polaris data format (schema version 2)

Backups (Export) and browser storage both use the same JSON structure.

```json
{
  "app": "polaris",
  "schemaVersion": 2,
  "savedAt": "2026-10-18T12:00:00.000Z",
  "data": {
    "tags": [
      { "id": "uuid", "name": "Work", "createdAt": "ISO-8601", "updatedAt": "ISO-8601" }
    ],
    "tasks": [
      {
        "id": "uuid",
        "title": "Prepare quarterly report",
        "notes": "",
        "importance": "high",
        "due": "2026-10-19",
        "tagIds": ["uuid"],
        "steps": [{ "id": "uuid", "title": "Gather numbers", "done": false }],
        "completedAt": null,
        "source": null,
        "createdAt": "ISO-8601",
        "updatedAt": "ISO-8601"
      }
    ],
    "dismissedSources": ["canvas:canvas.illinois.edu:assignment:123"]
  }
}
```

| Field         | Type / constraint                                                   |
| ------------- | ------------------------------------------------------------------- |
| `title`       | 1–200 characters on a single line                                   |
| `notes`       | Free text, up to 10,000 characters                                   |
| `importance`  | `"high"`, `"normal"` or `"low"`                                     |
| `due`         | `"YYYY-MM-DD"` (a local calendar date) or `null`                     |
| `tagIds`      | IDs of tags that exist in `data.tags`, with no duplicates            |
| `steps`       | Up to 100 steps; `done` is a boolean                                 |
| `completedAt` | ISO-8601 timestamp, or `null` while open. When set, every step must be done. |
| `source`      | `null` for tasks the user made, or an assignment link (below)       |
| `dismissedSources` | Upstream keys of synced tasks the user deleted; sync never re-creates them |
| Tag `name`    | 1–40 characters, unique ignoring case                                |

### Assignment link (`source`)

Set on tasks created by Canvas or Gradescope sync. See "Assignment sync" in DESIGN.md for the rules.

```json
{
  "kind": "canvas",
  "externalId": "canvas:canvas.illinois.edu:assignment:123",
  "aliases": ["gradescope:assignment:456"],
  "url": "https://canvas.illinois.edu/courses/1/assignments/123",
  "dueAt": "2026-10-25T04:59:00.000Z",
  "syncedTitle": "Homework 5",
  "syncedDue": "2026-10-24",
  "submittedKeys": [],
  "removedAt": null
}
```

| Field           | Type / constraint                                                        |
| --------------- | ------------------------------------------------------------------------ |
| `kind`          | `"canvas"` or `"gradescope"`                                             |
| `externalId`    | Stable upstream key, unique across all tasks (aliases included)          |
| `aliases`       | Keys of the same assignment from the other source                        |
| `url`           | An `https` address, or `""`                                              |
| `dueAt`         | Exact upstream deadline (ISO-8601), or `null`                            |
| `syncedTitle`, `syncedDue` | Last values received from upstream                            |
| `submittedKeys` | Keys (`externalId` or an alias) currently reported as submitted          |
| `removedAt`     | When the assignment stopped appearing upstream, or `null`                |

## Compatibility

- Import accepts any file whose `schemaVersion` is less than or equal to the current version. Older versions are
  upgraded by the migrations in `src/storage/schema.ts`. Version 1 files load with every task's `source` set to
  `null` and an empty `dismissedSources`.
- Files from a newer version are rejected with a message asking you to update Polaris.
- Invalid fields are repaired rather than silently dropped, and every repair is listed in the import preview.

## Browser storage keys

| Key                | Contents                                                       |
| ------------------ | -------------------------------------------------------------- |
| `polaris.data`     | Current data, in the format above                              |
| `polaris.previous` | The last good copy, taken before the most recent save          |
| `polaris.recovery` | `{ reason, savedAt, raw }`: the untouched original of data that needed repair or couldn't be read |
