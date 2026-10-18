import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  addTagToTasks,
  completeTasks,
  countTasksWithTag,
  createTag,
  createTask,
  deleteTag,
  deleteTasks,
  duplicateTask,
  renameTag,
  reopenTasks,
  setStepDone,
  updateTask,
} from '../../src/domain/tasks';
import { emptyData } from '../../src/domain/types';
import { LIMITS, ValidationError } from '../../src/domain/validation';
import { seed, testCtx, withTags } from './helpers';

describe('task creation', () => {
  it('creates an open task with defaults and trimmed title', () => {
    const ctx = testCtx();
    const { data, task } = createTask(emptyData(), { title: '  Write   report \n' }, ctx);
    expect(data.tasks).toHaveLength(1);
    expect(task).toMatchObject({
      title: 'Write report',
      notes: '',
      importance: 'normal',
      due: null,
      tagIds: [],
      steps: [],
      completedAt: null,
      createdAt: '2026-10-18T12:00:00.000Z',
    });
  });

  it('does not mutate the input data', () => {
    const before = emptyData();
    createTask(before, { title: 'A' }, testCtx());
    expect(before.tasks).toHaveLength(0);
  });

  it.each([
    [{ title: '' }, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(LIMITS.title + 1) }, 'title'],
    [{ title: 'ok', due: '2026-02-30' }, 'due'],
    [{ title: 'ok', due: 'tomorrow' }, 'due'],
    [{ title: 'ok', importance: 'urgent' as never }, 'importance'],
    [{ title: 'ok', tagIds: ['missing'] }, 'tags'],
    [{ title: 'ok', notes: 'x'.repeat(LIMITS.notes + 1) }, 'notes'],
  ])('rejects invalid input %j on field %s', (input, field) => {
    expect(() => createTask(emptyData(), input, testCtx())).toThrowError(
      expect.objectContaining({ name: 'ValidationError', field }),
    );
  });

  it('accepts a title exactly at the length limit', () => {
    const { task } = createTask(emptyData(), { title: 'x'.repeat(LIMITS.title) }, testCtx());
    expect(task.title).toHaveLength(LIMITS.title);
  });

  it('drops blank step rows and keeps the rest in order', () => {
    const { task } = createTask(
      emptyData(),
      { title: 'Trip', steps: [{ title: 'Book' }, { title: '  ' }, { title: 'Pack' }] },
      testCtx(),
    );
    expect(task.steps.map((s) => s.title)).toEqual(['Book', 'Pack']);
    expect(task.steps.every((s) => !s.done)).toBe(true);
  });

  it('de-duplicates tag ids', () => {
    const ctx = testCtx();
    const { data, ids } = withTags(emptyData(), ['Work'], ctx);
    const { task } = createTask(data, { title: 'A', tagIds: [ids[0]!, ids[0]!] }, ctx);
    expect(task.tagIds).toEqual([ids[0]]);
  });
});

describe('editing', () => {
  it('replaces fields, sets and removes due date, and bumps updatedAt', () => {
    const { data, tasks, ctx } = seed([{ title: 'A', due: '2026-10-20', importance: 'high' }]);
    const id = tasks[0]!.id;
    const next = updateTask(data, id, { title: 'B', due: null, importance: 'low', notes: 'n' }, ctx);
    const t = next.tasks[0]!;
    expect(t).toMatchObject({ title: 'B', due: null, importance: 'low', notes: 'n', createdAt: tasks[0]!.createdAt });
    expect(t.updatedAt > tasks[0]!.updatedAt).toBe(true);
  });

  it('leaves data unchanged when validation fails', () => {
    const { data, tasks, ctx } = seed([{ title: 'A' }]);
    expect(() => updateTask(data, tasks[0]!.id, { title: '' }, ctx)).toThrow(ValidationError);
    expect(data.tasks[0]!.title).toBe('A');
  });

  it('throws NotFoundError for a deleted task', () => {
    const { data, ctx } = seed([{ title: 'A' }]);
    expect(() => updateTask(data, 'nope', { title: 'x' }, ctx)).toThrow(NotFoundError);
  });
});

describe('completion and reopening', () => {
  it('completes and reopens tasks', () => {
    const { data, tasks, ctx } = seed([{ title: 'A' }, { title: 'B' }]);
    const done = completeTasks(data, [tasks[0]!.id], ctx);
    expect(done.tasks[0]!.completedAt).toBe(ctx.now());
    expect(done.tasks[1]!.completedAt).toBeNull();
    const reopened = reopenTasks(done, [tasks[0]!.id], ctx);
    expect(reopened.tasks[0]!.completedAt).toBeNull();
  });

  it('completes several tasks at once and keeps an earlier completion time', () => {
    const { data, tasks, ctx } = seed([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    const first = completeTasks(data, [tasks[0]!.id], ctx);
    const firstAt = first.tasks[0]!.completedAt;
    ctx.tick();
    const all = completeTasks(first, tasks.map((t) => t.id), ctx);
    expect(all.tasks.every((t) => t.completedAt)).toBe(true);
    expect(all.tasks[0]!.completedAt).toBe(firstAt);
  });

  it('refuses to complete a missing task without changing anything', () => {
    const { data, tasks, ctx } = seed([{ title: 'A' }]);
    expect(() => completeTasks(data, [tasks[0]!.id, 'gone'], ctx)).toThrow(NotFoundError);
  });
});

describe('steps (subtasks)', () => {
  const setup = () => seed([{ title: 'Trip', steps: [{ title: 'Book' }, { title: 'Pack' }] }]);

  it('completing a task marks all its steps done', () => {
    const { data, tasks, ctx } = setup();
    const next = completeTasks(data, [tasks[0]!.id], ctx);
    expect(next.tasks[0]!.steps.every((s) => s.done)).toBe(true);
  });

  it('finishing every step does not complete the task', () => {
    const { data, tasks, ctx } = setup();
    const [a, b] = tasks[0]!.steps;
    let next = setStepDone(data, tasks[0]!.id, a!.id, true, ctx);
    next = setStepDone(next, tasks[0]!.id, b!.id, true, ctx);
    expect(next.tasks[0]!.steps.every((s) => s.done)).toBe(true);
    expect(next.tasks[0]!.completedAt).toBeNull();
  });

  it('reopening a step of a completed task reopens the task', () => {
    const { data, tasks, ctx } = setup();
    const done = completeTasks(data, [tasks[0]!.id], ctx);
    const next = setStepDone(done, tasks[0]!.id, tasks[0]!.steps[0]!.id, false, ctx);
    expect(next.tasks[0]!.completedAt).toBeNull();
    expect(next.tasks[0]!.steps.map((s) => s.done)).toEqual([false, true]);
  });

  it('reopening a task leaves its steps as they were', () => {
    const { data, tasks, ctx } = setup();
    const done = completeTasks(data, [tasks[0]!.id], ctx);
    const reopened = reopenTasks(done, [tasks[0]!.id], ctx);
    expect(reopened.tasks[0]!.steps.every((s) => s.done)).toBe(true);
  });

  it('adding an open step to a completed task reopens it', () => {
    const { data, tasks, ctx } = setup();
    const done = completeTasks(data, [tasks[0]!.id], ctx);
    const t = done.tasks[0]!;
    const next = updateTask(done, t.id, { title: t.title, steps: [...t.steps, { title: 'Passport' }] }, ctx);
    expect(next.tasks[0]!.completedAt).toBeNull();
  });

  it('editing a completed task without adding open steps keeps it completed', () => {
    const { data, tasks, ctx } = setup();
    const done = completeTasks(data, [tasks[0]!.id], ctx);
    const t = done.tasks[0]!;
    const next = updateTask(done, t.id, { title: 'Trip!', steps: t.steps }, ctx);
    expect(next.tasks[0]!.completedAt).toBe(t.completedAt);
  });

  it('deleting a task deletes its steps with it', () => {
    const { data, tasks } = setup();
    const next = deleteTasks(data, [tasks[0]!.id]);
    expect(next.tasks).toHaveLength(0);
  });

  it('caps the number of steps', () => {
    const steps = Array.from({ length: LIMITS.steps + 1 }, (_, i) => ({ title: `s${i}` }));
    expect(() => createTask(emptyData(), { title: 'Big', steps }, testCtx())).toThrow(ValidationError);
  });
});

describe('delete and duplicate', () => {
  it('deletes only the selected tasks', () => {
    const { data, tasks } = seed([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    const next = deleteTasks(data, [tasks[0]!.id, tasks[2]!.id]);
    expect(next.tasks.map((t) => t.title)).toEqual(['B']);
  });

  it('duplicates as a new open task with fresh steps, placed after the original', () => {
    const { data, tasks, ctx } = seed([
      { title: 'A', steps: [{ title: 's1', done: true }], due: '2026-11-01', importance: 'high' },
      { title: 'B' },
    ]);
    const done = completeTasks(data, [tasks[0]!.id], ctx);
    const { data: next, task: copy } = duplicateTask(done, tasks[0]!.id, ctx);
    expect(next.tasks.map((t) => t.title)).toEqual(['A', 'A (copy)', 'B']);
    expect(copy).toMatchObject({ completedAt: null, due: '2026-11-01', importance: 'high' });
    expect(copy.id).not.toBe(tasks[0]!.id);
    expect(copy.steps[0]).toMatchObject({ title: 's1', done: false });
    expect(copy.steps[0]!.id).not.toBe(tasks[0]!.steps[0]!.id);
  });
});

describe('tags', () => {
  it('creates tags and rejects duplicate names case-insensitively', () => {
    const ctx = testCtx();
    const { data } = createTag(emptyData(), 'Work', ctx);
    expect(() => createTag(data, ' work ', ctx)).toThrowError(/already exists/);
  });

  it('renames a tag without touching task membership', () => {
    const { data: d0, tasks, ctx } = seed([{ title: 'A' }]);
    const { data: d1, ids } = withTags(d0, ['Work'], ctx);
    const d2 = addTagToTasks(d1, [tasks[0]!.id], ids[0]!, ctx);
    const d3 = renameTag(d2, ids[0]!, 'Job', ctx);
    expect(d3.tags[0]!.name).toBe('Job');
    expect(d3.tasks[0]!.tagIds).toEqual([ids[0]]);
  });

  it('allows renaming a tag to a different case of its own name', () => {
    const ctx = testCtx();
    const { data, tag } = createTag(emptyData(), 'work', ctx);
    expect(renameTag(data, tag.id, 'Work', ctx).tags[0]!.name).toBe('Work');
  });

  it('deleting a tag keeps tasks and removes only that tag from them', () => {
    const { data: d0, tasks, ctx } = seed([{ title: 'A' }, { title: 'B' }]);
    const { data: d1, ids } = withTags(d0, ['Work', 'Home'], ctx);
    let d = addTagToTasks(d1, [tasks[0]!.id, tasks[1]!.id], ids[0]!, ctx);
    d = addTagToTasks(d, [tasks[0]!.id], ids[1]!, ctx);
    expect(countTasksWithTag(d, ids[0]!)).toBe(2);
    const after = deleteTag(d, ids[0]!, ctx);
    expect(after.tasks).toHaveLength(2);
    expect(after.tasks[0]!.tagIds).toEqual([ids[1]]);
    expect(after.tasks[1]!.tagIds).toEqual([]);
  });

  it('moving a task between tags keeps everything else', () => {
    const { data: d0, ctx } = seed([]);
    const { data: d1, ids } = withTags(d0, ['Work', 'Home'], ctx);
    const { data: d2, task } = createTask(
      d1,
      { title: 'A', notes: 'n', due: '2026-11-01', tagIds: [ids[0]!], steps: [{ title: 's' }] },
      ctx,
    );
    const moved = updateTask(d2, task.id, { ...task, tagIds: [ids[1]!] }, ctx).tasks[0]!;
    expect(moved).toMatchObject({ notes: 'n', due: '2026-11-01', tagIds: [ids[1]] });
    expect(moved.steps).toEqual(task.steps);
  });
});
