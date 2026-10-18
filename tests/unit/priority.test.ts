import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isValidDate } from '../../src/domain/dates';
import { dueDescription, focusGroups, focusTier, urgencyOf } from '../../src/domain/priority';
import { completeTasks } from '../../src/domain/tasks';
import { seed } from './helpers';

const TODAY = '2026-10-18';
const d = (n: number) => addDays(TODAY, n);

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
    expect(isValidDate(20261018)).toBe(false);
  });

  it('counts days across month, year and DST boundaries', () => {
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});

describe('urgency is derived from the due date, separate from importance', () => {
  it.each([
    [d(-1), 'overdue'],
    [d(0), 'today'],
    [d(1), 'soon'],
    [d(7), 'soon'],
    [d(8), 'later'],
    [null, 'none'],
  ] as const)('due %s → %s', (due, expected) => {
    expect(urgencyOf({ due, completedAt: null }, TODAY)).toBe(expected);
  });

  it('a completed task is never urgent, even if past its due date', () => {
    expect(urgencyOf({ due: d(-3), completedAt: '2026-10-01T00:00:00Z' }, TODAY)).toBe('none');
  });

  it('describes due status in words', () => {
    const { tasks } = seed([{ title: 'a', due: d(-3) }, { title: 'b', due: d(-1) }, { title: 'c', due: d(1) }, { title: 'd', due: d(5) }]);
    expect(tasks.map((t) => dueDescription(t, TODAY))).toEqual([
      'Overdue by 3 days',
      'Overdue by 1 day',
      'Due tomorrow',
      'Due in 5 days',
    ]);
  });
});

describe('Focus tiers', () => {
  const { data, tasks, ctx } = seed([
    { title: 'low-overdue', due: d(-2), importance: 'low' }, // 0
    { title: 'today', due: d(0) }, // 1
    { title: 'high-soon', due: d(3), importance: 'high' }, // 2
    { title: 'high-nodate', importance: 'high' }, // 3
    { title: 'high-later', due: d(30), importance: 'high' }, // 4
    { title: 'normal-soon', due: d(2) }, // 5
    { title: 'normal-later', due: d(30) }, // 6
    { title: 'normal-nodate' }, // 7
    { title: 'done-overdue', due: d(-5), importance: 'high' }, // 8
  ]);
  const all = completeTasks(data, [tasks[8]!.id], ctx).tasks;

  it('assigns each open task to the first tier it matches', () => {
    expect(all.map((t) => focusTier(t, TODAY))).toEqual([
      'overdue',
      'today',
      'importantSoon',
      'important',
      'important',
      'soon',
      null,
      null,
      null,
    ]);
  });

  it('groups tiers in a fixed order and excludes tasks that need no attention', () => {
    const groups = focusGroups(all, TODAY);
    expect(groups.map((g) => g.tier)).toEqual(['overdue', 'today', 'importantSoon', 'important', 'soon']);
    expect(groups.flatMap((g) => g.tasks.map((t) => t.title))).toEqual([
      'low-overdue',
      'today',
      'high-soon',
      'high-later', // dated tasks before undated within a tier
      'high-nodate',
      'normal-soon',
    ]);
  });

  it('orders within a tier by due date, then importance, then age', () => {
    const { data } = seed([
      { title: 'later-low', due: d(-1), importance: 'low' },
      { title: 'earlier', due: d(-4) },
      { title: 'later-high', due: d(-1), importance: 'high' },
      { title: 'later-low-2', due: d(-1), importance: 'low' },
    ]);
    const [overdue] = focusGroups(data.tasks, TODAY);
    expect(overdue!.tasks.map((t) => t.title)).toEqual(['earlier', 'later-high', 'later-low', 'later-low-2']);
  });

  it('returns no groups for an empty list', () => {
    expect(focusGroups([], TODAY)).toEqual([]);
  });
});
