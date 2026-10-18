import { useMemo, useRef, useState } from 'preact/hooks';
import { addDays } from '../domain/dates';
import { NotFoundError, type TaskInput } from '../domain/tasks';
import type { Importance, Task } from '../domain/types';
import { LIMITS, ValidationError } from '../domain/validation';
import { useStore, useStoreState } from '../state/context';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { useUI } from './uiContext';

interface StepRow {
  key: string;
  id?: string;
  title: string;
  done: boolean;
}

interface FormState {
  title: string;
  notes: string;
  due: string;
  importance: Importance;
  tagIds: string[];
  steps: StepRow[];
}

interface Props {
  task?: Task;
  draft?: { title?: string; tagIds?: string[] };
  onClose: () => void;
}

let rowKey = 0;
const nextKey = () => `row-${++rowKey}`;

function initialState(task?: Task, draft?: Props['draft']): FormState {
  return {
    title: task?.title ?? draft?.title ?? '',
    notes: task?.notes ?? '',
    due: task?.due ?? '',
    importance: task?.importance ?? 'normal',
    tagIds: task?.tagIds ?? draft?.tagIds ?? [],
    steps: (task?.steps ?? []).map((s) => ({ key: nextKey(), id: s.id, title: s.title, done: s.done })),
  };
}

const IMPORTANCE_OPTIONS: { value: Importance; label: string; hint: string }[] = [
  { value: 'high', label: 'High', hint: 'Consequential — shown in Focus even without a due date' },
  { value: 'normal', label: 'Normal', hint: 'The default' },
  { value: 'low', label: 'Low', hint: 'Nice to do' },
];

export function TaskEditor({ task, draft, onClose }: Props) {
  const store = useStore();
  const { data, today, readOnly } = useStoreState();
  const ui = useUI();
  const initial = useMemo(() => initialState(task, draft), []);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newStep, setNewStep] = useState('');
  const [newTag, setNewTag] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const isNew = !task;

  const dirty = JSON.stringify({ ...form, steps: form.steps.map(({ key: _k, ...s }) => s) }) !==
    JSON.stringify({ ...initial, steps: initial.steps.map(({ key: _k, ...s }) => s) }) || newStep.trim() !== '';

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setConfirmDiscard(false);
  };

  const requestClose = () => {
    if (dirty && !readOnly) setConfirmDiscard(true);
    else onClose();
  };

  const toInput = (): TaskInput => {
    const steps = [...form.steps];
    if (newStep.trim()) steps.push({ key: nextKey(), title: newStep, done: false });
    return {
      title: form.title,
      notes: form.notes,
      due: form.due || null,
      importance: form.importance,
      tagIds: form.tagIds.filter((id) => data.tags.some((t) => t.id === id)),
      steps: steps.map((s) => ({ id: s.id, title: s.title, done: s.done })),
    };
  };

  const save = (e: Event) => {
    e.preventDefault();
    try {
      if (task) {
        store.updateTask(task.id, toInput());
        ui.notify(`Saved “${form.title.trim()}”.`, { undoable: true });
      } else {
        const created = store.createTask(toInput());
        ui.notify(`Added “${created.title}”.`, { undoable: true });
      }
      onClose();
    } catch (err) {
      if (err instanceof ValidationError) {
        const field = err.field ?? 'form';
        setErrors({ [field]: err.message });
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus());
      } else if (err instanceof NotFoundError) {
        setErrors({ form: `${err.message} Your edits were not saved.` });
      } else {
        setErrors({ form: err instanceof Error ? err.message : 'Something went wrong while saving.' });
      }
    }
  };

  const addStep = () => {
    if (!newStep.trim()) return;
    if (form.steps.length >= LIMITS.steps) {
      setErrors({ steps: `A task can have at most ${LIMITS.steps} steps.` });
      return;
    }
    update({ steps: [...form.steps, { key: nextKey(), title: newStep.trim(), done: false }] });
    setNewStep('');
  };

  const createTag = () => {
    try {
      const tag = store.createTag(newTag);
      update({ tagIds: [...form.tagIds, tag.id] });
      setNewTag('');
      setErrors((e) => ({ ...e, tagName: '' }));
    } catch (err) {
      setErrors({ tagName: err instanceof Error ? err.message : 'Could not create the tag.' });
    }
  };

  const duplicate = () => {
    if (!task) return;
    if (ui.attempt(() => store.duplicateTask(task.id))) {
      ui.notify(`Duplicated “${task.title}”.`, { undoable: true });
      onClose();
    }
  };

  const remove = () => {
    if (!task) return;
    if (ui.attempt(() => store.deleteTasks([task.id]))) {
      ui.notify(`Deleted “${task.title}”.`, { undoable: true });
      onClose();
      ui.focusTask(null);
    }
  };

  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`err-${name}`} class="field-error" role="alert">
        {errors[name]}
      </p>
    ) : null;
  const errProps = (name: string) => ({
    'data-field': name,
    'aria-invalid': errors[name] ? ('true' as const) : undefined,
    'aria-describedby': errors[name] ? `err-${name}` : undefined,
  });

  const quickDates = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: 'In a week', value: addDays(today, 7) },
  ];

  return (
    <Dialog title={isNew ? 'New task' : 'Edit task'} onRequestClose={requestClose} initialFocus="#task-title" wide>
      <form ref={formRef} class="editor" onSubmit={save} noValidate>
        {errors.form && (
          <p class="form-error" role="alert">
            {errors.form}
          </p>
        )}
        {readOnly && <p class="form-error">Editing is disabled while Polaris is in read-only mode.</p>}

        <div class="field">
          <label for="task-title">Title</label>
          <input
            id="task-title"
            type="text"
            required
            maxLength={LIMITS.title}
            value={form.title}
            autocomplete="off"
            onInput={(e) => update({ title: e.currentTarget.value })}
            {...errProps('title')}
          />
          {fieldError('title')}
        </div>

        <div class="field">
          <label for="task-notes">
            Notes <span class="optional">(optional)</span>
          </label>
          <textarea id="task-notes" rows={3} value={form.notes} onInput={(e) => update({ notes: e.currentTarget.value })} {...errProps('notes')} />
          {fieldError('notes')}
        </div>

        <div class="field-row">
          <fieldset class="field">
            <legend>
              Due date <span class="optional">(optional)</span>
            </legend>
            <div class="due-row">
              <label for="task-due" class="sr-only">
                Due date
              </label>
              <input id="task-due" type="date" value={form.due} onInput={(e) => update({ due: e.currentTarget.value })} {...errProps('due')} />
              {form.due && (
                <button type="button" class="button small" onClick={() => update({ due: '' })}>
                  Remove date
                </button>
              )}
            </div>
            <div class="quick-dates" role="group" aria-label="Quick dates">
              {quickDates.map((d) => (
                <button type="button" class="chip" aria-pressed={form.due === d.value} onClick={() => update({ due: d.value })}>
                  {d.label}
                </button>
              ))}
            </div>
            {fieldError('due')}
          </fieldset>

          <fieldset class="field">
            <legend>Importance</legend>
            <p class="hint" id="importance-hint">
              How much it matters — separate from when it's due.
            </p>
            {IMPORTANCE_OPTIONS.map((o) => (
              <label class="radio" key={o.value}>
                <input
                  type="radio"
                  name="importance"
                  value={o.value}
                  checked={form.importance === o.value}
                  onChange={() => update({ importance: o.value })}
                  aria-describedby={`imp-${o.value}`}
                />
                <span>
                  {o.label}
                  <span class="hint" id={`imp-${o.value}`}>
                    {' '}
                    — {o.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <fieldset class="field">
          <legend>Tags</legend>
          {data.tags.length > 0 ? (
            <div class="tag-options">
              {data.tags.map((tag) => (
                <label class="tag-option" key={tag.id}>
                  <input
                    type="checkbox"
                    checked={form.tagIds.includes(tag.id)}
                    onChange={(e) =>
                      update({
                        tagIds: e.currentTarget.checked ? [...form.tagIds, tag.id] : form.tagIds.filter((id) => id !== tag.id),
                      })
                    }
                  />
                  <span>{tag.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p class="hint">No tags yet. Tags let you group tasks however you like, such as by project or area.</p>
          )}
          <div class="inline-add">
            <label for="new-tag" class="sr-only">
              New tag name
            </label>
            <input
              id="new-tag"
              type="text"
              placeholder="New tag"
              maxLength={LIMITS.tagName}
              value={newTag}
              onInput={(e) => setNewTag(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createTag();
                }
              }}
              {...errProps('tagName')}
            />
            <button type="button" class="button small" onClick={createTag} disabled={readOnly}>
              Create tag
            </button>
          </div>
          {fieldError('tagName')}
          {fieldError('tags')}
        </fieldset>

        <fieldset class="field">
          <legend>Steps</legend>
          <p class="hint">
            Break the task into smaller steps. Completing the task marks every step done; finishing all steps
            doesn't complete the task for you.
          </p>
          {form.steps.length > 0 && (
            <ol class="step-editor">
              {form.steps.map((step, i) => (
                <li key={step.key}>
                  <input
                    type="checkbox"
                    checked={step.done}
                    aria-label={`Step ${i + 1} done`}
                    onChange={(e) => {
                      const done = e.currentTarget.checked;
                      update({ steps: form.steps.map((s) => (s.key === step.key ? { ...s, done } : s)) });
                    }}
                  />
                  <input
                    type="text"
                    value={step.title}
                    maxLength={LIMITS.title}
                    aria-label={`Step ${i + 1}`}
                    onInput={(e) => {
                      const title = e.currentTarget.value;
                      update({ steps: form.steps.map((s) => (s.key === step.key ? { ...s, title } : s)) });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  />
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Remove step ${i + 1}: ${step.title}`}
                    onClick={() => {
                      update({ steps: form.steps.filter((s) => s.key !== step.key) });
                      requestAnimationFrame(() => document.getElementById('new-step')?.focus());
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div class="inline-add">
            <label for="new-step" class="sr-only">
              New step
            </label>
            <input
              id="new-step"
              type="text"
              placeholder="Add a step"
              maxLength={LIMITS.title}
              value={newStep}
              onInput={(e) => setNewStep(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addStep();
                }
              }}
              {...errProps('steps')}
            />
            <button type="button" class="button small" onClick={addStep}>
              Add step
            </button>
          </div>
          {fieldError('steps')}
        </fieldset>

        {confirmDiscard && (
          <div class="confirm-box" role="alert">
            <p>You have unsaved changes. Discard them?</p>
            <div class="button-row">
              <button type="button" class="button danger" onClick={onClose}>
                Discard changes
              </button>
              <button type="button" class="button" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
            </div>
          </div>
        )}

        {confirmDelete && task && (
          <div class="confirm-box" role="alert">
            <p>
              Delete “{task.title}”{task.steps.length > 0 ? ` and its ${task.steps.length} steps` : ''}? You can undo
              this right after.
            </p>
            <div class="button-row">
              <button type="button" class="button danger" onClick={remove}>
                Delete task
              </button>
              <button type="button" class="button" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div class="editor-footer">
          {task && (
            <div class="button-row">
              <button type="button" class="button danger-outline" disabled={readOnly} onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
              <button type="button" class="button" disabled={readOnly} onClick={duplicate}>
                Duplicate
              </button>
            </div>
          )}
          <div class="button-row end">
            <button type="button" class="button" onClick={requestClose}>
              Cancel
            </button>
            <button type="submit" class="button primary" disabled={readOnly}>
              {isNew ? 'Add task' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
