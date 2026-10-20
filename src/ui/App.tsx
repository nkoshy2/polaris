import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_QUERY, type DueFilter, type Query } from '../domain/query';
import { parseSyncBatch } from '../domain/sync';
import { SOURCE_NAMES, describeSync, readConnectorMessage, sendToConnector } from '../state/connector';
import { KEYS } from '../storage/repository';
import { useStore, useStoreState } from '../state/context';
import { DataDialog } from './DataDialog';
import { FocusView } from './FocusView';
import { Icon } from './Icon';
import { Nav, type Scope } from './Nav';
import { Notices } from './Notices';
import { TagManager } from './TagManager';
import { TaskEditor } from './TaskEditor';
import { TasksView } from './TasksView';
import { Toasts, type Toast } from './Toasts';
import { UIContext, type EditorTarget, type UI } from './uiContext';

function parseHash(hash: string): Scope {
  const m = /^#tasks\/(.+)$/.exec(hash);
  if (m) return { view: 'tasks', tag: decodeURIComponent(m[1]!) };
  if (hash === '#tasks') return { view: 'tasks', tag: 'any' };
  return { view: 'focus' };
}

const hashFor = (scope: Scope) => (scope.view === 'focus' ? '#focus' : `#tasks/${encodeURIComponent(scope.tag)}`);

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

let toastId = 0;

export function App() {
  const store = useStore();
  const state = useStoreState();
  const { data, undo, readOnly } = state;

  const [scope, setScope] = useState<Scope>(() => parseHash(location.hash));
  const [query, setQuery] = useState<Query>(() => ({
    ...DEFAULT_QUERY,
    tag: scope.view === 'tasks' ? scope.tag : 'any',
  }));
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [dialog, setDialog] = useState<'tags' | 'data' | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const focusRequest = useRef<{ taskId: string | null; fallback?: string } | null>(null);

  // If the tag being viewed is deleted, fall back to All tasks.
  const viewTag = scope.view === 'tasks' ? scope.tag : 'any';
  useEffect(() => {
    if (viewTag !== 'any' && viewTag !== 'untagged' && !data.tags.some((t) => t.id === viewTag)) {
      navigate({ view: 'tasks', tag: 'any' }, {}, true);
    }
  }, [data.tags, viewTag]);

  const navigate = useCallback((next: Scope, patch: Partial<Query> = {}, replace = false) => {
    setScope(next);
    setQuery((q) => ({ ...DEFAULT_QUERY, sort: q.sort, dir: q.dir, tag: next.view === 'tasks' ? next.tag : 'any', ...patch }));
    setNavOpen(false);
    const hash = hashFor(next);
    if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    requestAnimationFrame(() => document.getElementById('main-heading')?.focus());
  }, []);

  // Keep the tag in the URL in sync when it is changed from the filter bar.
  const changeQuery = (q: Query) => {
    setQuery(q);
    if (scope.view === 'tasks' && q.tag !== scope.tag) {
      const next: Scope = { view: 'tasks', tag: q.tag };
      setScope(next);
      history.replaceState(null, '', hashFor(next));
    }
  };

  useEffect(() => {
    const onPop = () => {
      const next = parseHash(location.hash);
      setScope(next);
      setQuery((q) => ({ ...DEFAULT_QUERY, sort: q.sort, dir: q.dir, tag: next.view === 'tasks' ? next.tag : 'any' }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---- notifications ----------------------------------------------------------

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const ui: UI = useMemo(
    () => ({
      openEditor: (target) => setEditor(target),
      notify: (message, options = {}) => {
        const toast: Toast = { id: ++toastId, message, undoable: !!options.undoable, error: !!options.error };
        // Only the newest toast offers Undo, since undo always reverts the latest change.
        setToasts((ts) => [...ts.map((t) => ({ ...t, undoable: false })), toast].slice(-3));
      },
      attempt: (action) => {
        try {
          action();
          return true;
        } catch (err) {
          ui.notify(err instanceof Error ? err.message : 'Something went wrong.', { error: true });
          return false;
        }
      },
      focusTask: (taskId, fallback) => {
        focusRequest.current = { taskId, fallback };
      },
    }),
    [],
  );

  // Apply pending focus moves after the DOM reflects the latest change.
  useEffect(() => {
    const req = focusRequest.current;
    if (!req) return;
    focusRequest.current = null;
    requestAnimationFrame(() => {
      const own = req.taskId && document.querySelector<HTMLElement>(`[data-task-id="${req.taskId}"] .task-check`);
      const target =
        own || (req.fallback && document.querySelector<HTMLElement>(req.fallback)) || document.getElementById('main-heading');
      if (target && document.activeElement !== target) target.focus();
    });
  });

  const doUndo = useCallback(() => {
    const label = store.undo();
    ui.notify(label ? `Undid: ${label}.` : 'Nothing to undo.');
  }, [store, ui]);

  // ---- global listeners -------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
        e.preventDefault();
        doUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      } else if (e.key === 'n') {
        e.preventDefault();
        document.getElementById('quick-add-input')?.focus();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEYS.data || e.key === null) {
        store.reloadFromStorage();
        ui.notify('Updated with changes made in another tab.');
      }
    };
    // Assignments from the Polaris Connector extension (see src/state/connector.ts).
    const onMessage = (e: MessageEvent) => {
      const msg = readConnectorMessage(e);
      if (!msg) return;
      if (msg.type === 'hello') store.connectorHello(msg.version);
      else if (msg.type === 'status') store.setSourceStatus(msg.kind, msg.status);
      else {
        const parsed = parseSyncBatch(msg.batch);
        if (!parsed) return;
        const { kind } = parsed.batch;
        try {
          const text = describeSync(kind, store.applySync(parsed.batch));
          if (text) ui.notify(text, { undoable: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'The assignments could not be added.';
          store.setSourceStatus(kind, { at: new Date().toISOString(), ok: false, message });
          ui.notify(`${SOURCE_NAMES[kind]} sync failed: ${message}`, { error: true });
        }
      }
    };
    const refresh = () => store.refreshToday();
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMessage);
    sendToConnector('ready');
    return () => {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
    };
  }, [doUndo]);

  const showFiltered = (due?: DueFilter) => navigate({ view: 'tasks', tag: 'any' }, due ? { due } : {});
  const lastUndo = undo.at(-1);
  const editingTask = editor?.taskId ? data.tasks.find((t) => t.id === editor.taskId) : undefined;

  // Close the editor if its task disappears (e.g. deleted in another tab).
  useEffect(() => {
    if (editor?.taskId && !editingTask) {
      setEditor(null);
      ui.notify('The task you were editing no longer exists, so the editor was closed.', { error: true });
    }
  }, [editor, editingTask]);

  return (
    <UIContext.Provider value={ui}>
      <a class="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main-heading')?.focus();
      }}>
        Skip to main content
      </a>
      <header class="topbar">
        <button
          type="button"
          class="icon-button nav-toggle"
          aria-expanded={navOpen}
          aria-controls="primary-nav"
          aria-label="Views and tags"
          onClick={() => setNavOpen(!navOpen)}
        >
          <Icon name="menu" size={20} />
        </button>
        <a class="brand" href="#focus" onClick={(e) => {
          e.preventDefault();
          navigate({ view: 'focus' });
        }}>
          <Icon name="logo" size={20} />
          <span>Polaris</span>
        </a>
        <form class="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <label for="search" class="sr-only">
            Search tasks
          </label>
          <Icon name="search" />
          <input
            id="search"
            type="search"
            placeholder="Search tasks"
            autocomplete="off"
            value={query.text}
            onInput={(e) => {
              const text = e.currentTarget.value;
              if (scope.view === 'focus') {
                // Searching always happens across all tasks.
                setScope({ view: 'tasks', tag: 'any' });
                history.pushState(null, '', hashFor({ view: 'tasks', tag: 'any' }));
                setQuery({ ...DEFAULT_QUERY, sort: query.sort, dir: query.dir, text });
              } else setQuery({ ...query, text });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query.text) {
                e.preventDefault();
                setQuery({ ...query, text: '' });
              }
            }}
          />
        </form>
        <div class="topbar-actions">
          {lastUndo && !readOnly && (
            <button type="button" class="button" onClick={doUndo} title="Undo (Ctrl+Z)">
              <Icon name="undo" />
              Undo<span class="hide-narrow muted">: {lastUndo.label}</span>
            </button>
          )}
          <button type="button" class="button" onClick={() => setDialog('data')}>
            <Icon name="data" />
            Backup
          </button>
        </div>
      </header>

      <Notices onOpenData={() => setDialog('data')} />

      <div class="layout">
        <Nav
          current={scope}
          open={navOpen}
          onNavigate={(s) => navigate(s)}
          onManageTags={() => {
            setNavOpen(false);
            setDialog('tags');
          }}
        />
        <main id="main">
          {scope.view === 'focus' ? (
            <FocusView onShow={showFiltered} />
          ) : (
            <TasksView query={query} onQueryChange={changeQuery} />
          )}
          <footer class="footer">
            <p class="muted">
              Keyboard: <kbd>/</kbd> search · <kbd>n</kbd> new task · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Esc</kbd>{' '}
              close dialog
            </p>
          </footer>
        </main>
      </div>

      <Toasts toasts={toasts} onDismiss={dismissToast} onUndo={doUndo} />

      {editor && (!editor.taskId || editingTask) && (
        <TaskEditor
          key={editor.taskId ?? 'new'}
          task={editingTask}
          draft={editor.draft}
          onClose={() => setEditor(null)}
        />
      )}
      {dialog === 'tags' && <TagManager onClose={() => setDialog(null)} />}
      {dialog === 'data' && <DataDialog onClose={() => setDialog(null)} />}
    </UIContext.Provider>
  );
}
