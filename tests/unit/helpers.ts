import type { Ctx, TaskInput } from '../../src/domain/tasks';
import { createTag, createTask } from '../../src/domain/tasks';
import { emptyData, type AppData, type Task } from '../../src/domain/types';
import type { KeyValueStore } from '../../src/storage/repository';

/** Deterministic clock/ID source. `tick()` advances the clock by one minute. */
export function testCtx(start = '2026-10-18T12:00:00.000Z') {
  let t = Date.parse(start);
  let n = 0;
  const ctx: Ctx & { tick(): void; set(iso: string): void } = {
    now: () => new Date(t).toISOString(),
    newId: () => `id-${++n}`,
    tick: () => {
      t += 60_000;
    },
    set: (iso: string) => {
      t = Date.parse(iso);
    },
  };
  return ctx;
}

export function seed(inputs: TaskInput[], ctx = testCtx()): { data: AppData; tasks: Task[]; ctx: ReturnType<typeof testCtx> } {
  let data = emptyData();
  const tasks: Task[] = [];
  for (const input of inputs) {
    const r = createTask(data, input, ctx);
    data = r.data;
    tasks.push(r.task);
    ctx.tick();
  }
  return { data, tasks, ctx };
}

export function withTags(data: AppData, names: string[], ctx: Ctx) {
  const ids: string[] = [];
  for (const name of names) {
    const r = createTag(data, name, ctx);
    data = r.data;
    ids.push(r.tag.id);
  }
  return { data, ids };
}

export class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  failWrites: false | 'quota' | 'other' = false;
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites === 'quota') throw new DOMException('full', 'QuotaExceededError');
    if (this.failWrites === 'other') throw new Error('disk error');
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}
