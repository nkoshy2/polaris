import { useState } from 'preact/hooks';
import { focusTier } from '../domain/priority';
import type { Tag } from '../domain/types';
import { ValidationError } from '../domain/validation';
import { useStore, useStoreState } from '../state/context';
import { Icon } from './Icon';
import { useUI } from './uiContext';

interface Props {
  /** Tag applied to new tasks when viewing a tag. */
  tag?: Tag;
  /** When true, warn if a new task won't show up in Focus. */
  inFocus?: boolean;
}

export function QuickAdd({ tag, inFocus }: Props) {
  const store = useStore();
  const { today, readOnly } = useStoreState();
  const ui = useUI();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: Event) => {
    e.preventDefault();
    try {
      const task = store.createTask({ title, tagIds: tag ? [tag.id] : [] });
      setTitle('');
      setError(null);
      const hidden = inFocus && !focusTier(task, today);
      ui.notify(
        hidden
          ? `Added “${task.title}”. It isn't due soon or high importance, so it's in All tasks rather than Focus.`
          : `Added “${task.title}”.`,
        { undoable: true },
      );
    } catch (err) {
      if (err instanceof ValidationError) setError(err.message);
      else ui.notify(err instanceof Error ? err.message : 'The task could not be added.', { error: true });
    }
  };

  return (
    <form class="quick-add" onSubmit={submit} noValidate>
      <label for="quick-add-input" class="quick-add-label">
        New task{tag ? <span class="muted"> · tagged {tag.name}</span> : null}
      </label>
      <div class="quick-add-row">
        <input
          id="quick-add-input"
          type="text"
          value={title}
          autocomplete="off"
          maxLength={200}
          placeholder="What needs doing?"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'quick-add-error' : 'quick-add-hint'}
          disabled={readOnly}
          onInput={(e) => {
            setTitle(e.currentTarget.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" class="button primary" disabled={readOnly}>
          <Icon name="plus" />
          Add
        </button>
        <button
          type="button"
          class="button"
          disabled={readOnly}
          onClick={() => {
            ui.openEditor({ draft: { title, tagIds: tag ? [tag.id] : [] } });
            setTitle('');
          }}
        >
          Add with details…
        </button>
      </div>
      {error ? (
        <p id="quick-add-error" class="field-error" role="alert">
          {error}
        </p>
      ) : (
        <p id="quick-add-hint" class="sr-only">
          Press Enter to add. Use “Add with details” to set a due date, importance, tags or steps.
        </p>
      )}
    </form>
  );
}
