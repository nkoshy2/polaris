import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/dates';
import { stepProgress, summarize } from '../../src/domain/progress';
import { completeTasks, createTask, deleteTasks, reopenTasks, setStepDone } from '../../src/domain/tasks';
import { seed } from './helpers';

const TODAY = '2026-10-18';
const d = (n: number) => addDays(TODAY, n);

describe('summary counts tasks, never steps', () => {
  it('handles an empty list without a misleading percentage', () => {
    expect(summarize([], TODAY)).toMatchObject({ total: 0, open: 0, completed: 0, percentComplete: null });
  });

  it('counts a task with many steps as one task', () => {
    const { data } = seed([{ title: 'Big', steps: Array.from({ length: 10 }, (_, i) => ({ title: `s${i}` })) }, { title: 'Small' }]);
    expect(summarize(data.tasks, TODAY)).toMatchObject({ total: 2, open: 2, completed: 0, percentComplete: 0 });
  });

  it('finished steps alone do not count as completed work', () => {
    const { data, tasks, ctx } = seed([{ title: 'Big', steps: [{ title: 'a' }] }]);
    const next = setStepDone(data, tasks[0]!.id, tasks[0]!.steps[0]!.id, true, ctx);
    expect(summarize(next.tasks, TODAY)).toMatchObject({ completed: 0, percentComplete: 0 });
    expect(stepProgress(next.tasks[0]!)).toEqual({ done: 1, total: 1 });
  });

  it('rounds percentages down so 100% means everything is done', () => {
    const { data, tasks, ctx } = seed(Array.from({ length: 200 }, (_, i) => ({ title: `t${i}` })));
    const next = completeTasks(data, tasks.slice(0, 199).map((t) => t.id), ctx);
    expect(summarize(next.tasks, TODAY).percentComplete).toBe(99);
    const third = completeTasks(seed([{ title: 'a' }, { title: 'b' }, { title: 'c' }]).data, [], ctx);
    expect(summarize(third.tasks, TODAY).percentComplete).toBe(0);
  });

  it('buckets open tasks by urgency without overlap', () => {
    const { data, tasks, ctx } = seed([
      { title: 'o1', due: d(-3) },
      { title: 'o2', due: d(-1) },
      { title: 't', due: d(0) },
      { title: 's', due: d(7) },
      { title: 'l', due: d(8) },
      { title: 'n' },
      { title: 'done-overdue', due: d(-2) },
    ]);
    const next = completeTasks(data, [tasks[6]!.id], ctx);
    const s = summarize(next.tasks, TODAY);
    expect(s).toMatchObject({ total: 7, open: 6, completed: 1, overdue: 2, dueToday: 1, dueSoon: 1 });
  });

  it('updates correctly through create, complete, reopen and delete', () => {
    const { data, tasks, ctx } = seed([{ title: 'a' }, { title: 'b' }]);
    let cur = completeTasks(data, [tasks[0]!.id], ctx);
    expect(summarize(cur.tasks, TODAY)).toMatchObject({ total: 2, completed: 1, percentComplete: 50 });
    cur = createTask(cur, { title: 'c' }, ctx).data;
    expect(summarize(cur.tasks, TODAY)).toMatchObject({ total: 3, completed: 1, percentComplete: 33 });
    cur = reopenTasks(cur, [tasks[0]!.id], ctx);
    expect(summarize(cur.tasks, TODAY)).toMatchObject({ total: 3, completed: 0 });
    cur = deleteTasks(cur, [tasks[1]!.id]);
    expect(summarize(cur.tasks, TODAY)).toMatchObject({ total: 2, open: 2 });
  });

  it('counts tasks completed in the last 7 local days', () => {
    const { data, tasks, ctx } = seed([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    ctx.set('2026-10-18T12:00:00');
    let cur = completeTasks(data, [tasks[0]!.id], ctx);
    ctx.set('2026-10-12T12:00:00');
    cur = completeTasks(cur, [tasks[1]!.id], ctx);
    ctx.set('2026-10-11T12:00:00');
    cur = completeTasks(cur, [tasks[2]!.id], ctx);
    expect(summarize(cur.tasks, TODAY).completedLast7Days).toBe(2);
  });
});

describe('step progress', () => {
  it('is null for tasks without steps', () => {
    expect(stepProgress({ steps: [] })).toBeNull();
  });
});
