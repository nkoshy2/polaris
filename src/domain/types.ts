/**
 * Core data model. See docs/DESIGN.md for the reasoning behind each choice.
 *
 * - Dates without a time ("due dates") are local calendar dates: "YYYY-MM-DD".
 * - Timestamps are ISO-8601 UTC strings.
 * - IDs are random UUIDs so records created on different devices never collide
 *   (keeps a future sync option open without a migration).
 */

export type Importance = 'high' | 'normal' | 'low';

export const IMPORTANCE_LEVELS: readonly Importance[] = ['high', 'normal', 'low'];

/** A step inside a task. Steps are never counted as tasks in totals. */
export interface Step {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  importance: Importance;
  /** Local calendar date "YYYY-MM-DD", or null when the task has no deadline. */
  due: string | null;
  tagIds: string[];
  steps: Step[];
  /** Set when the task is completed; null while it is open. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppData {
  tasks: Task[];
  tags: Tag[];
}

export const emptyData = (): AppData => ({ tasks: [], tags: [] });
