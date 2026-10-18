/**
 * Persistence behind a small interface. The browser implementation uses
 * localStorage (synchronous, ample for thousands of tasks; see docs/DESIGN.md).
 *
 * Keys:
 *   polaris.data      current data (envelope JSON)
 *   polaris.previous  the last good copy before the most recent save
 *   polaris.recovery  the untouched original of anything that had to be
 *                     repaired or could not be read, so nothing is lost
 */
import { emptyData, type AppData } from '../domain/types';
import { SchemaError, parseEnvelope, serialize } from './schema';

/** The subset of the Web Storage API we rely on (easy to fake in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEYS = {
  data: 'polaris.data',
  previous: 'polaris.previous',
  recovery: 'polaris.recovery',
} as const;

export type LoadStatus =
  /** Nothing stored yet — a first run. */
  | 'empty'
  | 'ok'
  /** Stored data needed repairs; the original is kept as a recovery copy. */
  | 'repaired'
  /** Current data was unreadable; the previous good copy was loaded instead. */
  | 'restoredPrevious'
  /** Nothing usable; started empty. The original is kept as a recovery copy. */
  | 'unreadable'
  /** Written by a newer Polaris. Loaded nothing and saving is disabled. */
  | 'newerVersion';

export interface LoadResult {
  data: AppData;
  status: LoadStatus;
  issues: string[];
  /** When true, save() refuses to write so newer data is never overwritten. */
  readOnly: boolean;
}

export interface RecoveryCopy {
  reason: string;
  savedAt: string;
  raw: string;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class Repository {
  private readOnly = false;

  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  load(): LoadResult {
    this.readOnly = false;
    let raw: string | null;
    try {
      raw = this.kv.getItem(KEYS.data);
    } catch {
      throw new StorageError('Polaris cannot access browser storage. Check that site data is allowed for this page.');
    }

    if (raw === null) {
      const prev = this.tryParse(this.safeGet(KEYS.previous));
      if (prev) return { data: prev.data, status: 'restoredPrevious', issues: prev.issues, readOnly: false };
      return { data: emptyData(), status: 'empty', issues: [], readOnly: false };
    }

    try {
      const result = parseEnvelope(raw, { now: this.now() });
      if (result.issues.length > 0) {
        this.keepRecoveryCopy(raw, 'Repaired while loading: ' + result.issues.join(' '));
        return { data: result.data, status: 'repaired', issues: result.issues, readOnly: false };
      }
      return { data: result.data, status: 'ok', issues: [], readOnly: false };
    } catch (err) {
      if (err instanceof SchemaError && err.kind === 'newerVersion') {
        this.readOnly = true;
        return { data: emptyData(), status: 'newerVersion', issues: [err.message], readOnly: true };
      }
      const reason = err instanceof Error ? err.message : 'Unknown error.';
      this.keepRecoveryCopy(raw, `Unreadable: ${reason}`);
      const prev = this.tryParse(this.safeGet(KEYS.previous));
      if (prev) {
        return { data: prev.data, status: 'restoredPrevious', issues: [reason, ...prev.issues], readOnly: false };
      }
      return { data: emptyData(), status: 'unreadable', issues: [reason], readOnly: false };
    }
  }

  /** Writes data, keeping the prior good copy. Throws StorageError on failure. */
  save(data: AppData): void {
    if (this.readOnly) {
      throw new StorageError('Saving is disabled because the stored data belongs to a newer version of Polaris.');
    }
    const text = serialize(data, this.now());
    try {
      const current = this.kv.getItem(KEYS.data);
      if (current !== null && this.tryParse(current)) this.kv.setItem(KEYS.previous, current);
      this.kv.setItem(KEYS.data, text);
    } catch (err) {
      const quota = err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
      throw new StorageError(
        quota
          ? 'Browser storage is full, so your latest change was not saved. Export a backup, then free up space.'
          : 'Your latest change could not be saved to browser storage.',
      );
    }
  }

  getRecoveryCopy(): RecoveryCopy | null {
    const raw = this.safeGet(KEYS.recovery);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as RecoveryCopy;
      return typeof parsed.raw === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  clearRecoveryCopy(): void {
    this.kv.removeItem(KEYS.recovery);
  }

  private keepRecoveryCopy(raw: string, reason: string) {
    try {
      const copy: RecoveryCopy = { reason, savedAt: this.now(), raw };
      this.kv.setItem(KEYS.recovery, JSON.stringify(copy));
    } catch {
      // Storage is full or blocked. The original is still in KEYS.data until
      // the next successful save, and the UI warns the user to export.
    }
  }

  private safeGet(key: string): string | null {
    try {
      return this.kv.getItem(key);
    } catch {
      return null;
    }
  }

  private tryParse(raw: string | null) {
    if (raw === null) return null;
    try {
      return parseEnvelope(raw, { now: this.now() });
    } catch {
      return null;
    }
  }
}
