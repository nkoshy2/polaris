# Polaris data format (schema version 1)

Backups (Export) and browser storage both use the same JSON structure.

```json
{
  "app": "polaris",
  "schemaVersion": 1,
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
        "createdAt": "ISO-8601",
        "updatedAt": "ISO-8601"
      }
    ]
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
| Tag `name`    | 1–40 characters, unique ignoring case                                |

## Compatibility

- Import accepts any file whose `schemaVersion` is less than or equal to the current version. Older versions are
  upgraded by the migrations in `src/storage/schema.ts`.
- Files from a newer version are rejected with a message asking you to update Polaris.
- Invalid fields are repaired rather than silently dropped, and every repair is listed in the import preview.

## Browser storage keys

| Key                | Contents                                                       |
| ------------------ | -------------------------------------------------------------- |
| `polaris.data`     | Current data, in the format above                              |
| `polaris.previous` | The last good copy, taken before the most recent save          |
| `polaris.recovery` | `{ reason, savedAt, raw }`: the untouched original of data that needed repair or couldn't be read |
