import { describe, expect, it } from 'vitest';
import {
  applySync,
  courseTag,
  dueDateFor,
  parseSyncBatch,
  restoreDismissed,
  type ExternalItem,
  type SyncBatch,
} from '../../src/domain/sync';
import { createTag, deleteTasks, duplicateTask, reopenTasks, updateTask } from '../../src/domain/tasks';
import { emptyData, type AppData, type Task } from '../../src/domain/types';
import { KEYS, Repository } from '../../src/storage/repository';
import { parseEnvelope } from '../../src/storage/schema';
import { Store } from '../../src/state/store';
import { MemoryStore, testCtx } from './helpers';

/** A deadline at a local wall-clock time, so tests pass in any time zone. */
const local = (y: number, m: number, d: number, h = 23, min = 59) => new Date(y, m - 1, d, h, min).toISOString();

const canvas = (over: Partial<ExternalItem> = {}): ExternalItem => ({
  kind: 'canvas',
  externalId: 'canvas:canvas.illinois.edu:assignment:1',
  title: 'Homework 5',
  course: 'Fall 2026-AE 370-Aerospace Numerical Methods-Section A',
  url: 'https://canvas.illinois.edu/courses/9/assignments/1',
  dueAt: local(2026, 10, 24),
  submitted: false,
  ...over,
});

const gradescope = (over: Partial<ExternalItem> = {}): ExternalItem => ({
  kind: 'gradescope',
  externalId: 'gradescope:assignment:77',
  title: 'Homework 5',
  course: 'AE 370',
  url: 'https://www.gradescope.com/courses/1366944/assignments/77',
  dueAt: local(2026, 10, 24),
  submitted: false,
  ...over,
});

const batch = (items: ExternalItem[], extra: Partial<SyncBatch> = {}): SyncBatch => ({
  kind: items[0]?.kind ?? 'canvas',
  items,
  ...extra,
});

function sync(data: AppData, items: ExternalItem[], ctx = testCtx(), extra: Partial<SyncBatch> = {}, autoComplete = true) {
  return applySync(data, batch(items, extra), ctx, { autoComplete });
}

const only = (data: AppData): Task => {
  expect(data.tasks).toHaveLength(1);
  return data.tasks[0]!;
};

describe('course tags', () => {
  it.each([
    ['Fall 2026-AE 312-Compressible Flow-Section A, ME 410', 'AE 312'],
    ['ae_312_120268_262662', 'AE 312'],
    ['AE412', 'AE 412'],
    ['PHYS 225', 'PHYS 225'],
    ['AE 298 RES SPRING 2025', 'AE 298'],
    ['AE Advising', 'AE Advising'],
    ['Physics 211', 'Physics 211'],
  ])('“%s” becomes “%s”', (course, tag) => {
    expect(courseTag(course)).toBe(tag);
  });
});

describe('due dates from deadlines', () => {
  it('uses the local date of the deadline', () => {
    expect(dueDateFor(local(2026, 10, 24, 23, 59))).toBe('2026-10-24');
    expect(dueDateFor(local(2026, 10, 24, 14, 0))).toBe('2026-10-24');
  });

  it('puts a deadline in the first hour of a day on the evening before', () => {
    expect(dueDateFor(local(2026, 10, 25, 0, 0))).toBe('2026-10-24');
    expect(dueDateFor(local(2026, 11, 1, 0, 30))).toBe('2026-10-31');
    expect(dueDateFor(local(2026, 10, 25, 1, 0))).toBe('2026-10-25');
  });

  it('has no due date when the assignment has no deadline', () => {
    expect(dueDateFor(null)).toBeNull();
  });
});

describe('reading a batch from the extension', () => {
  it('rejects messages that are not a batch', () => {
    expect(parseSyncBatch(null)).toBeNull();
    expect(parseSyncBatch({ kind: 'moodle', items: [] })).toBeNull();
    expect(parseSyncBatch({ kind: 'canvas', items: 'x' })).toBeNull();
  });

  it('keeps usable items, skips the rest, and says why', () => {
    const result = parseSyncBatch({
      kind: 'canvas',
      items: [
        { ...canvas(), title: '  Homework   5 ', url: 'javascript:alert(1)', dueAt: 'soon', submitted: 'yes' },
        canvas(), // duplicate key
        { ...canvas(), externalId: '' },
        { ...gradescope() },
        { ...canvas(), externalId: 'gradescope:assignment:1' },
        'junk',
      ],
      window: { start: '2026-10-04T00:00:00Z', end: 'later' },
    });
    expect(result?.batch.items).toEqual([{ ...canvas(), title: 'Homework 5', url: '', dueAt: null, submitted: false }]);
    expect(result?.batch.window).toBeUndefined();
    expect(result?.rejected).toHaveLength(4);
  });
});

describe('creating tasks from assignments', () => {
  it('creates an open task tagged with its course', () => {
    const { data, summary } = sync(emptyData(), [canvas()]);
    const task = only(data);
    expect(summary).toEqual({ added: 1, updated: 0, completed: 0, removed: 0 });
    expect(task).toMatchObject({ title: 'Homework 5', due: '2026-10-24', importance: 'normal', completedAt: null });
    expect(data.tags.map((t) => t.name)).toEqual(['AE 370']);
    expect(task.tagIds).toEqual([data.tags[0]!.id]);
    expect(task.source).toMatchObject({ kind: 'canvas', url: canvas().url, syncedDue: '2026-10-24', removedAt: null });
  });

  it('reuses an existing tag with the same name, ignoring case', () => {
    const ctx = testCtx();
    const { data: tagged, tag } = createTag(emptyData(), 'ae 370', ctx);
    const { data } = sync(tagged, [canvas()], ctx);
    expect(data.tags).toHaveLength(1);
    expect(only(data).tagIds).toEqual([tag.id]);
  });

  it('creates an already-submitted assignment as completed', () => {
    const task = only(sync(emptyData(), [canvas({ submitted: true })]).data);
    expect(task.completedAt).not.toBeNull();
  });

  it('changes nothing, not even the data object, when upstream is unchanged', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas()], ctx).data;
    ctx.tick();
    const again = sync(first, [canvas()], ctx);
    expect(again.data).toBe(first);
    expect(again.summary).toEqual({ added: 0, updated: 0, completed: 0, removed: 0 });
  });
});

describe('following upstream changes', () => {
  it('updates the title and due date when they change upstream', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas()], ctx).data;
    const { data, summary } = sync(first, [canvas({ title: 'Homework 5 (revised)', dueAt: local(2026, 10, 27) })], ctx);
    expect(only(data)).toMatchObject({ title: 'Homework 5 (revised)', due: '2026-10-27' });
    expect(summary.updated).toBe(1);
  });

  it('keeps a field the user edited, while still following the others', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas()], ctx).data;
    const t = only(first);
    const edited = updateTask(first, t.id, { title: t.title, due: '2026-10-22', tagIds: t.tagIds }, ctx);
    const { data } = sync(edited, [canvas({ title: 'HW 5', dueAt: local(2026, 10, 30) })], ctx);
    expect(only(data)).toMatchObject({ title: 'HW 5', due: '2026-10-22' });
    expect(only(data).source?.syncedDue).toBe('2026-10-30');
  });
});

describe('completing on submission', () => {
  it('completes the task, including its steps, when the assignment is submitted', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas()], ctx).data;
    const t = only(first);
    const withStep = updateTask(first, t.id, { title: t.title, due: t.due, tagIds: t.tagIds, steps: [{ title: 'Q1' }] }, ctx);
    const { data, summary } = sync(withStep, [canvas({ submitted: true })], ctx);
    expect(only(data).completedAt).toBe(ctx.now());
    expect(only(data).steps.every((s) => s.done)).toBe(true);
    expect(summary.completed).toBe(1);
  });

  it('leaves a task the user reopened open until there is a new submission', () => {
    const ctx = testCtx();
    const submitted = sync(sync(emptyData(), [canvas()], ctx).data, [canvas({ submitted: true })], ctx).data;
    const reopened = reopenTasks(submitted, [only(submitted).id], ctx);
    const stillSubmitted = sync(reopened, [canvas({ submitted: true })], ctx).data;
    expect(only(stillSubmitted).completedAt).toBeNull();

    const unsubmitted = sync(stillSubmitted, [canvas({ submitted: false })], ctx).data;
    const resubmitted = sync(unsubmitted, [canvas({ submitted: true })], ctx).data;
    expect(only(resubmitted).completedAt).not.toBeNull();
  });

  it('only records the submission when auto-complete is off', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas()], ctx).data;
    const { data } = sync(first, [canvas({ submitted: true })], ctx, {}, false);
    expect(only(data).completedAt).toBeNull();
    expect(only(data).source?.submittedKeys).toEqual([canvas().externalId]);
  });
});

describe('deleted and removed assignments', () => {
  it('never re-creates an assignment the user deleted, until it is restored', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas()], ctx).data;
    const deleted = deleteTasks(first, [only(first).id], ctx);
    expect(deleted.dismissedSources).toEqual([{ keys: [canvas().externalId], title: 'Homework 5', dismissedAt: ctx.now() }]);
    expect(sync(deleted, [canvas()], ctx).data.tasks).toHaveLength(0);

    const restored = restoreDismissed(deleted, [canvas().externalId]);
    expect(restored.dismissedSources).toEqual([]);
    expect(sync(restored, [canvas()], ctx).data.tasks).toHaveLength(1);
    expect(restoreDismissed(deleted).dismissedSources).toEqual([]);
    expect(restoreDismissed(deleted, ['other'])).toBe(deleted);
  });

  it('flags a task whose assignment disappeared inside a complete fetch, without deleting it', () => {
    const ctx = testCtx();
    const other = canvas({ externalId: 'canvas:canvas.illinois.edu:assignment:2', title: 'Lab 3' });
    const first = sync(emptyData(), [canvas(), other], ctx).data;
    const window = { start: local(2026, 10, 4, 0, 0), end: local(2026, 12, 17, 0, 0) };
    const { data, summary } = sync(first, [other], ctx, { window });
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks[0]!.source?.removedAt).toBe(ctx.now());
    expect(data.tasks[1]!.source?.removedAt).toBeNull();
    expect(summary.removed).toBe(1);

    const back = sync(data, [canvas(), other], ctx, { window }).data;
    expect(back.tasks[0]!.source?.removedAt).toBeNull();
  });

  it('does not flag assignments due outside the fetched window', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas({ dueAt: local(2026, 9, 1) })], ctx).data;
    const window = { start: local(2026, 10, 4, 0, 0), end: local(2026, 12, 17, 0, 0) };
    expect(sync(first, [], ctx, { kind: 'canvas', window }).data).toBe(first);
  });

  it('a copy of a synced task is not linked to the assignment', () => {
    const ctx = testCtx();
    const first = sync(emptyData(), [canvas()], ctx).data;
    expect(duplicateTask(first, only(first).id, ctx).task.source).toBeNull();
  });
});

describe('the same assignment in Canvas and Gradescope', () => {
  it('becomes one task, and a Gradescope submission completes it', () => {
    const ctx = testCtx();
    const fromCanvas = sync(emptyData(), [canvas()], ctx).data;
    const linked = sync(fromCanvas, [gradescope()], ctx);
    expect(linked.summary).toMatchObject({ added: 0, updated: 1 });
    expect(only(linked.data).source?.aliases).toEqual([gradescope().externalId]);

    const done = sync(linked.data, [gradescope({ submitted: true })], ctx).data;
    expect(only(done).completedAt).not.toBeNull();

    // Canvas still says "not submitted"; that doesn't reopen or re-complete anything.
    const reopened = reopenTasks(done, [only(done).id], ctx);
    const later = sync(sync(reopened, [canvas()], ctx).data, [gradescope({ submitted: true })], ctx).data;
    expect(only(later).completedAt).toBeNull();
  });

  it('keeps separate tasks when the due dates differ', () => {
    const ctx = testCtx();
    const fromCanvas = sync(emptyData(), [canvas()], ctx).data;
    expect(sync(fromCanvas, [gradescope({ dueAt: local(2026, 10, 25) })], ctx).data.tasks).toHaveLength(2);
  });

  it('dismisses both when the linked task is deleted', () => {
    const ctx = testCtx();
    const linked = sync(sync(emptyData(), [canvas()], ctx).data, [gradescope()], ctx).data;
    const deleted = deleteTasks(linked, [only(linked).id], ctx);
    expect(deleted.dismissedSources.map((d) => d.keys)).toEqual([[canvas().externalId, gradescope().externalId]]);
    expect(sync(deleted, [gradescope()], ctx).data.tasks).toHaveLength(0);
  });
});

describe('storage of synced tasks', () => {
  const NOW = '2026-10-18T12:00:00.000Z';

  it('upgrades version 1 data: existing tasks have no source', () => {
    const v1 = JSON.stringify({
      app: 'polaris',
      schemaVersion: 1,
      savedAt: NOW,
      data: { tags: [], tasks: [{ id: 't1', title: 'Old', createdAt: NOW, updatedAt: NOW }] },
    });
    const { data, issues, fromVersion } = parseEnvelope(v1, { now: NOW });
    expect(fromVersion).toBe(1);
    expect(issues).toEqual([]);
    expect(data.dismissedSources).toEqual([]);
    expect(only(data).source).toBeNull();
  });

  it('round-trips synced tasks and dismissed assignments exactly', () => {
    const ctx = testCtx();
    let data = sync(emptyData(), [canvas(), canvas({ externalId: 'canvas:x:2', title: 'Gone' })], ctx).data;
    data = sync(data, [gradescope({ submitted: true })], ctx).data;
    data = deleteTasks(data, [data.tasks[1]!.id], ctx);
    const kv = new MemoryStore();
    new Repository(kv, () => NOW).save(data);
    expect(new Repository(kv, () => NOW).load()).toMatchObject({ status: 'ok', data });
  });

  it('repairs broken assignment links instead of dropping tasks', () => {
    const source = { kind: 'canvas', externalId: 'k1', url: 'javascript:alert(1)', submittedKeys: ['k1', 'other'] };
    const text = JSON.stringify({
      app: 'polaris',
      schemaVersion: 2,
      savedAt: NOW,
      data: {
        tags: [],
        dismissedSources: [{ keys: ['k9'], title: '  Old  HW ' }, { title: 'no keys' }],
        tasks: [
          { id: 'a', title: 'Linked', source },
          { id: 'b', title: 'Same key', source },
          { id: 'c', title: 'Bad kind', source: { kind: 'moodle', externalId: 'k3' } },
        ],
      },
    });
    const { data, issues } = parseEnvelope(text, { now: NOW });
    expect(data.tasks.map((t) => t.source?.externalId ?? null)).toEqual(['k1', null, null]);
    expect(data.tasks[0]!.source).toMatchObject({ url: '', submittedKeys: ['k1'] });
    expect(data.dismissedSources).toEqual([{ keys: ['k9'], title: 'Old HW', dismissedAt: NOW }]);
    expect(issues).toHaveLength(4);
  });
});

describe('store', () => {
  it('applies a sync as one undoable change and saves it', () => {
    const kv = new MemoryStore();
    const store = new Store(kv, testCtx());
    const summary = store.applySync(batch([canvas(), canvas({ externalId: 'canvas:x:2', title: 'Lab' })]));
    expect(summary.added).toBe(2);
    expect(parseEnvelope(kv.getItem(KEYS.data)!).data.tasks).toHaveLength(2);
    expect(store.undo()).toBe('Sync Canvas');
    expect(store.getState().data.tasks).toHaveLength(0);
  });

  it('records no undo step when nothing changed', () => {
    const store = new Store(new MemoryStore(), testCtx());
    store.applySync(batch([canvas()]));
    store.applySync(batch([canvas()]));
    expect(store.getState().undo).toHaveLength(1);
  });
});
