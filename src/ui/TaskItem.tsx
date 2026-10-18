import { useState } from 'preact/hooks';
import { formatDate, localDate } from '../domain/dates';
import { dueDescription, urgencyOf } from '../domain/priority';
import { stepProgress } from '../domain/progress';
import type { Tag, Task } from '../domain/types';
import { Icon } from './Icon';

export interface TaskItemProps {
  task: Task;
  tagsById: Map<string, Tag>;
  today: string;
  /** In selection mode the row's checkbox selects instead of completing. */
  selecting: boolean;
  selected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onToggleComplete: (task: Task) => void;
  onToggleStep: (task: Task, stepId: string, done: boolean) => void;
  onOpen: (task: Task) => void;
}

export function TaskItem(props: TaskItemProps) {
  const { task, tagsById, today, selecting, selected } = props;
  const [showSteps, setShowSteps] = useState(false);
  const done = !!task.completedAt;
  const urgency = urgencyOf(task, today);
  const progress = stepProgress(task);
  const metaId = `meta-${task.id}`;
  const stepsId = `steps-${task.id}`;
  const tags = task.tagIds.map((id) => tagsById.get(id)).filter((t): t is Tag => !!t);

  return (
    <li class={`task${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`} data-task-id={task.id}>
      <div class="task-main">
        {selecting ? (
          <input
            type="checkbox"
            class="task-check select-check"
            checked={selected}
            aria-label={`Select “${task.title}”`}
            onChange={(e) => props.onSelect(task.id, e.currentTarget.checked)}
          />
        ) : (
          <input
            type="checkbox"
            class="task-check complete-check"
            checked={done}
            aria-label={`Complete “${task.title}”`}
            aria-describedby={metaId}
            onChange={() => props.onToggleComplete(task)}
          />
        )}
        <div class="task-body">
          <button type="button" class="task-title" aria-haspopup="dialog" aria-describedby={metaId} onClick={() => props.onOpen(task)}>
            {task.title}
          </button>
          <ul class="task-meta" id={metaId} aria-label="Details">
            {done && <li class="meta meta-done">Completed {formatDate(localDate(new Date(task.completedAt!)), today)}</li>}
            {task.due && (
              <li class={`meta meta-due urgency-${urgency}`}>
                <Icon name={urgency === 'overdue' ? 'alert' : 'calendar'} size={14} />
                <span>
                  {done ? 'Was due' : dueDescription(task, today)} · {formatDate(task.due, today)}
                </span>
              </li>
            )}
            {task.importance !== 'normal' && (
              <li class={`meta meta-importance importance-${task.importance}`}>
                <Icon name={task.importance === 'high' ? 'flag' : 'down'} size={14} />
                <span>{task.importance === 'high' ? 'High importance' : 'Low importance'}</span>
              </li>
            )}
            {progress && (
              <li class="meta">
                <button
                  type="button"
                  class="steps-toggle"
                  aria-expanded={showSteps}
                  aria-controls={stepsId}
                  onClick={() => setShowSteps(!showSteps)}
                >
                  <Icon name="steps" size={14} />
                  <span>
                    {progress.done} of {progress.total} steps
                  </span>
                  <span class="sr-only">{showSteps ? ', hide' : ', show'}</span>
                </button>
              </li>
            )}
            {tags.map((tag) => (
              <li class="meta meta-tag" key={tag.id}>
                <Icon name="tag" size={14} />
                <span>{tag.name}</span>
              </li>
            ))}
          </ul>
          {progress && showSteps && (
            <ul class="step-list" id={stepsId} aria-label={`Steps for “${task.title}”`}>
              {task.steps.map((step) => (
                <li key={step.id}>
                  <label class="step">
                    <input
                      type="checkbox"
                      checked={step.done}
                      onChange={(e) => props.onToggleStep(task, step.id, e.currentTarget.checked)}
                    />
                    <span class={step.done ? 'step-done' : undefined}>{step.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
