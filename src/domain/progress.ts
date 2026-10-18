/**
 * Progress rules (documented in docs/DESIGN.md and tested in progress.test.ts):
 *  - Totals count TASKS only. Steps are never counted as tasks.
 *  - A task counts as done only when the task itself is completed, regardless
 *    of how many of its steps are done.
 *  - Step progress is reported per task as "done of total steps".
 *  - Percentages round DOWN, so 100% only ever means everything is done.
 */
import { addDays, localDate } from './dates';
import { urgencyOf } from './priority';
import type { Task } from './types';

export interface Summary {
  total: number;
  open: number;
  completed: number;
  overdue: number;
  dueToday: number;
  /** Open tasks due in the next 7 days, excluding today. */
  dueSoon: number;
  /** Tasks completed today or in the 6 days before (local dates). */
  completedLast7Days: number;
  /** floor(completed / total * 100), or null when there are no tasks. */
  percentComplete: number | null;
}

export function summarize(tasks: Task[], today: string): Summary {
  const weekStart = addDays(today, -6);
  const s: Summary = {
    total: tasks.length,
    open: 0,
    completed: 0,
    overdue: 0,
    dueToday: 0,
    dueSoon: 0,
    completedLast7Days: 0,
    percentComplete: null,
  };
  for (const t of tasks) {
    if (t.completedAt) {
      s.completed++;
      const day = localDate(new Date(t.completedAt));
      if (day >= weekStart && day <= today) s.completedLast7Days++;
      continue;
    }
    s.open++;
    const u = urgencyOf(t, today);
    if (u === 'overdue') s.overdue++;
    else if (u === 'today') s.dueToday++;
    else if (u === 'soon') s.dueSoon++;
  }
  if (s.total > 0) s.percentComplete = Math.floor((s.completed / s.total) * 100);
  return s;
}

export interface StepProgress {
  done: number;
  total: number;
}

export function stepProgress(task: Pick<Task, 'steps'>): StepProgress | null {
  if (task.steps.length === 0) return null;
  return { done: task.steps.filter((s) => s.done).length, total: task.steps.length };
}
