import { useMemo } from 'preact/hooks';
import { focusTier } from '../domain/priority';
import { useStoreState } from '../state/context';
import { Icon } from './Icon';

export type Scope = { view: 'focus' } | { view: 'tasks'; tag: string };

interface Props {
  current: Scope;
  open: boolean;
  onNavigate: (scope: Scope) => void;
  onManageTags: () => void;
}

/** Primary navigation. Counts are of open tasks only. */
export function Nav({ current, open, onNavigate, onManageTags }: Props) {
  const { data, today } = useStoreState();

  const counts = useMemo(() => {
    const byTag = new Map<string, number>();
    let all = 0;
    let untagged = 0;
    let focus = 0;
    for (const t of data.tasks) {
      if (t.completedAt) continue;
      all++;
      if (focusTier(t, today)) focus++;
      if (t.tagIds.length === 0) untagged++;
      for (const id of t.tagIds) byTag.set(id, (byTag.get(id) ?? 0) + 1);
    }
    return { all, untagged, focus, byTag };
  }, [data.tasks, today]);

  const isCurrent = (scope: Scope) =>
    scope.view === current.view && (scope.view === 'focus' || (current.view === 'tasks' && scope.tag === current.tag));

  const item = (scope: Scope, label: string, count: number, icon: Parameters<typeof Icon>[0]['name']) => (
    <li>
      <a
        href={scope.view === 'focus' ? '#focus' : `#tasks/${encodeURIComponent(scope.tag)}`}
        class="nav-link"
        aria-current={isCurrent(scope) ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(scope);
        }}
      >
        <Icon name={icon} />
        <span class="nav-label">{label}</span>
        <span class="nav-count">
          {count}
          <span class="sr-only"> open</span>
        </span>
      </a>
    </li>
  );

  return (
    <nav id="primary-nav" class={`sidebar${open ? ' is-open' : ''}`} aria-label="Views">
      <ul class="nav-list">
        {item({ view: 'focus' }, 'Focus', counts.focus, 'focus')}
        {item({ view: 'tasks', tag: 'any' }, 'All tasks', counts.all, 'list')}
      </ul>
      <div class="nav-section">
        <h2 class="nav-heading" id="tags-heading">
          Tags
        </h2>
        <button type="button" class="link small" onClick={onManageTags}>
          Manage
        </button>
      </div>
      <ul class="nav-list" aria-labelledby="tags-heading">
        {data.tags.map((tag) => item({ view: 'tasks', tag: tag.id }, tag.name, counts.byTag.get(tag.id) ?? 0, 'tag'))}
        {item({ view: 'tasks', tag: 'untagged' }, 'Untagged', counts.untagged, 'inbox')}
      </ul>
      {data.tags.length === 0 && <p class="hint nav-hint">Create tags to group tasks by project, area or anything else.</p>}
    </nav>
  );
}
