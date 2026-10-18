import { describe, expect, it } from 'vitest';
import { KEYS } from '../../src/storage/repository';
import { serialize } from '../../src/storage/schema';
import { Store } from '../../src/state/store';
import { MemoryStore, testCtx } from './helpers';

const make = (kv = new MemoryStore()) => ({ kv, store: new Store(kv, testCtx(), () => new Date(2026, 9, 18, 9)) });

describe('store', () => {
  it("uses the local calendar date as 'today'", () => {
    expect(make().store.getState().today).toBe('2026-10-18');
  });

  it('persists every change so a restart sees it', () => {
    const { kv, store } = make();
    const task = store.createTask({ title: 'Persist me' });
    store.setCompleted([task.id], true);
    const restarted = new Store(kv, testCtx());
    expect(restarted.getState().data.tasks).toEqual([expect.objectContaining({ title: 'Persist me', completedAt: expect.any(String) })]);
  });

  it('undoes changes in reverse order, including deletes, and persists the undo', () => {
    const { kv, store } = make();
    const a = store.createTask({ title: 'A' });
    store.createTask({ title: 'B' });
    store.deleteTasks([a.id]);
    expect(store.getState().data.tasks.map((t) => t.title)).toEqual(['B']);
    expect(store.undo()).toBe('Delete task');
    expect(store.getState().data.tasks.map((t) => t.title)).toEqual(['A', 'B']);
    expect(new Store(kv, testCtx()).getState().data.tasks).toHaveLength(2);
    expect(store.undo()).toBe('Add task');
    expect(store.undo()).toBe('Add task');
    expect(store.undo()).toBeNull();
    expect(store.getState().data.tasks).toEqual([]);
  });

  it('restores tag membership when a tag deletion is undone', () => {
    const { store } = make();
    const tag = store.createTag('Work');
    const task = store.createTask({ title: 'A', tagIds: [tag.id] });
    store.deleteTag(tag.id);
    expect(store.getState().data.tasks[0]!.tagIds).toEqual([]);
    store.undo();
    expect(store.getState().data.tasks[0]!.tagIds).toEqual([tag.id]);
    expect(store.getState().data.tasks[0]!.id).toBe(task.id);
  });

  it('does not record history or save when an action fails validation', () => {
    const { kv, store } = make();
    store.createTask({ title: 'A' });
    const saved = kv.getItem(KEYS.data);
    expect(() => store.createTask({ title: '  ' })).toThrowError(/can't be empty/);
    expect(store.getState().undo).toHaveLength(1);
    expect(kv.getItem(KEYS.data)).toBe(saved);
  });

  it('keeps changes in memory and reports an error when saving fails, then recovers on retry', () => {
    const { kv, store } = make();
    kv.failWrites = 'quota';
    store.createTask({ title: 'Unsaved' });
    expect(store.getState().saveError).toMatch(/storage is full/);
    expect(store.getState().data.tasks).toHaveLength(1);
    kv.failWrites = false;
    expect(store.retrySave()).toBe(true);
    expect(store.getState().saveError).toBeNull();
    expect(new Store(kv, testCtx()).getState().data.tasks).toHaveLength(1);
  });

  it('refuses edits when the stored data is from a newer version', () => {
    const kv = new MemoryStore();
    const future = serialize({ tasks: [], tags: [] }, '2026-10-18T00:00:00Z').replace('"schemaVersion":1', '"schemaVersion":99');
    kv.setItem(KEYS.data, future);
    const { store } = make(kv);
    expect(store.getState()).toMatchObject({ readOnly: true, loadStatus: 'newerVersion' });
    expect(() => store.createTask({ title: 'x' })).toThrowError(/read-only/);
    expect(kv.getItem(KEYS.data)).toBe(future);
  });

  it('picks up changes another tab wrote and resets undo history', () => {
    const kv = new MemoryStore();
    const tabA = make(kv).store;
    const tabB = make(kv).store;
    tabA.createTask({ title: 'From A' });
    tabB.reloadFromStorage();
    expect(tabB.getState().data.tasks.map((t) => t.title)).toEqual(['From A']);
    expect(tabB.getState().undo).toEqual([]);
  });

  it('replaces all data on restore, and the restore can be undone', () => {
    const { store } = make();
    store.createTask({ title: 'Mine' });
    store.replaceAll({ tasks: [], tags: [] });
    expect(store.getState().data.tasks).toHaveLength(0);
    expect(store.undo()).toBe('Restore backup');
    expect(store.getState().data.tasks.map((t) => t.title)).toEqual(['Mine']);
  });

  it('notifies subscribers on change', () => {
    const { store } = make();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.createTask({ title: 'A' });
    off();
    store.createTask({ title: 'B' });
    expect(calls).toBe(1);
  });
});
