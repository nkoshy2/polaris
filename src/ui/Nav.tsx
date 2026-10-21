import { useMemo } from 'preact/hooks';
import { focusTier } from '../domain/priority';
import { useStoreState } from '../state/context';

export type Scope = { view: 'focus' } | { view: 'tasks'; tag: string };

interface Props {
  current: Scope;
  onNavigate: (scope: Scope) => void;
}

/**
 * The two views, as a pill switch in the header. Tags are a filter of All
 * tasks (the "tagged …" word in its filter sentence), not separate views.
 * Counts are of open tasks only.
 */
export function Nav({ current, onNavigate }: Props) {
  const { data, today } = useStoreState();

  const counts = useMemo(() => {
    let all = 0;
    let focus = 0;
    for (const t of data.tasks) {
      if (t.completedAt) continue;
      all++;
      if (focusTier(t, today)) focus++;
    }
    return { all, focus };
  }, [data.tasks, today]);

  const item = (scope: Scope, label: string, count: number) => (
    <li>
      <a
        href={scope.view === 'focus' ? '#focus' : '#tasks/any'}
        class="nav-link"
        aria-current={scope.view === current.view ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(scope);
        }}
      >
        {label}
        <span class="nav-count">
          {count}
          <span class="sr-only"> open</span>
        </span>
      </a>
    </li>
  );

  return (
    <nav class="view-switch" aria-label="Views">
      <ul>
        {item({ view: 'focus' }, 'Focus', counts.focus)}
        {item({ view: 'tasks', tag: 'any' }, 'All tasks', counts.all)}
      </ul>
    </nav>
  );
}
