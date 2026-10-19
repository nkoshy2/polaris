/**
 * Application store: owns the current AppData, persists every change through
 * the Repository, and keeps a linear undo history. UI components call these
 * actions; all task rules stay in src/domain.
 */
import { localDate } from '../domain/dates';
import * as sync from '../domain/sync';
import type { SyncBatch, SyncOptions, SyncSummary } from '../domain/sync';
import * as ops from '../domain/tasks';
import type { Ctx, TaskInput } from '../domain/tasks';
import { emptyData, type AppData, type Task } from '../domain/types';
import { Repository, StorageError, type KeyValueStore, type LoadStatus } from '../storage/repository';

const UNDO_LIMIT = 50;

export interface UndoEntry {
  label: string;
  before: AppData;
}

export interface StoreState {
  data: AppData;
  today: string;
  loadStatus: LoadStatus;
  loadIssues: string[];
  readOnly: boolean;
  /** Set when the latest change could not be written to storage. */
  saveError: string | null;
  undo: UndoEntry[];
  /** Incremented when another tab changed the data. */
  externalChange: number;
}

type Listener = () => void;

export class Store {
  private state: StoreState;
  private listeners = new Set<Listener>();
  private repo: Repository;

  constructor(
    kv: KeyValueStore,
    private readonly ctx: Ctx = ops.systemCtx,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.repo = new Repository(kv, ctx.now);
    let loaded;
    let loadError: string | null = null;
    try {
      loaded = this.repo.load();
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      loaded = { data: emptyData(), status: 'ok' as const, issues: [], readOnly: false };
    }
    this.state = {
      data: loaded.data,
      today: localDate(clock()),
      loadStatus: loaded.status,
      loadIssues: loaded.issues,
      readOnly: loaded.readOnly,
      saveError: loadError,
      undo: [],
      externalChange: 0,
    };
    // Persist repairs straight away so they are not re-reported on every start.
    if (loaded.status === 'repaired' || loaded.status === 'restoredPrevious') this.persist(loaded.data);
  }

  // ---- subscription -----------------------------------------------------------

  getState = (): StoreState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ---- persistence ------------------------------------------------------------

  private persist(data: AppData): boolean {
    if (this.state?.readOnly) return false;
    try {
      this.repo.save(data);
      if (this.state?.saveError) this.set({ saveError: null });
      return true;
    } catch (err) {
      const message = err instanceof StorageError ? err.message : 'Your latest change could not be saved.';
      if (this.state) this.set({ saveError: message });
      return false;
    }
  }

  /** Applies a change: records undo, updates memory, then writes to storage. */
  private commit(label: string, next: AppData) {
    if (this.state.readOnly) {
      throw new StorageError('Polaris is in read-only mode because your data belongs to a newer version.');
    }
    if (next === this.state.data) return;
    const undo = [...this.state.undo, { label, before: this.state.data }].slice(-UNDO_LIMIT);
    this.set({ data: next, undo });
    this.persist(next);
  }

  /** Retry a failed save (e.g. after the user frees up storage). */
  retrySave = (): boolean => this.persist(this.state.data);

  /** Re-read storage after another tab wrote to it. Undo history is reset. */
  reloadFromStorage = () => {
    const loaded = this.repo.load();
    this.set({
      data: loaded.data,
      readOnly: loaded.readOnly,
      undo: [],
      externalChange: this.state.externalChange + 1,
    });
  };

  refreshToday = () => {
    const today = localDate(this.clock());
    if (today !== this.state.today) this.set({ today });
  };

  dismissLoadNotice = () => this.set({ loadStatus: 'ok', loadIssues: [] });

  getRecoveryCopy = () => this.repo.getRecoveryCopy();
  clearRecoveryCopy = () => this.repo.clearRecoveryCopy();

  // ---- undo -------------------------------------------------------------------

  /** Reverts the most recent change. Returns its label, or null if none. */
  undo = (): string | null => {
    const entry = this.state.undo.at(-1);
    if (!entry || this.state.readOnly) return null;
    this.set({ data: entry.before, undo: this.state.undo.slice(0, -1) });
    this.persist(entry.before);
    return entry.label;
  };

  // ---- task actions -----------------------------------------------------------

  createTask = (input: TaskInput): Task => {
    const { data, task } = ops.createTask(this.state.data, input, this.ctx);
    this.commit('Add task', data);
    return task;
  };

  updateTask = (id: string, input: TaskInput) => {
    this.commit('Edit task', ops.updateTask(this.state.data, id, input, this.ctx));
  };

  setCompleted = (ids: string[], completed: boolean) => {
    const label = `${completed ? 'Complete' : 'Reopen'} ${ids.length === 1 ? 'task' : `${ids.length} tasks`}`;
    const fn = completed ? ops.completeTasks : ops.reopenTasks;
    this.commit(label, fn(this.state.data, ids, this.ctx));
  };

  setStepDone = (taskId: string, stepId: string, done: boolean) => {
    this.commit(done ? 'Complete step' : 'Reopen step', ops.setStepDone(this.state.data, taskId, stepId, done, this.ctx));
  };

  deleteTasks = (ids: string[]) => {
    this.commit(ids.length === 1 ? 'Delete task' : `Delete ${ids.length} tasks`, ops.deleteTasks(this.state.data, ids));
  };

  duplicateTask = (id: string): Task => {
    const { data, task } = ops.duplicateTask(this.state.data, id, this.ctx);
    this.commit('Duplicate task', data);
    return task;
  };

  addTagToTasks = (ids: string[], tagId: string) => {
    this.commit('Tag tasks', ops.addTagToTasks(this.state.data, ids, tagId, this.ctx));
  };

  // ---- tag actions ------------------------------------------------------------

  createTag = (name: string) => {
    const { data, tag } = ops.createTag(this.state.data, name, this.ctx);
    this.commit('Create tag', data);
    return tag;
  };

  renameTag = (id: string, name: string) => {
    this.commit('Rename tag', ops.renameTag(this.state.data, id, name, this.ctx));
  };

  deleteTag = (id: string) => {
    this.commit('Delete tag', ops.deleteTag(this.state.data, id, this.ctx));
  };

  // ---- assignment sync --------------------------------------------------------

  /** Merges one batch from the extension. The whole sync is a single undo step. */
  applySync = (batch: SyncBatch, options?: SyncOptions): SyncSummary => {
    const { data, summary } = sync.applySync(this.state.data, batch, this.ctx, options);
    this.commit(`Sync ${batch.kind === 'canvas' ? 'Canvas' : 'Gradescope'}`, data);
    return summary;
  };

  restoreDismissed = (keys: string[]) => {
    this.commit('Restore dismissed assignments', sync.restoreDismissed(this.state.data, keys));
  };

  // ---- backup -----------------------------------------------------------------

  replaceAll = (data: AppData) => {
    this.commit('Restore backup', data);
  };
}
