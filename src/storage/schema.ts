/**
 * Stored/exported file format, schema migrations, and defensive loading.
 *
 * Envelope (documented in docs/DATA_FORMAT.md):
 *   { "app": "polaris", "schemaVersion": 1, "savedAt": ISO, "data": { tasks, tags } }
 *
 * Loading never throws away a recognisable record: malformed fields are
 * repaired to safe defaults and every repair is reported as an issue so the
 * caller can keep a copy of the original and tell the user.
 */
import { isValidDate } from '../domain/dates';
import { IMPORTANCE_LEVELS, type AppData, type Importance, type Step, type Tag, type Task } from '../domain/types';
import { LIMITS, cleanLine } from '../domain/validation';

export const APP_ID = 'polaris';
export const SCHEMA_VERSION = 1;

export interface Envelope {
  app: typeof APP_ID;
  schemaVersion: number;
  savedAt: string;
  data: AppData;
}

/** The input cannot be used at all (not JSON, not Polaris data, or too new). */
export class SchemaError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreadable' | 'newerVersion' = 'unreadable',
  ) {
    super(message);
    this.name = 'SchemaError';
  }
}

/**
 * Migration n upgrades `data` from version n to n+1. Add an entry here whenever
 * SCHEMA_VERSION is bumped; migrations must be pure and never drop records.
 */
export type Migration = (data: unknown) => unknown;
export const MIGRATIONS: Record<number, Migration> = {};

export function migrate(
  data: unknown,
  fromVersion: number,
  toVersion = SCHEMA_VERSION,
  migrations: Record<number, Migration> = MIGRATIONS,
): unknown {
  let current = data;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations[v];
    if (!step) throw new SchemaError(`No upgrade path from data version ${v}.`);
    current = step(current);
  }
  return current;
}

export function serialize(data: AppData, savedAt: string): string {
  const envelope: Envelope = { app: APP_ID, schemaVersion: SCHEMA_VERSION, savedAt, data };
  return JSON.stringify(envelope);
}

export interface ParseResult {
  data: AppData;
  /** Human-readable descriptions of every repair made while loading. */
  issues: string[];
  /** Version the input was written with (before migration). */
  fromVersion: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIsoTimestamp = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

export function parseEnvelope(
  text: string,
  options: { now?: string; newId?: () => string; migrations?: Record<number, Migration> } = {},
): ParseResult {
  const now = options.now ?? new Date().toISOString();
  const newId = options.newId ?? (() => crypto.randomUUID());

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SchemaError('The data is not valid JSON.');
  }
  if (!isObject(raw) || raw.app !== APP_ID) throw new SchemaError('This is not Polaris data.');
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SchemaError('The data has an unknown format version.');
  }
  if (version > SCHEMA_VERSION) {
    throw new SchemaError(
      `This data was saved by a newer version of Polaris (format ${version}). Update Polaris to open it.`,
      'newerVersion',
    );
  }
  const migrated = migrate(raw.data, version, SCHEMA_VERSION, options.migrations);
  const { data, issues } = normalizeData(migrated, now, newId);
  return { data, issues, fromVersion: version };
}

/** Repairs anything that does not match the current model. Exported for tests. */
export function normalizeData(input: unknown, now: string, newId: () => string): { data: AppData; issues: string[] } {
  const issues: string[] = [];
  if (!isObject(input)) throw new SchemaError('The data section is missing.');
  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (!Array.isArray(input.tags)) issues.push('Tag list was missing; started an empty one.');
  if (!Array.isArray(input.tasks)) issues.push('Task list was missing; started an empty one.');

  const tags: Tag[] = [];
  const tagIds = new Set<string>();
  const tagNames = new Set<string>();
  rawTags.forEach((t, i) => {
    if (!isObject(t)) {
      issues.push(`Skipped tag #${i + 1}: not a tag record.`);
      return;
    }
    let id = typeof t.id === 'string' && t.id ? t.id : '';
    if (!id || tagIds.has(id)) {
      id = newId();
      issues.push(`Tag #${i + 1} had a missing or duplicate ID; assigned a new one.`);
    }
    let name = cleanLine(t.name).slice(0, LIMITS.tagName);
    if (!name) {
      name = `Tag ${i + 1}`;
      issues.push(`Tag #${i + 1} had no name; renamed to “${name}”.`);
    }
    let unique = name;
    for (let n = 2; tagNames.has(unique.toLocaleLowerCase()); n++) unique = `${name} (${n})`;
    if (unique !== name) issues.push(`Renamed duplicate tag “${name}” to “${unique}”.`);
    tagIds.add(id);
    tagNames.add(unique.toLocaleLowerCase());
    tags.push({
      id,
      name: unique,
      createdAt: isIsoTimestamp(t.createdAt) ? t.createdAt : now,
      updatedAt: isIsoTimestamp(t.updatedAt) ? t.updatedAt : now,
    });
  });

  const tasks: Task[] = [];
  const taskIds = new Set<string>();
  rawTasks.forEach((t, i) => {
    if (!isObject(t)) {
      issues.push(`Skipped task #${i + 1}: not a task record.`);
      return;
    }
    const label = typeof t.title === 'string' && t.title.trim() ? `“${cleanLine(t.title).slice(0, 40)}”` : `#${i + 1}`;
    let id = typeof t.id === 'string' && t.id ? t.id : '';
    if (!id || taskIds.has(id)) {
      id = newId();
      issues.push(`Task ${label} had a missing or duplicate ID; assigned a new one.`);
    }
    taskIds.add(id);

    let title = cleanLine(t.title);
    if (!title) {
      title = 'Untitled task';
      issues.push(`Task #${i + 1} had no title; named it “Untitled task”.`);
    } else if (title.length > LIMITS.title) {
      issues.push(`Task ${label} had an over-long title; the full text was moved to its notes.`);
    }
    let notes = typeof t.notes === 'string' ? t.notes : '';
    if (t.notes != null && typeof t.notes !== 'string') issues.push(`Task ${label} had unreadable notes; cleared them.`);
    if (title.length > LIMITS.title) {
      notes = notes ? `${title}\n\n${notes}` : title;
      title = title.slice(0, LIMITS.title);
    }

    let importance: Importance = 'normal';
    if (IMPORTANCE_LEVELS.includes(t.importance as Importance)) importance = t.importance as Importance;
    else if (t.importance != null) issues.push(`Task ${label} had an unknown importance; set it to normal.`);

    let due: string | null = null;
    if (isValidDate(t.due)) due = t.due;
    else if (t.due != null && t.due !== '') issues.push(`Task ${label} had an invalid due date (${String(t.due)}); removed it.`);

    const taskTagIds: string[] = [];
    if (Array.isArray(t.tagIds)) {
      for (const tagId of t.tagIds) {
        if (typeof tagId === 'string' && tagIds.has(tagId)) {
          if (!taskTagIds.includes(tagId)) taskTagIds.push(tagId);
        } else issues.push(`Task ${label} referenced a tag that doesn't exist; removed the reference.`);
      }
    }

    const steps: Step[] = [];
    const stepIds = new Set<string>();
    if (Array.isArray(t.steps)) {
      t.steps.forEach((s) => {
        const stitle = isObject(s) ? cleanLine(s.title).slice(0, LIMITS.title) : '';
        if (!isObject(s) || !stitle) {
          issues.push(`Task ${label} had an unreadable step; skipped it.`);
          return;
        }
        let sid = typeof s.id === 'string' && s.id ? s.id : '';
        if (!sid || stepIds.has(sid)) sid = newId();
        stepIds.add(sid);
        steps.push({ id: sid, title: stitle, done: s.done === true });
      });
    }

    let completedAt: string | null = null;
    if (isIsoTimestamp(t.completedAt)) completedAt = t.completedAt;
    else if (t.completedAt != null) {
      completedAt = now;
      issues.push(`Task ${label} had an unreadable completion time; kept it completed as of now.`);
    }
    if (completedAt && steps.some((s) => !s.done)) {
      // Enforce the invariant "a completed task has no open steps".
      steps.forEach((s) => (s.done = true));
      issues.push(`Task ${label} was completed but had open steps; marked those steps done.`);
    }

    tasks.push({
      id,
      title,
      notes,
      importance,
      due,
      tagIds: taskTagIds,
      steps,
      completedAt,
      createdAt: isIsoTimestamp(t.createdAt) ? t.createdAt : now,
      updatedAt: isIsoTimestamp(t.updatedAt) ? t.updatedAt : now,
    });
  });

  return { data: { tasks, tags }, issues };
}
