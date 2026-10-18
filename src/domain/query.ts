/** Search, filtering and sorting over tasks. */
import { addDays } from './dates';
import { IMPORTANCE_RANK, SOON_DAYS, compareRecommended } from './priority';
import type { AppData, Importance, Task } from './types';

export type StatusFilter = 'open' | 'completed' | 'all';
/**
 * overdue = open and past due; soon = due in the 7 days after today. These
 * match the urgency buckets so overview counts and filtered lists agree.
 */
export type DueFilter = 'any' | 'overdue' | 'today' | 'soon' | 'none';
/** 'any', 'untagged', or a tag id. */
export type TagFilter = string;
export type SortKey = 'recommended' | 'due' | 'importance' | 'created' | 'title';
export type SortDir = 'asc' | 'desc';

export interface Query {
  text: string;
  status: StatusFilter;
  due: DueFilter;
  importance: Importance | 'any';
  tag: TagFilter;
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_QUERY: Query = {
  text: '',
  status: 'open',
  due: 'any',
  importance: 'any',
  tag: 'any',
  sort: 'recommended',
  dir: 'asc',
};

/** Fields that narrow results (sorting does not count as a filter). */
export const FILTER_KEYS = ['text', 'status', 'due', 'importance', 'tag'] as const;

export function activeFilterCount(q: Query): number {
  return FILTER_KEYS.filter((k) => (k === 'text' ? q.text.trim() !== '' : q[k] !== DEFAULT_QUERY[k])).length;
}

export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function matchesText(task: Task, terms: string[], tagNames: Map<string, string>): boolean {
  if (terms.length === 0) return true;
  const haystack = normalizeText(
    [task.title, task.notes, ...task.steps.map((s) => s.title), ...task.tagIds.map((id) => tagNames.get(id) ?? '')].join(
      '\n',
    ),
  );
  return terms.every((t) => haystack.includes(t));
}

function matchesDue(task: Task, due: DueFilter, today: string): boolean {
  switch (due) {
    case 'any':
      return true;
    case 'none':
      return task.due === null;
    case 'overdue':
      return !task.completedAt && task.due !== null && task.due < today;
    case 'today':
      return task.due === today;
    case 'soon':
      return task.due !== null && task.due > today && task.due <= addDays(today, SOON_DAYS);
  }
}

export function filterTasks(data: AppData, q: Query, today: string): Task[] {
  const terms = normalizeText(q.text).split(/\s+/).filter(Boolean);
  const tagNames = new Map(data.tags.map((t) => [t.id, t.name]));
  return data.tasks.filter(
    (t) =>
      (q.status === 'all' || (q.status === 'open' ? !t.completedAt : !!t.completedAt)) &&
      (q.importance === 'any' || t.importance === q.importance) &&
      (q.tag === 'any' || (q.tag === 'untagged' ? t.tagIds.length === 0 : t.tagIds.includes(q.tag))) &&
      matchesDue(t, q.due, today) &&
      matchesText(t, terms, tagNames),
  );
}

const tieBreak = (a: Task, b: Task) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function sortTasks(tasks: Task[], sort: SortKey, dir: SortDir): Task[] {
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = (a: Task, b: Task): number => {
    switch (sort) {
      case 'recommended':
        return sign * compareRecommended(a, b) || tieBreak(a, b);
      case 'due':
        // Tasks without a due date always sort last, whatever the direction.
        if (a.due === b.due) return tieBreak(a, b);
        if (!a.due) return 1;
        if (!b.due) return -1;
        return sign * (a.due < b.due ? -1 : 1);
      case 'importance':
        return sign * (IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]) || compareRecommended(a, b);
      case 'created':
        return sign * tieBreak(a, b);
      case 'title':
        return sign * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || tieBreak(a, b);
    }
  };
  return [...tasks].sort(cmp);
}

export function runQuery(data: AppData, q: Query, today: string): Task[] {
  return sortTasks(filterTasks(data, q, today), q.sort, q.dir);
}
