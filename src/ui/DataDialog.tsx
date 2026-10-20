import { useState } from 'preact/hooks';
import { localDate } from '../domain/dates';
import { MAX_IMPORT_BYTES, exportFilename, exportJson, parseBackup, type ImportPreview } from '../storage/backup';
import { SOURCE_KINDS } from '../domain/types';
import { SOURCE_NAMES, sendToConnector } from '../state/connector';
import { useStore, useStoreState } from '../state/context';
import { Dialog } from './Dialog';
import { useUI } from './uiContext';

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataDialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { data, today, readOnly } = useStoreState();
  const ui = useUI();
  const [preview, setPreview] = useState<(ImportPreview & { fileName: string }) | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(() => store.getRecoveryCopy());
  const [confirmClear, setConfirmClear] = useState(false);

  const exportNow = () => {
    download(exportFilename(today), exportJson(data, new Date().toISOString()));
    ui.notify(`Exported ${data.tasks.length} tasks and ${data.tags.length} tags.`);
  };

  const pickFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    setPreview(null);
    setImportError(null);
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a Polaris backup.');
      const result = parseBackup(await file.text());
      setPreview({ ...result, fileName: file.name });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'That file could not be read.');
    }
  };

  const restore = () => {
    if (!preview) return;
    if (ui.attempt(() => store.replaceAll(preview.data))) {
      ui.notify(`Restored ${preview.taskCount} tasks from ${preview.fileName}.`, { undoable: true });
      onClose();
    }
  };

  return (
    <Dialog title="Backup & restore" onRequestClose={onClose} wide>
      <section class="data-section" aria-labelledby="storage-h">
        <h3 id="storage-h">Where your data lives</h3>
        <p>
          Your tasks are saved automatically in this browser on this device. Nothing is sent anywhere. Clearing site
          data for this page erases them, so export a backup regularly, and use it to move your tasks to another
          device or browser.
        </p>
      </section>

      <SourcesSection />

      <section class="data-section" aria-labelledby="export-h">
        <h3 id="export-h">Export</h3>
        <p>
          Downloads all {data.tasks.length} tasks and {data.tags.length} tags as a JSON file (format described in
          docs/DATA_FORMAT.md).
        </p>
        <button type="button" class="button primary" onClick={exportNow}>
          Export backup
        </button>
      </section>

      <section class="data-section" aria-labelledby="import-h">
        <h3 id="import-h">Restore from a backup</h3>
        <p>Restoring replaces everything currently in Polaris. You can undo a restore until you reload the page.</p>
        <label for="import-file" class="file-label">
          Choose a backup file
        </label>
        <input id="import-file" type="file" accept="application/json,.json" disabled={readOnly} onChange={pickFile} />
        {importError && (
          <p class="field-error" role="alert">
            {importError}
          </p>
        )}
        {preview && (
          <div class="confirm-box" role="region" aria-label="Restore preview">
            <p>
              <strong>{preview.fileName}</strong> contains {preview.taskCount} tasks ({preview.openCount} open) and{' '}
              {preview.tagCount} tags. It will replace your current {data.tasks.length} tasks and {data.tags.length} tags.
            </p>
            {preview.issues.length > 0 && (
              <details>
                <summary>{preview.issues.length} problems in the file will be repaired</summary>
                <ul>
                  {preview.issues.slice(0, 50).map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </details>
            )}
            <div class="button-row">
              <button type="button" class="button" onClick={exportNow}>
                Export current data first
              </button>
              <button type="button" class="button danger" onClick={restore}>
                Replace my data
              </button>
            </div>
          </div>
        )}
      </section>

      {recovery && (
        <section class="data-section" aria-labelledby="recovery-h">
          <h3 id="recovery-h">Recovery copy</h3>
          <p>
            On {new Date(recovery.savedAt).toLocaleString()}, Polaris found stored data it couldn't load as-is and kept
            the original here: {recovery.reason.slice(0, 300)}
          </p>
          <div class="button-row">
            <button
              type="button"
              class="button"
              onClick={() => download(`polaris-recovery-${localDate(new Date(recovery.savedAt))}.json`, recovery.raw)}
            >
              Download recovery copy
            </button>
            {confirmClear ? (
              <span class="confirm-inline" role="alert">
                Delete it permanently?
                <button
                  type="button"
                  class="button danger"
                  onClick={() => {
                    store.clearRecoveryCopy();
                    setRecovery(null);
                    ui.notify('Recovery copy deleted.');
                  }}
                >
                  Yes, delete
                </button>
                <button type="button" class="button" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" class="button danger-outline" onClick={() => setConfirmClear(true)}>
                Delete recovery copy…
              </button>
            )}
          </div>
        </section>
      )}
    </Dialog>
  );
}

/** Status of the Polaris Connector extension, and deleted assignments that sync skips. */
function SourcesSection() {
  const store = useStore();
  const { data, readOnly, connector } = useStoreState();
  const ui = useUI();
  const dismissed = data.dismissedSources;

  return (
    <section class="data-section" aria-labelledby="sources-h">
      <h3 id="sources-h">Canvas and Gradescope</h3>
      {connector.version ? (
        <>
          <p>
            The Polaris Connector extension (version {connector.version}) adds your Canvas and Gradescope assignments as
            tasks. It reads them with your sign-in on those sites.
          </p>
          <ul class="source-list" aria-label="Sync status">
            {SOURCE_KINDS.map((kind) => {
              const status = connector.sources[kind];
              const when = status && new Date(status.at).toLocaleString();
              return (
                <li key={kind}>
                  <span>
                    <strong>{SOURCE_NAMES[kind]}:</strong>{' '}
                    {!status ? (
                      'not synced yet'
                    ) : status.ok ? (
                      `synced ${when}${status.message ? ` (${status.message})` : ''}`
                    ) : (
                      <span class="source-failed">
                        sync failed {when}
                        {status.message ? `: ${status.message}` : ''}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            class="button"
            disabled={readOnly}
            onClick={() => {
              sendToConnector('sync-now');
              ui.notify('Asked the extension to check Canvas and Gradescope.');
            }}
          >
            Sync now
          </button>
        </>
      ) : (
        <p>
          To add Canvas and Gradescope assignments as tasks automatically, install the Polaris Connector extension for
          Chrome. It reads assignments with your sign-in on those sites; Polaris itself still sends nothing anywhere.
        </p>
      )}
      {dismissed.length > 0 && (
        <details class="dismissed">
          <summary>
            {dismissed.length === 1
              ? '1 deleted assignment won’t be added again'
              : `${dismissed.length} deleted assignments won’t be added again`}
          </summary>
          <ul class="source-list">
            {dismissed.map((d) => (
              <li key={d.keys[0]}>
                <span>{d.title}</span>
                <button
                  type="button"
                  class="button small"
                  disabled={readOnly}
                  onClick={() => {
                    if (ui.attempt(() => store.restoreDismissed(d.keys))) {
                      ui.notify(`“${d.title}” will be added again on the next sync.`, { undoable: true });
                    }
                  }}
                >
                  Allow again<span class="sr-only"> for “{d.title}”</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
