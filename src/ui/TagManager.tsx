import { useEffect, useState } from 'preact/hooks';
import { countTasksWithTag } from '../domain/tasks';
import type { Tag } from '../domain/types';
import { LIMITS } from '../domain/validation';
import { useStore, useStoreState } from '../state/context';
import { Dialog } from './Dialog';
import { useUI } from './uiContext';

function TagRow({ tag }: { tag: Tag }) {
  const store = useStore();
  const { data, readOnly } = useStoreState();
  const ui = useUI();
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const count = countTasksWithTag(data, tag.id);
  const inputId = `tag-name-${tag.id}`;

  // Keep the field in sync when the name changes elsewhere (e.g. undo).
  useEffect(() => setName(tag.name), [tag.name]);

  const rename = (e: Event) => {
    e.preventDefault();
    if (name.trim() === tag.name) return;
    try {
      store.renameTag(tag.id, name);
      setError(null);
      ui.notify(`Renamed tag to “${name.trim()}”.`, { undoable: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the tag.');
    }
  };

  const remove = () => {
    if (ui.attempt(() => store.deleteTag(tag.id))) {
      ui.notify(`Deleted tag “${tag.name}”. ${count} ${count === 1 ? 'task' : 'tasks'} kept.`, { undoable: true });
      requestAnimationFrame(() => document.getElementById('new-tag-name')?.focus());
    }
  };

  return (
    <li class="tag-row">
      <form class="tag-row-form" onSubmit={rename} noValidate>
        <label for={inputId} class="sr-only">
          Name of tag {tag.name}
        </label>
        <input
          id={inputId}
          type="text"
          value={name}
          maxLength={LIMITS.tagName}
          disabled={readOnly}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${inputId}-err` : `${inputId}-count`}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <span class="muted" id={`${inputId}-count`}>
          {count} {count === 1 ? 'task' : 'tasks'}
        </span>
        <button type="submit" class="button small" disabled={readOnly || name.trim() === tag.name}>
          Rename
        </button>
        <button type="button" class="button small danger-outline" disabled={readOnly} onClick={() => setConfirming(true)}>
          Delete…
        </button>
      </form>
      {error && (
        <p id={`${inputId}-err`} class="field-error" role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <div class="confirm-box" role="alert">
          <p>
            Delete the tag “{tag.name}”? {count > 0 ? `It will be removed from ${count} ${count === 1 ? 'task' : 'tasks'}; the tasks themselves are kept.` : ''}
          </p>
          <div class="button-row">
            <button type="button" class="button danger" onClick={remove}>
              Delete tag
            </button>
            <button type="button" class="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function TagManager({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { data, readOnly } = useStoreState();
  const ui = useUI();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = (e: Event) => {
    e.preventDefault();
    try {
      const tag = store.createTag(name);
      setName('');
      setError(null);
      ui.notify(`Created tag “${tag.name}”.`, { undoable: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the tag.');
    }
  };

  return (
    <Dialog title="Tags" onRequestClose={onClose} initialFocus="#new-tag-name">
      <p class="hint">
        Tags are the one way to group tasks in Polaris. A task can have any number of tags; tasks without any appear
        under “Untagged”.
      </p>
      <form class="inline-add" onSubmit={create} noValidate>
        <label for="new-tag-name">New tag</label>
        <input
          id="new-tag-name"
          type="text"
          value={name}
          maxLength={LIMITS.tagName}
          disabled={readOnly}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'new-tag-err' : undefined}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <button type="submit" class="button primary small" disabled={readOnly}>
          Create
        </button>
      </form>
      {error && (
        <p id="new-tag-err" class="field-error" role="alert">
          {error}
        </p>
      )}
      {data.tags.length === 0 ? (
        <p class="muted">No tags yet.</p>
      ) : (
        <ul class="tag-rows" aria-label="Existing tags">
          {data.tags.map((tag) => (
            <TagRow key={tag.id} tag={tag} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
