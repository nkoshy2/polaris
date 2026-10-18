/**
 * Decision support. Importance is chosen by the user; urgency is *derived*
 * from the due date and today's date and is never stored. The Focus list is a
 * fixed ordering of explicit tiers — no hidden scores. See docs/DESIGN.md.
 */
import { daysBetween } from './dates';
import type { Importance, Task } from './types';

/** How many days ahead counts as "soon" (today excluded). */
export const SOON_DAYS = 7;

export type Urgency = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export function urgencyOf(task: Pick<Task, 'due' | 'completedAt'>, today: string): Urgency {
  if (!task.due || task.completedAt) return 'none';
  const days = daysBetween(today, task.due);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= SOON_DAYS) return 'soon';
  return 'later';
}

export const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, normal: 1, low: 2 };

/**
 * Focus tiers, in order. An open task appears in the first tier it matches;
 * open tasks matching none are not in Focus (they remain in All tasks).
 */
export type FocusTier = 'overdue' | 'today' | 'importantSoon' | 'important' | 'soon';

export const FOCUS_TIERS: { tier: FocusTier; label: string }[] = [
  { tier: 'overdue', label: 'Overdue' },
  { tier: 'today', label: 'Due today' },
  { tier: 'importantSoon', label: `High importance, due within ${SOON_DAYS} days` },
  { tier: 'important', label: 'High importance' },
  { tier: 'soon', label: `Due within ${SOON_DAYS} days` },
];

export function focusTier(task: Task, today: string): FocusTier | null {
  if (task.completedAt) return null;
  const urgency = urgencyOf(task, today);
  if (urgency === 'overdue') return 'overdue';
  if (urgency === 'today') return 'today';
  const high = task.importance === 'high';
  if (high && urgency === 'soon') return 'importantSoon';
  if (high) return 'important';
  if (urgency === 'soon') return 'soon';
  return null;
}

/**
 * Default ordering used inside a tier and for "Recommended" sort:
 * earliest due date first (no date last), then higher importance, then oldest.
 */
export function compareRecommended(a: Task, b: Task): number {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  const imp = IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance];
  if (imp !== 0) return imp;
  return a.createdAt.localeCompare(b.createdAt);
}

export interface FocusGroup {
  tier: FocusTier;
  label: string;
  tasks: Task[];
}

export function focusGroups(tasks: Task[], today: string): FocusGroup[] {
  const buckets = new Map<FocusTier, Task[]>();
  for (const task of tasks) {
    const tier = focusTier(task, today);
    if (!tier) continue;
    const list = buckets.get(tier) ?? [];
    list.push(task);
    buckets.set(tier, list);
  }
  return FOCUS_TIERS.filter(({ tier }) => buckets.has(tier)).map(({ tier, label }) => ({
    tier,
    label,
    tasks: buckets.get(tier)!.sort(compareRecommended),
  }));
}

/** Short human description of a task's due status, e.g. "Overdue by 3 days". */
export function dueDescription(task: Task, today: string): string | null {
  if (!task.due) return null;
  const days = daysBetween(today, task.due);
  if (task.completedAt) return null;
  if (days < -1) return `Overdue by ${-days} days`;
  if (days === -1) return 'Overdue by 1 day';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}
