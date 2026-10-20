import { SOURCE_KINDS } from '../domain/types';
import { SOURCE_NAMES } from '../state/connector';
import { useStore, useStoreState } from '../state/context';

/** Persistent banners about the health of stored data and assignment sync. */
export function Notices({ onOpenData }: { onOpenData: () => void }) {
  const store = useStore();
  const { loadStatus, loadIssues, saveError, readOnly, connector } = useStoreState();

  const banners: { key: string; tone: 'warn' | 'error'; body: preact.ComponentChildren; actions?: preact.ComponentChildren }[] = [];

  if (saveError) {
    banners.push({
      key: 'save',
      tone: 'error',
      body: (
        <>
          <strong>Changes aren't being saved.</strong> {saveError} Your work is still on screen; export a backup so it
          isn't lost if you close this page.
        </>
      ),
      actions: (
        <>
          <button type="button" class="button small" onClick={() => store.retrySave()}>
            Try saving again
          </button>
          <button type="button" class="button small" onClick={onOpenData}>
            Export backup
          </button>
        </>
      ),
    });
  }

  if (readOnly && loadStatus === 'newerVersion') {
    banners.push({
      key: 'newer',
      tone: 'error',
      body: (
        <>
          <strong>Read-only mode.</strong> {loadIssues[0]} Polaris won't change your stored data until then.
        </>
      ),
    });
  } else if (loadStatus === 'repaired' || loadStatus === 'restoredPrevious' || loadStatus === 'unreadable') {
    const summary = {
      repaired: 'Some stored task data was damaged and has been repaired.',
      restoredPrevious: 'The latest stored data could not be read, so Polaris loaded the previous saved copy. Your most recent change may be missing.',
      unreadable: 'Stored task data could not be read, so Polaris started empty.',
    }[loadStatus];
    banners.push({
      key: 'load',
      tone: 'warn',
      body: (
        <>
          <strong>{summary}</strong> The original was kept as a recovery copy, which you can download from Backup.
          {loadIssues.length > 0 && (
            <details>
              <summary>Details ({loadIssues.length})</summary>
              <ul>
                {loadIssues.slice(0, 50).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ),
      actions: (
        <>
          <button type="button" class="button small" onClick={onOpenData}>
            Open Backup
          </button>
          <button type="button" class="button small" onClick={store.dismissLoadNotice}>
            Dismiss
          </button>
        </>
      ),
    });
  }

  // A source whose latest sync failed (e.g. signed out) would otherwise miss new
  // assignments without anyone noticing. Cleared by that source's next good sync.
  const failed = SOURCE_KINDS.flatMap((kind) => {
    const status = connector.sources[kind];
    return status && !status.ok ? [{ kind, status }] : [];
  });
  if (failed.length > 0) {
    banners.push({
      key: 'sync',
      tone: 'warn',
      body: (
        <>
          <strong>{failed.map((f) => SOURCE_NAMES[f.kind]).join(' and ')} sync failed.</strong>{' '}
          {failed.map((f) => f.status.message && <span key={f.kind}>{f.status.message} </span>)}
          New assignments won't appear in Polaris until {failed.length > 1 ? 'they sync' : 'it syncs'} again.
        </>
      ),
      actions: (
        <button type="button" class="button small" onClick={onOpenData}>
          Open Backup
        </button>
      ),
    });
  }

  if (banners.length === 0) return null;
  return (
    <div class="notices">
      {banners.map((b) => (
        <div key={b.key} class={`notice notice-${b.tone}`} role={b.tone === 'error' ? 'alert' : 'status'}>
          <div class="notice-body">{b.body}</div>
          {b.actions && <div class="button-row">{b.actions}</div>}
        </div>
      ))}
    </div>
  );
}
