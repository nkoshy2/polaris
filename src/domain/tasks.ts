/**
 * Task and tag operations. Every function is pure: it takes the current
 * AppData and returns a new AppData (or throws ValidationError), never mutating
 * its input. This is the only place task business rules live.
 *
 * Invariant: a completed task never has open steps.
 *  - Completing a task marks all of its steps done.
 *  - Re-opening a step (or adding an open step) re-opens its completed task.
 *  - Finishing the last step does NOT complete the task; the user decides.
 *  - Re-opening a task leaves its steps as they were.
 */
import type { AppData, Importance, Step, Tag, Task } from './types';
import {
  LIMITS,
  ValidationError,
  cleanLine,
  validateDue,
  validateImportance,
  validateNotes,
  validateTagName,
  validateTitle,
} from './validation';

/** Injected clock and ID source so operations stay deterministic in tests. */
export interface Ctx {
  now: () => string;
  newId: () => string;
}

export const systemCtx: Ctx = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
};

export interface StepInput {
  id?: string;
  title: string;
  done?: boolean;
}

export interface TaskInput {
  title: string;
  notes?: string;
  importance?: Importance;
  due?: string | null;
  tagIds?: string[];
  steps?: StepInput[];
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} no longer exists. It may have been deleted.`);
    this.name = 'NotFoundError';
  }
}

function getTask(data: AppData, id: string): Task {
  const task = data.tasks.find((t) => t.id === id);
  if (!task) throw new NotFoundError('That task');
  return task;
}

function replaceTask(data: AppData, next: Task): AppData {
  return { ...data, tasks: data.tasks.map((t) => (t.id === next.id ? next : t)) };
}

function validateTagIds(data: AppData, tagIds: unknown): string[] {
  if (tagIds == null) return [];
  if (!Array.isArray(tagIds)) throw new ValidationError('Tags are invalid.', 'tags');
  const known = new Set(data.tags.map((t) => t.id));
  const unique = [...new Set(tagIds)];
  for (const id of unique) {
    if (typeof id !== 'string' || !known.has(id)) {
      throw new ValidationError('One of the selected tags no longer exists.', 'tags');
    }
  }
  return unique as string[];
}

/** Empty step rows are dropped; that is how a user removes a step in a form. */
function validateSteps(steps: unknown, ctx: Ctx): Step[] {
  if (steps == null) return [];
  if (!Array.isArray(steps)) throw new ValidationError('Steps are invalid.', 'steps');
  const result: Step[] = [];
  const seen = new Set<string>();
  steps.forEach((raw: StepInput, i) => {
    const title = cleanLine(raw?.title);
    if (!title) return;
    if (title.length > LIMITS.title) {
      throw new ValidationError(`Step ${i + 1} must be ${LIMITS.title} characters or fewer.`, 'steps');
    }
    let id = typeof raw.id === 'string' && raw.id ? raw.id : ctx.newId();
    if (seen.has(id)) id = ctx.newId();
    seen.add(id);
    result.push({ id, title, done: raw.done === true });
  });
  if (result.length > LIMITS.steps) {
    throw new ValidationError(`A task can have at most ${LIMITS.steps} steps.`, 'steps');
  }
  return result;
}

function validateTaskInput(data: AppData, input: TaskInput, ctx: Ctx) {
  return {
    title: validateTitle(input.title),
    notes: validateNotes(input.notes),
    importance: validateImportance(input.importance),
    due: validateDue(input.due),
    tagIds: validateTagIds(data, input.tagIds),
    steps: validateSteps(input.steps, ctx),
  };
}

const hasOpenSteps = (steps: Step[]) => steps.some((s) => !s.done);

export function createTask(data: AppData, input: TaskInput, ctx: Ctx): { data: AppData; task: Task } {
  const fields = validateTaskInput(data, input, ctx);
  const now = ctx.now();
  const task: Task = { id: ctx.newId(), ...fields, completedAt: null, source: null, createdAt: now, updatedAt: now };
  return { data: { ...data, tasks: [...data.tasks, task] }, task };
}

/** Replaces the editable fields of a task (a full form save). */
export function updateTask(data: AppData, id: string, input: TaskInput, ctx: Ctx): AppData {
  const task = getTask(data, id);
  const fields = validateTaskInput(data, input, ctx);
  const completedAt = task.completedAt && !hasOpenSteps(fields.steps) ? task.completedAt : null;
  return replaceTask(data, { ...task, ...fields, completedAt, updatedAt: ctx.now() });
}

export function completeTasks(data: AppData, ids: string[], ctx: Ctx): AppData {
  const now = ctx.now();
  const targets = new Set(ids);
  ids.forEach((id) => getTask(data, id));
  return {
    ...data,
    tasks: data.tasks.map((t) =>
      targets.has(t.id) && !t.completedAt
        ? { ...t, completedAt: now, updatedAt: now, steps: t.steps.map((s) => (s.done ? s : { ...s, done: true })) }
        : t,
    ),
  };
}

export function reopenTasks(data: AppData, ids: string[], ctx: Ctx): AppData {
  const now = ctx.now();
  const targets = new Set(ids);
  ids.forEach((id) => getTask(data, id));
  return {
    ...data,
    tasks: data.tasks.map((t) => (targets.has(t.id) && t.completedAt ? { ...t, completedAt: null, updatedAt: now } : t)),
  };
}

export function setStepDone(data: AppData, taskId: string, stepId: string, done: boolean, ctx: Ctx): AppData {
  const task = getTask(data, taskId);
  if (!task.steps.some((s) => s.id === stepId)) throw new NotFoundError('That step');
  const steps = task.steps.map((s) => (s.id === stepId ? { ...s, done } : s));
  const completedAt = done ? task.completedAt : null;
  return replaceTask(data, { ...task, steps, completedAt, updatedAt: ctx.now() });
}

/** Deleting a synced task dismisses its upstream keys so sync never re-creates it. */
export function deleteTasks(data: AppData, ids: string[]): AppData {
  const targets = new Set(ids);
  const dismissed = new Set(data.dismissedSources);
  for (const t of data.tasks) {
    if (targets.has(t.id) && t.source) [t.source.externalId, ...t.source.aliases].forEach((key) => dismissed.add(key));
  }
  const dismissedSources = dismissed.size === data.dismissedSources.length ? data.dismissedSources : [...dismissed];
  return { ...data, tasks: data.tasks.filter((t) => !targets.has(t.id)), dismissedSources };
}

/** Copies a task as a new open task with all steps reset. The copy is never linked to an assignment. */
export function duplicateTask(data: AppData, id: string, ctx: Ctx): { data: AppData; task: Task } {
  const src = getTask(data, id);
  const now = ctx.now();
  const suffix = ' (copy)';
  const title = src.title.length + suffix.length <= LIMITS.title ? src.title + suffix : src.title;
  const copy: Task = {
    ...src,
    id: ctx.newId(),
    title,
    tagIds: [...src.tagIds],
    steps: src.steps.map((s) => ({ id: ctx.newId(), title: s.title, done: false })),
    completedAt: null,
    source: null,
    createdAt: now,
    updatedAt: now,
  };
  const index = data.tasks.findIndex((t) => t.id === id);
  const tasks = [...data.tasks];
  tasks.splice(index + 1, 0, copy);
  return { data: { ...data, tasks }, task: copy };
}

export function addTagToTasks(data: AppData, ids: string[], tagId: string, ctx: Ctx): AppData {
  validateTagIds(data, [tagId]);
  const now = ctx.now();
  const targets = new Set(ids);
  return {
    ...data,
    tasks: data.tasks.map((t) =>
      targets.has(t.id) && !t.tagIds.includes(tagId) ? { ...t, tagIds: [...t.tagIds, tagId], updatedAt: now } : t,
    ),
  };
}

// ---- Tags -------------------------------------------------------------------

function assertUniqueTagName(data: AppData, name: string, exceptId?: string) {
  const key = name.toLocaleLowerCase();
  if (data.tags.some((t) => t.id !== exceptId && t.name.toLocaleLowerCase() === key)) {
    throw new ValidationError(`A tag named “${name}” already exists.`, 'tagName');
  }
}

export function createTag(data: AppData, name: string, ctx: Ctx): { data: AppData; tag: Tag } {
  const clean = validateTagName(name);
  assertUniqueTagName(data, clean);
  const now = ctx.now();
  const tag: Tag = { id: ctx.newId(), name: clean, createdAt: now, updatedAt: now };
  return { data: { ...data, tags: [...data.tags, tag] }, tag };
}

export function renameTag(data: AppData, id: string, name: string, ctx: Ctx): AppData {
  const tag = data.tags.find((t) => t.id === id);
  if (!tag) throw new NotFoundError('That tag');
  const clean = validateTagName(name);
  assertUniqueTagName(data, clean, id);
  return { ...data, tags: data.tags.map((t) => (t.id === id ? { ...t, name: clean, updatedAt: ctx.now() } : t)) };
}

/** Removes a tag and detaches it from every task. Tasks themselves are kept. */
export function deleteTag(data: AppData, id: string, ctx: Ctx): AppData {
  if (!data.tags.some((t) => t.id === id)) throw new NotFoundError('That tag');
  const now = ctx.now();
  return {
    ...data,
    tags: data.tags.filter((t) => t.id !== id),
    tasks: data.tasks.map((t) =>
      t.tagIds.includes(id) ? { ...t, tagIds: t.tagIds.filter((x) => x !== id), updatedAt: now } : t,
    ),
  };
}

export const countTasksWithTag = (data: AppData, tagId: string) =>
  data.tasks.filter((t) => t.tagIds.includes(tagId)).length;
