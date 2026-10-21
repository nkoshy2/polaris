import { useMemo } from 'preact/hooks';
import type { FocusTier } from '../domain/priority';
import type { Task } from '../domain/types';
import { useStore, useStoreState } from '../state/context';
import { TaskItem } from './TaskItem';
import { useUI } from './uiContext';

interface Props {
  tasks: Task[];
  labelledBy?: string;
  label?: string;
  variant?: 'card' | 'row';
  /** The Focus tier every task in this list belongs to. */
  tier?: FocusTier;
  selecting?: boolean;
  selected?: Set<string>;
  onSelect?: (id: string, selected: boolean) => void;
}

export function TaskList({ tasks, labelledBy, label, variant = 'row', tier, selecting = false, selected, onSelect }: Props) {
  const store = useStore();
  const { data, today } = useStoreState();
  const ui = useUI();
  const tagsById = useMemo(() => new Map(data.tags.map((t) => [t.id, t])), [data.tags]);

  const toggleComplete = (task: Task) => {
    const index = tasks.findIndex((t) => t.id === task.id);
    const completing = !task.completedAt;
    const ok = ui.attempt(() => store.setCompleted([task.id], completing));
    if (!ok) return;
    ui.notify(`${completing ? 'Completed' : 'Reopened'} “${task.title}”.`, { undoable: true });
    // If the row leaves this view, keep keyboard focus in the list.
    const neighbour = tasks[index + 1] ?? tasks[index - 1];
    ui.focusTask(task.id, neighbour ? `[data-task-id="${neighbour.id}"] .task-check` : undefined);
  };

  const toggleStep = (task: Task, stepId: string, done: boolean) => {
    const reopensTask = !done && !!task.completedAt;
    if (ui.attempt(() => store.setStepDone(task.id, stepId, done)) && reopensTask) {
      ui.notify(`Reopened “${task.title}” because a step is unfinished.`, { undoable: true });
    }
  };

  return (
    <ul class={`task-list task-list-${variant}`} aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          tagsById={tagsById}
          today={today}
          variant={variant}
          tier={tier}
          selecting={selecting}
          selected={selected?.has(task.id) ?? false}
          onSelect={(id, s) => onSelect?.(id, s)}
          onToggleComplete={toggleComplete}
          onToggleStep={toggleStep}
          onOpen={(t) => ui.openEditor({ taskId: t.id })}
        />
      ))}
    </ul>
  );
}
