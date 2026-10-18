import { useMemo } from 'preact/hooks';
import { FOCUS_TIERS, SOON_DAYS, focusGroups } from '../domain/priority';
import { summarize } from '../domain/progress';
import type { DueFilter } from '../domain/query';
import { useStoreState } from '../state/context';
import { QuickAdd } from './QuickAdd';
import { TaskList } from './TaskList';

interface Props {
  /** Jump to All tasks with a due filter (or completed status) applied. */
  onShow: (due?: DueFilter) => void;
}

export function FocusView({ onShow }: Props) {
  const { data, today } = useStoreState();
  const groups = useMemo(() => focusGroups(data.tasks, today), [data.tasks, today]);
  const s = useMemo(() => summarize(data.tasks, today), [data.tasks, today]);

  // Each linked count equals the length of the list it opens (see query tests).
  const stats: { label: string; value: number; due?: DueFilter }[] = [
    { label: 'Overdue', value: s.overdue, due: 'overdue' },
    { label: 'Due today', value: s.dueToday, due: 'today' },
    { label: `Due in the next ${SOON_DAYS} days`, value: s.dueSoon, due: 'soon' },
    { label: 'Completed in the last 7 days', value: s.completedLast7Days },
  ];

  return (
    <>
      <div class="view-header">
        <h1 id="main-heading" tabIndex={-1}>
          Focus
        </h1>
        <p class="muted">What needs your attention now, in a fixed, explainable order.</p>
      </div>

      <section aria-label="Overview" class="stats">
        <ul>
          {stats.map((stat) => (
            <li key={stat.label}>
              {stat.due ? (
                <button
                  type="button"
                  class={`stat${stat.due === 'overdue' && stat.value > 0 ? ' stat-alert' : ''}`}
                  onClick={() => onShow(stat.due)}
                >
                  <span class="stat-value">{stat.value}</span>
                  <span class="stat-label">{stat.label}</span>
                  <span class="sr-only">, show these tasks</span>
                </button>
              ) : (
                <div class="stat stat-static">
                  <span class="stat-value">{stat.value}</span>
                  <span class="stat-label">{stat.label}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <QuickAdd inFocus />

      {groups.length === 0 ? (
        <div class="empty">
          {data.tasks.length === 0 ? (
            <>
              <p class="empty-title">No tasks yet.</p>
              <p>Add your first task above. Give it a due date or mark it high importance and it will show up here.</p>
            </>
          ) : (
            <>
              <p class="empty-title">Nothing needs attention right now.</p>
              <p>
                No open tasks are overdue, due within {SOON_DAYS} days, or marked high importance.{' '}
                {s.open > 0 && (
                  <button type="button" class="link" onClick={() => onShow()}>
                    See all {s.open} open {s.open === 1 ? 'task' : 'tasks'}
                  </button>
                )}
              </p>
            </>
          )}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.tier} class="group" aria-labelledby={`tier-${group.tier}`}>
            <h2 id={`tier-${group.tier}`} class={`group-title tier-${group.tier}`}>
              {group.label} <span class="count">({group.tasks.length})</span>
            </h2>
            <TaskList tasks={group.tasks} labelledBy={`tier-${group.tier}`} />
          </section>
        ))
      )}

      <details class="explainer">
        <summary>How Focus decides what to show</summary>
        <p>
          Open tasks appear in the first group they match, in this order. Inside each group, tasks with the
          earliest due date come first, then higher importance, then older tasks.
        </p>
        <ol>
          {FOCUS_TIERS.map((t) => (
            <li key={t.tier}>{t.label}</li>
          ))}
        </ol>
        <p>
          <strong>Importance</strong> is how much a task matters and is set by you. <strong>Urgency</strong> comes only
          from the due date. Open tasks that match none of these groups are listed under All tasks.
        </p>
      </details>
    </>
  );
}
