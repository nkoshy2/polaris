import { useEffect, useMemo, useState } from 'preact/hooks';
import { summarize } from '../domain/progress';
import { DEFAULT_QUERY, activeFilterCount, runQuery, type Query } from '../domain/query';
import type { Importance } from '../domain/types';
import { useStore, useStoreState } from '../state/context';
import { Icon } from './Icon';
import { QuickAdd } from './QuickAdd';
import { TaskList } from './TaskList';
import { useUI } from './uiContext';

interface Props {
  query: Query;
  onQueryChange: (q: Query) => void;
}

const STATUS_LABELS = { open: 'Open', completed: 'Completed', all: 'Open and completed' } as const;
const DUE_LABELS = {
  any: 'Any date',
  overdue: 'Overdue',
  today: 'Due today',
  soon: 'Next 7 days (after today)',
  none: 'No due date',
} as const;
const IMPORTANCE_LABELS = { any: 'Any importance', high: 'High', normal: 'Normal', low: 'Low' } as const;
const SORT_LABELS = {
  recommended: 'Recommended',
  due: 'Due date',
  importance: 'Importance',
  created: 'Date created',
  title: 'Title',
} as const;

export function TasksView({ query, onQueryChange }: Props) {
  const store = useStore();
  const { data, today, readOnly } = useStoreState();
  const ui = useUI();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState('');
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

  const chips: { label: string; clear: Partial<Query> }[] = [];
  if (query.text.trim()) chips.push({ label: `Search: “${query.text.trim()}”`, clear: { text: '' } });
  if (query.status !== DEFAULT_QUERY.status) chips.push({ label: `Status: ${STATUS_LABELS[query.status]}`, clear: { status: DEFAULT_QUERY.status } });
  if (query.due !== 'any') chips.push({ label: `Due: ${DUE_LABELS[query.due]}`, clear: { due: 'any' } });
  if (query.importance !== 'any') chips.push({ label: `Importance: ${IMPORTANCE_LABELS[query.importance]}`, clear: { importance: 'any' } });
  if (query.tag !== 'any') chips.push({ label: `Tag: ${title}`, clear: { tag: 'any' } });

  return (
    <>
      <div class="view-header">
        <h1 id="main-heading" tabIndex={-1}>
          {title}
        </h1>
        <p class="muted" id="scope-progress">
          {scope.total === 0
            ? 'No tasks here yet.'
            : `${scope.completed} of ${plural(scope.total)} completed (${scope.percentComplete}%) · ${scope.open} open`}
          {scope.total > 0 && <span class="hint"> — counts tasks, not steps</span>}
        </p>
      </div>

      <QuickAdd tag={tag} />

      <section class="filters" aria-label="Filter and sort">
        <div class="filter-grid">
          <div>
            <label for="f-status">Status</label>
            <select id="f-status" value={query.status} onChange={(e) => set({ status: e.currentTarget.value as Query['status'] })}>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label for="f-due">Due</label>
            <select id="f-due" value={query.due} onChange={(e) => set({ due: e.currentTarget.value as Query['due'] })}>
              {Object.entries(DUE_LABELS).map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label for="f-importance">Importance</label>
            <select id="f-importance"
              value={query.importance}
              onChange={(e) => set({ importance: e.currentTarget.value as Importance | 'any' })}
            >
              {Object.entries(IMPORTANCE_LABELS).map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label for="f-tag">Tag</label>
            <select id="f-tag" value={query.tag} onChange={(e) => set({ tag: e.currentTarget.value })}>
              <option value="any">Any tag</option>
              <option value="untagged">Untagged</option>
              {data.tags.map((t) => (
                <option value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label for="f-sort">Sort by</label>
            <select id="f-sort" value={query.sort} onChange={(e) => set({ sort: e.currentTarget.value as Query['sort'] })}>
              {Object.entries(SORT_LABELS).map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label for="f-order">Order</label>
            <select id="f-order" value={query.dir} onChange={(e) => set({ dir: e.currentTarget.value as Query['dir'] })}>
              <option value="asc">{query.sort === 'title' ? 'A to Z' : query.sort === 'importance' ? 'Highest first' : query.sort === 'created' ? 'Oldest first' : query.sort === 'due' ? 'Soonest first' : 'Default'}</option>
              <option value="desc">{query.sort === 'title' ? 'Z to A' : query.sort === 'importance' ? 'Lowest first' : query.sort === 'created' ? 'Newest first' : query.sort === 'due' ? 'Latest first' : 'Reversed'}</option>
            </select>
          </div>
        </div>

        {filters > 0 && (
          <div class="active-filters">
            <span class="sr-only">Active filters:</span>
            <ul>
              {chips.map((chip) => (
                <li key={chip.label}>
                  <button type="button" class="chip" onClick={() => set(chip.clear)} aria-label={`Remove filter ${chip.label}`}>
                    {chip.label}
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" class="link" onClick={() => onQueryChange({ ...DEFAULT_QUERY, sort: query.sort, dir: query.dir })}>
              Clear all filters
            </button>
          </div>
        )}
      </section>

      <div class="list-toolbar">
        <p class="result-count" role="status">
          {tasks.length === 0 ? 'No matching tasks' : `Showing ${plural(tasks.length)}`}
        </p>
        {tasks.length > 0 && !readOnly && (
          <button
            type="button"
            id="select-toggle"
            class="button"
            aria-pressed={selecting}
            onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          >
            {selecting ? 'Done selecting' : 'Select'}
          </button>
        )}
      </div>

      {selecting && (
        <div class="bulk-bar" role="group" aria-label="Bulk actions">
          <label class="select-all">
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === tasks.length}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && selected.size < tasks.length;
              }}
              onChange={(e) => setSelected(e.currentTarget.checked ? new Set(tasks.map((t) => t.id)) : new Set())}
            />
            <span>{selected.size === 0 ? 'Select all shown' : `${selected.size} selected`}</span>
          </label>
          <div class="bulk-actions">
            <button type="button" class="button" disabled={!selected.size} onClick={() => bulk(() => store.setCompleted(ids, true), `Completed ${plural(ids.length)}.`)}>
              Complete
            </button>
            <button type="button" class="button" disabled={!selected.size} onClick={() => bulk(() => store.setCompleted(ids, false), `Reopened ${plural(ids.length)}.`)}>
              Reopen
            </button>
            {data.tags.length > 0 && (
              <span class="inline-field">
                <label for="bulk-tag" class="sr-only">
                  Tag to add
                </label>
                <select id="bulk-tag" value={bulkTag} onChange={(e) => setBulkTag(e.currentTarget.value)}>
                  <option value="">Add tag…</option>
                  {data.tags.map((t) => (
                    <option value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  class="button"
                  disabled={!selected.size || !bulkTag}
                  onClick={() => {
                    const name = data.tags.find((t) => t.id === bulkTag)?.name;
                    bulk(() => store.addTagToTasks(ids, bulkTag), `Tagged ${plural(ids.length)} “${name}”.`);
                    setBulkTag('');
                  }}
                >
                  Apply
                </button>
              </span>
            )}
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
              <button type="button" class="button danger-outline" disabled={!selected.size} onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            )}
          </div>
        </div>
      )}

      {tasks.length > 0 ? (
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
                  Try removing a filter, or{' '}
                  <button
                    type="button"
                    class="link"
                    onClick={() => onQueryChange({ ...DEFAULT_QUERY, tag: query.tag, sort: query.sort, dir: query.dir })}
                  >
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
