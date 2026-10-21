import { useMemo, useState } from 'preact/hooks';
import { formatDate } from '../domain/dates';
import { focusTier } from '../domain/priority';
import { parseQuickAdd } from '../domain/quickadd';
import type { Tag } from '../domain/types';
import { ValidationError, validateTagName, validateTitle } from '../domain/validation';
import { useStore, useStoreState } from '../state/context';
import { Icon } from './Icon';
import { useUI } from './uiContext';

interface Props {
  /** Tag applied to new tasks when viewing a tag. */
  tag?: Tag;
  /** When true, warn if a new task won't show up in Focus. */
  inFocus?: boolean;
  /** 'card' is the large Focus form; 'bar' is the slim All tasks one. */
  layout: 'card' | 'bar';
}

/**
 * Adds a task from one line of text. Shorthand ("fri", "!high", "#Home") sets
 * the due date, importance and tags; the line under the field previews what
 * will be added (see domain/quickadd.ts).
 */
export function QuickAdd({ tag, inFocus, layout }: Props) {
  const store = useStore();
  const { data, today, readOnly } = useStoreState();
  const ui = useUI();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseQuickAdd(text, data.tags, today), [text, data.tags, today]);
  const tagIds = tag && !parsed.tagIds.includes(tag.id) ? [tag.id, ...parsed.tagIds] : parsed.tagIds;
  const tagNames = [...tagIds.map((id) => data.tags.find((t) => t.id === id)?.name ?? ''), ...parsed.newTags];

  const submit = (e: Event) => {
    e.preventDefault();
    try {
      // Validate everything before creating new tags, so a bad line adds nothing.
      validateTitle(parsed.title);
      parsed.newTags.forEach(validateTagName);
      const created = parsed.newTags.map((name) => store.createTag(name).id);
      const task = store.createTask({
        title: parsed.title,
        due: parsed.due,
        importance: parsed.importance,
        tagIds: [...tagIds, ...created],
      });
      setText('');
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

  const openDetails = () => {
    ui.openEditor({ draft: { title: parsed.title, due: parsed.due, importance: parsed.importance, tagIds } });
    setText('');
    setError(null);
  };

  return (
    <form class={`quick-add quick-add-${layout}`} onSubmit={submit} noValidate>
      <div class="quick-add-row">
        <Icon name="plus" size={18} />
        <label for="quick-add-input" class="sr-only">
          New task
        </label>
        <input
          id="quick-add-input"
          type="text"
          value={text}
          autocomplete="off"
          maxLength={400}
          placeholder={tag ? `Add a task tagged ${tag.name}` : layout === 'bar' ? 'Add a task — try “fri !high #Work”' : 'Add a task'}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby="quick-add-preview"
          disabled={readOnly}
          onInput={(e) => {
            setText(e.currentTarget.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" class="button primary" disabled={readOnly}>
          Add
        </button>
      </div>
      <div class="quick-add-preview">
        {error ? (
          <p id="quick-add-preview" class="field-error" role="alert">
            {error}
          </p>
        ) : (
          <p id="quick-add-preview">
            {text.trim() ? (
              <>
                <span>Adds “{parsed.title || '…'}”</span>
                {parsed.due && (
                  <span class="preview-chip">
                    <Icon name="calendar" size={13} />
                    Due {formatDate(parsed.due, today)}
                  </span>
                )}
                {parsed.importance !== 'normal' && (
                  <span class={`preview-chip importance-${parsed.importance}`}>
                    <Icon name={parsed.importance === 'high' ? 'flag' : 'down'} size={13} />
                    {parsed.importance === 'high' ? 'High' : 'Low'} importance
                  </span>
                )}
                {tagNames.map((name, i) => (
                  <span class="preview-chip" key={name}>
                    <Icon name="tag" size={13} />
                    {name}
                    {i >= tagIds.length && ' (new tag)'}
                  </span>
                ))}
              </>
            ) : (
              <span>
                Try “tomorrow”, “friday”, “!high” or “#{data.tags[0]?.name ?? 'Home'}”.
              </span>
            )}
          </p>
        )}
        <button type="button" class="link" disabled={readOnly} onClick={openDetails}>
          Add with details…
        </button>
      </div>
    </form>
  );
}
