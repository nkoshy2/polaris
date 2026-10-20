/**
 * Assignment sync: merges assignments read from Canvas or Gradescope (by the
 * Polaris Connector extension) into tasks. Pure, like the rest of src/domain.
 * The rules are listed under "Assignment sync" in docs/DESIGN.md:
 *
 *  - A new assignment becomes an open task tagged with its course.
 *  - Title and due date follow upstream changes unless the user edited them.
 *  - Becoming submitted upstream completes the task (once per submission).
 *  - An assignment missing upstream is flagged, never deleted.
 *  - Assignments the user deleted (dismissed) are never re-created.
 *  - The same assignment in Canvas and Gradescope becomes one task.
 */
import { isValidDate, localDate } from './dates';
import type { Ctx } from './tasks';
import { SOURCE_KINDS, type AppData, type SourceKind, type Tag, type Task, type TaskSource } from './types';
import { LIMITS, cleanLine } from './validation';

/** One assignment as read from upstream. */
export interface ExternalItem {
  kind: SourceKind;
  externalId: string;
  title: string;
  /** Course name as upstream shows it; turned into a tag by `courseTag`. */
  course: string;
  url: string;
  /** Exact deadline (ISO-8601), or null when the assignment has none. */
  dueAt: string | null;
  submitted: boolean;
}

/**
 * Everything one source returned in one fetch. When `window` is given, the
 * fetch was complete for deadlines inside it, so a linked task whose deadline
 * is inside the window but whose assignment is missing was removed upstream.
 */
export interface SyncBatch {
  kind: SourceKind;
  items: ExternalItem[];
  window?: { start: string; end: string };
  /**
   * When the extension fetched this batch (ISO-8601). A batch replayed from the
   * extension's cache can be hours old, so this, not the time it arrived, is
   * the sync time shown to the user.
   */
  fetchedAt?: string;
}

export interface SyncOptions {
  /** Complete tasks when their assignment becomes submitted. On by default. */
  autoComplete?: boolean;
}

export interface SyncSummary {
  added: number;
  updated: number;
  completed: number;
  removed: number;
}

const LIMIT_EXTERNAL_ID = 300;
const LIMIT_BATCH_ITEMS = 2_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIsoTimestamp = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a batch received from the extension. Items that can't be used are
 * skipped and described in `rejected`; the rest of the batch still applies.
 * Returns null when the message is not a batch at all.
 */
export function parseSyncBatch(raw: unknown): { batch: SyncBatch; rejected: string[] } | null {
  if (!isObject(raw) || !SOURCE_KINDS.includes(raw.kind as SourceKind) || !Array.isArray(raw.items)) return null;
  const kind = raw.kind as SourceKind;
  const rejected: string[] = [];
  const items: ExternalItem[] = [];
  const seen = new Set<string>();
  raw.items.slice(0, LIMIT_BATCH_ITEMS).forEach((it, i) => {
    const title = isObject(it) ? cleanLine(it.title) : '';
    const externalId = isObject(it) && typeof it.externalId === 'string' ? it.externalId : '';
    if (!isObject(it) || !title || !externalId || externalId.length > LIMIT_EXTERNAL_ID) {
      rejected.push(`Item #${i + 1} had no usable title or ID.`);
      return;
    }
    if (it.kind !== kind || !externalId.startsWith(`${kind}:`)) {
      rejected.push(`“${title}” came from a different source than its batch.`);
      return;
    }
    if (seen.has(externalId)) return;
    seen.add(externalId);
    items.push({
      kind,
      externalId,
      title,
      course: cleanLine(it.course),
      url: isHttpsUrl(it.url) ? it.url : '',
      dueAt: isIsoTimestamp(it.dueAt) ? new Date(it.dueAt).toISOString() : null,
      submitted: it.submitted === true,
    });
  });
  if (raw.items.length > LIMIT_BATCH_ITEMS) rejected.push(`Only the first ${LIMIT_BATCH_ITEMS} items were read.`);
  const w = raw.window;
  const window = isObject(w) && isIsoTimestamp(w.start) && isIsoTimestamp(w.end) ? { start: w.start, end: w.end } : undefined;
  const fetchedAt = isIsoTimestamp(raw.fetchedAt) ? new Date(raw.fetchedAt).toISOString() : undefined;
  return { batch: { kind, items, ...(window ? { window } : {}), ...(fetchedAt ? { fetchedAt } : {}) }, rejected };
}

/**
 * The tag for a course: "<DEPT> <number>" when the name contains one, so
 * Canvas's "Fall 2026-AE 312-Compressible Flow-Section A" and Gradescope's
 * "ae_312_120268_262662" or "AE312" all become "AE 312". Other names are kept.
 */
export function courseTag(course: string): string {
  const match = /(?<![A-Za-z])([A-Za-z]{2,5})[\s_-]*(\d{3})(?!\d)/.exec(course);
  const name = match ? `${match[1]!.toUpperCase()} ${match[2]}` : cleanLine(course);
  return name.slice(0, LIMITS.tagName).trim();
}

/**
 * The due date for an exact deadline, in local time. A deadline in the first
 * hour of a day (e.g. 12:00 AM) belongs to the evening before: that is the
 * day the work has to be finished.
 */
export function dueDateFor(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const at = new Date(dueAt);
  if (at.getHours() === 0) at.setHours(-1);
  const date = localDate(at);
  return isValidDate(date) ? date : null;
}

const titleKey = (title: string) => title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const sourceKeys = (t: Task) => (t.source ? [t.source.externalId, ...t.source.aliases] : []);

/** Merges one batch into the data. Returns the same `data` object when nothing changed. */
export function applySync(
  data: AppData,
  batch: SyncBatch,
  ctx: Ctx,
  options: SyncOptions = {},
): { data: AppData; summary: SyncSummary } {
  const autoComplete = options.autoComplete ?? true;
  const now = ctx.now();
  const summary: SyncSummary = { added: 0, updated: 0, completed: 0, removed: 0 };
  const dismissed = new Set(data.dismissedSources.flatMap((d) => d.keys));

  const tasks = [...data.tasks];
  const tags: Tag[] = [...data.tags];
  const byKey = new Map<string, number>();
  tasks.forEach((t, i) => sourceKeys(t).forEach((key) => byKey.set(key, i)));
  const seen = new Set<number>();

  const tagFor = (course: string): string | null => {
    const name = courseTag(course);
    if (!name) return null;
    const existing = tags.find((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) return existing.id;
    const tag: Tag = { id: ctx.newId(), name, createdAt: now, updatedAt: now };
    tags.push(tag);
    return tag.id;
  };

  /** A task from the other source for the same course, title and due date. */
  const findDuplicate = (item: ExternalItem, due: string | null): number => {
    const tag = courseTag(item.course).toLocaleLowerCase();
    const key = titleKey(item.title);
    return tasks.findIndex((t, i) => {
      if (!t.source || t.source.kind === item.kind || seen.has(i)) return false;
      if (t.source.aliases.some((a) => a.startsWith(`${item.kind}:`))) return false;
      const sameCourse = t.tagIds.some((id) => tags.find((g) => g.id === id)?.name.toLocaleLowerCase() === tag);
      return sameCourse && titleKey(t.source.syncedTitle) === key && t.source.syncedDue === due;
    });
  };

  const complete = (t: Task): Task => ({
    ...t,
    completedAt: now,
    steps: t.steps.map((s) => (s.done ? s : { ...s, done: true })),
  });

  for (const item of batch.items) {
    if (item.kind !== batch.kind || dismissed.has(item.externalId)) continue;
    const due = dueDateFor(item.dueAt);
    const title = item.title.slice(0, LIMITS.title);
    let index = byKey.get(item.externalId);

    if (index === undefined) {
      const dup = findDuplicate(item, due);
      if (dup < 0) {
        const tagId = tagFor(item.course);
        let task: Task = {
          id: ctx.newId(),
          title,
          notes: '',
          importance: 'normal',
          due,
          tagIds: tagId ? [tagId] : [],
          steps: [],
          completedAt: null,
          source: {
            kind: item.kind,
            externalId: item.externalId,
            aliases: [],
            url: item.url,
            dueAt: item.dueAt,
            syncedTitle: title,
            syncedDue: due,
            submittedKeys: item.submitted ? [item.externalId] : [],
            removedAt: null,
          },
          createdAt: now,
          updatedAt: now,
        };
        if (item.submitted && autoComplete) task = complete(task);
        index = tasks.push(task) - 1;
        byKey.set(item.externalId, index);
        seen.add(index);
        summary.added++;
        continue;
      }
      // Same assignment from the other source: link it to the existing task.
      const t = tasks[dup]!;
      tasks[dup] = { ...t, source: { ...t.source!, aliases: [...t.source!.aliases, item.externalId] } };
      byKey.set(item.externalId, dup);
      index = dup;
    }

    seen.add(index);
    const before = data.tasks[index];
    const t = tasks[index]!;
    const src = t.source!;
    const submittedKeys = item.submitted
      ? src.submittedKeys.includes(item.externalId) ? src.submittedKeys : [...src.submittedKeys, item.externalId]
      : src.submittedKeys.filter((k) => k !== item.externalId);

    let next: Task = t;
    if (src.externalId === item.externalId) {
      // The primary source owns title, due date and link. Each follows upstream
      // only while the user hasn't edited it.
      next = {
        ...t,
        title: t.title === src.syncedTitle ? title : t.title,
        due: t.due === src.syncedDue ? due : t.due,
        source: { ...src, url: item.url, dueAt: item.dueAt, syncedTitle: title, syncedDue: due, submittedKeys, removedAt: null },
      };
    } else {
      next = { ...t, source: { ...src, submittedKeys } };
    }
    if (autoComplete && src.submittedKeys.length === 0 && submittedKeys.length > 0 && !t.completedAt) {
      next = complete(next);
      summary.completed++;
    }
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      tasks[index] = { ...next, updatedAt: now };
      summary.updated++;
    } else {
      tasks[index] = before!;
    }
  }

  if (batch.window) {
    const start = Date.parse(batch.window.start);
    const end = Date.parse(batch.window.end);
    tasks.forEach((t, i) => {
      const src = t.source;
      if (!src || src.kind !== batch.kind || src.removedAt || seen.has(i) || !src.dueAt) return;
      const at = Date.parse(src.dueAt);
      if (at < start || at > end) return;
      tasks[i] = { ...t, source: { ...src, removedAt: now }, updatedAt: now };
      summary.removed++;
    });
  }

  const changed = summary.added + summary.updated + summary.removed > 0;
  return { data: changed ? { ...data, tasks, tags } : data, summary };
}

/** Which sources a linked task came from: its own kind first, then its aliases' kinds. */
export function linkedKinds(source: TaskSource): SourceKind[] {
  const kinds: SourceKind[] = [source.kind];
  for (const key of source.aliases) {
    const kind = SOURCE_KINDS.find((k) => key.startsWith(`${k}:`));
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** Lets sync create deleted assignments' tasks again: those sharing any of `keys`, or all of them. */
export function restoreDismissed(data: AppData, keys?: string[]): AppData {
  const targets = new Set(keys);
  const dismissedSources = keys ? data.dismissedSources.filter((d) => !d.keys.some((k) => targets.has(k))) : [];
  return dismissedSources.length === data.dismissedSources.length ? data : { ...data, dismissedSources };
}
