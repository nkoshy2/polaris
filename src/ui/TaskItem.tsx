import { useState } from 'preact/hooks';
import { addDays, formatDate, localDate } from '../domain/dates';
import { dueDescription, urgencyOf, type FocusTier } from '../domain/priority';
import { stepProgress } from '../domain/progress';
import { linkedKinds } from '../domain/sync';
import { SOURCE_NAMES } from '../state/connector';
import type { Tag, Task } from '../domain/types';
import { Icon } from './Icon';

export interface TaskItemProps {
  task: Task;
  tagsById: Map<string, Tag>;
  today: string;
  /**
   * 'card' is the compact Focus layout, which leaves out what the task's
   * group already says (`tier`). 'row' is the All tasks table layout.
   */
  variant: 'card' | 'row';
  tier?: FocusTier;
  /** In selection mode the row's checkbox selects instead of completing. */
  selecting: boolean;
  selected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onToggleComplete: (task: Task) => void;
  onToggleStep: (task: Task, stepId: string, done: boolean) => void;
  onOpen: (task: Task) => void;
}

const IMPORTANCE_LABELS = { high: 'High', normal: 'Normal', low: 'Low' } as const;

export function TaskItem(props: TaskItemProps) {
  const { task, tagsById, today, variant, tier, selecting, selected } = props;
  const [showSteps, setShowSteps] = useState(false);
  const done = !!task.completedAt;
  const urgency = urgencyOf(task, today);
  const progress = stepProgress(task);
  const metaId = `meta-${task.id}`;
  const stepsId = `steps-${task.id}`;
  const tags = task.tagIds.map((id) => tagsById.get(id)).filter((t): t is Tag => !!t);

  const check = selecting ? (
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
  );

  const title = (
    <button type="button" class="task-title" aria-haspopup="dialog" aria-describedby={metaId} onClick={() => props.onOpen(task)}>
      {task.title}
    </button>
  );

  const stepsToggle = progress && (
    <button type="button" class="steps-toggle" aria-expanded={showSteps} aria-controls={stepsId} onClick={() => setShowSteps(!showSteps)}>
      {variant === 'row' ? (
        <span class="bar bar-small" aria-hidden="true">
          <span style={{ width: `${Math.floor((progress.done / progress.total) * 100)}%` }} />
        </span>
      ) : (
        <Icon name="steps" size={13} />
      )}
      <span>
        {progress.done} of {progress.total} steps
      </span>
      <span class="sr-only">{showSteps ? ', hide' : ', show'}</span>
    </button>
  );

  const source = task.source && (
    <span class={`meta meta-source${task.source.removedAt ? ' is-removed' : ''}`}>
      <Icon name="link" size={13} />
      <span>
        {task.source.removedAt
          ? `No longer listed in ${SOURCE_NAMES[task.source.kind]}`
          : `From ${linkedKinds(task.source).map((k) => SOURCE_NAMES[k]).join(' and ')}`}
      </span>
    </span>
  );

  const stepList = progress && showSteps && (
    <ul class="step-list" id={stepsId} aria-label={`Steps for “${task.title}”`}>
      {task.steps.map((step) => (
        <li key={step.id}>
          <label class="step">
            <input
              type="checkbox"
              class="step-check"
              checked={step.done}
              onChange={(e) => props.onToggleStep(task, step.id, e.currentTarget.checked)}
            />
            <span class={step.done ? 'step-done' : undefined}>{step.title}</span>
          </label>
        </li>
      ))}
    </ul>
  );

  const classes = `task task-${variant}${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`;

  if (variant === 'card') {
    // The group heading already says "Overdue" / "Due today", so only add what it doesn't.
    const dueText =
      !task.due || tier === 'today'
        ? null
        : urgency === 'overdue'
          ? dueDescription(task, today)
          : task.due === addDays(today, 1)
            ? 'Tomorrow'
            : formatDate(task.due, today);
    return (
      <li class={classes} data-task-id={task.id}>
        {check}
        <div class="task-body">
          {title}
          <div class="task-meta" id={metaId}>
            {dueText && (
              <span class={`meta urgency-${urgency}`}>
                <Icon name={urgency === 'overdue' ? 'alert' : 'calendar'} size={13} />
                <span>
                  {urgency !== 'overdue' && <span class="sr-only">Due </span>}
                  {dueText}
                </span>
              </span>
            )}
            {task.importance === 'high' && (tier === 'overdue' || tier === 'today') && (
              <span class="meta importance-high">
                <Icon name="flag" size={13} />
                <span>High importance</span>
              </span>
            )}
            {stepsToggle && <span class="meta">{stepsToggle}</span>}
            {source}
            {tags.length > 0 && (
              <span class="meta">
                <Icon name="tag" size={13} />
                <span>{tags.map((t) => t.name).join(', ')}</span>
              </span>
            )}
          </div>
          {stepList}
        </div>
      </li>
    );
  }

  const description = dueDescription(task, today);
  return (
    <li class={classes} data-task-id={task.id}>
      {check}
      <div class="task-body">
        {title}
        {(stepsToggle || source) && (
          <div class="task-meta">
            {stepsToggle && <span class="meta">{stepsToggle}</span>}
            {source}
          </div>
        )}
        {stepList}
      </div>
      {/* Read by screen readers as the checkbox and title description. */}
      <div class="task-cells" id={metaId}>
        <span class="cell cell-due">
          <span class="sr-only">Due: </span>
          <span class="cell-main">{task.due ? formatDate(task.due, today) : 'No date'}</span>
          {done ? (
            <span class="cell-sub">Completed {formatDate(localDate(new Date(task.completedAt!)), today)}</span>
          ) : (
            description && <span class={`cell-sub urgency-${urgency}`}>{description}</span>
          )}
        </span>
        <span class={`cell cell-importance importance-${task.importance}`}>
          <Icon name={task.importance === 'high' ? 'flag' : task.importance === 'low' ? 'down' : 'dash'} size={14} />
          <span>
            {IMPORTANCE_LABELS[task.importance]}
            <span class="sr-only"> importance</span>
          </span>
        </span>
        <span class="cell cell-tags">
          <span class="sr-only">Tags: </span>
          {tags.length ? tags.map((t) => t.name).join(', ') : <span aria-label="None">—</span>}
        </span>
      </div>
    </li>
  );
}
