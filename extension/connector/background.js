/**
 * Polaris Connector service worker. Every 30 minutes (and on request from the
 * Polaris page) it reads each source, keeps the latest batch and status in
 * chrome.storage.local, and delivers them to the most recently used Polaris
 * tab. When Polaris isn't open, the page asks for the cached batches when it
 * next loads. Nothing is sent anywhere except to the Polaris tab.
 */
import { SignedOutError, fetchCanvasBatch } from './canvas.js';

const ALARM = 'sync';
const PERIOD_MINUTES = 30;
const POLARIS_URLS = ['https://nkoshy2.github.io/polaris/*', 'http://localhost:5173/*', 'http://localhost:4173/*'];

/** Each source's fetcher. Gradescope is added in the next step. */
const SOURCES = { canvas: fetchCanvasBatch };

const version = chrome.runtime.getManifest().version;
let running = null;

async function readCache() {
  const { batches = {}, statuses = {} } = await chrome.storage.local.get(['batches', 'statuses']);
  return { batches, statuses };
}

async function deliver(message) {
  const tabs = await chrome.tabs.query({ url: POLARIS_URLS });
  // One tab is enough: Polaris shares saved changes with its other tabs.
  const tab = tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // The tab was opened before the extension loaded, so it has no content script.
    // It gets the cached batch when it is reloaded.
  }
}

async function syncSource(kind) {
  const at = new Date().toISOString();
  let status;
  try {
    const batch = await SOURCES[kind]();
    const { batches } = await readCache();
    await chrome.storage.local.set({ batches: { ...batches, [kind]: batch } });
    await deliver({ type: 'batch', batch });
    status = { kind, ok: true, at };
  } catch (error) {
    const message =
      error instanceof SignedOutError ? error.message : `Couldn't read ${kind === 'canvas' ? 'Canvas' : kind}: ${error?.message ?? error}`;
    status = { kind, ok: false, at, message };
  }
  const { statuses } = await readCache();
  await chrome.storage.local.set({ statuses: { ...statuses, [kind]: status } });
  // A successful batch already reports its own result in Polaris; only failures need a status message.
  if (!status.ok) await deliver({ type: 'status', ...status });
}

/** Runs one sync of every source; concurrent requests share the run in progress. */
function syncAll() {
  running ??= Promise.all(Object.keys(SOURCES).map(syncSource)).finally(() => {
    running = null;
  });
  return running;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
  syncAll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
  syncAll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncAll();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'page-ready') {
    // The page just loaded: give it what we have, then refresh.
    readCache().then(({ batches, statuses }) => {
      sendResponse({ version, batches: Object.values(batches), statuses: Object.values(statuses).filter((s) => !s.ok) });
      syncAll();
    });
    return true;
  }
  if (message?.type === 'sync-now') {
    syncAll();
    return false;
  }
  return false;
});
