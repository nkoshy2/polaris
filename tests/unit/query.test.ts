import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/dates';
import { summarize } from '../../src/domain/progress';
import { DEFAULT_QUERY, activeFilterCount, runQuery, type Query } from '../../src/domain/query';
import { addTagToTasks, completeTasks, createTask } from '../../src/domain/tasks';
import { emptyData } from '../../src/domain/types';
import { seed, testCtx, withTags } from './helpers';

const TODAY = '2026-10-18';
const d = (n: number) => addDays(TODAY, n);
const q = (over: Partial<Query>): Query => ({ ...DEFAULT_QUERY, ...over });

function fixture() {
  const s = seed([
    { title: 'Pay rent', due: d(-1), importance: 'high', notes: 'landlord portal' },
    { title: 'Buy groceries', due: d(0), steps: [{ title: 'Milk' }, { title: 'Café beans' }] },
    { title: 'Plan trip', due: d(5), importance: 'low' },
    { title: 'Read book' },
    { title: 'File taxes', due: d(20), importance: 'high' },
  ]);
  const { data, ids } = withTags(s.data, ['Home', 'Money'], s.ctx);
  let next = addTagToTasks(data, [s.tasks[0]!.id, s.tasks[1]!.id], ids[0]!, s.ctx);
  next = addTagToTasks(next, [s.tasks[0]!.id, s.tasks[4]!.id], ids[1]!, s.ctx);
  next = completeTasks(next, [s.tasks[2]!.id], s.ctx);
  return { data: next, home: ids[0]!, money: ids[1]! };
}

const titles = (tasks: { title: string }[]) => tasks.map((t) => t.title);

describe('filtering', () => {
  const { data, home, money } = fixture();

  it('shows open tasks by default', () => {
    expect(titles(runQuery(data, DEFAULT_QUERY, TODAY))).not.toContain('Plan trip');
    expect(runQuery(data, q({ status: 'all' }), TODAY)).toHaveLength(5);
    expect(titles(runQuery(data, q({ status: 'completed' }), TODAY))).toEqual(['Plan trip']);
  });

  it('filters by due bucket', () => {
    expect(titles(runQuery(data, q({ due: 'overdue' }), TODAY))).toEqual(['Pay rent']);
    expect(titles(runQuery(data, q({ due: 'today' }), TODAY))).toEqual(['Buy groceries']);
    expect(titles(runQuery(data, q({ due: 'soon', status: 'all' }), TODAY))).toEqual(['Plan trip']);
    expect(titles(runQuery(data, q({ due: 'none' }), TODAY))).toEqual(['Read book']);
  });

  it('filters by importance and by tag, including untagged', () => {
    expect(titles(runQuery(data, q({ importance: 'high' }), TODAY))).toEqual(['Pay rent', 'File taxes']);
    expect(titles(runQuery(data, q({ tag: home }), TODAY))).toEqual(['Pay rent', 'Buy groceries']);
    expect(titles(runQuery(data, q({ tag: money }), TODAY))).toEqual(['Pay rent', 'File taxes']);
    expect(titles(runQuery(data, q({ tag: 'untagged', status: 'all' }), TODAY))).toEqual(['Plan trip', 'Read book']);
  });

  it('combines filters with AND', () => {
    expect(titles(runQuery(data, q({ tag: money, due: 'overdue' }), TODAY))).toEqual(['Pay rent']);
  });
});

describe('search', () => {
  const { data } = fixture();

  it('matches title, notes, step titles and tag names, case- and accent-insensitively', () => {
    expect(titles(runQuery(data, q({ text: 'RENT' }), TODAY))).toEqual(['Pay rent']);
    expect(titles(runQuery(data, q({ text: 'portal' }), TODAY))).toEqual(['Pay rent']);
    expect(titles(runQuery(data, q({ text: 'cafe' }), TODAY))).toEqual(['Buy groceries']);
    expect(titles(runQuery(data, q({ text: 'money' }), TODAY))).toEqual(['Pay rent', 'File taxes']);
  });

  it('requires every word to match', () => {
    expect(titles(runQuery(data, q({ text: 'pay landlord' }), TODAY))).toEqual(['Pay rent']);
    expect(runQuery(data, q({ text: 'pay groceries' }), TODAY)).toEqual([]);
  });

  it('treats blank search as no filter', () => {
    expect(runQuery(data, q({ text: '   ' }), TODAY)).toHaveLength(4);
  });
});

describe('sorting', () => {
  const { data } = fixture();
  const all = { status: 'all' as const };

  it('sorts by due date with undated tasks last in both directions', () => {
    expect(titles(runQuery(data, q({ ...all, sort: 'due' }), TODAY))).toEqual([
      'Pay rent',
      'Buy groceries',
      'Plan trip',
      'File taxes',
      'Read book',
    ]);
    expect(titles(runQuery(data, q({ ...all, sort: 'due', dir: 'desc' }), TODAY))).toEqual([
      'File taxes',
      'Plan trip',
      'Buy groceries',
      'Pay rent',
      'Read book',
    ]);
  });

  it('sorts by importance, then due date', () => {
    expect(titles(runQuery(data, q({ ...all, sort: 'importance' }), TODAY))).toEqual([
      'Pay rent',
      'File taxes',
      'Buy groceries',
      'Read book',
      'Plan trip',
    ]);
  });

  it('sorts by creation date and by title', () => {
    expect(titles(runQuery(data, q({ ...all, sort: 'created', dir: 'desc' }), TODAY))[0]).toBe('File taxes');
    expect(titles(runQuery(data, q({ ...all, sort: 'title' }), TODAY))).toEqual([
      'Buy groceries',
      'File taxes',
      'Pay rent',
      'Plan trip',
      'Read book',
    ]);
  });
});

describe('overview counts agree with the lists they link to', () => {
  it('overdue / today / soon counts equal the filtered open-task lists', () => {
    const { data } = fixture();
    const s = summarize(data.tasks, TODAY);
    expect(runQuery(data, q({ due: 'overdue' }), TODAY)).toHaveLength(s.overdue);
    expect(runQuery(data, q({ due: 'today' }), TODAY)).toHaveLength(s.dueToday);
    expect(runQuery(data, q({ due: 'soon' }), TODAY)).toHaveLength(s.dueSoon);
    expect(runQuery(data, DEFAULT_QUERY, TODAY)).toHaveLength(s.open);
  });
});

describe('active filter count', () => {
  it('counts only filters that differ from the defaults, not sorting', () => {
    expect(activeFilterCount(DEFAULT_QUERY)).toBe(0);
    expect(activeFilterCount(q({ sort: 'title', dir: 'desc' }))).toBe(0);
    expect(activeFilterCount(q({ text: ' x ', tag: 'untagged', status: 'all' }))).toBe(3);
  });
});

describe('large collections', () => {
  it('filters and sorts 10,000 tasks quickly', () => {
    const ctx = testCtx();
    let data = emptyData();
    // Build directly for speed; createTask is exercised elsewhere.
    const base = createTask(data, { title: 'seed' }, ctx).task;
    data = {
      tags: [],
      tasks: Array.from({ length: 10_000 }, (_, i) => ({
        ...base,
        id: `t${i}`,
        title: `Task ${i} ${i % 7 === 0 ? 'alpha' : 'beta'}`,
        due: i % 3 === 0 ? null : d((i % 60) - 30),
        importance: (['high', 'normal', 'low'] as const)[i % 3]!,
      })),
    };
    const start = performance.now();
    const result = runQuery(data, q({ text: 'alpha', sort: 'due' }), TODAY);
    const ms = performance.now() - start;
    expect(result).toHaveLength(Math.ceil(10_000 / 7));
    expect(ms).toBeLessThan(250);
  });
});
