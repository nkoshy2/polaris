import { useMemo, useState } from 'preact/hooks';
import { addDays, formatDate } from '../domain/dates';
import { SOON_DAYS, focusGroups, type FocusTier } from '../domain/priority';
import { summarize } from '../domain/progress';
import type { DueFilter } from '../domain/query';
import type { Task } from '../domain/types';
import { useStoreState } from '../state/context';
import { QuickAdd } from './QuickAdd';
import { TaskList } from './TaskList';

interface Props {
  /** Jump to All tasks with a due filter applied. */
  onShow: (due?: DueFilter) => void;
}

/**
 * Focus shows the five tiers from domain/priority.ts as three lanes: Now
 * (overdue, due today), This week (high importance first, then the rest) and
 * Important (high importance, not due this week).
 */
const LANES: { id: string; title: string; groups: { tier: FocusTier; label: string }[] }[] = [
  { id: 'now', title: 'Now', groups: [{ tier: 'overdue', label: 'Overdue' }, { tier: 'today', label: 'Due today' }] },
  {
    id: 'week',
    title: 'This week',
    groups: [{ tier: 'importantSoon', label: 'High importance' }, { tier: 'soon', label: 'Everything else' }],
  },
  { id: 'important', title: 'Important', groups: [{ tier: 'important', label: 'Not due this week' }] },
];

export function FocusView({ onShow }: Props) {
  const { data, today } = useStoreState();
  const [rulesOpen, setRulesOpen] = useState(false);
  const groups = useMemo(() => focusGroups(data.tasks, today), [data.tasks, today]);
  const s = useMemo(() => summarize(data.tasks, today), [data.tasks, today]);
  const byTier = new Map<FocusTier, Task[]>(groups.map((g) => [g.tier, g.tasks]));
  const weekEnd = formatDate(addDays(today, SOON_DAYS), today);

  const blurbs: Record<string, string> = {
    now: 'Overdue or due today',
    week: `Due by ${weekEnd}`,
    important: 'High importance, not due this week',
  };

  // Each linked count equals the length of the list it opens (see query tests).
  const countLink = (n: number, label: string, due: DueFilter, alert = false) => (
    <button type="button" class={`inline-link${alert && n > 0 ? ' is-alert' : ''}`} onClick={() => onShow(due)}>
      {n} {label}
    </button>
  );

  return (
    <>
      <div class="focus-head">
        <div class="view-header">
          <h1 id="main-heading" tabIndex={-1}>
            Focus
          </h1>
          <p class="focus-summary">
            {data.tasks.length === 0 ? (
              'No tasks yet. Add one with a due date or high importance and it will show up here.'
            ) : (
              <>
                You have {countLink(s.overdue, 'overdue', 'overdue', true)} and {countLink(s.dueToday, 'due today', 'today')},
                with {countLink(s.dueSoon, 'more', 'soon')} due by {weekEnd}.
              </>
            )}
          </p>
        </div>
        <QuickAdd inFocus layout="card" />
      </div>

      {groups.length === 0 && data.tasks.length > 0 && (
        <div class="empty">
          <p class="empty-title">Nothing needs attention right now.</p>
          <p>
            No open tasks are overdue, due within {SOON_DAYS} days, or marked high importance.{' '}
            {s.open > 0 && (
              <button type="button" class="link" onClick={() => onShow()}>
                See all {s.open} open {s.open === 1 ? 'task' : 'tasks'}
              </button>
            )}
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div class="lanes">
          {LANES.map((lane) => {
            const laneGroups = lane.groups.filter((g) => byTier.has(g.tier));
            const count = laneGroups.reduce((n, g) => n + byTier.get(g.tier)!.length, 0);
            return (
              <section key={lane.id} class={`lane lane-${lane.id}`} aria-labelledby={`lane-${lane.id}`}>
                <header class="lane-header">
                  <span class="lane-count" aria-hidden="true">
                    {count}
                  </span>
                  <div>
                    <h2 id={`lane-${lane.id}`}>
                      {lane.title}
                      <span class="sr-only"> ({count})</span>
                    </h2>
                    <p class="lane-blurb">{blurbs[lane.id]}</p>
                  </div>
                </header>
                {laneGroups.map((g) => (
                  <div key={g.tier} class="lane-group">
                    <h3 id={`tier-${g.tier}`} class="lane-group-title">
                      {g.label}
                    </h3>
                    <TaskList tasks={byTier.get(g.tier)!} labelledBy={`tier-${g.tier}`} variant="card" tier={g.tier} />
                  </div>
                ))}
                {count === 0 && <p class="lane-empty">Nothing here. Nice.</p>}
              </section>
            );
          })}
        </div>
      )}

      <div class="explainer">
        <button
          type="button"
          class="button ghost"
          aria-expanded={rulesOpen}
          aria-controls="focus-rules"
          onClick={() => setRulesOpen(!rulesOpen)}
        >
          How the lanes are decided
        </button>
        {rulesOpen && (
          <div id="focus-rules" class="explainer-body">
            <p>
              <strong>Now</strong> — overdue, then due today.
            </p>
            <p>
              <strong>This week</strong> — high importance due within {SOON_DAYS} days, then anything else due within{' '}
              {SOON_DAYS} days.
            </p>
            <p>
              <strong>Important</strong> — high importance with no date in the next {SOON_DAYS} days.
            </p>
            <p class="muted">
              Each task appears once, in the first group it matches. Inside a group: earliest due date, then
              importance, then oldest. <strong>Importance</strong> is how much a task matters and is set by you;
              urgency comes only from the due date. Everything else is in All tasks.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
