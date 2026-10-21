import { useEffect, useMemo, useState } from 'preact/hooks';
import { summarize } from '../domain/progress';
import { DEFAULT_QUERY, activeFilterCount, runQuery, type Query } from '../domain/query';
import { useStore, useStoreState } from '../state/context';
import { Icon } from './Icon';
import { Menu, type MenuOption } from './Menu';
import { QuickAdd } from './QuickAdd';
import { TaskList } from './TaskList';
import { useUI } from './uiContext';

interface Props {
  query: Query;
  onQueryChange: (q: Query) => void;
}

/** Each filter value has a menu label and the word it reads as in the filter sentence. */
type Choice<V extends string> = MenuOption<V> & { word: string };

const STATUS: Choice<Query['status']>[] = [
  { value: 'open', label: 'Open', word: 'open' },
  { value: 'completed', label: 'Completed', word: 'completed' },
  { value: 'all', label: 'Open and completed', word: 'all' },
];
const DUE: Choice<Query['due']>[] = [
  { value: 'any', label: 'Any time', word: 'any time' },
  { value: 'overdue', label: 'Overdue', word: 'before today' },
  { value: 'today', label: 'Today', word: 'today' },
  { value: 'soon', label: 'Next 7 days (after today)', word: 'this week' },
  { value: 'none', label: 'No due date', word: 'with no date' },
];
const IMPORTANCE: Choice<Query['importance']>[] = [
  { value: 'any', label: 'Any', word: 'any' },
  { value: 'high', label: 'High', word: 'high' },
  { value: 'normal', label: 'Normal', word: 'normal' },
  { value: 'low', label: 'Low', word: 'low' },
];
const SORT: Choice<Query['sort']>[] = [
  { value: 'recommended', label: 'Recommended', word: 'recommended' },
  { value: 'due', label: 'Due date', word: 'due date' },
  { value: 'importance', label: 'Importance', word: 'importance' },
  { value: 'created', label: 'Date created', word: 'date created' },
  { value: 'title', label: 'Title', word: 'title' },
];
const ORDER: Record<Query['sort'], [asc: string, desc: string]> = {
  recommended: ['usual order', 'reversed'],
  due: ['soonest first', 'latest first'],
  importance: ['highest first', 'lowest first'],
  created: ['oldest first', 'newest first'],
  title: ['A to Z', 'Z to A'],
};

export function TasksView({ query, onQueryChange }: Props) {
  const store = useStore();
  const { data, today, readOnly } = useStoreState();
  const ui = useUI();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tasks = useMemo(() => runQuery(data, query, today), [data, query, today]);
  const tag = data.tags.find((t) => t.id === query.tag);
  const scopeTasks = useMemo(
    () =>
      query.tag === 'any'
        ? data.tasks
        : query.tag === 'untagged'
          ? data.tasks.filter((t) => t.tagIds.length === 0)
          : data.tasks.filter((t) => t.tagIds.includes(query.tag)),
    [data.tasks, query.tag],
  );
  const scope = useMemo(() => summarize(scopeTasks, today), [scopeTasks, today]);
  const filters = activeFilterCount(query);
  const title = tag ? tag.name : query.tag === 'untagged' ? 'Untagged' : 'All tasks';

  // Drop selections that are no longer visible so bulk actions only touch what the user can see.
  useEffect(() => {
    const visible = new Set(tasks.map((t) => t.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const set = (patch: Partial<Query>) => onQueryChange({ ...query, ...patch });
  const reset = (keepTag = false) =>
    onQueryChange({ ...DEFAULT_QUERY, sort: query.sort, dir: query.dir, tag: keepTag ? query.tag : 'any' });
  const ids = [...selected];
  const plural = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
    setConfirmDelete(false);
  };

  const bulk = (fn: () => void, message: string) => {
    if (ui.attempt(fn)) {
      ui.notify(message, { undoable: true });
      exitSelection();
      ui.focusTask(null, '#select-toggle');
    }
  };

  const tagChoices: Choice<string>[] = [
    { value: 'any', label: 'Any tag', word: 'anything' },
    { value: 'untagged', label: 'Untagged', word: 'nothing' },
    ...data.tags.map((t) => ({ value: t.id, label: t.name, word: t.name })),
  ];

  /** One word of the filter sentence: a button that opens the choices for that filter. */
  const pill = <V extends string>(name: string, choices: Choice<V>[], value: V, onPick: (v: V) => void, isDefault: boolean) => {
    const choice = choices.find((c) => c.value === value) ?? choices[0]!;
    return (
      <Menu
        // The name contains the visible word so voice control can target it (WCAG 2.5.3).
        label={`${name}: ${choice.word}`}
        class={`sentence-pill${isDefault ? '' : ' is-active'}`}
        options={choices}
        current={value}
        onPick={onPick}
      >
        {choice.word}
      </Menu>
    );
  };
  const [ascLabel, descLabel] = ORDER[query.sort];

  return (
    <>
      <div class="tasks-head">
        <div class="view-header">
          <h1 id="main-heading" tabIndex={-1}>
            {title}
          </h1>
          <div class="progress-line">
            {scope.total > 0 && (
              <span class="bar" aria-hidden="true">
                <span style={{ width: `${scope.percentComplete}%` }} />
              </span>
            )}
            <p class="muted" id="scope-progress">
              {scope.total === 0
                ? 'No tasks here yet.'
                : `${scope.completed} of ${plural(scope.total)} completed (${scope.percentComplete}%) · ${scope.open} open`}
              {scope.total > 0 && <span class="sr-only"> — counts tasks, not steps</span>}
            </p>
          </div>
        </div>
        <QuickAdd tag={tag} layout="bar" />
      </div>

      <section class="sentence" aria-label="Filter and sort">
        <span>Show</span>
        {pill('Status', STATUS, query.status, (status) => set({ status }), query.status === DEFAULT_QUERY.status)}
        <span>tasks due</span>
        {pill('Due', DUE, query.due, (due) => set({ due }), query.due === 'any')}
        <span>with</span>
        {pill('Importance', IMPORTANCE, query.importance, (importance) => set({ importance }), query.importance === 'any')}
        <span>importance, tagged</span>
        {pill('Tag', tagChoices, query.tag, (t) => set({ tag: t }), query.tag === 'any')}
        {query.text.trim() && (
          <>
            <span>matching</span>
            <button
              type="button"
              class="sentence-pill is-active"
              aria-label={`Remove filter Search: “${query.text.trim()}”`}
              onClick={() => set({ text: '' })}
            >
              “{query.text.trim()}”
              <Icon name="close" size={16} />
            </button>
          </>
        )}
        <span>sorted by</span>
        {pill('Sort by', SORT, query.sort, (sort) => set({ sort, dir: 'asc' }), true)}
        {pill(
          'Order',
          [
            { value: 'asc', label: ascLabel, word: ascLabel },
            { value: 'desc', label: descLabel, word: descLabel },
          ],
          query.dir,
          (dir) => set({ dir }),
          query.dir === 'asc',
        )}
        {filters > 0 && (
          <button type="button" class="button ghost sentence-reset" onClick={() => reset()}>
            Reset filters
          </button>
        )}
      </section>

      <div class={`list-toolbar${selecting ? ' is-selecting' : ''}`}>
        {selecting ? (
          <div class="bulk-bar" role="group" aria-label="Bulk actions">
            <label class="select-all">
              <input
                type="checkbox"
                class="task-check select-check"
                checked={selected.size > 0 && selected.size === tasks.length}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < tasks.length;
                }}
                onChange={(e) => setSelected(e.currentTarget.checked ? new Set(tasks.map((t) => t.id)) : new Set())}
              />
              <span>{selected.size === 0 ? 'Select all shown' : `${selected.size} selected`}</span>
            </label>
            <div class="bulk-actions">
              {confirmDelete ? (
                <span class="confirm-inline" role="alert">
                  Delete {plural(ids.length)}?
                  <button type="button" class="button danger" onClick={() => bulk(() => store.deleteTasks(ids), `Deleted ${plural(ids.length)}.`)}>
                    Yes, delete
                  </button>
                  <button type="button" class="button" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" class="button" disabled={!selected.size} onClick={() => bulk(() => store.setCompleted(ids, true), `Completed ${plural(ids.length)}.`)}>
                    Complete
                  </button>
                  <button type="button" class="button" disabled={!selected.size} onClick={() => bulk(() => store.setCompleted(ids, false), `Reopened ${plural(ids.length)}.`)}>
                    Reopen
                  </button>
                  {data.tags.length > 0 && (
                    <Menu
                      label="Add tag"
                      class="button"
                      align="end"
                      disabled={!selected.size}
                      options={data.tags.map((t) => ({ value: t.id, label: t.name }))}
                      onPick={(id) => {
                        const name = data.tags.find((t) => t.id === id)?.name;
                        bulk(() => store.addTagToTasks(ids, id), `Tagged ${plural(ids.length)} “${name}”.`);
                      }}
                    >
                      Add tag
                    </Menu>
                  )}
                  <button type="button" class="button danger-outline" disabled={!selected.size} onClick={() => setConfirmDelete(true)}>
                    Delete…
                  </button>
                </>
              )}
              <button type="button" id="select-toggle" class="button primary dark" onClick={exitSelection}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p class="result-count" role="status">
              {tasks.length === 0 ? 'No matching tasks' : `Showing ${plural(tasks.length)}`}
            </p>
            {tasks.length > 0 && !readOnly && (
              <button type="button" id="select-toggle" class="button" onClick={() => setSelecting(true)}>
                Select
              </button>
            )}
          </>
        )}
      </div>

      {tasks.length > 0 ? (
        <div class="task-table">
          <div class="task-table-head" aria-hidden="true">
            <span />
            <span>Task</span>
            <span>Due</span>
            <span>Importance</span>
            <span>Tags</span>
          </div>
          <TaskList
            tasks={tasks}
            labelledBy="main-heading"
            selecting={selecting}
            selected={selected}
            onSelect={(id, on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
        </div>
      ) : (
        <div class="empty">
          {scope.total === 0 ? (
            <p>
              {tag
                ? `No tasks tagged “${tag.name}” yet. Add one above.`
                : query.tag === 'untagged'
                  ? 'Every task has at least one tag.'
                  : 'Nothing here yet. Add a task above.'}
            </p>
          ) : (
            <>
              <p class="empty-title">
                {query.status === 'open' && scope.open === 0 ? 'Everything here is completed.' : 'No tasks match.'}
              </p>
              {filters > (query.tag !== 'any' ? 1 : 0) && (
                <p>
                  Change a word in the sentence above, or{' '}
                  <button type="button" class="link" onClick={() => reset(true)}>
                    {query.tag === 'any' ? 'clear all filters' : 'clear the other filters'}
                  </button>
                  .
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
