import { useStore, useStoreState } from '../state/context';

/** Persistent banners about the health of stored data. */
export function Notices({ onOpenData }: { onOpenData: () => void }) {
  const store = useStore();
  const { loadStatus, loadIssues, saveError, readOnly } = useStoreState();

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
