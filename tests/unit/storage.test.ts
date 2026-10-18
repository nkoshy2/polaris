import { describe, expect, it } from 'vitest';
import { completeTasks } from '../../src/domain/tasks';
import { emptyData } from '../../src/domain/types';
import { exportFilename, exportJson, parseBackup } from '../../src/storage/backup';
import { KEYS, Repository, StorageError } from '../../src/storage/repository';
import { SCHEMA_VERSION, SchemaError, migrate, parseEnvelope, serialize } from '../../src/storage/schema';
import { MemoryStore, seed, withTags } from './helpers';

const NOW = '2026-10-18T12:00:00.000Z';
let n = 0;
const opts = { now: NOW, newId: () => `new-${++n}` };
const envelope = (data: unknown, schemaVersion = SCHEMA_VERSION) => JSON.stringify({ app: 'polaris', schemaVersion, savedAt: NOW, data });

function sample() {
  const s = seed([{ title: 'A', due: '2026-10-20', importance: 'high', steps: [{ title: 's' }] }, { title: 'B' }]);
  const { data, ids } = withTags(s.data, ['Work'], s.ctx);
  const tagged = { ...data, tasks: data.tasks.map((t, i) => (i === 0 ? { ...t, tagIds: [ids[0]!] } : t)) };
  return completeTasks(tagged, [s.tasks[1]!.id], s.ctx);
}

describe('persistence across restarts', () => {
  it('round-trips data through storage exactly', () => {
    const kv = new MemoryStore();
    const data = sample();
    new Repository(kv, () => NOW).save(data);
    const loaded = new Repository(kv, () => NOW).load(); // a fresh "app start"
    expect(loaded.status).toBe('ok');
    expect(loaded.data).toEqual(data);
  });

  it('reports a first run as empty', () => {
    expect(new Repository(new MemoryStore()).load()).toMatchObject({ status: 'empty', data: emptyData() });
  });

  it('keeps the previous good copy on each save', () => {
    const kv = new MemoryStore();
    const repo = new Repository(kv, () => NOW);
    const first = sample();
    repo.save(first);
    repo.save(emptyData());
    expect(parseEnvelope(kv.getItem(KEYS.previous)!).data).toEqual(first);
  });
});

describe('recovery from bad stored data', () => {
  it('falls back to the previous copy when current data is corrupt, and keeps the corrupt original', () => {
    const kv = new MemoryStore();
    const repo = new Repository(kv, () => NOW);
    const good = sample();
    repo.save(good);
    repo.save(good);
    kv.setItem(KEYS.data, '{"app":"polaris","schemaVersion":1,"data":'); // truncated write
    const loaded = new Repository(kv, () => NOW).load();
    expect(loaded.status).toBe('restoredPrevious');
    expect(loaded.data).toEqual(good);
    expect(new Repository(kv).getRecoveryCopy()?.raw).toContain('"schemaVersion":1,"data":');
  });

  it('starts empty but preserves the original when nothing is readable', () => {
    const kv = new MemoryStore();
    kv.setItem(KEYS.data, 'not json at all');
    const repo = new Repository(kv, () => NOW);
    const loaded = repo.load();
    expect(loaded).toMatchObject({ status: 'unreadable', data: emptyData(), readOnly: false });
    expect(repo.getRecoveryCopy()).toMatchObject({ raw: 'not json at all' });
  });

  it('repairs malformed records instead of discarding them, and reports each repair', () => {
    const kv = new MemoryStore();
    kv.setItem(
      KEYS.data,
      envelope({
        tags: [{ id: 'g1', name: 'Work' }, { id: 'g1', name: 'work' }, 'junk'],
        tasks: [
          { id: 't1', title: '  Keep me ', due: '2026-02-31', importance: 'urgent', tagIds: ['g1', 'ghost'] },
          { id: 't1', title: '' },
          { title: 'Done but open steps', completedAt: NOW, steps: [{ title: 'x', done: false }, { nope: 1 }] },
          42,
        ],
      }),
    );
    const repo = new Repository(kv, () => NOW);
    const loaded = repo.load();
    expect(loaded.status).toBe('repaired');
    const [a, b, c] = loaded.data.tasks;
    expect(loaded.data.tasks).toHaveLength(3);
    expect(a).toMatchObject({ id: 't1', title: 'Keep me', due: null, importance: 'normal', tagIds: ['g1'] });
    expect(b!.id).not.toBe('t1');
    expect(b!.title).toBe('Untitled task');
    expect(c!.steps).toEqual([expect.objectContaining({ title: 'x', done: true })]);
    expect(loaded.data.tags.map((t) => t.name)).toEqual(['Work', 'work (2)']);
    expect(new Set(loaded.data.tags.map((t) => t.id)).size).toBe(2);
    expect(loaded.issues.length).toBeGreaterThanOrEqual(8);
    expect(loaded.issues.join(' ')).toMatch(/invalid due date \(2026-02-31\)/);
    expect(repo.getRecoveryCopy()?.raw).toContain('2026-02-31');
  });

  it('moves an over-long title into the notes instead of truncating it away', () => {
    const long = 'word '.repeat(60).trim();
    const { data, issues } = parseEnvelope(envelope({ tags: [], tasks: [{ id: 'x', title: long, notes: 'orig' }] }), opts);
    expect(data.tasks[0]!.title.length).toBe(200);
    expect(data.tasks[0]!.notes).toBe(`${long}\n\norig`);
    expect(issues).toHaveLength(1);
  });

  it('refuses to overwrite data written by a newer version', () => {
    const kv = new MemoryStore();
    const future = envelope({ tasks: [], tags: [] }, SCHEMA_VERSION + 1);
    kv.setItem(KEYS.data, future);
    const repo = new Repository(kv, () => NOW);
    expect(repo.load()).toMatchObject({ status: 'newerVersion', readOnly: true });
    expect(() => repo.save(emptyData())).toThrow(StorageError);
    expect(kv.getItem(KEYS.data)).toBe(future);
  });

  it('surfaces storage write failures and leaves the last saved data intact', () => {
    const kv = new MemoryStore();
    const repo = new Repository(kv, () => NOW);
    const good = sample();
    repo.save(good);
    kv.failWrites = 'quota';
    expect(() => repo.save(emptyData())).toThrowError(/storage is full/);
    kv.failWrites = 'other';
    expect(() => repo.save(emptyData())).toThrowError(/could not be saved/);
    kv.failWrites = false;
    expect(new Repository(kv).load().data).toEqual(good);
  });
});

describe('schema versions and migrations', () => {
  it('rejects non-Polaris and unversioned data', () => {
    expect(() => parseEnvelope('{"tasks":[]}')).toThrow(SchemaError);
    expect(() => parseEnvelope('{"app":"polaris","data":{}}')).toThrowError(/unknown format version/);
    expect(() => parseEnvelope('[]')).toThrow(SchemaError);
  });

  it('applies migrations in order from the stored version', () => {
    const migrations = {
      1: (d: unknown) => ({ ...(d as object), trail: ['1→2'] }),
      2: (d: unknown) => ({ ...(d as { trail: string[] }), trail: [...(d as { trail: string[] }).trail, '2→3'] }),
    };
    expect(migrate({}, 1, 3, migrations)).toEqual({ trail: ['1→2', '2→3'] });
    expect(() => migrate({}, 1, 3, { 1: migrations[1] })).toThrowError(/No upgrade path from data version 2/);
  });

  it('round-trips through serialize', () => {
    const data = sample();
    expect(parseEnvelope(serialize(data, NOW)).data).toEqual(data);
  });
});

describe('backup export and restore', () => {
  it('exports a readable, versioned JSON file that restores to identical data', () => {
    const data = sample();
    const text = exportJson(data, NOW);
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ app: 'polaris', schemaVersion: SCHEMA_VERSION, savedAt: NOW });
    expect(text).toContain('\n  "data"');
    const preview = parseBackup(text);
    expect(preview).toMatchObject({ taskCount: 2, tagCount: 1, openCount: 1, issues: [] });
    expect(preview.data).toEqual(data);
  });

  it('names the backup file by date', () => {
    expect(exportFilename('2026-10-18')).toBe('polaris-backup-2026-10-18.json');
  });

  it('gives readable errors for files that are not backups', () => {
    expect(() => parseBackup('')).toThrowError(/empty/);
    expect(() => parseBackup('hello')).toThrowError(/not valid JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrowError(/not Polaris data/);
  });
});
