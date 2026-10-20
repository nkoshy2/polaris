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

/** Where a synced task came from. Assignments are read by the Polaris Connector extension. */
export type SourceKind = 'canvas' | 'gradescope';

export const SOURCE_KINDS: readonly SourceKind[] = ['canvas', 'gradescope'];

/**
 * Link between a task and an upstream assignment. The `synced*` fields hold the
 * values last received from upstream: when the task's own field differs, the
 * user edited it, and sync leaves it alone. See "Assignment sync" in DESIGN.md.
 */
export interface TaskSource {
  kind: SourceKind;
  /** Stable upstream key starting with "<kind>:", e.g. "canvas:canvas.illinois.edu:assignment:123". */
  externalId: string;
  /** Upstream keys of the same assignment from another source (Canvas and Gradescope). */
  aliases: string[];
  /** https link to the assignment, or "" when unknown. */
  url: string;
  /** Exact upstream deadline (ISO-8601), or null when it has none. */
  dueAt: string | null;
  syncedTitle: string;
  syncedDue: string | null;
  /**
   * Keys (externalId or aliases) whose assignment is currently submitted. The
   * task is completed when this goes from empty to non-empty, so reopening a
   * submitted task sticks until there is a new submission.
   */
  submittedKeys: string[];
  /** Set when the assignment stopped appearing upstream; the task is kept. */
  removedAt: string | null;
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
  /** Set for tasks created by assignment sync; null for tasks the user made. */
  source: TaskSource | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A synced task the user deleted. Sync never re-creates a task for any of its
 * keys, nor for an assignment from the other source that matches it the way
 * duplicates are linked (same course tag, title and due date).
 */
export interface DismissedSource {
  /** The deleted task's externalId and aliases. */
  keys: string[];
  title: string;
  dismissedAt: string;
  /**
   * The deleted task's tag names (one of them is its course tag), last synced
   * title and last synced due date, for matching the other source's copy.
   * Missing on entries saved before they were recorded; those match by key only.
   */
  tagNames?: string[];
  syncedTitle?: string;
  syncedDue?: string | null;
}

export interface AppData {
  tasks: Task[];
  tags: Tag[];
  dismissedSources: DismissedSource[];
}

export const emptyData = (): AppData => ({ tasks: [], tags: [], dismissedSources: [] });
